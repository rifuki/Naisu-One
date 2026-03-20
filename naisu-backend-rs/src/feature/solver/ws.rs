use axum::{
    extract::{State, WebSocketUpgrade},
    response::IntoResponse,
};
use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use crate::AppState;
use crate::feature::intent::events::{SolverProgressEvent, SseEventType};

use super::model::SolverInbound;

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Channel for backend → solver outbound messages (decouples send from recv loop)
    let (tx, mut rx) = mpsc::channel::<String>(32);

    // Spawn writer task: forwards outbound messages to the WS sender
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    let mut solver_id: Option<String> = None;

    while let Some(result) = ws_receiver.next().await {
        let msg = match result {
            Ok(m) => m,
            Err(e) => {
                debug!(error = %e, "WS receive error");
                break;
            }
        };

        match msg {
            Message::Text(text) => {
                let parsed: Result<SolverInbound, _> = serde_json::from_str(&text);
                match parsed {
                    Ok(inbound) => {
                        handle_message(inbound, &state, &tx, &mut solver_id).await;
                    }
                    Err(e) => {
                        warn!(error = %e, raw = %text, "Solver sent unparseable WS message");
                        let err = serde_json::json!({ "type": "error", "error": "Invalid message format" });
                        let _ = tx.send(err.to_string()).await;
                    }
                }
            }
            Message::Close(_) => {
                debug!("Solver sent close frame");
                break;
            }
            Message::Ping(data) => {
                let _ = tx.send(
                    serde_json::json!({ "type": "pong" }).to_string()
                ).await;
                let _ = data; // handled by axum automatically
            }
            _ => {} // binary / pong — ignore
        }
    }

    // Cleanup on disconnect
    if let Some(id) = solver_id {
        state.solver_registry.disconnect(&id);
    } else {
        debug!("Unregistered WS connection closed");
    }
}

