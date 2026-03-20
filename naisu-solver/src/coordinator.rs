//! Solver network coordinator — WebSocket client mode.
//!
//! The solver connects to naisu-backend over WebSocket (/api/v1/solver/ws)
//! and operates as a pure client:
//!   1. Connect and send {type:"register"} — receive {type:"registered", solverId, token}
//!   2. Handle {type:"rfq"}     — compute and send back {type:"rfq_quote"}
//!   3. Handle {type:"execute"} — call executeIntent() on EVM, then send {type:"execute_confirmed"}
//!   4. Send {type:"heartbeat"} every 30s with current balances
//!   5. Reconnect automatically on disconnect (5s delay)
//!
//! evm_listener calls report_step() to push sol_sent/vaa_ready/execute_confirmed events;
//! those go into an mpsc channel and are forwarded to the backend via the WS connection.

use crate::config::Config;
use ethers::{
    abi::{encode as abi_encode, Token},
    middleware::SignerMiddleware,
    providers::{Http, Middleware, Provider},
    signers::{LocalWallet, Signer},
    types::{Address, Bytes, TransactionRequest, U256},
};
use eyre::Result;
use futures::{SinkExt, StreamExt};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::{connect_async, tungstenite::Message};

// ============================================================================
// Shared reporter — backward-compatible public interface used by evm_listener
// ============================================================================

/// Holds the sender end of the mpsc channel used to forward progress messages
/// (sol_sent, vaa_ready, execute_confirmed) from evm_listener to the WS connection.
pub type SharedReporter = Arc<RwLock<Option<mpsc::Sender<String>>>>;

/// Create an empty shared reporter. Call from main.rs before spawning tasks.
pub fn make_shared_reporter() -> SharedReporter {
    Arc::new(RwLock::new(None))
}

/// Report a solver progress step to naisu-backend.
/// Serializes the step as a JSON WS message and sends it via the mpsc channel
/// that the active WebSocket session is reading from.
/// No-op if the channel is not yet set up (registration not complete).
pub async fn report_step(
    reporter: &SharedReporter,
    order_id: &str,
    step_type: &str,
    tx_hash: Option<&str>,
) {
    let guard = reporter.read().await;
    let Some(tx) = guard.as_ref() else { return };

    let mut msg = serde_json::json!({
        "type":    step_type,
        "orderId": order_id,
    });
    if let Some(hash) = tx_hash {
        msg["txHash"] = Value::String(hash.to_string());
    }

    let payload = msg.to_string();
    if let Err(e) = tx.send(payload).await {
        tracing::warn!(step = step_type, err = %e, "Failed to queue report_step — WS channel closed?");
    }
}

// ============================================================================
// Entry point — call from main.rs via tokio::spawn
// ============================================================================

