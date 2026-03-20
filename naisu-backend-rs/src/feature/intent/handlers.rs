use alloy::{
    primitives::{Address, FixedBytes, U256},
    providers::{Provider, ProviderBuilder},
    sol,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::Utc;
use serde::Deserialize;
use tracing::{info, warn};

use crate::{
    AppState,
    feature::solver::auction,
    infrastructure::web::response::{ApiError, ApiResult, ApiSuccess},
};

use super::{
    eip712::{self, IntentParams},
    model::{IntentDetails, IntentOrder, IntentStatus, OrderStatus, SupportedChain},
    orderbook,
    price,
};

// ─── On-chain nonce helper ────────────────────────────────────────────────────

sol! {
    #[sol(rpc)]
    interface IIntentBridge {
        function nonces(address user) external view returns (uint256);
    }
}

async fn read_onchain_nonce(state: &AppState, user: Address) -> eyre::Result<u64> {
    let url: alloy::transports::http::reqwest::Url = state.config.chain.rpc_url.parse()?;
    let provider      = ProviderBuilder::new().connect_http(url);
    let contract_addr: Address = state.config.chain.contract_address.parse()?;
    let contract      = IIntentBridge::new(contract_addr, &provider);
    let nonce = contract.nonces(user).call().await?;
    Ok(nonce.to::<u64>())
}

// ─── GET /orders ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct OrdersQuery {
    pub user: String,
    pub chain: Option<SupportedChain>,
}

pub async fn get_orders(
    State(state): State<AppState>,
    Query(params): Query<OrdersQuery>,
) -> ApiResult<serde_json::Value> {
    info!(user = %params.user, chain = ?params.chain, "Intent orders requested");

    let orders = orderbook::get_orders_by_user(
        &state.intent_store,
        &params.user,
        params.chain.as_ref(),
    );

    let total = orders.len();
    let data = serde_json::json!({
        "orders": orders,
        "total": total,
        "source": "store",
    });

    Ok(ApiSuccess::default().with_data(data))
}

// ─── GET /nonce ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct NonceQuery {
    pub address: String,
}

pub async fn get_nonce(
    State(state): State<AppState>,
    Query(params): Query<NonceQuery>,
) -> ApiResult<serde_json::Value> {
    // Basic EVM address validation
    if !is_valid_evm_address(&params.address) {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("Must be a valid EVM address (0x + 40 hex chars)"));
    }

    info!(address = %params.address, "Nonce requested");

    let nonce = orderbook::get_cached_nonce(&state.intent_store, &params.address).unwrap_or(0);

    let data = serde_json::json!({
        "address": params.address,
        "nonce": nonce,
        "message": "Include this nonce in your next signed intent",
    });

    Ok(ApiSuccess::default().with_data(data))
}

// ─── PATCH /orders/:intentId/cancel ──────────────────────────────────────────

pub async fn cancel_order(
    State(state): State<AppState>,
    Path(intent_id): Path<String>,
) -> ApiResult<serde_json::Value> {
    info!(intent_id = %intent_id, "Off-chain intent cancel requested");

    let cancelled = orderbook::cancel_intent(&state.intent_store, &intent_id);

    if !cancelled {
        return Err(ApiError::default()
            .with_code(StatusCode::NOT_FOUND)
            .with_message("Intent not found or cannot be cancelled"));
    }

    let data = serde_json::json!({
        "intentId": intent_id,
        "status": "cancelled",
    });

    Ok(ApiSuccess::default().with_data(data))
}

// ─── GET /orderbook/stats ─────────────────────────────────────────────────────

pub async fn get_orderbook_stats(
    State(state): State<AppState>,
) -> ApiResult<serde_json::Value> {
    let gasless = &state.intent_store.gasless;
    let total = gasless.len();

    let mut by_status = std::collections::HashMap::new();
    for entry in gasless.iter() {
        let key = format!("{:?}", entry.status).to_lowercase();
        *by_status.entry(key).or_insert(0usize) += 1;
    }

    let data = serde_json::json!({
        "total": total,
        "byStatus": by_status,
        "ordersInStore": state.intent_store.orders.len(),
    });

    Ok(ApiSuccess::default().with_data(data))
}

// ─── POST /build-gasless ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildGaslessBody {
    pub sender_address:    String,
    pub recipient_address: String,
    pub destination_chain: String, // "solana" | "sui"
    pub amount:            String, // ETH amount, e.g. "0.1"
    pub duration_seconds:  Option<u64>,
    pub output_token:      Option<String>, // "sol" | "msol"
}

