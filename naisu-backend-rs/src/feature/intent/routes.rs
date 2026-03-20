use axum::{Router, routing::get};

use crate::AppState;

use super::handlers;

pub fn intent_routes() -> Router<AppState> {
    Router::new()
        .route("/orders", get(handlers::get_orders))
        .route("/nonce", get(handlers::get_nonce))
        .route("/orders/{intent_id}/cancel", axum::routing::patch(handlers::cancel_order))
        .route("/orderbook/stats", get(handlers::get_orderbook_stats))
}
