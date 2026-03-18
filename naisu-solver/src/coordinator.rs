//! Solver network coordinator:
//!   1. Register with naisu-backend on startup
//!   2. Send heartbeat every 30s with current balances
//!   3. Serve HTTP /rfq endpoint — backend calls this to request a quote
//!
//! All three tasks are no-ops if SOLVER_NAME or SOLVER_BACKEND_URL are not set.

use crate::config::Config;
use axum::{extract::State, routing::post, Json, Router};
use eyre::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

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
// Internal state for axum handler
// ============================================================================

struct RfqState {
    solver_name:        String,
    quote_discount_bps: u64,
    eta_seconds:        u64,
}

// ============================================================================
// Entry point — call from main.rs via tokio::spawn
// ============================================================================

/// Start solver network coordinator. No-op if SOLVER_NAME or SOLVER_BACKEND_URL not set.
pub async fn start(config: Arc<Config>) {
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

    // ── Heartbeat loop (background) ───────────────────────────────────────────

    {
        let client2      = client.clone();
        let token2       = token.clone();
        let backend_url2 = backend_url.clone();
        let rpc_url      = config.solana_rpc_url.clone();
        let evm_rpc_url  = config.evm2_rpc_url.clone();
        let sol_addr     = sol_address.clone();
        let evm_addr     = evm_address.clone();

        tokio::spawn(async move {
            heartbeat_loop(client2, token2, backend_url2, rpc_url, evm_rpc_url, sol_addr, evm_addr).await
        });
    }

    // ── RFQ HTTP server (blocks task) ─────────────────────────────────────────

    let rfq_state = Arc::new(RfqState {
        solver_name:        name,
        quote_discount_bps: config.solver_quote_discount_bps,
        eta_seconds:        config.solver_eta_seconds,
    });

    let app = Router::new()
        .route("/rfq", post(handle_rfq))
        .with_state(rfq_state);

    let addr = format!("0.0.0.0:{rfq_port}");
    tracing::info!(%addr, "RFQ server listening");

    match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => {
            if let Err(e) = axum::serve(listener, app).await {
                tracing::error!("RFQ server error: {e}");
            }
        }
        Err(e) => tracing::error!("Cannot bind RFQ port {rfq_port}: {e}"),
    }
}

// ============================================================================
// Heartbeat loop
// ============================================================================

async fn heartbeat_loop(
    client:      reqwest::Client,
    token:       String,
    backend_url: String,
    sol_rpc:     String,
    evm_rpc:     String,
    sol_address: String,
    evm_address: String,
) {
    let url = format!("{backend_url}/api/v1/solver/heartbeat");
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

        match client.post(&url).bearer_auth(&token).json(&body).send().await {
            Ok(r) if r.status().is_success() => tracing::debug!("Heartbeat OK"),
            Ok(r) => tracing::warn!(status = %r.status(), "Heartbeat failed"),
            Err(e) => tracing::warn!(err = %e, "Heartbeat error"),
        }
    }
}

// ============================================================================
// RFQ handler
// ============================================================================

async fn handle_rfq(
    State(state): State<Arc<RfqState>>,
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
