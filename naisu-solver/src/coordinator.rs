//! Solver network coordinator:
//!   1. Register with naisu-backend on startup
//!   2. Send heartbeat every 30s with current balances
//!   3. Serve HTTP /rfq   — backend calls this to request a quote
//!   4. Serve HTTP /execute — backend calls this when solver wins RFQ (gasless flow)
//!
//! All three tasks are no-ops if SOLVER_NAME or SOLVER_BACKEND_URL are not set.

use crate::config::Config;
use axum::{extract::State, routing::post, Json, Router};
use ethers::{
    abi::{encode as abi_encode, Token},
    middleware::SignerMiddleware,
    providers::{Http, Middleware, Provider},
    signers::{LocalWallet, Signer},
    types::{Address, Bytes, TransactionRequest, U256},
};
use eyre::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

// ============================================================================
// Shared reporter — written after successful registration, read by evm_listener
// ============================================================================

/// Holds all state needed to report steps back to the backend.
pub struct SolverReporter {
    pub backend_url: String,
    pub token:       String,
    pub solver_name: String,
}

/// Arc-wrapped optional reporter shared across async tasks.
pub type SharedReporter = Arc<RwLock<Option<SolverReporter>>>;

/// Create an empty shared reporter (call from main.rs before spawning tasks).
pub fn make_shared_reporter() -> SharedReporter {
    Arc::new(RwLock::new(None))
}

/// Report a solver step (sol_sent / vaa_ready) to naisu-backend via HTTP POST.
/// No-op if registration has not yet completed.
pub async fn report_step(
    reporter: &SharedReporter,
    order_id: &str,
    step_type: &str,
    tx_hash: Option<&str>,
) {
    let guard = reporter.read().await;
    let Some(r) = guard.as_ref() else { return };

    let client = reqwest::Client::new();
    let mut payload = serde_json::json!({
        "orderId": order_id,
        "type":    step_type,
    });
    if let Some(hash) = tx_hash {
        payload["txHash"] = serde_json::Value::String(hash.to_string());
    }

    let url = format!("{}/api/v1/solver/report-step", r.backend_url);
    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", r.token))
        .json(&payload)
        .send()
        .await;

    match res {
        Ok(resp) if resp.status().is_success() => {
            tracing::debug!(step = step_type, order_id, "Step reported to backend");
        }
        Ok(resp) => {
            tracing::warn!(
                step   = step_type,
                status = %resp.status(),
                "report-step returned non-OK"
            );
        }
        Err(e) => {
            tracing::warn!(step = step_type, err = %e, "Failed to report step to backend");
        }
    }
}

// ============================================================================
// API types (backend ↔ solver)
// ============================================================================

#[derive(Serialize)]
struct RegisterBody {
    name:             String,
    #[serde(rename = "evmAddress")]
    evm_address:      String,
    #[serde(rename = "solanaAddress")]
    solana_address:   String,
    #[serde(rename = "callbackUrl")]
    callback_url:     String,
    #[serde(rename = "supportedRoutes")]
    supported_routes: Vec<String>,
}

#[derive(Deserialize)]
struct RegisterResponse {
    data: RegisterData,
}

#[derive(Deserialize)]
struct RegisterData {
    #[serde(rename = "solverId")]
    solver_id: String,
    token: String,
}

#[derive(Serialize)]
struct HeartbeatBody {
    #[serde(rename = "solanaBalance")]
    solana_balance: String,
    #[serde(rename = "evmBalance")]
    evm_balance: String,
    status: String,
}

#[derive(Deserialize)]
pub struct RfqRequest {
    #[serde(rename = "orderId")]
    pub order_id: String,
    #[serde(rename = "startPrice")]
    pub start_price: String,
    #[serde(rename = "floorPrice")]
    pub floor_price: String,
    pub deadline: u64,
}

#[derive(Serialize)]
pub struct RfqResponse {
    #[serde(rename = "quotedPrice")]
    pub quoted_price: String,
    #[serde(rename = "estimatedETA")]
    pub estimated_eta: u64,
    #[serde(rename = "expiresAt")]
    pub expires_at: u64,
}

// ============================================================================
// Internal state for axum handlers
// ============================================================================

