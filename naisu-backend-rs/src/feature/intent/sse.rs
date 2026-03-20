use std::{convert::Infallible, time::Duration};

use axum::{
    extract::{Query, State},
    response::sse::{Event, KeepAlive, Sse},
};
use serde::Deserialize;
use tokio::time::{interval, sleep};
use tracing::{debug, warn};

use crate::AppState;

use super::{events::SolverProgressEvent, model::SupportedChain, orderbook};

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const AUTO_CLOSE_DURATION: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Deserialize)]
pub struct WatchQuery {
    pub user: String,
    pub chain: Option<SupportedChain>,
}

pub async fn watch_orders(
    State(state): State<AppState>,
    Query(params): Query<WatchQuery>,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    let user_lower = params.user.to_lowercase();
    let chain_filter = params.chain;

    // Snapshot of current orders for this user
    let snapshot = orderbook::get_orders_by_user(
        &state.intent_store,
        &params.user,
        chain_filter.as_ref(),
    );

    // Subscribe to the broadcast channel before building the stream,
    // so we don't miss events that arrive while the snapshot is being sent.
    let mut rx = state.event_tx.subscribe();

    let stream = async_stream::stream! {
        // ── Immediate snapshot + ping ──────────────────────────────────────
        let snap_data = serde_json::json!({ "orders": snapshot }).to_string();
        yield Ok(Event::default().event("snapshot").data(snap_data));

        let ping_data = serde_json::json!({ "t": now_ms() }).to_string();
        yield Ok(Event::default().event("ping").data(ping_data));

        // ── Timers ────────────────────────────────────────────────────────
        let mut heartbeat = interval(HEARTBEAT_INTERVAL);
        heartbeat.tick().await; // consume the immediate first tick

        let auto_close = sleep(AUTO_CLOSE_DURATION);
        tokio::pin!(auto_close);

        // ── Event loop ────────────────────────────────────────────────────
        loop {
            tokio::select! {
                biased;

                _ = &mut auto_close => {
                    let data = serde_json::json!({ "reason": "timeout" }).to_string();
                    yield Ok(Event::default().event("close").data(data));
                    break;
                }

                _ = heartbeat.tick() => {
                    let data = serde_json::json!({ "t": now_ms() }).to_string();
                    yield Ok(Event::default().event("ping").data(data));
                }

                result = rx.recv() => {
                    match result {
                        Ok(evt) => {
                            if !should_forward(&evt, &user_lower) {
                                continue;
                            }
                            let event_name = evt.event_type.as_str();
                            let mut payload = evt.data.clone();
                            // Always include orderId in the payload
                            if let Some(obj) = payload.as_object_mut() {
                                obj.entry("orderId").or_insert_with(|| serde_json::json!(evt.order_id));
                            }
                            yield Ok(Event::default().event(event_name).data(payload.to_string()));
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            warn!(lagged_by = n, "SSE subscriber lagged, some events dropped");
                            // continue — we stay connected and pick up from now
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            debug!("Broadcast channel closed, SSE stream ending");
                            break;
                        }
                    }
                }
            }
        }
    };

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Decide whether to forward an event to this SSE connection.
/// - User-scoped events (user_addr is Some): only forward if it matches.
/// - Broadcast events (user_addr is None): always forward (frontend filters by orderId).
fn should_forward(evt: &SolverProgressEvent, user_lower: &str) -> bool {
    match &evt.user_addr {
        Some(addr) => addr.to_lowercase() == user_lower,
        None => true,
    }
}
