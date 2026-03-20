use axum::{Router, routing::get};

use crate::AppState;

use super::{handlers, ws};

pub fn solver_routes() -> Router<AppState> {
    Router::new()
        .route("/ws", get(ws::ws_handler))
        .route("/list", get(handlers::list_solvers))
        .route("/selection/{order_id}", get(handlers::get_selection))
}
