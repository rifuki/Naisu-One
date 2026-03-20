use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::Deserialize;
use tracing::info;

use crate::{
    AppState,
    infrastructure::web::response::{ApiError, ApiResult, ApiSuccess},
};

use super::{model::SupportedChain, orderbook};

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn is_valid_evm_address(s: &str) -> bool {
    s.starts_with("0x")
        && s.len() == 42
        && s[2..].chars().all(|c| c.is_ascii_hexdigit())
}
