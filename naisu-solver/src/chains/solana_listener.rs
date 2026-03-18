use base64::Engine as _;
use crate::{auction, config::Config, executor, wormhole};
use eyre::Result;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use tracing::{error, info, warn};

/// A Solana intent (open order locked on-chain).
#[derive(Debug, Clone)]
pub struct SolanaIntent {
    pub intent_id: [u8; 32],
    pub recipient: [u8; 32],  // destination chain address (EVM = 20 bytes right-aligned)
    pub destination_chain: u16,
    pub amount: u64,      // lamports locked
    pub start_price: u64, // in "gwei" units for cross-chain comparison
    pub floor_price: u64,
    pub deadline: i64,
    pub created_at: i64,
}

/// Compute Anchor account discriminator: sha256("account:<Name>")[0..8]
fn account_discriminator(name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(format!("account:{}", name).as_bytes());
    let result: [u8; 32] = hasher.finalize().into();
    result[..8].try_into().unwrap()
}

/// Parse a 148-byte Intent account data slice into a SolanaIntent.
/// Layout (after 8-byte discriminator):
///   [0..32]   intent_id
///   [32..64]  creator pubkey
///   [64..96]  recipient bytes32
///   [96..98]  destination_chain u16 LE
///   [98..106] amount u64 LE
///   [106..114] start_price u64 LE
///   [114..122] floor_price u64 LE
///   [122..130] deadline i64 LE
///   [130..138] created_at i64 LE
///   [138]     status u8
///   [139]     bump u8
fn parse_intent(data: &[u8]) -> Option<SolanaIntent> {
    // Must be at least 8 (discriminator) + 140 bytes = 148 bytes
    if data.len() < 148 {
        return None;
    }

    // Skip discriminator
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

    Some(SolanaIntent {
        intent_id,
        recipient,
        destination_chain,
        amount,
        start_price,
        floor_price,
        deadline,
        created_at,
    })
}

// ──────────────────────────────────────────────────────────────────────────────
// JSON-RPC response types
// ──────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    result: T,
}

#[derive(Debug, Deserialize)]
struct AccountResult {
    account: AccountData,
}

#[derive(Debug, Deserialize)]
struct AccountData {
    data: Vec<String>, // [base64_data, "base64"]
}

/// Fetch all Intent accounts with status == 0 (open) from the program.
async fn fetch_open_intents(rpc_url: &str, program_id: &str) -> Result<Vec<SolanaIntent>> {
    let discriminator = account_discriminator("Intent");
    let disc_b64 = base64::engine::general_purpose::STANDARD.encode(discriminator);

    // Filter 1: memcmp at offset 0 for Intent discriminator
    // Filter 2: memcmp at offset 146 for status == 0 (STATUS_OPEN)
    let status_open_b64 = base64::engine::general_purpose::STANDARD.encode([0u8]);

    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getProgramAccounts",
        "params": [
            program_id,
            {
                "encoding": "base64",
                "filters": [
                    { "dataSize": 148 },
                    {
                        "memcmp": {
                            "offset": 0,
                            "bytes": disc_b64,
                            "encoding": "base64"
                        }
                    },
                    {
                        "memcmp": {
                            "offset": 146,
                            "bytes": status_open_b64,
                            "encoding": "base64"
                        }
                    }
                ]
            }
        ]
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(rpc_url)
        .json(&body)
        .send()
        .await?
        .json::<RpcResponse<Vec<AccountResult>>>()
        .await?;

    let mut intents = Vec::new();
    for item in &resp.result {
        if item.account.data.is_empty() {
            continue;
        }
        let raw = base64::engine::general_purpose::STANDARD
            .decode(&item.account.data[0])
            .unwrap_or_default();
        if let Some(intent) = parse_intent(&raw) {
            intents.push(intent);
        }
    }
    Ok(intents)
}

// ──────────────────────────────────────────────────────────────────────────────
// Main run loop
// ──────────────────────────────────────────────────────────────────────────────

