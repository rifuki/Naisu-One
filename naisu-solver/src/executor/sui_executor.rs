use crate::chains::evm_listener::EvmOrder;
use crate::config::Config;
use ethers::signers::Signer;
use eyre::Result;
use shared_crypto::intent::{Intent, IntentMessage};
use sui_json::SuiJsonValue;
use sui_sdk::rpc_types::{SuiTransactionBlockResponseOptions, SuiObjectDataOptions, SuiTransactionBlockEffectsAPI};
use sui_sdk::{SuiClient, SuiClientBuilder};
use sui_types::base_types::{ObjectID, SequenceNumber, SuiAddress};
use sui_types::crypto::{Signature, SuiKeyPair};
use sui_types::transaction_driver_types::ExecuteTransactionRequestType;
use sui_types::transaction::{SenderSignedData, Transaction, TransactionData};
use tracing::{info, warn};

/// Request timeout for the Sui JSON-RPC client (30s — if it hasn't responded by then, move on)
const SUI_REQUEST_TIMEOUT_SECS: u64 = 30;
/// Delay between retries within the same round
const RETRY_DELAY_SECS: u64 = 2;
/// How many full rounds through all RPC endpoints before giving up
const MAX_ROUNDS: usize = 3;

/// Build a SuiClient with proper timeout configuration.
async fn build_sui_client(rpc_url: &str) -> eyre::Result<SuiClient> {
    let client = SuiClientBuilder::default()
        .request_timeout(std::time::Duration::from_secs(SUI_REQUEST_TIMEOUT_SECS))
        .build(rpc_url)
        .await
        .map_err(|e| eyre::eyre!("Failed to build SuiClient({}): {e}", rpc_url))?;
    Ok(client)
}

/// Fetch the `initial_shared_version` of a shared object from the RPC.
async fn get_initial_shared_version(sui: &SuiClient, object_id: ObjectID) -> eyre::Result<SequenceNumber> {
    let resp = sui.read_api()
        .get_object_with_options(object_id, SuiObjectDataOptions::new().with_owner())
        .await
        .map_err(|e| eyre::eyre!("get_object({object_id}) failed: {e}"))?;
    let data = resp.data.ok_or_else(|| eyre::eyre!("Object {object_id} not found"))?;
    if let Some(sui_types::object::Owner::Shared { initial_shared_version }) = data.owner {
        return Ok(SequenceNumber::from_u64(initial_shared_version.into()));
    }
    Err(eyre::eyre!("Object {object_id} is not a shared object"))
}

/// Get all RPC URLs (primary + fallbacks) for round-robin failover.
fn all_rpc_urls(config: &Config) -> Vec<String> {
    let mut urls = vec![config.sui_rpc_url.clone()];
    for fb in &config.sui_rpc_fallbacks {
        if !urls.contains(fb) {
            urls.push(fb.clone());
        }
    }
    urls
}

fn build_client_and_key(config: &Config) -> eyre::Result<(SuiKeyPair, SuiAddress)> {
    let keypair = SuiKeyPair::decode(&config.sui_private_key)
        .map_err(|e| eyre::eyre!("Key decode error: {e}"))?;
    let sender: SuiAddress = (&keypair.public()).into();
    Ok((keypair, sender))
}

/// Check if an error is transient / retryable.
/// We use an allowlist of NON-retryable patterns instead: anything that is clearly a
/// business-logic failure (insufficient gas, Move abort, object not found, etc.) should
/// stop immediately. Everything else (network errors, 5xx, "Internal error", etc.)
/// is assumed retryable so we try the next RPC node.
fn is_retryable_error(err: &str) -> bool {
    let lower = err.to_lowercase();
    // Non-retryable: deterministic on-chain / client errors
    let non_retryable = [
        "insufficientgas",
        "insufficient gas",
        "insufficient coin balance",
        "moveabort",
        "move abort",
        "object not found",
        "objectnotfound",
        "invalid transaction",
        "invalid signature",
        "equivocation",
        "package not found",
        "function not found",
        "type error",
        "bcs error",
        "deserialization error",
    ];
    for pat in &non_retryable {
        if lower.contains(pat) {
            return false;
        }
    }
    // Everything else is retryable (504, 502, internal error, timeout, connection issues, etc.)
    true
}