/// Start solver network coordinator.
/// No-op if SOLVER_NAME or SOLVER_BACKEND_URL are not set.
/// Loops: connect → run session → clear reporter → wait 5s → reconnect.
pub async fn start(config: Arc<Config>, reporter: SharedReporter) {
    let name = match &config.solver_name {
        Some(n) => n.clone(),
        None => {
            tracing::info!("SOLVER_NAME not set — solver network disabled");
            return;
        }
    };

    let backend_url = match &config.solver_backend_url {
        Some(u) => u.trim_end_matches('/').to_string(),
        None => {
            tracing::info!("SOLVER_BACKEND_URL not set — solver network disabled");
            return;
        }
    };

    // Convert http(s):// base URL to a ws(s):// WebSocket URL
    let ws_url = {
        let url = format!("{backend_url}/api/v1/solver/ws");
        if url.starts_with("https://") {
            url.replacen("https://", "wss://", 1)
        } else {
            url.replacen("http://", "ws://", 1)
        }
    };

    tracing::info!(%ws_url, solver = %name, "Solver coordinator starting — will connect to backend WS");

    loop {
        tracing::info!(%ws_url, "Connecting to backend WebSocket...");

        match run_ws_session(&config, &ws_url, Arc::clone(&reporter)).await {
            Ok(()) => tracing::info!("WS session ended cleanly — reconnecting in 5s"),
            Err(e) => tracing::warn!(err = %e, "WS session error — reconnecting in 5s"),
        }

        // Clear reporter so evm_listener does not try to use a dead channel
        *reporter.write().await = None;

        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}

// ============================================================================
// WebSocket session
// ============================================================================

async fn run_ws_session(
    config: &Arc<Config>,
    ws_url: &str,
    reporter: SharedReporter,
) -> Result<()> {
    let (ws_stream, _response) = connect_async(ws_url).await?;
    tracing::info!("WebSocket connected to backend");

    let (mut write, mut read) = ws_stream.split();

    // ── Derive addresses ─────────────────────────────────────────────────────
    let evm_address = derive_evm_address(&config.evm_private_key)?;
    let sol_address = derive_sol_address(&config.solana_private_key)?;
    let solver_name = config.solver_name.as_deref().unwrap_or("unknown").to_string();

    // ── Send register message ─────────────────────────────────────────────────
    let register_msg = serde_json::json!({
        "type":            "register",
        "name":            solver_name,
        "evmAddress":      evm_address,
        "solanaAddress":   sol_address,
        "supportedRoutes": ["evm-base→solana"],
    });
    write.send(Message::Text(register_msg.to_string().into())).await?;
    tracing::debug!("Register message sent");

    // ── Wait for {type:"registered"} ─────────────────────────────────────────
    let registered_resp = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        read.next(),
    )
    .await
    .map_err(|_| eyre::eyre!("Timeout waiting for registered response"))?
    .ok_or_else(|| eyre::eyre!("WS closed before registered response"))?;

    let registered_msg = registered_resp?;
    let registered_text = match &registered_msg {
        Message::Text(t) => t.as_str().to_string(),
        _ => return Err(eyre::eyre!("Expected text for registered response, got {:?}", registered_msg)),
    };

    let registered: Value = serde_json::from_str(&registered_text)?;
    if registered["type"].as_str() != Some("registered") {
        return Err(eyre::eyre!("Expected type=registered, got: {registered_text}"));
    }
    let solver_id = registered["solverId"].as_str().unwrap_or("unknown").to_string();
    tracing::info!(solver_id = %solver_id, "Registered with naisu-backend via WebSocket");

    // ── Create mpsc channel for progress reports from evm_listener ────────────
    // Buffer of 64 allows bursts without blocking evm_listener.
    let (report_tx, mut report_rx) = mpsc::channel::<String>(64);

    // Write the sender into the shared reporter so evm_listener can use it
    *reporter.write().await = Some(report_tx);

    // ── Heartbeat interval ────────────────────────────────────────────────────
    let mut heartbeat_interval = tokio::time::interval(std::time::Duration::from_secs(30));
    heartbeat_interval.tick().await; // discard first instant tick

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    let sol_rpc = config.solana_rpc_url.clone();
    let evm_rpc = config.base_rpc_url.clone();
    let sol_addr_hb = sol_address.clone();
    let evm_addr_hb = evm_address.clone();

    // ── Main event loop ───────────────────────────────────────────────────────
    loop {
        tokio::select! {
            // ── Forward progress reports from evm_listener to backend ──────────
            Some(report_payload) = report_rx.recv() => {
                write.send(Message::Text(report_payload.into())).await?;
            }

            // ── Heartbeat tick ─────────────────────────────────────────────────
            _ = heartbeat_interval.tick() => {
                let sol_bal = fetch_sol_balance(&http_client, &sol_rpc, &sol_addr_hb)
                    .await
                    .unwrap_or_else(|_| "0".to_string());
                let evm_bal = fetch_evm_balance(&evm_rpc, &evm_addr_hb)
                    .await
                    .unwrap_or_else(|_| "0".to_string());

                let hb = serde_json::json!({
                    "type":           "heartbeat",
                    "evmBalance":     evm_bal,
                    "solanaBalance":  sol_bal,
                    "status":         "ready",
                });
                write.send(Message::Text(hb.to_string().into())).await?;
                tracing::debug!("Heartbeat sent");
            }

            // ── Incoming backend message ───────────────────────────────────────
            msg = read.next() => {
                match msg {
                    None => {
                        tracing::info!("WS stream ended by backend");
                        return Ok(());
                    }
                    Some(Err(e)) => {
                        return Err(eyre::eyre!("WS read error: {e}"));
                    }
                    Some(Ok(Message::Ping(data))) => {
                        write.send(Message::Pong(data)).await?;
                    }
                    Some(Ok(Message::Close(_))) => {
                        tracing::info!("WS Close frame received");
                        return Ok(());
                    }
                    Some(Ok(Message::Text(text))) => {
                        let parsed: Value = match serde_json::from_str(text.as_str()) {
                            Ok(v) => v,
                            Err(e) => {
                                tracing::warn!(err = %e, "Non-JSON message from backend — ignoring");
                                continue;
                            }
                        };

                        let msg_type = parsed["type"].as_str().unwrap_or("");

                        match msg_type {
                            "rfq" => {
                                handle_rfq_message(&parsed, config, &mut write).await;
                            }
                            "execute" => {
                                handle_execute_message(&parsed, config, Arc::clone(&reporter)).await;
                            }
                            _ => {
                                tracing::debug!(msg_type, "Unhandled backend message type");
                            }
                        }
                    }
                    Some(Ok(_)) => {
                        // Binary or other frame types — ignore
                    }
                }
            }
        }
    }
}

