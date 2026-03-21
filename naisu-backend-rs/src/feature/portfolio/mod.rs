use std::time::Duration;

use axum::{Json, Router, extract::Query, routing::{get, post}};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::{
    infrastructure::web::response::{ApiError, ApiResult, ApiSuccess},
    state::AppState,
};

// ─── Constants ────────────────────────────────────────────────────────────────

const SOLANA_RPC: &str = "https://api.devnet.solana.com";
const MSOL_MINT:  &str = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";
const USDC_MINT:  &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioBalances {
    wallet:          String,
    sol:             String, // lamports raw (native SOL in wallet)
    msol:            String, // mSOL smallest unit raw
    usdc:            String, // USDC micro-units raw
    marginfi_sol:    String, // SOL lamports lent in marginfi (solver account)
    msol_decimals:   u8,
    usdc_decimals:   u8,
}

// ─── Solana JSON-RPC helpers ──────────────────────────────────────────────────

async fn rpc_call(method: &str, params: serde_json::Value) -> eyre::Result<serde_json::Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params
    });

    let resp = client
        .post(SOLANA_RPC)
        .json(&body)
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;

    Ok(resp)
}

async fn get_sol_balance(wallet: &str) -> eyre::Result<u64> {
    let resp = rpc_call(
        "getBalance",
        serde_json::json!([wallet, { "commitment": "confirmed" }]),
    ).await?;

    let lamports = resp["result"]["value"]
        .as_u64()
        .ok_or_else(|| eyre::eyre!("Missing balance in getBalance response"))?;

    Ok(lamports)
}

// SPL token account layout: bytes 64-71 = amount (u64 little-endian)
fn extract_spl_amount(resp: eyre::Result<serde_json::Value>) -> String {
    use base64::Engine;
    resp.ok()
        .and_then(|r| r["result"]["value"].as_array().cloned())
        .and_then(|arr| arr.into_iter().next())
        .and_then(|acct| {
            let data_arr = acct["account"]["data"].as_array()?;
            let b64 = data_arr[0].as_str()?;
            let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
            if bytes.len() < 72 { return None; }
            let amount = u64::from_le_bytes(bytes[64..72].try_into().ok()?);
            Some(amount.to_string())
        })
        .unwrap_or_else(|| "0".to_string())
}

async fn get_token_balances(wallet: &str) -> eyre::Result<(String, String)> {
    let (msol_resp, usdc_resp) = tokio::join!(
        rpc_call(
            "getTokenAccountsByOwner",
            serde_json::json!([wallet, { "mint": MSOL_MINT }, { "encoding": "base64", "commitment": "confirmed" }]),
        ),
        rpc_call(
            "getTokenAccountsByOwner",
            serde_json::json!([wallet, { "mint": USDC_MINT }, { "encoding": "base64", "commitment": "confirmed" }]),
        ),
    );

    Ok((
        extract_spl_amount(msol_resp),
        extract_spl_amount(usdc_resp),
    ))
}

async fn get_marginfi_sol() -> String {
    use std::path::PathBuf;
    use tokio::process::Command;

    let solver_key = match std::env::var("SOLVER_SOLANA_PRIVATE_KEY") {
        Ok(k) => k,
        Err(_) => return "0".to_string(),
    };

    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(&PathBuf::from("/"))
        .join("naisu-contracts/solana/scripts/dist/marginfi_balance.js");

    let output = Command::new("node")
        .arg(&script)
        .arg(SOLANA_RPC)
        .arg(&solver_key)
        .output()
        .await;

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            serde_json::from_str::<serde_json::Value>(&stdout)
                .ok()
                .and_then(|v| v["solLamports"].as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "0".to_string())
        }
        Err(_) => "0".to_string(),
    }
}

// ─── GET /balances ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BalancesQuery {
    pub wallet: String,
}

pub async fn get_balances(
    Query(params): Query<BalancesQuery>,
) -> ApiResult<PortfolioBalances> {
    info!(wallet = %params.wallet, "Portfolio balances requested");

    let (sol_result, token_result, marginfi_sol) = tokio::join!(
        get_sol_balance(&params.wallet),
        get_token_balances(&params.wallet),
        get_marginfi_sol(),
    );

    let sol = match sol_result {
        Ok(lamports) => lamports.to_string(),
        Err(e) => {
            warn!(error = %e, wallet = %params.wallet, "getBalance RPC failed");
            "0".to_string()
        }
    };

    let (msol, usdc) = match token_result {
        Ok(balances) => balances,
        Err(e) => {
            warn!(error = %e, wallet = %params.wallet, "token balance RPC failed");
            ("0".to_string(), "0".to_string())
        }
    };

    Ok(ApiSuccess::default().with_data(PortfolioBalances {
        wallet: params.wallet,
        sol,
        msol,
        usdc,
        marginfi_sol,
        msol_decimals: 9,
        usdc_decimals: 6,
    }))
}

// ─── POST /unstake-msol ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct UnstakeMsolBody {
    pub wallet: String,
    pub amount: String, // raw mSOL units integer string
}

