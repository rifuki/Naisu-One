use base64::Engine as _;
use crate::{auction, config::Config, executor, wormhole};
use eyre::Result;
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::time::{Duration, Instant};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{error, info, warn};

#[derive(Debug, Clone)]
pub struct SolanaIntent {
    pub intent_id: [u8; 32],
    pub recipient: [u8; 32],
    pub destination_chain: u16,
    pub amount: u64,
    pub start_price: u64,
    pub floor_price: u64,
    pub deadline: i64,
    pub created_at: i64,
}

fn account_discriminator(name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(format!("account:{}", name).as_bytes());
    let result: [u8; 32] = hasher.finalize().into();
    result[..8].try_into().unwrap()
}

fn parse_intent(data: &[u8]) -> Option<SolanaIntent> {
    if data.len() < 148 { return None; }
    let d = &data[8..];

    let mut intent_id = [0u8; 32];
    intent_id.copy_from_slice(&d[0..32]);

    let mut recipient = [0u8; 32];
    recipient.copy_from_slice(&d[64..96]);

    let destination_chain = u16::from_le_bytes(d[96..98].try_into().ok()?);
    let amount = u64::from_le_bytes(d[98..106].try_into().ok()?);
    let start_price = u64::from_le_bytes(d[106..114].try_into().ok()?);
    let floor_price = u64::from_le_bytes(d[114..122].try_into().ok()?);
    let deadline = i64::from_le_bytes(d[122..130].try_into().ok()?);
    let created_at = i64::from_le_bytes(d[130..138].try_into().ok()?);

    Some(SolanaIntent { intent_id, recipient, destination_chain, amount, start_price, floor_price, deadline, created_at })
}

#[derive(Debug, Deserialize)]
struct RpcResponse<T> { result: T }

#[derive(Debug, Deserialize)]
struct AccountResult { account: AccountData }

#[derive(Debug, Deserialize)]
struct AccountData { data: Vec<String> }

async fn fetch_open_intents(rpc_url: &str, program_id: &str) -> Result<Vec<SolanaIntent>> {
    let discriminator = account_discriminator("Intent");
    let disc_b64 = base64::engine::general_purpose::STANDARD.encode(discriminator);
    let status_open_b64 = base64::engine::general_purpose::STANDARD.encode([0u8]);

    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": 1,
        "method": "getProgramAccounts",
        "params": [
            program_id,
            {
                "encoding": "base64",
                "filters": [
                    { "dataSize": 148 },
                    { "memcmp": { "offset": 0, "bytes": disc_b64, "encoding": "base64" } },
                    { "memcmp": { "offset": 146, "bytes": status_open_b64, "encoding": "base64" } }
                ]
            }
        ]
    });

    let client = reqwest::Client::new();
    let resp = client.post(rpc_url).json(&body).send().await?
        .json::<RpcResponse<Vec<AccountResult>>>().await?;

    let mut intents = Vec::new();
    for item in &resp.result {
        if item.account.data.is_empty() { continue; }
        let raw = base64::engine::general_purpose::STANDARD
            .decode(&item.account.data[0]).unwrap_or_default();
        if let Some(intent) = parse_intent(&raw) { intents.push(intent); }
    }
    Ok(intents)
}