// ============================================================================
// RFQ message handler
// ============================================================================

async fn handle_rfq_message(
    msg: &Value,
    config: &Arc<Config>,
    write: &mut (impl SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin),
) {
    let order_id = match msg["orderId"].as_str() {
        Some(id) => id.to_string(),
        None => {
            tracing::warn!("rfq message missing orderId — ignoring");
            return;
        }
    };

    // Parse prices — sent as decimal strings
    let start_price: u64 = msg["startPrice"].as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let floor_price: u64 = msg["floorPrice"].as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let deadline = msg["deadline"].as_u64().unwrap_or(0);

    // Reject if order already past deadline
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    if deadline > 0 && deadline < now_ms {
        tracing::warn!(order_id = %order_id, "RFQ rejected: order past deadline");
        // Still respond with floor_price so backend can include us but we score low
    }

    // Quote = startPrice minus solver's discount (better deal for user), clamped to floor
    let range        = start_price.saturating_sub(floor_price);
    let discount     = (range * config.solver_quote_discount_bps) / 10_000;
    let quoted_price = start_price.saturating_sub(discount).max(floor_price);

    let expires_at = now_ms + 30_000; // quote valid for 30s

    tracing::info!(
        order_id = %order_id,
        quoted_price,
        eta      = config.solver_eta_seconds,
        "RFQ received — responding with quote"
    );

    let quote_msg = serde_json::json!({
        "type":         "rfq_quote",
        "orderId":      order_id,
        "quotedPrice":  quoted_price.to_string(),
        "estimatedETA": config.solver_eta_seconds,
        "expiresAt":    expires_at,
    });

    if let Err(e) = write.send(Message::Text(quote_msg.to_string().into())).await {
        tracing::warn!(err = %e, "Failed to send rfq_quote");
    }
}

// ============================================================================
// Execute message handler — gasless flow
// ============================================================================

/// Spawns a background task that calls executeIntent() on EVM.
/// When the tx is mined, sends {type:"execute_confirmed"} via the reporter channel.
async fn handle_execute_message(
    msg: &Value,
    config: &Arc<Config>,
    reporter: SharedReporter,
) {
    let intent_id = match msg["intentId"].as_str() {
        Some(id) => id.to_string(),
        None => {
            tracing::warn!("execute message missing intentId — ignoring");
            return;
        }
    };

    tracing::info!(intent_id = %intent_id, "Execute signal received — calling executeIntent()");

    // Clone everything needed by the background task before spawning
    let config_bg     = Arc::clone(config);
    let reporter_bg   = reporter;
    let intent_id_bg  = intent_id.clone();
    let msg_bg        = msg.clone();

    tokio::spawn(async move {
        if let Err(e) = execute_intent_task(&config_bg, &intent_id_bg, &msg_bg, reporter_bg).await {
            tracing::error!(intent_id = %intent_id_bg, err = %e, "execute_intent_task failed");
        }
    });
}