struct SolverState {
    solver_name:        String,
    quote_discount_bps: u64,
    eta_seconds:        u64,
    config:             Arc<Config>,
}

// ── Execute endpoint types ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct ExecuteIntentFields {
    creator:           String,
    recipient:         String,   // 0x-prefixed bytes32 hex (64 hex chars)
    #[serde(rename = "destinationChain")]
    destination_chain: u64,
    amount:            String,   // wei as decimal string
    #[serde(rename = "startPrice")]
    start_price:       String,
    #[serde(rename = "floorPrice")]
    floor_price:       String,
    deadline:          u64,
    #[serde(rename = "intentType")]
    intent_type:       u64,
    nonce:             u64,
}

#[derive(Deserialize)]
struct ExecuteRequest {
    #[serde(rename = "intentId")]
    intent_id:        String,
    intent:           ExecuteIntentFields,
    signature:        String,         // 0x-prefixed 65-byte hex
    #[serde(rename = "contractAddress")]
    contract_address: String,
    #[serde(rename = "chainId")]
    chain_id:         u64,
    #[serde(rename = "rpcUrl")]
    rpc_url:          String,
}

#[derive(Serialize)]
struct ExecuteResponse {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error:   Option<String>,
}

// ============================================================================
// Entry point — call from main.rs via tokio::spawn
// ============================================================================

/// Start solver network coordinator. No-op if SOLVER_NAME or SOLVER_BACKEND_URL not set.
/// After successful registration the token is written to `reporter` so that other tasks
/// (e.g. evm_listener) can call `report_step()` to push progress events to the backend.
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

    let evm_address = match derive_evm_address(&config.evm_private_key) {
        Ok(a) => a,
        Err(e) => {
            tracing::warn!("Cannot derive EVM address for coordinator: {e}");
            return;
        }
    };

    let sol_address = match derive_sol_address(&config.solana_private_key) {
        Ok(a) => a,
        Err(e) => {
            tracing::warn!("Cannot derive SOL address for coordinator: {e}");
            return;
        }
    };

    let rfq_port    = config.solver_rfq_port;
    let callback_url = format!("http://127.0.0.1:{rfq_port}");

    // Guard: claim the port before registering — fail fast if already in use
    let addr = format!("0.0.0.0:{rfq_port}");
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!(
                "Cannot bind RFQ port {rfq_port}: {e}\n\
                Another solver instance may already be running. \
                Kill it first (lsof -i :{rfq_port}) then retry."
            );
            std::process::exit(1);
        }
    };
    tracing::info!(%addr, "RFQ port reserved");

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Cannot build HTTP client: {e}");
            return;
        }
    };

    // ── Register ──────────────────────────────────────────────────────────────

    let register_url = format!("{backend_url}/api/v1/solver/register");
    let body = RegisterBody {
        name:             name.clone(),
        evm_address:      evm_address.clone(),
        solana_address:   sol_address.clone(),
        callback_url,
        supported_routes: vec!["evm-base→solana".to_string()],
    };

    let token = match client.post(&register_url).json(&body).send().await {
        Ok(r) if r.status().is_success() => match r.json::<RegisterResponse>().await {
            Ok(data) => {
                tracing::info!(
                    solver_id = %data.data.solver_id,
                    name = %name,
                    "Registered with naisu-backend"
                );
                data.data.token
            }
            Err(e) => {
                tracing::warn!("Register response parse error: {e}");
                return;
            }
        },
        Ok(r) => {
            tracing::warn!(status = %r.status(), "Backend registration failed — solver network disabled");
            return;
        }
        Err(e) => {
            tracing::warn!(err = %e, "Backend unreachable — solver network disabled");
            return;
        }
    };

    // Write reporter so evm_listener can report steps back to the backend
    *reporter.write().await = Some(SolverReporter {
        backend_url: backend_url.clone(),
        token:       token.clone(),
        solver_name: name.clone(),
    });

    // ── Heartbeat loop (background) ───────────────────────────────────────────

    {
        let client2      = client.clone();
        let token2       = token.clone();
        let backend_url2 = backend_url.clone();
        let rpc_url      = config.solana_rpc_url.clone();
        let evm_rpc_url  = config.base_rpc_url.clone();
        let sol_addr     = sol_address.clone();
        let evm_addr     = evm_address.clone();
        let name2        = name.clone();
        let callback_url2 = format!("http://127.0.0.1:{rfq_port}");

        tokio::spawn(async move {
            heartbeat_loop(
                client2, token2, backend_url2, rpc_url, evm_rpc_url, sol_addr, evm_addr,
                name2, callback_url2,
            ).await
        });
    }

    // ── RFQ + Execute HTTP server (blocks task) ───────────────────────────────

    let solver_state = Arc::new(SolverState {
        solver_name:        name,
        quote_discount_bps: config.solver_quote_discount_bps,
        eta_seconds:        config.solver_eta_seconds,
        config:             config.clone(),
    });

    let app = Router::new()
        .route("/rfq",     post(handle_rfq))
        .route("/execute", post(handle_execute))
        .with_state(solver_state);

    tracing::info!(%addr, "RFQ server listening");
    if let Err(e) = axum::serve(listener, app).await {
        tracing::error!("RFQ server error: {e}");
    }
}

