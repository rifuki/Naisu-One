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
const TOKEN_PROGRAM_ID: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioBalances {
    wallet:       String,
    sol:          String, // lamports raw
    msol:         String, // mSOL smallest unit raw
    usdc:         String, // USDC micro-units raw
    msol_decimals: u8,
    usdc_decimals: u8,
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

async fn get_token_balances(wallet: &str) -> eyre::Result<(String, String)> {
    let resp = rpc_call(
        "getParsedTokenAccountsByOwner",
        serde_json::json!([
            wallet,
            { "programId": TOKEN_PROGRAM_ID },
            { "encoding": "jsonParsed", "commitment": "confirmed" }
        ]),
    ).await?;

    let accounts = resp["result"]["value"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    let mut msol = "0".to_string();
    let mut usdc = "0".to_string();

    for acct in accounts {
        let info = &acct["account"]["data"]["parsed"]["info"];
        let mint   = info["mint"].as_str().unwrap_or("");
        let amount = info["tokenAmount"]["amount"].as_str().unwrap_or("0");

        if mint == MSOL_MINT {
            msol = amount.to_string();
        } else if mint == USDC_MINT {
            usdc = amount.to_string();
        }
    }

    Ok((msol, usdc))
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

    let (sol_result, token_result) = tokio::join!(
        get_sol_balance(&params.wallet),
        get_token_balances(&params.wallet),
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
            warn!(error = %e, wallet = %params.wallet, "getParsedTokenAccountsByOwner RPC failed");
            ("0".to_string(), "0".to_string())
        }
    };

    Ok(ApiSuccess::default().with_data(PortfolioBalances {
        wallet:        params.wallet,
        sol,
        msol,
        usdc,
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

// ─── Routes ───────────────────────────────────────────────────────────────────

pub fn portfolio_routes() -> Router<AppState> {
    Router::new()
        .route("/balances",     get(get_balances))
        .route("/unstake-msol", post(unstake_msol))
}