/// EVM→Sui direction (v2 Wormhole):
/// Sends SUI to the user AND publishes a Wormhole message as proof.
/// Returns (tx_digest, wormhole_sequence_number).
///
/// Uses RPC fallback: if the primary node returns 504/timeout, rotates to the next
/// RPC endpoint and retries with a freshly built SuiClient.
pub async fn solve_and_prove(
    config: &Config,
    order: &EvmOrder,
    amount_to_send: u64,
) -> Result<(String, u64)> {
    let (keypair, sender) = build_client_and_key(config)?;

    let ensure_0x = |s: &str| -> String {
        if !s.starts_with("0x") {
            format!("0x{}", s)
        } else {
            s.to_string()
        }
    };

    let package_id: ObjectID = ensure_0x(&config.sui_package_id).parse()?;
    let bridge_state_id: ObjectID = ensure_0x(&config.sui_bridge_state_id).parse()?;
    let wormhole_state_id: ObjectID = ensure_0x(&config.sui_wormhole_state_id).parse()?;

    // Validate recipient is a proper Sui address (32 bytes) and NOT a padded EVM address
    if order.recipient.len() != 32 {
        return Err(eyre::eyre!(
            "Invalid recipient: expected 32 bytes for Sui address, got {} bytes",
            order.recipient.len()
        ));
    }
    
    // Check if it's a padded EVM address (first 12 bytes are zeros, last 20 bytes form valid EVM address)
    let first_12_zeros = order.recipient[..12].iter().all(|&b| b == 0);
    let last_20_nonzero = order.recipient[12..].iter().any(|&b| b != 0);
    if first_12_zeros && last_20_nonzero {
        return Err(eyre::eyre!(
            "Invalid recipient: detected padded EVM address (0x0000...{}). \
             This is likely an EVM address mistakenly used as Sui recipient. \
             SUI sent to this address would be inaccessible without the corresponding Sui private key.",
            hex::encode(&order.recipient[12..])
        ));
    }
    
    let recipient = SuiAddress::from_bytes(order.recipient)
        .map_err(|e| eyre::eyre!("Invalid recipient: {e}"))?;

    // Derive solver EVM wallet address from private key (this is where ETH will be sent)
    let solver_wallet: ethers::signers::LocalWallet = config.evm_private_key
        .parse::<ethers::signers::LocalWallet>()
        .map_err(|e| eyre::eyre!("Invalid evm_private_key: {e}"))?;
    let solver_evm_bytes: Vec<u8> = solver_wallet.address().as_bytes().to_vec();

    let wormhole_fee_mist: u64 = 0;

    // --- RPC fallback loop: try each endpoint, multiple rounds ---
    let rpc_urls = all_rpc_urls(config);
    let total_attempts = rpc_urls.len() * MAX_ROUNDS;
    let mut last_err = String::new();

    for attempt in 0..total_attempts {
        let rpc_url = &rpc_urls[attempt % rpc_urls.len()];
        let round = attempt / rpc_urls.len() + 1;

        if attempt > 0 {
            let delay = if attempt % rpc_urls.len() == 0 {
                info!(round, "Starting new round through all RPC endpoints...");
                RETRY_DELAY_SECS * 2
            } else {
                RETRY_DELAY_SECS
            };
            info!(rpc = %rpc_url, attempt = attempt + 1, round, "Trying Sui RPC...");
            tokio::time::sleep(tokio::time::Duration::from_secs(delay)).await;
        }

        let sui = match build_sui_client(rpc_url).await {
            Ok(c) => c,
            Err(e) => {
                warn!(rpc = %rpc_url, "Failed to build SuiClient: {e}");
                last_err = format!("{e}");
                continue;
            }
        };

        // Fetch initial_shared_version for shared objects
        info!("Fetching shared object versions...");
        let bridge_isv = match get_initial_shared_version(&sui, bridge_state_id).await {
            Ok(v) => v,
            Err(e) => {
                warn!(rpc = %rpc_url, "Failed to get bridge_state version: {e}");
                last_err = format!("{e}");
                continue;
            }
        };
        let wormhole_isv = match get_initial_shared_version(&sui, wormhole_state_id).await {
            Ok(v) => v,
            Err(e) => {
                warn!(rpc = %rpc_url, "Failed to get wormhole_state version: {e}");
                last_err = format!("{e}");
                continue;
            }
        };

        // Build the PTB with correct shared object versions
        let mut ptb = sui_types::programmable_transaction_builder::ProgrammableTransactionBuilder::new();
        
        let payment_amount_arg = ptb.input(sui_types::transaction::CallArg::Pure(bcs::to_bytes(&amount_to_send).unwrap())).unwrap();
        let payment_arg = ptb.command(
            sui_types::transaction::Command::SplitCoins(
                sui_types::transaction::Argument::GasCoin,
                vec![payment_amount_arg],
            )
        );
        
        let fee_amount_arg = ptb.input(sui_types::transaction::CallArg::Pure(bcs::to_bytes(&wormhole_fee_mist).unwrap())).unwrap();
        let fee_arg = ptb.command(
            sui_types::transaction::Command::SplitCoins(
                sui_types::transaction::Argument::GasCoin,
                vec![fee_amount_arg],
            )
        );

        let bridge_state_arg = ptb.obj(sui_types::transaction::ObjectArg::SharedObject {
            id: bridge_state_id,
            initial_shared_version: bridge_isv,
            mutability: sui_types::transaction::SharedObjectMutability::Mutable,
        }).unwrap();

        let recipient_arg = ptb.input(sui_types::transaction::CallArg::Pure(bcs::to_bytes(&recipient).unwrap())).unwrap();
        let order_id_vec: Vec<u8> = order.order_id.to_vec();
        let order_id_arg = ptb.input(sui_types::transaction::CallArg::Pure(bcs::to_bytes(&order_id_vec).unwrap())).unwrap();
        let solver_evm_arg = ptb.input(sui_types::transaction::CallArg::Pure(bcs::to_bytes(&solver_evm_bytes).unwrap())).unwrap();

        let wormhole_state_arg = ptb.obj(sui_types::transaction::ObjectArg::SharedObject {
            id: wormhole_state_id,
            initial_shared_version: wormhole_isv,
            mutability: sui_types::transaction::SharedObjectMutability::Mutable,
        }).unwrap();

        let clock_arg = ptb.obj(sui_types::transaction::ObjectArg::SharedObject {
            id: std::str::FromStr::from_str("0x6").unwrap(),
            initial_shared_version: SequenceNumber::from_u64(1),
            mutability: sui_types::transaction::SharedObjectMutability::Immutable,
        }).unwrap();

        ptb.command(
            sui_types::transaction::Command::MoveCall(
                Box::new(sui_types::transaction::ProgrammableMoveCall {
                    package: package_id,
                    module: "intent_bridge".to_string(),
                    function: "solve_and_prove".to_string(),
                    type_arguments: vec![],
                    arguments: vec![
                        bridge_state_arg,
                        payment_arg,
                        recipient_arg,
                        order_id_arg,
                        solver_evm_arg,
                        wormhole_state_arg,
                        fee_arg,
                        clock_arg,
                    ],
                })
            )
        );

        let pt = ptb.finish();

        info!("Fetching reference gas price...");
        let gas_price = match sui.read_api().get_reference_gas_price().await {
            Ok(p) => p,
            Err(e) => {
                warn!(rpc = %rpc_url, "get_reference_gas_price failed: {e}");
                last_err = format!("{e}");
                continue;
            }
        };

        info!("Fetching SUI coins for gas...");
        // Fetch ALL coins — Sui merges multiple gas coins automatically, so we can use all of
        // them to avoid InsufficientCoinBalance when SUI is spread across multiple coin objects.
        let coins = match sui.coin_read_api().get_coins(sender, None, None, None).await {
            Ok(c) => c,
            Err(e) => {
                warn!(rpc = %rpc_url, "get_coins failed: {e}");
                last_err = format!("{e}");
                continue;
            }
        };

        let gas_coins: Vec<_> = coins.data.iter().map(|c| c.object_ref()).collect();
        if gas_coins.is_empty() {
            return Err(eyre::eyre!("No SUI coins found in solver address for gas"));
        }

        let tx_data = TransactionData::new_programmable(
            sender,
            gas_coins,
            pt,
            50_000_000,
            gas_price,
        );

        let transaction = sign_and_wrap(&keypair, tx_data);
        let tx_digest = transaction.digest();
        info!(rpc = %rpc_url, attempt = attempt + 1, "Submitting PTB solve_and_prove... tx_digest={}", tx_digest);

        match sui.quorum_driver_api()
            .execute_transaction_block(
                transaction,
                SuiTransactionBlockResponseOptions::new().with_effects().with_events(),
                Some(ExecuteTransactionRequestType::WaitForEffectsCert),
            )
            .await
        {
            Ok(response) => {
                let digest = response.digest.to_string();

                // Check transaction status — it can succeed at RPC level but fail on-chain
                if let Some(effects) = &response.effects {
                    let status = effects.status();
                    if status != &sui_sdk::rpc_types::SuiExecutionStatus::Success {
                        let err_str = format!("On-chain failure: {:?}", status);
                        warn!(rpc = %rpc_url, digest = %digest, "{err_str}");
                        // On-chain failures are NOT retryable (same tx will fail again)
                        return Err(eyre::eyre!("solve_and_prove tx failed on-chain ({}): {}", digest, err_str));
                    }
                }

                let sequence = response
                    .events
                    .as_ref()
                    .and_then(|evts| {
                        evts.data.iter().find_map(|e| {
                            if e.type_.name.as_str() == "WormholeMessage" {
                                e.parsed_json
                                    .get("sequence")
                                    .and_then(|v| v.as_str())
                                    .and_then(|s| s.parse::<u64>().ok())
                            } else {
                                None
                            }
                        })
                    })
                    .unwrap_or(0);

                info!(
                    digest = %digest,
                    wormhole_sequence = sequence,
                    to = %recipient,
                    amount = amount_to_send,
                    rpc = %rpc_url,
                    "solve_and_prove complete"
                );

                return Ok((digest, sequence));
            }
            Err(e) => {
                let err_str = format!("{e}");
                warn!(rpc = %rpc_url, attempt = attempt + 1, "execute_transaction_block failed: {err_str}");
                last_err = err_str.clone();
                if !is_retryable_error(&err_str) {
                    return Err(eyre::eyre!("execute_transaction_block failed: {err_str}"));
                }
                continue;
            }
        }
    }

    Err(eyre::eyre!("solve_and_prove failed after {} attempts across {} RPC endpoints ({} rounds). Last error: {}", total_attempts, rpc_urls.len(), MAX_ROUNDS, last_err))
}