pub async fn build_gasless(
    State(state): State<AppState>,
    Json(body): Json<BuildGaslessBody>,
) -> ApiResult<serde_json::Value> {
    if !is_valid_evm_address(&body.sender_address) {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("senderAddress must be a valid EVM address"));
    }

    let amount_f64: f64 = body.amount.parse().map_err(|_| {
        ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("amount must be a positive number string")
    })?;
    if amount_f64 <= 0.0 {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("amount must be positive"));
    }

    info!(
        sender = %body.sender_address,
        dest   = %body.destination_chain,
        amount = %body.amount,
        "Build gasless intent requested"
    );

    // Convert human ETH → wei string for price computation
    let amount_wei = format!("{}", (amount_f64 * 1e18) as u128);
    let prices = price::compute_eth_to_sol_prices(&amount_wei).await;

    let sender_addr: Address = body.sender_address.parse().map_err(|_| {
        ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("Invalid sender address")
    })?;

    let nonce = match read_onchain_nonce(&state, sender_addr).await {
        Ok(n) => n,
        Err(e) => {
            warn!(error = %e, sender = %body.sender_address, "Failed to read on-chain nonce");
            0
        }
    };

    let duration_secs  = body.duration_seconds.unwrap_or(300);
    let active_solvers = state.solver_registry.active_count();
    let solver_warning = if active_solvers == 0 {
        Some("No solver is currently online. Your intent will be submitted but may not fill before the deadline.")
    } else {
        None
    };

    let mut data = serde_json::json!({
        "type":             "gasless_intent",
        "recipientAddress": body.recipient_address,
        "destinationChain": body.destination_chain,
        "amount":           body.amount,
        "amountWei":        amount_wei,
        "outputToken":      body.output_token.unwrap_or_else(|| "sol".to_string()),
        "startPrice":       prices.start_price,
        "floorPrice":       prices.floor_price,
        "durationSeconds":  duration_secs,
        "nonce":            nonce,
        "fromUsd":          prices.from_usd,
        "toUsd":            prices.to_usd,
    });

    if let Some(warning) = solver_warning {
        data["solverWarning"] = serde_json::json!(warning);
    }

    Ok(ApiSuccess::default().with_data(data))
}

// ─── POST /submit-signature ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitIntentBody {
    pub creator:           String,
    pub recipient:         String, // bytes32 hex, 0x + 64 chars
    pub destination_chain: u16,
    pub amount:            String, // wei
    pub start_price:       String,
    pub floor_price:       String,
    pub deadline:          i64,    // unix seconds
    pub intent_type:       u8,
    pub nonce:             u64,
    pub signature:         String, // 0x + 130 hex chars
}