pub async fn run(config: &Config) -> Result<()> {
    info!(
        program = %config.solana_program_id,
        rpc = %config.solana_rpc_url,
        "Polling Solana intents..."
    );

    let intent_disc = account_discriminator("Intent");
    info!(discriminator = %hex::encode(intent_disc), "Intent discriminator computed");

    // Track intent IDs already attempted this session
    let mut attempted: HashSet<[u8; 32]> = HashSet::new();

    loop {
        let intents = match fetch_open_intents(&config.solana_rpc_url, &config.solana_program_id).await {
            Ok(i) => i,
            Err(e) => {
                warn!("getProgramAccounts failed: {e} — retrying in 10s");
                tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
                continue;
            }
        };

        for intent in &intents {
            // Skip already-attempted intents
            if attempted.contains(&intent.intent_id) {
                continue;
            }

            // Skip intents not destined for EVM chains we handle (Fuji=6, Base=10004)
            let evm_chain = match intent.destination_chain {
                6 => "Avalanche Fuji",
                10004 => "Base Sepolia",
                other => {
                    info!(
                        intent_id = %hex::encode(intent.intent_id),
                        chain = other,
                        "Skipping intent with unsupported destination chain"
                    );
                    attempted.insert(intent.intent_id);
                    continue;
                }
            };

            // Check expiry
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;

            if now >= intent.deadline {
                info!(
                    intent_id = %hex::encode(intent.intent_id),
                    "Solana intent expired, skipping"
                );
                attempted.insert(intent.intent_id);
                continue;
            }

            // Extract EVM recipient from the 32-byte recipient field
            // For EVM: 20-byte address is in the last 20 bytes (right-aligned)
            let evm_recipient_hex = format!("0x{}", hex::encode(&intent.recipient[12..32]));

            // Calculate Dutch auction price (in gwei for cross-chain)
            let now_ms = (now * 1000) as u64;
            let price_gwei = match auction::calculate_price(
                intent.start_price,
                intent.floor_price,
                intent.created_at as u64 * 1000,
                intent.deadline as u64 * 1000,
                now_ms,
            ) {
                Some(p) => p,
                None => {
                    error!(
                        intent_id = %hex::encode(intent.intent_id),
                        "Invalid auction params, skipping"
                    );
                    attempted.insert(intent.intent_id);
                    continue;
                }
            };

            info!(
                intent_id = %hex::encode(intent.intent_id),
                amount_sol = intent.amount as f64 / 1e9,
                price_gwei = price_gwei,
                destination = evm_chain,
                recipient = %evm_recipient_hex,
                "New Solana intent detected — executing..."
            );

            // Mark as in-flight before processing
            attempted.insert(intent.intent_id);

            // Encode intent_id as EVM-compatible bytes32 hex
            let intent_id_hex = hex::encode(intent.intent_id);

            // Build a SuiIntent-like struct to reuse evm_executor::fulfill_and_prove
            // recipient is the EVM address (20 bytes from the right half of recipient bytes32)
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

            // Step 1: Send ETH to recipient on EVM + publish Wormhole message
            let (tx_hash, wh_sequence) =
                match executor::evm_executor::fulfill_and_prove(config, &sui_intent, price_gwei).await {
                    Ok(r) => {
                        info!(tx = %r.0, sequence = r.1, "EVM fulfill_and_prove complete");
                        r
                    }
                    Err(e) => {
                        error!("fulfill_and_prove failed: {e}");
                        continue;
                    }
                };

            // Step 2: Fetch VAA from Wormhole API
            // EVM emitter address (32 bytes, from config)
            let evm_emitter = config.evm_emitter_address.trim_start_matches("0x");
            let vaa = match wormhole::fetch_vaa(
                &config.wormhole_api_url,
                intent.destination_chain,
                evm_emitter,
                wh_sequence,
            )
            .await
            {
                Ok(v) => {
                    info!(sequence = wh_sequence, "VAA fetched");
                    v
                }
                Err(e) => {
                    error!("fetch_vaa failed (tx={tx_hash}): {e}");
                    continue;
                }
            };

            // Step 3: Relay VAA to Solana and claim locked SOL
            match executor::solana_executor::relay_and_claim(
                config,
                &vaa,
                intent.intent_id,
            )
            .await
            {
                Ok(sig) => {
                    info!(signature = %sig, "Solana claim_with_vaa complete — SOL claimed!");
                }
                Err(e) => {
                    error!("relay_and_claim failed: {e}");
                }
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }
}