/// Scan all open intents and process any new ones. Returns number processed.
async fn process_open_intents(config: &Config, attempted: &mut HashSet<[u8; 32]>) {
    let intents = match fetch_open_intents(&config.solana_rpc_url, &config.solana_program_id).await {
        Ok(i) => i,
        Err(e) => { warn!("getProgramAccounts failed: {e}"); return; }
    };

    for intent in &intents {
        if attempted.contains(&intent.intent_id) { continue; }

        let evm_chain = match intent.destination_chain {
            10004 => "Base Sepolia",
            other => {
                info!(
                    intent_id = %hex::encode(intent.intent_id),
                    chain = other,
                    "Skipping intent — unsupported destination"
                );
                attempted.insert(intent.intent_id);
                continue;
            }
        };

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;

        if now >= intent.deadline {
            info!(intent_id = %hex::encode(intent.intent_id), "Solana intent expired, skipping");
            attempted.insert(intent.intent_id);
            continue;
        }

        let evm_recipient_hex = format!("0x{}", hex::encode(&intent.recipient[12..32]));
        let now_ms = (now * 1000) as u64;

        let price_gwei = match auction::calculate_price(
            intent.start_price, intent.floor_price,
            intent.created_at as u64 * 1000,
            intent.deadline as u64 * 1000,
            now_ms,
        ) {
            Some(p) => p,
            None => {
                error!(intent_id = %hex::encode(intent.intent_id), "Invalid auction params, skipping");
                attempted.insert(intent.intent_id);
                continue;
            }
        };

        info!(
            intent_id = %hex::encode(intent.intent_id),
            amount_sol = intent.amount as f64 / 1e9,
            price_gwei,
            destination = evm_chain,
            recipient = %evm_recipient_hex,
            "New Solana intent — executing..."
        );

        attempted.insert(intent.intent_id);

        let intent_id_hex = hex::encode(intent.intent_id);
        let evm_recipient_bytes = intent.recipient[12..32].to_vec();

        let sui_intent = crate::chains::sui_listener::SuiIntent {
            intent_id: intent_id_hex.clone(),
            recipient: evm_recipient_bytes,
            amount: intent.amount,
            start_price: intent.start_price,
            floor_price: intent.floor_price,
            deadline: intent.deadline as u64,
            created_at: intent.created_at as u64,
        };

        let (tx_hash, wh_sequence) =
            match executor::evm_executor::fulfill_and_prove(config, &sui_intent, price_gwei).await {
                Ok(r) => { info!(tx = %r.0, sequence = r.1, "EVM fulfill_and_prove complete"); r }
                Err(e) => { error!("fulfill_and_prove failed: {e}"); continue; }
            };

        let evm_emitter = config.evm_emitter_address.trim_start_matches("0x");
        let vaa = match wormhole::fetch_vaa(
            &config.wormhole_api_url, intent.destination_chain, evm_emitter, wh_sequence,
        ).await {
            Ok(v) => { info!(sequence = wh_sequence, "VAA fetched"); v }
            Err(e) => { error!("fetch_vaa failed (tx={tx_hash}): {e}"); continue; }
        };

        match executor::solana_executor::relay_and_claim(config, &vaa, intent.intent_id).await {
            Ok(sig) => info!(signature = %sig, "Solana claim_with_vaa complete — SOL claimed!"),
            Err(e) => error!("relay_and_claim failed: {e}"),
        }
    }
}

/// Listen for program activity via logsSubscribe WS. On each confirmed tx mentioning
/// the program, immediately scan for new open intents (debounced to 500ms).
/// Reconnects automatically; replays via getProgramAccounts on each reconnect.
pub async fn run(config: &Config) -> Result<()> {
    let ws_url = config.solana_ws_url.clone().unwrap_or_else(|| {
        config.solana_rpc_url
            .replace("https://", "wss://")
            .replace("http://", "ws://")
    });
    let program_id = config.solana_program_id.clone();

    info!(program = %program_id, ws = %ws_url, "Solana WS listener starting...");

    let intent_disc = account_discriminator("Intent");
    info!(discriminator = %hex::encode(intent_disc), "Intent discriminator computed");

    let mut attempted: HashSet<[u8; 32]> = HashSet::new();

    // Initial scan to pick up any open intents already on-chain
    process_open_intents(config, &mut attempted).await;

    loop {
        match connect_async(&ws_url).await {
            Ok((mut ws, _)) => {
                let sub = serde_json::json!({
                    "jsonrpc": "2.0", "id": 1,
                    "method": "logsSubscribe",
                    "params": [
                        { "mentions": [program_id] },
                        { "commitment": "confirmed" }
                    ]
                });

                if ws.send(Message::Text(sub.to_string().into())).await.is_err() {
                    warn!("Solana WS: failed to send subscription — reconnecting...");
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    continue;
                }

                info!("Solana WS connected ✓  streaming program logs...");

                let mut last_scan = Instant::now() - Duration::from_secs(10);
                let mut ping_interval = tokio::time::interval(Duration::from_secs(30));
                ping_interval.tick().await; // consume immediate first tick

                loop {
                    let text = tokio::select! {
                        msg = ws.next() => match msg {
                            Some(Ok(Message::Text(t))) => t,
                            Some(Ok(Message::Ping(p))) => { let _ = ws.send(Message::Pong(p)).await; continue; }
                            Some(Ok(_)) => continue,
                            _ => break,
                        },
                        _ = ping_interval.tick() => {
                            if ws.send(Message::Ping(vec![].into())).await.is_err() { break; }
                            continue;
                        }
                    };

                    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();

                    // Skip subscription confirmation message
                    if v.get("id").is_some() { continue; }

                    // Only act on successful txs
                    let err = &v["params"]["result"]["value"]["err"];
                    if !err.is_null() { continue; }

                    // Debounce: at most one getProgramAccounts scan per 500ms
                    if last_scan.elapsed() >= Duration::from_millis(500) {
                        last_scan = Instant::now();
                        process_open_intents(config, &mut attempted).await;
                    }
                }

                warn!("Solana WS stream ended — reconnecting...");
                // Catchup any intents created while disconnected
                process_open_intents(config, &mut attempted).await;
            }
            Err(e) => warn!("Solana WS connect failed ({ws_url}): {e} — retrying..."),
        }

        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}