// ============================================================================
// Heartbeat loop
// ============================================================================

async fn heartbeat_loop(
    client:       reqwest::Client,
    initial_token: String,
    backend_url:  String,
    sol_rpc:      String,
    evm_rpc:      String,
    sol_address:  String,
    evm_address:  String,
    solver_name:  String,
    callback_url: String,
) {
    let hb_url       = format!("{backend_url}/api/v1/solver/heartbeat");
    let register_url = format!("{backend_url}/api/v1/solver/register");
    let mut token    = initial_token;
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
    interval.tick().await; // discard first instant tick

    loop {
        interval.tick().await;

        let sol_balance = fetch_sol_balance(&client, &sol_rpc, &sol_address)
            .await
            .unwrap_or_else(|_| "0".to_string());

        let evm_balance = fetch_evm_balance(&evm_rpc, &evm_address)
            .await
            .unwrap_or_else(|_| "0".to_string());

        let body = HeartbeatBody {
            solana_balance: sol_balance,
            evm_balance,
            status: "ready".to_string(),
        };

        match client.post(&hb_url).bearer_auth(&token).json(&body).send().await {
            Ok(r) if r.status().is_success() => tracing::debug!("Heartbeat OK"),
            Ok(r) if r.status() == 401 => {
                tracing::warn!("Heartbeat 401 — backend restarted, re-registering...");
                // Re-register to get a fresh token
                let reg_body = RegisterBody {
                    name:             solver_name.clone(),
                    evm_address:      evm_address.clone(),
                    solana_address:   sol_address.clone(),
                    callback_url:     callback_url.clone(),
                    supported_routes: vec!["evm-base→solana".to_string()],
                };
                match client.post(&register_url).json(&reg_body).send().await {
                    Ok(r) if r.status().is_success() => {
                        match r.json::<RegisterResponse>().await {
                            Ok(data) => {
                                tracing::info!(solver_id = %data.data.solver_id, "Re-registered with naisu-backend");
                                token = data.data.token;
                            }
                            Err(e) => tracing::warn!(err = %e, "Re-register parse error"),
                        }
                    }
                    Ok(r) => tracing::warn!(status = %r.status(), "Re-register failed"),
                    Err(e) => tracing::warn!(err = %e, "Re-register request error"),
                }
            }
            Ok(r) => tracing::warn!(status = %r.status(), "Heartbeat failed"),
            Err(e) => tracing::warn!(err = %e, "Heartbeat error"),
        }
    }
}

// ============================================================================
// RFQ handler
// ============================================================================

async fn handle_rfq(
    State(state): State<Arc<SolverState>>,
    Json(req): Json<RfqRequest>,
) -> Json<RfqResponse> {
    // Reject if order already past deadline
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    if req.deadline < now_ms {
        tracing::warn!(order_id = %req.order_id, "RFQ rejected: order past deadline");
        // Return floor price so backend can still include us but we'll score low
    }

    let start_price: u64 = req.start_price.parse().unwrap_or(0);
    let floor_price: u64 = req.floor_price.parse().unwrap_or(0);

    // Quote = startPrice minus solver's discount (better deal for user)
    // Clamped to floor so we never quote below the minimum
    let range       = start_price.saturating_sub(floor_price);
    let discount    = (range * state.quote_discount_bps) / 10_000;
    let quoted_price = start_price.saturating_sub(discount).max(floor_price);

    let expires_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
        + 30_000;  // quote valid for 30s

    tracing::info!(
        order_id = %req.order_id,
        quoted_price,
        eta = state.eta_seconds,
        solver = %state.solver_name,
        "RFQ received — responding with quote"
    );

    Json(RfqResponse {
        quoted_price:  quoted_price.to_string(),
        estimated_eta: state.eta_seconds,
        expires_at,
    })
}