async fn execute_intent_task(
    config: &Arc<Config>,
    intent_id: &str,
    msg: &Value,
    reporter: SharedReporter,
) -> Result<()> {
    // ── Parse execute message fields ──────────────────────────────────────────
    let intent        = &msg["intent"];
    let signature     = msg["signature"].as_str().unwrap_or("").to_string();
    let contract_addr_str = msg["contractAddress"].as_str().unwrap_or("").to_string();
    let chain_id      = msg["chainId"].as_u64().unwrap_or(84532);
    let rpc_url       = msg["rpcUrl"].as_str().unwrap_or("").to_string();

    // ── Build ethers client ───────────────────────────────────────────────────
    let wallet = config.evm_private_key.parse::<LocalWallet>()?
        .with_chain_id(chain_id);
    let provider = Provider::<Http>::try_from(rpc_url.as_str())?;
    let client   = SignerMiddleware::new(provider, wallet);

    // ── Parse intent fields ───────────────────────────────────────────────────
    let contract_addr: Address = contract_addr_str.parse()?;
    let creator: Address       = intent["creator"].as_str().unwrap_or("").parse()?;

    // recipient is bytes32 (0x + 64 hex chars)
    let recipient_hex = intent["recipient"].as_str().unwrap_or("")
        .trim_start_matches("0x")
        .to_string();
    if recipient_hex.len() != 64 {
        return Err(eyre::eyre!("recipient must be 64 hex chars, got {}", recipient_hex.len()));
    }
    let mut recipient_bytes = [0u8; 32];
    hex::decode_to_slice(&recipient_hex, &mut recipient_bytes)
        .map_err(|e| eyre::eyre!("Invalid recipient hex: {e}"))?;

    let amount = U256::from_dec_str(intent["amount"].as_str().unwrap_or("0"))?;
    let start_price = U256::from_dec_str(intent["startPrice"].as_str().unwrap_or("0"))?;
    let floor_price = U256::from_dec_str(intent["floorPrice"].as_str().unwrap_or("0"))?;
    let destination_chain = intent["destinationChain"].as_u64().unwrap_or(0);
    let deadline          = intent["deadline"].as_u64().unwrap_or(0);
    let intent_type       = intent["intentType"].as_u64().unwrap_or(0);
    let nonce             = intent["nonce"].as_u64().unwrap_or(0);

    // ── Parse signature ───────────────────────────────────────────────────────
    let sig_hex   = signature.trim_start_matches("0x").to_string();
    let sig_bytes = hex::decode(&sig_hex)
        .map_err(|e| eyre::eyre!("Invalid signature hex: {e}"))?;

    // ── Build ABI calldata ────────────────────────────────────────────────────
    // executeIntent((address,bytes32,uint16,uint256,uint256,uint256,uint256,uint8,uint256),bytes)
    let selector = &ethers::utils::keccak256(
        b"executeIntent((address,bytes32,uint16,uint256,uint256,uint256,uint256,uint8,uint256),bytes)"
    )[..4];

    let intent_tuple = Token::Tuple(vec![
        Token::Address(creator),
        Token::FixedBytes(recipient_bytes.to_vec()),
        Token::Uint(U256::from(destination_chain)),
        Token::Uint(amount),
        Token::Uint(start_price),
        Token::Uint(floor_price),
        Token::Uint(U256::from(deadline)),
        Token::Uint(U256::from(intent_type)),
        Token::Uint(U256::from(nonce)),
    ]);

    let mut calldata = selector.to_vec();
    calldata.extend_from_slice(&abi_encode(&[intent_tuple, Token::Bytes(sig_bytes)]));

    // ── Get pending nonce ─────────────────────────────────────────────────────
    let nonce_val = client
        .provider()
        .get_transaction_count(client.address(), Some(ethers::types::BlockNumber::Pending.into()))
        .await
        .ok();

    let mut tx = TransactionRequest::new()
        .to(contract_addr)
        .data(Bytes::from(calldata))
        .value(amount);  // msg.value must equal intent.amount

    if let Some(n) = nonce_val {
        tx = tx.nonce(n);
    }

    tracing::info!(
        intent_id = %intent_id,
        amount    = %amount,
        contract  = %contract_addr_str,
        "Sending executeIntent() tx"
    );

    // ── Submit tx — do NOT await receipt here ─────────────────────────────────
    // The backend WS connection stays alive while we poll in the background.
    let pending = client.send_transaction(tx, None).await
        .map_err(|e| eyre::eyre!("send_transaction failed: {e}"))?;

    let tx_hash_h256      = pending.tx_hash();
    let submitted_hash    = format!("{:?}", tx_hash_h256);

    tracing::info!(
        intent_id = %intent_id,
        tx_hash   = %submitted_hash,
        "executeIntent() submitted — polling confirmation in background"
    );

    drop(pending);
    drop(client);

    // ── Poll for receipt ──────────────────────────────────────────────────────
    let provider2 = Provider::<Http>::try_from(rpc_url.as_str())?;

    for attempt in 0u32..100 {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;

        match provider2.get_transaction_receipt(tx_hash_h256).await {
            Ok(Some(receipt)) => {
                let tx_hash_str = format!("{:?}", receipt.transaction_hash);

                if receipt.status == Some(ethers::types::U64::from(1)) {
                    tracing::info!(
                        intent_id = %intent_id,
                        tx_hash   = %tx_hash_str,
                        "executeIntent() mined — reporting execute_confirmed"
                    );
                    // Use report_step so the message is forwarded over the WS channel
                    report_step(&reporter, intent_id, "execute_confirmed", Some(&submitted_hash)).await;
                } else {
                    tracing::error!(
                        intent_id = %intent_id,
                        tx_hash   = %tx_hash_str,
                        "executeIntent() REVERTED — check msg.value / signature / nonce"
                    );
                }
                return Ok(());
            }
            Ok(None) => {
                if attempt % 10 == 9 {
                    tracing::debug!(intent_id = %intent_id, attempt, "Waiting for executeIntent() receipt...");
                }
            }
            Err(e) => tracing::warn!(intent_id = %intent_id, err = %e, "Receipt poll error — retrying"),
        }
    }

    tracing::warn!(intent_id = %intent_id, "executeIntent() receipt poll timed out after ~5 min");
    Ok(())
}