/// Sui→EVM direction (v2 Wormhole):
/// Submits Wormhole VAA (from EVM fulfillAndProve tx) to claim_with_vaa().
/// Sui contract verifies VAA and releases locked SUI to solver.
pub async fn claim_with_vaa(
    config: &Config,
    intent_object_id: &str,
    vaa: Vec<u8>,
) -> Result<String> {
    let (keypair, sender) = build_client_and_key(config)?;
    let ensure_0x = |s: &str| -> String {
        if !s.starts_with("0x") {
            format!("0x{}", s)
        } else {
            s.to_string()
        }
    };

    let package_id: ObjectID = ensure_0x(&config.sui_package_id).parse()?;
    let bridge_state_id: ObjectID = ensure_0x(&config.sui_bridge_state_id).parse()?;
    let wormhole_state_id: ObjectID = ensure_0x(&config.sui_wormhole_state_id).parse()?;

    let vaa_json: Vec<serde_json::Value> = vaa
        .iter()
        .map(|b| serde_json::Value::Number((*b).into()))
        .collect();

    let bridge_state_str = ensure_0x(&bridge_state_id.to_string());
    let intent_obj_str = ensure_0x(intent_object_id);
    let wormhole_state_str = ensure_0x(&wormhole_state_id.to_string());

    let rpc_urls = all_rpc_urls(config);
    let total_attempts = rpc_urls.len() * MAX_ROUNDS;
    let mut last_err = String::new();

    for attempt in 0..total_attempts {
        let rpc_url = &rpc_urls[attempt % rpc_urls.len()];
        let round = attempt / rpc_urls.len() + 1;

        if attempt > 0 {
            let delay = if attempt % rpc_urls.len() == 0 {
                info!(round, "Starting new round for claim_with_vaa...");
                RETRY_DELAY_SECS * 2
            } else {
                RETRY_DELAY_SECS
            };
            info!(rpc = %rpc_url, attempt = attempt + 1, round, "Trying Sui RPC for claim_with_vaa...");
            tokio::time::sleep(tokio::time::Duration::from_secs(delay)).await;
        }

        let sui = match build_sui_client(rpc_url).await {
            Ok(c) => c,
            Err(e) => {
                warn!(rpc = %rpc_url, "Failed to build SuiClient: {e}");
                last_err = format!("{e}");
                continue;
            }
        };

        let tx_data = match sui
            .transaction_builder()
            .move_call(
                sender,
                package_id,
                "intent_bridge",
                "claim_with_vaa",
                vec![],
                vec![
                    SuiJsonValue::new(serde_json::json!(bridge_state_str.clone()))
                        .map_err(|e| eyre::eyre!("{e}"))?,
                    SuiJsonValue::new(serde_json::json!(intent_obj_str.clone()))
                        .map_err(|e| eyre::eyre!("{e}"))?,
                    SuiJsonValue::new(serde_json::Value::Array(vaa_json.clone()))
                        .map_err(|e| eyre::eyre!("{e}"))?,
                    SuiJsonValue::new(serde_json::json!(wormhole_state_str.clone()))
                        .map_err(|e| eyre::eyre!("{e}"))?,
                    SuiJsonValue::new(serde_json::json!("0x6"))
                        .map_err(|e| eyre::eyre!("{e}"))?,
                ],
                None,
                50_000_000,
                None,
            )
            .await
        {
            Ok(td) => td,
            Err(e) => {
                let err_str = format!("{e}");
                warn!(rpc = %rpc_url, "move_call(claim_with_vaa) failed: {err_str}");
                last_err = err_str.clone();
                if is_retryable_error(&err_str) { continue; }
                return Err(eyre::eyre!("{e}"));
            }
        };

        let transaction = sign_and_wrap(&keypair, tx_data);
        match sui
            .quorum_driver_api()
            .execute_transaction_block(
                transaction,
                SuiTransactionBlockResponseOptions::new().with_effects(),
                Some(ExecuteTransactionRequestType::WaitForEffectsCert),
            )
            .await
        {
            Ok(response) => {
                let digest = response.digest.to_string();

                // Check transaction status — it can succeed at RPC level but fail on-chain
                if let Some(effects) = &response.effects {
                    let status = effects.status();
                    if status != &sui_sdk::rpc_types::SuiExecutionStatus::Success {
                        let err_str = format!("On-chain failure: {:?}", status);
                        warn!(rpc = %rpc_url, digest = %digest, "{err_str}");
                        return Err(eyre::eyre!("claim_with_vaa tx failed on-chain ({}): {}", digest, err_str));
                    }
                }

                info!(digest = %digest, rpc = %rpc_url, "claim_with_vaa complete — SUI claimed!");
                return Ok(digest);
            }
            Err(e) => {
                let err_str = format!("{e}");
                warn!(rpc = %rpc_url, "execute_transaction_block(claim_with_vaa) failed: {err_str}");
                last_err = err_str.clone();
                if !is_retryable_error(&err_str) {
                    return Err(eyre::eyre!("execute_transaction_block failed: {err_str}"));
                }
                continue;
            }
        }
    }

    Err(eyre::eyre!("claim_with_vaa failed after {} attempts across {} RPC endpoints ({} rounds). Last error: {}", total_attempts, rpc_urls.len(), MAX_ROUNDS, last_err))
}

fn sign_and_wrap(keypair: &SuiKeyPair, tx_data: TransactionData) -> Transaction {
    let intent_msg = IntentMessage::new(Intent::sui_transaction(), &tx_data);
    let sig = Signature::new_secure(&intent_msg, keypair);
    let signed = SenderSignedData::new_from_sender_signature(tx_data, sig);
    Transaction::new(signed)
}
