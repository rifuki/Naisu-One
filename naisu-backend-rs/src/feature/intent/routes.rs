use axum::{Router, routing::{get, patch, post}};

use crate::AppState;

use super::{handlers, sse};

pub fn intent_routes() -> Router<AppState> {
    Router::new()
        .route("/watch",                    get(sse::watch_orders))
        .route("/orders",                   get(handlers::get_orders))
        .route("/nonce",                    get(handlers::get_nonce))
        .route("/orders/{intent_id}/cancel", patch(handlers::cancel_order))
        .route("/orderbook/stats",          get(handlers::get_orderbook_stats))
        .route("/build-gasless",            post(handlers::build_gasless))
        .route("/submit-signature",         post(handlers::submit_signature))
}