// ============================================================================
// Balance helpers
// ============================================================================

async fn fetch_sol_balance(
    client:  &reqwest::Client,
    rpc:     &str,
    address: &str,
) -> Result<String> {
    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": 1,
        "method":  "getBalance",
        "params":  [address, {"commitment": "confirmed"}]
    });
    let resp: Value = client.post(rpc).json(&body).send().await?.json().await?;
    let lamports = resp["result"]["value"].as_u64().unwrap_or(0);
    Ok(format!("{:.4}", lamports as f64 / 1e9))
}

async fn fetch_evm_balance(evm_rpc: &str, address: &str) -> Result<String> {
    let provider  = Provider::<Http>::try_from(evm_rpc)?;
    let addr: Address = address.parse()?;
    let balance   = provider.get_balance(addr, None).await?;
    Ok(ethers::utils::format_ether(balance))
}

// ============================================================================
// Address derivation helpers
// ============================================================================

fn derive_evm_address(private_key: &str) -> Result<String> {
    use ethers::signers::Signer;
    let wallet: ethers::signers::LocalWallet = private_key.parse()?;
    Ok(format!("{:?}", wallet.address()))
}

fn derive_sol_address(key: &str) -> Result<String> {
    let key = key.trim();
    let seed: [u8; 32] = if key.len() == 88 {
        let bytes = bs58::decode(key).into_vec().map_err(|e| eyre::eyre!("{e}"))?;
        bytes[..32].try_into().map_err(|_| eyre::eyre!("key too short"))?
    } else {
        let bytes = hex::decode(key.trim_start_matches("0x"))?;
        bytes.try_into().map_err(|_| eyre::eyre!("key wrong length"))?
    };
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&seed);
    Ok(bs58::encode(signing_key.verifying_key().as_bytes()).into_string())
}