async fn handle_message(
    msg: SolverInbound,
    state: &AppState,
    tx: &mpsc::Sender<String>,
    solver_id: &mut Option<String>,
) {
    match msg {
        // ── Register ─────────────────────────────────────────────────────────
        SolverInbound::Register { name, evm_address, solana_address, supported_routes } => {
            let (id, token) = state.solver_registry.register(
                name.clone(),
                evm_address,
                solana_address,
                supported_routes,
                tx.clone(),
            );

            *solver_id = Some(id.clone());

            let ack = serde_json::json!({
                "type": "registered",
                "solverId": id,
                "token": token,
            });
            let _ = tx.send(ack.to_string()).await;
            info!(solver_id = %id, name = %name, "Solver register ACK sent");

            // Look for active RFQs and send them to the newly connected solver
            let now = chrono::Utc::now().timestamp_millis();
            let mut active_rfqs = Vec::new();
            for entry in state.intent_store.gasless.iter() {
                let intent = entry.value();
                if intent.status == crate::feature::intent::model::IntentStatus::RfqActive {
                    if let Some(order) = state.intent_store.orders.get(entry.key()) {
                        if order.deadline > now {
                            active_rfqs.push((entry.key().clone(), intent.clone()));
                        }
                    }
                }
            }

            if !active_rfqs.is_empty() {
                info!(solver_id = %id, count = active_rfqs.len(), "Pushing active RFQs to newly connected solver");
                for (intent_id, pending) in active_rfqs {
                    let rfq_msg = serde_json::json!({
                        "type": "rfq",
                        "orderId": intent_id,
                        "startPrice": pending.intent.start_price,
                        "floorPrice": pending.intent.floor_price,
                        "deadline": pending.intent.deadline,
                        "amount": pending.intent.amount,
                    });
                    state.solver_registry.send(&id, &rfq_msg).await;
                    
                    // Broadcast updated solver count
                    let _ = state.event_tx.send(crate::feature::intent::events::SolverProgressEvent {
                        event_type: crate::feature::intent::events::SseEventType::RfqBroadcast,
                        order_id: intent_id.clone(),
                        user_addr: None,
                        data: serde_json::json!({
                            "solverCount": state.solver_registry.active_count(),
                            "solverNames": [],
                        }),
                    });
                }
            }
        }

        // ── Heartbeat ─────────────────────────────────────────────────────────
        SolverInbound::Heartbeat { solana_balance, evm_balance, status } => {
            if let Some(id) = solver_id.as_deref() {
                state.solver_registry.heartbeat(
                    id,
                    solana_balance,
                    evm_balance,
                    status.as_deref(),
                );
                debug!(solver_id = %id, "Heartbeat OK");
            } else {
                not_registered(tx).await;
            }
        }

        // ── RFQ Quote ─────────────────────────────────────────────────────────
        SolverInbound::RfqQuote { order_id, quoted_price, estimated_eta, expires_at } => {
            let Some(id) = solver_id.as_deref() else {
                not_registered(tx).await;
                return;
            };

            let solver_name = state.solver_registry.sessions
                .get(id)
                .map(|s| s.info.name.clone())
                .unwrap_or_else(|| id.to_string());

            debug!(solver_id = %id, order_id = %order_id, quoted_price = %quoted_price, "RFQ quote received");

            let quote = super::model::RawQuote {
                solver_id: id.to_string(),
                solver_name,
                quoted_price,
                estimated_eta,
                expires_at,
            };

            let accepted = state.solver_registry.push_quote(
                &order_id,
                quote.clone(),
            );
            if !accepted {
                // If it's not accepted by a collector, it might be a late quote for an RfqActive intent.
                // Handle it immediately as a standalone quote.
                let state_clone = state.clone();
                let order_id_clone = order_id.clone();
                tokio::spawn(async move {
                    crate::feature::solver::auction::handle_standalone_quote(&state_clone, &order_id_clone, quote).await;
                });
            }
        }

        // ── execute_confirmed → emit SSE execute_sent ─────────────────────────
        SolverInbound::ExecuteConfirmed { order_id, tx_hash } => {
            let Some(id) = solver_id.as_deref() else {
                not_registered(tx).await;
                return;
            };
            // Clear exclusive window so fade detection doesn't penalise an executing solver
            state.solver_registry.clear_exclusive(&order_id);
            emit_progress(state, id, SseEventType::ExecuteSent, order_id, tx_hash);
        }

        // ── sol_sent → emit SSE ───────────────────────────────────────────────
        SolverInbound::SolSent { order_id, tx_hash } => {
            let Some(id) = solver_id.as_deref() else {
                not_registered(tx).await;
                return;
            };
            emit_progress(state, id, SseEventType::SolSent, order_id, tx_hash);
        }

        // ── vaa_ready → emit SSE ──────────────────────────────────────────────
        SolverInbound::VaaReady { order_id } => {
            let Some(id) = solver_id.as_deref() else {
                not_registered(tx).await;
                return;
            };
            emit_progress(state, id, SseEventType::VaaReady, order_id, None);
        }

        // ── settled → emit SSE ────────────────────────────────────────────────
        SolverInbound::Settled { order_id, tx_hash } => {
            let Some(id) = solver_id.as_deref() else {
                not_registered(tx).await;
                return;
            };
            emit_progress(state, id, SseEventType::Settled, order_id, tx_hash);
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async fn not_registered(tx: &mpsc::Sender<String>) {
    let err = serde_json::json!({
        "type": "error",
        "error": "Not registered — send {\"type\":\"register\"} first"
    });
    let _ = tx.send(err.to_string()).await;
}

fn emit_progress(
    state: &AppState,
    solver_id: &str,
    event_type: SseEventType,
    order_id: String,
    tx_hash: Option<String>,
) {
    let solver_name = state.solver_registry.sessions
        .get(solver_id)
        .map(|s| s.info.name.clone())
        .unwrap_or_else(|| solver_id.to_string());

    let mut data = serde_json::json!({ "solverName": solver_name });
    if let Some(hash) = &tx_hash {
        data["txHash"] = serde_json::json!(hash);
    }

    info!(
        solver_id = %solver_id,
        order_id = %order_id,
        event = %event_type.as_str(),
        tx_hash = ?tx_hash,
        "Solver progress step emitted"
    );

    let event = SolverProgressEvent {
        event_type,
        order_id,
        user_addr: None, // broadcast to all SSE connections
        data,
    };

    let _ = state.event_tx.send(event);
}