pub async fn submit_signature(
    State(state): State<AppState>,
    Json(body): Json<SubmitIntentBody>,
) -> ApiResult<serde_json::Value> {
    // ── Basic validation ──────────────────────────────────────────────────────
    if !body.creator.starts_with("0x") || body.creator.len() != 42 {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("creator must be a valid EVM address (0x + 40 hex chars)"));
    }
    if !body.recipient.starts_with("0x") || body.recipient.len() != 66 {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("recipient must be bytes32 hex (0x + 64 chars)"));
    }
    if !body.signature.starts_with("0x") || body.signature.len() != 132 {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("signature must be 0x + 130 hex chars (65 bytes)"));
    }

    let now_secs = Utc::now().timestamp();
    if body.deadline <= now_secs {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("Intent deadline has already passed"));
    }

    info!(
        creator          = %body.creator,
        amount           = %body.amount,
        destination_chain = body.destination_chain,
        nonce            = body.nonce,
        "Gasless intent signature submitted"
    );

    // ── Parse address ─────────────────────────────────────────────────────────
    let creator_addr: Address = body.creator.parse().map_err(|_| {
        ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("Invalid creator address")
    })?;

    // ── Verify on-chain nonce ─────────────────────────────────────────────────
    match read_onchain_nonce(&state, creator_addr).await {
        Ok(onchain_nonce) => {
            if body.nonce != onchain_nonce {
                warn!(
                    creator       = %body.creator,
                    intent_nonce  = body.nonce,
                    onchain_nonce = onchain_nonce,
                    "Stale nonce rejected"
                );
                return Err(ApiError::default()
                    .with_code(StatusCode::BAD_REQUEST)
                    .with_message(&format!(
                        "Stale nonce: signed with {} but contract expects {}. Please start a new bridge request.",
                        body.nonce, onchain_nonce
                    )));
            }
        }
        Err(e) => {
            warn!(error = %e, creator = %body.creator, "Nonce check failed — proceeding without on-chain verify");
        }
    }

    // ── Parse recipient bytes32 ───────────────────────────────────────────────
    let recipient_hex = body.recipient.strip_prefix("0x").unwrap_or(&body.recipient);
    let recipient_bytes = hex::decode(recipient_hex).map_err(|_| {
        ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("recipient is not valid hex")
    })?;
    let mut recipient_arr = [0u8; 32];
    recipient_arr.copy_from_slice(&recipient_bytes);
    let recipient: FixedBytes<32> = FixedBytes::from(recipient_arr);

    // ── Parse amounts ─────────────────────────────────────────────────────────
    let parse_u256 = |s: &str, field: &str| -> Result<U256, ApiError> {
        s.parse::<U256>().map_err(|_| {
            ApiError::default()
                .with_code(StatusCode::BAD_REQUEST)
                .with_message(&format!("{field} must be a valid uint256 string"))
        })
    };

    let amount      = parse_u256(&body.amount, "amount")?;
    let start_price = parse_u256(&body.start_price, "startPrice")?;
    let floor_price = parse_u256(&body.floor_price, "floorPrice")?;
    let deadline    = U256::from(body.deadline as u64);
    let nonce       = U256::from(body.nonce);

    // ── EIP-712 verify ────────────────────────────────────────────────────────
    let params = IntentParams {
        creator: creator_addr,
        recipient,
        destination_chain: body.destination_chain,
        amount,
        start_price,
        floor_price,
        deadline,
        intent_type: body.intent_type,
        nonce,
    };

    let valid = eip712::verify_intent_signature(&params, &body.signature, &state.config.chain)
        .map_err(|e| {
            ApiError::default()
                .with_code(StatusCode::BAD_REQUEST)
                .with_message(&format!("Signature verification error: {e}"))
        })?;

    if !valid {
        return Err(ApiError::default()
            .with_code(StatusCode::BAD_REQUEST)
            .with_message("Invalid signature — recovered address does not match creator"));
    }

    // ── Generate intent ID ────────────────────────────────────────────────────
    let raw = format!("{}{}{}", body.creator, body.nonce, Utc::now().timestamp_millis());
    let intent_id = format!(
        "0x{}",
        &hex::encode(raw.as_bytes())[..64]
    );

    // ── Build IntentDetails ───────────────────────────────────────────────────
    let details = IntentDetails {
        creator:           body.creator.clone(),
        recipient:         body.recipient.clone(),
        destination_chain: body.destination_chain,
        amount:            body.amount.clone(),
        start_price:       body.start_price.clone(),
        floor_price:       body.floor_price.clone(),
        deadline:          body.deadline,
        intent_type:       body.intent_type,
        nonce:             body.nonce,
    };

    // ── Build injected IntentOrder (visible in GET /orders immediately) ───────
    let amount_eth = {
        let val: u128 = body.amount.parse().unwrap_or(0);
        let whole = val / 1_000_000_000_000_000_000u128;
        let frac  = (val % 1_000_000_000_000_000_000u128) / 1_000_000_000_000u128;
        format!("{whole}.{frac:06}")
    };
    let deadline_ms  = body.deadline * 1000;
    let now_ms       = Utc::now().timestamp_millis();

    let injected = IntentOrder {
        order_id:          intent_id.clone(),
        chain:             SupportedChain::EvmBase,
        creator:           body.creator.clone(),
        recipient:         hex::encode(&recipient_bytes),
        destination_chain: body.destination_chain,
        amount:            amount_eth,
        amount_raw:        body.amount.clone(),
        start_price:       body.start_price.clone(),
        floor_price:       body.floor_price.clone(),
        current_price:     Some(body.start_price.clone()),
        deadline:          deadline_ms,
        created_at:        now_ms,
        status:            OrderStatus::Open,
        intent_type:       body.intent_type,
        explorer_url:      String::new(),
        fulfill_tx_hash:   None,
        is_gasless:        true,
    };

    // ── Add to orderbook ──────────────────────────────────────────────────────
    orderbook::add_intent(
        &state.intent_store,
        intent_id.clone(),
        details,
        body.signature.clone(),
        injected,
    );
    orderbook::update_intent_status(
        &state.intent_store,
        &intent_id,
        IntentStatus::RfqActive,
    );

    info!(intent_id = %intent_id, creator = %body.creator, "Intent verified, starting RFQ");

    // ── Spawn RFQ async ───────────────────────────────────────────────────────
    {
        let state_rfq    = state.clone();
        let intent_id_rfq = intent_id.clone();
        tokio::spawn(async move {
            auction::broadcast_rfq(&state_rfq, &intent_id_rfq).await;
        });
    }

    Ok(ApiSuccess::default().with_data(serde_json::json!({
        "intentId":          intent_id,
        "status":            "rfq_active",
        "estimatedFillTime": 30_000,
        "message":           "Intent verified and submitted. Solvers are bidding...",
    })))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn is_valid_evm_address(s: &str) -> bool {
    s.starts_with("0x")
        && s.len() == 42
        && s[2..].chars().all(|c| c.is_ascii_hexdigit())
}
