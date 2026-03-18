#![allow(dead_code)]
use crate::{auction, config::Config, executor, strategy, wormhole};
use eyre::Result;
use std::collections::HashSet;
use sui_sdk::{SuiClientBuilder, rpc_types::EventFilter};
use sui_types::event::EventID;
use tracing::{error, info, warn};

#[derive(Debug, Clone)]
pub struct SuiIntent {
    pub intent_id: String,
    pub recipient: Vec<u8>, // EVM address bytes (20 bytes)
    pub amount: u64,      // locked SUI in MIST
    pub start_price: u64, // ETH in Gwei (1e9 = 1 ETH)
    pub floor_price: u64,
    pub deadline: u64,
    pub created_at: u64,
}

pub async fn run(config: &Config) -> Result<()> {
    let sui = SuiClientBuilder::default()
        .request_timeout(std::time::Duration::from_secs(60))
        .build(&config.sui_rpc_url)
        .await
        .map_err(|e| eyre::eyre!("{e}"))?;

    info!(pkg = %config.sui_package_id, "Polling Sui intent events...");

    let mut cursor: Option<EventID> = None;
    let mut attempted: HashSet<String> = HashSet::new();

    loop {
        let pkg_id = &config.sui_package_id;
        let event_type = format!("{}::intent_bridge::IntentCreated", pkg_id);
        let filter = match event_type.parse() {
            Ok(f) => EventFilter::MoveEventType(f),
            Err(e) => {
                error!(pkg = %pkg_id, "Failed to parse event type: {e}");
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                continue;
            }
        };
        let page = match sui
            .event_api()
            .query_events(filter, cursor, Some(20), false)
            .await
        {
            Ok(p) => p,
            Err(e) => {
                warn!("query_events failed (will retry next cycle): {e}");
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                continue;
            }
        };

        for event in &page.data {
            let json = &event.parsed_json;

            let Some(intent) = parse_intent(json) else {
                continue;
            };

            if attempted.contains(&intent.intent_id) {
                continue;
            }

            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_millis() as u64;

            if now_ms >= intent.deadline {
                info!(id = %intent.intent_id, "Intent expired, skipping");
                attempted.insert(intent.intent_id.clone());
                continue;
            }

            // VAA buffer depends on chain:
            //   Base Sepolia (CL=1, safe block): ~18-20 min → 25 min buffer
            //   Avalanche Fuji (CL=200, instant): ~30s-2 min → 3 min buffer
            let chain_id_env = std::env::var("EVM_CHAIN_ID").unwrap_or_else(|_| "84532".to_string());
            let vaa_buffer_ms: u64 = if chain_id_env == "43113" {
                3 * 60 * 1000
            } else {
                25 * 60 * 1000
            };
            if intent.deadline.saturating_sub(now_ms) < vaa_buffer_ms {
                info!(
                    id = %intent.intent_id,
                    remaining_ms = intent.deadline.saturating_sub(now_ms),
                    vaa_buffer_ms,
                    "Not enough time left for VAA flow, skipping"
                );
                continue;
            }

            // Check on-chain status — skip if already Fulfilled(1) or Cancelled(2)
            match sui.read_api().get_object_with_options(
                intent.intent_id.parse().map_err(|e| eyre::eyre!("{e}"))?,
                sui_sdk::rpc_types::SuiObjectDataOptions::new().with_content(),
            ).await {
                Ok(resp) => {
                    if let Some(data) = resp.data
                        && let Some(content) = data.content
                    {
                        let fields = match &content {
                            sui_sdk::rpc_types::SuiParsedData::MoveObject(obj) => {
                                Some(&obj.fields)
                            }
                            _ => None,
                        };
                        if let Some(sui_sdk::rpc_types::SuiMoveStruct::WithFields(map)) = fields
                            && let Some(sui_sdk::rpc_types::SuiMoveValue::Number(status)) = map.get("status")
                            && *status != 0
                        {
                            warn!(id = %intent.intent_id, status, "Intent not Open on-chain, skipping");
                            attempted.insert(intent.intent_id.clone());
                            continue;
                        }
                    }
                }
                Err(e) => {
                    error!(id = %intent.intent_id, "Failed to fetch intent object: {e}");
                    continue;
                }
            }

            let price = match auction::calculate_price(
                intent.start_price,
                intent.floor_price,
                intent.created_at,
                intent.deadline,
                now_ms,
            ) {
                Some(p) => p,
                None => {
                    error!(id = %intent.intent_id, "Invalid auction params, skipping");
                    continue;
                }
            };

            info!(
                id = %intent.intent_id,
                amount_mist = intent.amount,
                price_gwei = price,
                "New Sui intent detected"
            );

            if !strategy::is_profitable(intent.amount, price, 50_000, config.min_profit_bps) {
                info!(id = %intent.intent_id, "Not profitable, skipping");
                continue;
            }

            info!(id = %intent.intent_id, price_gwei = price, "Profitable! Executing Wormhole flow...");

            let price_wei = price * 1_000_000_000;

            // Step 1: fulfillAndProve on EVM — sends ETH to user + publishes Wormhole msg
            let mut fulfill_result = None;
            for attempt in 1..=3u32 {
                match executor::evm_executor::fulfill_and_prove(config, &intent, price_wei).await {
                    Ok(result) => {
                        info!(tx = %result.0, sequence = result.1, "ETH sent via fulfillAndProve");
                        fulfill_result = Some(result);
                        break;
                    }
                    Err(e) => {
                        if attempt < 3 {
                            error!(attempt, "fulfillAndProve failed: {e} — retrying in 5s...");
                            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                        } else {
                            error!("fulfillAndProve failed after {attempt} attempt(s): {e}");
                        }
                    }
                }
            }
            let (tx_hash, wh_sequence) = match fulfill_result {
                Some(r) => r,
                None => continue,
            };

            // Step 2: Fetch Wormhole VAA
            let chain_id_str = std::env::var("EVM_CHAIN_ID").unwrap_or_else(|_| "84532".to_string());
            let wh_chain_id = if chain_id_str == "43113" { 6 } else { 10004 };

            let vaa = match wormhole::fetch_vaa(
                &config.wormhole_api_url,
                wh_chain_id,
                &config.evm_emitter_address,
                wh_sequence,
            )
            .await
            {
                Ok(v) => {
                    info!(sequence = wh_sequence, "VAA fetched from Wormhole");
                    v
                }
                Err(e) => {
                    error!("Failed to fetch VAA (tx={tx_hash}): {e}");
                    continue;
                }
            };

            // Step 3: Submit VAA to Sui claim_with_vaa() — releases locked SUI to solver
            match executor::sui_executor::claim_with_vaa(config, &intent.intent_id, vaa).await {
                Ok(digest) => info!(digest = %digest, "SUI claimed via claim_with_vaa!"),
                Err(e) => error!(id = %intent.intent_id, "claim_with_vaa failed: {e}"),
            }
        }

        cursor = page.next_cursor;
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }
}

fn parse_intent(json: &serde_json::Value) -> Option<SuiIntent> {
    Some(SuiIntent {
        intent_id: json.get("intent_id")?.as_str()?.to_string(),
        recipient: json
            .get("recipient")?
            .as_array()?
            .iter()
            .filter_map(|v| v.as_u64().map(|n| n as u8))
            .collect(),
        amount: json.get("amount")?.as_str()?.parse().ok()?,
        start_price: json.get("start_price")?.as_str()?.parse().ok()?,
        floor_price: json.get("floor_price")?.as_str()?.parse().ok()?,
        deadline: json.get("deadline")?.as_str()?.parse().ok()?,
        created_at: json.get("created_at")?.as_str()?.parse().ok()?,
    })
}
