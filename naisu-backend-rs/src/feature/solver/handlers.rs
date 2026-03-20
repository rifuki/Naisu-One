use axum::{
    extract::{Path, State},
    http::StatusCode,
};
use tracing::info;

use crate::{
    AppState,
    infrastructure::web::response::{ApiError, ApiResult, ApiSuccess},
};

pub async fn list_solvers(State(state): State<AppState>) -> ApiResult<serde_json::Value> {
    let solvers = state.solver_registry.list();
    let total = solvers.len();
    let active = state.solver_registry.active_count();

    let data = serde_json::json!({
        "solvers": solvers,
        "total": total,
        "active": active,
    });

    Ok(ApiSuccess::default().with_data(data))
}

pub async fn get_stats(State(state): State<AppState>) -> ApiResult<serde_json::Value> {
    let total  = state.solver_registry.sessions.len();
    let active = state.solver_registry.active_count();
    let rfq_results = state.solver_registry.rfq_results.len();

    let mut by_tier: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for entry in state.solver_registry.sessions.iter() {
        let tier = format!("{:?}", entry.info.tier).to_lowercase();
        *by_tier.entry(tier).or_insert(0) += 1;
    }

    let data = serde_json::json!({
        "total":      total,
        "active":     active,
        "rfqResults": rfq_results,
        "byTier":     by_tier,
    });

    Ok(ApiSuccess::default().with_data(data))
}

pub async fn get_selection(
    State(state): State<AppState>,
    Path(order_id): Path<String>,
) -> ApiResult<serde_json::Value> {
    info!(order_id = %order_id, "RFQ selection requested");

    match state.solver_registry.get_rfq_result(&order_id) {
        Some(result) => Ok(ApiSuccess::default().with_data(serde_json::to_value(result).unwrap_or_default())),
        None => Err(ApiError::default()
            .with_code(StatusCode::NOT_FOUND)
            .with_message("No RFQ result found for this orderId")),
    }
}