// ============================================================================
// Execute handler — gasless flow: call executeIntent() on EVM with the
// user's EIP-712 signature so the contract emits OrderCreated, then the
// EVM listener picks it up and does the cross-chain execution.
// ============================================================================

async fn handle_execute(
    State(state): State<Arc<SolverState>>,
    Json(req): Json<ExecuteRequest>,
) -> Json<ExecuteResponse> {
    tracing::info!(intent_id = %req.intent_id, "Execute signal received from backend — calling executeIntent()");

    macro_rules! err {
        ($msg:expr) => {
            return Json(ExecuteResponse { success: false, tx_hash: None, error: Some($msg) })
        };
    }

    // Build ethers client
    let wallet = match state.config.evm_private_key.parse::<LocalWallet>() {
        Ok(w) => w.with_chain_id(req.chain_id),
        Err(e) => err!(format!("Invalid private key: {e}")),
    };
    let provider = match Provider::<Http>::try_from(req.rpc_url.as_str()) {
        Ok(p) => p,
        Err(e) => err!(format!("Invalid RPC URL: {e}")),
    };
    let client = SignerMiddleware::new(provider, wallet);

    // Parse intent fields
    let contract_addr: Address = match req.contract_address.parse() {
        Ok(a) => a,
        Err(e) => err!(format!("Invalid contract address: {e}")),
    };
    let creator: Address = match req.intent.creator.parse() {
        Ok(a) => a,
        Err(e) => err!(format!("Invalid creator: {e}")),
    };

    // recipient is bytes32 (0x + 64 hex chars)
    let recipient_hex = req.intent.recipient.trim_start_matches("0x");
    if recipient_hex.len() != 64 {
        err!(format!("recipient must be 64 hex chars, got {}", recipient_hex.len()));
    }
    let mut recipient_bytes = [0u8; 32];
    if hex::decode_to_slice(recipient_hex, &mut recipient_bytes).is_err() {
        err!("Invalid recipient hex".to_string());
    }

    let amount = match U256::from_dec_str(&req.intent.amount) {
        Ok(a) => a,
        Err(e) => err!(format!("Invalid amount: {e}")),
    };
    let start_price = match U256::from_dec_str(&req.intent.start_price) {
        Ok(a) => a,
        Err(e) => err!(format!("Invalid startPrice: {e}")),
    };
    let floor_price = match U256::from_dec_str(&req.intent.floor_price) {
        Ok(a) => a,
        Err(e) => err!(format!("Invalid floorPrice: {e}")),
    };

    // Parse signature
    let sig_hex = req.signature.trim_start_matches("0x");
    let sig_bytes = match hex::decode(sig_hex) {
        Ok(b) => b,
        Err(e) => err!(format!("Invalid signature hex: {e}")),
    };

    // Build ABI calldata for:
    //   executeIntent((address,bytes32,uint16,uint256,uint256,uint256,uint256,uint8,uint256),bytes)
    let selector = &ethers::utils::keccak256(
        b"executeIntent((address,bytes32,uint16,uint256,uint256,uint256,uint256,uint8,uint256),bytes)"
    )[..4];

    let intent_tuple = Token::Tuple(vec![
        Token::Address(creator),
        Token::FixedBytes(recipient_bytes.to_vec()),
        Token::Uint(U256::from(req.intent.destination_chain)),
        Token::Uint(amount),
        Token::Uint(start_price),
        Token::Uint(floor_price),
        Token::Uint(U256::from(req.intent.deadline)),
        Token::Uint(U256::from(req.intent.intent_type)),
        Token::Uint(U256::from(req.intent.nonce)),
    ]);

    let mut calldata = selector.to_vec();
    calldata.extend_from_slice(&abi_encode(&[intent_tuple, Token::Bytes(sig_bytes)]));

    // Get pending nonce
    let nonce = client
        .provider()
        .get_transaction_count(client.address(), Some(ethers::types::BlockNumber::Pending.into()))
        .await
        .ok();

    let mut tx = TransactionRequest::new()
        .to(contract_addr)
        .data(Bytes::from(calldata))
        .value(amount);   // msg.value must equal intent.amount

    if let Some(n) = nonce {
        tx = tx.nonce(n);
    }

    tracing::info!(
        intent_id = %req.intent_id,
        amount    = %amount,
        contract  = %req.contract_address,
        "Sending executeIntent() tx — solver pays gas, order ETH locked in contract"
    );

    // Submit tx — do NOT await the receipt here.
    // Backend HTTP timeout (10s) kills the connection before Base Sepolia mines the block (~15-30s).
    // Solution: submit → copy tx hash → drop client → poll receipt in background task.
    let pending = match client.send_transaction(tx, None).await {
        Ok(p)  => p,
        Err(e) => {
            tracing::error!(intent_id = %req.intent_id, err = %e, "send_transaction failed");
            err!(format!("send_transaction failed: {e}"))
        }
    };

    // Copy the H256 tx hash before dropping pending (which borrows client)
    let tx_hash_h256 = pending.tx_hash();
    let submitted_hash = format!("{:?}", tx_hash_h256);

    tracing::info!(
        intent_id = %req.intent_id,
        tx_hash   = %submitted_hash,
        "executeIntent() submitted — polling confirmation in background"
    );

    // Drop pending + client so background task can own rpc_url without borrow issues
    drop(pending);
    drop(client);

    // Background task: create fresh provider, poll for receipt
    let rpc_url_bg  = req.rpc_url.clone();
    let intent_id_bg = req.intent_id.clone();
    tokio::spawn(async move {
        use ethers::providers::Middleware as _;
        let provider = match Provider::<Http>::try_from(rpc_url_bg.as_str()) {
            Ok(p) => p,
            Err(e) => {
                tracing::error!(intent_id = %intent_id_bg, err = %e, "Background: invalid RPC URL");
                return;
            }
        };

        // Poll every 3s for up to ~5 minutes (100 attempts)
        for attempt in 0u32..100 {
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            match provider.get_transaction_receipt(tx_hash_h256).await {
                Ok(Some(receipt)) => {
                    let tx_hash_str = format!("{:?}", receipt.transaction_hash);
                    if receipt.status == Some(ethers::types::U64::from(1)) {
                        tracing::info!(
                            intent_id = %intent_id_bg,
                            tx_hash   = %tx_hash_str,
                            "executeIntent() mined ✓ — EVM listener will detect OrderCreated and execute cross-chain"
                        );
                    } else {
                        tracing::error!(
                            intent_id = %intent_id_bg,
                            tx_hash   = %tx_hash_str,
                            "executeIntent() REVERTED — check msg.value / signature / nonce"
                        );
                    }
                    return;
                }
                Ok(None) => {
                    if attempt % 10 == 9 {
                        tracing::debug!(intent_id = %intent_id_bg, attempt, "Still waiting for executeIntent() receipt...");
                    }
                }
                Err(e) => tracing::warn!(intent_id = %intent_id_bg, err = %e, "Receipt poll error — retrying"),
            }
        }
        tracing::warn!(intent_id = %intent_id_bg, "executeIntent() receipt poll timed out after 5 min");
    });

    Json(ExecuteResponse { success: true, tx_hash: Some(submitted_hash), error: None })
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
        "method": "getBalance",
        "params": [address, {"commitment": "confirmed"}]
    });
    let resp: serde_json::Value = client.post(rpc).json(&body).send().await?.json().await?;
    let lamports = resp["result"]["value"].as_u64().unwrap_or(0);
    Ok(format!("{:.4}", lamports as f64 / 1e9))
}

async fn fetch_evm_balance(evm_rpc: &str, address: &str) -> Result<String> {
    use ethers::providers::{Http, Middleware, Provider};
    let provider  = Provider::<Http>::try_from(evm_rpc)?;
    let addr: ethers::types::Address = address.parse()?;
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
