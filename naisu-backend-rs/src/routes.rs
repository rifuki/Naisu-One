use axum::Router;

use crate::{
    feature::{health::health_routes, intent::intent_routes, solver::solver_routes},
    state::AppState,
};

pub fn app_routes(state: AppState) -> Router {
    Router::new()
        .nest("/health", health_routes())
        .nest("/api/v1/intent", intent_routes())
        .nest("/api/v1/solver", solver_routes())
        .fallback(handle_404)
        .with_state(state)
}

async fn handle_404() -> crate::infrastructure::web::response::ApiError {
    crate::infrastructure::web::response::ApiError::default()
        .with_code(axum::http::StatusCode::NOT_FOUND)
        .with_message("The requested endpoint does not exist")
}