pub async fn unstake_msol(
    Json(body): Json<UnstakeMsolBody>,
) -> ApiResult<serde_json::Value> {
    use std::path::PathBuf;
    use tokio::process::Command;

    info!(wallet = %body.wallet, amount = %body.amount, "Marinade liquid unstake tx requested");

    // Validate amount is a positive integer
    let raw: u64 = body.amount.parse().map_err(|_| {
        ApiError::default()
            .with_code(axum::http::StatusCode::BAD_REQUEST)
            .with_message("amount must be a raw positive integer string")
    })?;
    if raw == 0 {
        return Err(ApiError::default()
            .with_code(axum::http::StatusCode::BAD_REQUEST)
            .with_message("amount must be > 0"));
    }

    // Resolve script path relative to repo root
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(&PathBuf::from("/"))
        .join("naisu-contracts/solana/scripts/dist/marinade_liquid_unstake_tx.js");

    let output = Command::new("node")
        .arg(&script)
        .arg(&body.wallet)
        .arg(&body.amount)
        .arg(SOLANA_RPC)
        .output()
        .await
        .map_err(|e| {
            ApiError::default()
                .with_code(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
                .with_message(&format!("Failed to run unstake script: {e}"))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!(wallet = %body.wallet, stderr = %stderr, "marinade_liquid_unstake_tx failed");
        return Err(ApiError::default()
            .with_code(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
            .with_message("Unstake transaction build failed"));
    }

    let tx_base64 = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if tx_base64.is_empty() {
        return Err(ApiError::default()
            .with_code(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
            .with_message("Unstake script produced no output"));
    }

    Ok(ApiSuccess::default().with_data(serde_json::json!({ "tx": tx_base64 })))
}

// ─── GET /marginfi-balance ────────────────────────────────────────────────────

pub async fn get_marginfi_balance() -> ApiResult<serde_json::Value> {
    use std::path::PathBuf;
    use tokio::process::Command;

    let solver_key = std::env::var("SOLVER_SOLANA_PRIVATE_KEY").map_err(|_| {
        ApiError::default()
            .with_code(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
            .with_message("SOLVER_SOLANA_PRIVATE_KEY not configured")
    })?;

    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(&PathBuf::from("/"))
        .join("naisu-contracts/solana/scripts/dist/marginfi_balance.js");

    let output = Command::new("node")
        .arg(&script)
        .arg(SOLANA_RPC)
        .arg(&solver_key)
        .output()
        .await
        .map_err(|e| {
            ApiError::default()
                .with_code(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
                .with_message(&format!("Failed to run balance script: {e}"))
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let result: serde_json::Value = serde_json::from_str(&stdout).unwrap_or_else(|_| {
        serde_json::json!({ "solLamports": "0", "solAmount": "0.000000000" })
    });

    Ok(ApiSuccess::default().with_data(result))
}

// ─── POST /withdraw-marginfi ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct WithdrawMarginfiBody {
    pub wallet: String,   // recipient Solana address (base58)
    pub amount: String,   // SOL amount as decimal string e.g. "0.01"
}

pub async fn withdraw_marginfi(
    Json(body): Json<WithdrawMarginfiBody>,
) -> ApiResult<serde_json::Value> {
    use std::path::PathBuf;
    use tokio::process::Command;

    info!(wallet = %body.wallet, amount = %body.amount, "marginfi withdraw requested");

    let amount_sol: f64 = body.amount.parse().map_err(|_| {
        ApiError::default()
            .with_code(axum::http::StatusCode::BAD_REQUEST)
            .with_message("amount must be a decimal SOL number")
    })?;
    if amount_sol <= 0.0 {
        return Err(ApiError::default()
            .with_code(axum::http::StatusCode::BAD_REQUEST)
            .with_message("amount must be > 0"));
    }

    let solver_key = std::env::var("SOLVER_SOLANA_PRIVATE_KEY").map_err(|_| {
        ApiError::default()
            .with_code(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
            .with_message("SOLVER_SOLANA_PRIVATE_KEY not configured")
    })?;

    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(&PathBuf::from("/"))
        .join("naisu-contracts/solana/scripts/dist/marginfi_withdraw.js");

    let output = Command::new("node")
        .arg(&script)
        .arg(&body.wallet)
        .arg(&body.amount)
        .arg(SOLANA_RPC)
        .arg(&solver_key)
        .output()
        .await
        .map_err(|e| {
            ApiError::default()
                .with_code(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
                .with_message(&format!("Failed to run withdraw script: {e}"))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!(wallet = %body.wallet, stderr = %stderr, "marginfi_withdraw failed");
        // Try to parse JSON error from stdout
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let msg = serde_json::from_str::<serde_json::Value>(&stdout)
            .ok()
            .and_then(|v| v["error"].as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| "Withdraw failed".to_string());
        return Err(ApiError::default()
            .with_code(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
            .with_message(&msg));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let result: serde_json::Value = serde_json::from_str(&stdout).map_err(|_| {
        ApiError::default()
            .with_code(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
            .with_message("Invalid output from withdraw script")
    })?;

    Ok(ApiSuccess::default().with_data(result))
}

// ─── Routes ───────────────────────────────────────────────────────────────────

pub fn portfolio_routes() -> Router<AppState> {
    Router::new()
        .route("/balances",          get(get_balances))
        .route("/marginfi-balance",  get(get_marginfi_balance))
        .route("/unstake-msol",      post(unstake_msol))
        .route("/withdraw-marginfi", post(withdraw_marginfi))
}
