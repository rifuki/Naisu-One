use std::sync::Arc;
use tokio::sync::{mpsc::Sender, Notify};
use tracing::{
    field::{Field, Visit},
    Event, Subscriber,
};
use tracing_subscriber::{layer::Context, Layer};

use crate::tui::{AppEvent, Transaction, TxStatus};

pub struct TuiLayer {
    pub tx: Sender<AppEvent>,
    pub balance_notify: Arc<Notify>,
}

struct EventVisitor {
    message: String,
    fields: Vec<(String, String)>,
}

impl Visit for EventVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        let s = format!("{value:?}");
        // Debug-formatting a &str wraps it in quotes — strip them
        let s = s.trim_matches('"').to_string();
        if field.name() == "message" {
            self.message = s;
        } else {
            self.fields.push((field.name().to_string(), s));
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_string();
        } else {
            self.fields.push((field.name().to_string(), value.to_string()));
        }
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.fields.push((field.name().to_string(), value.to_string()));
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.fields.push((field.name().to_string(), value.to_string()));
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.fields.push((field.name().to_string(), value.to_string()));
    }
}

impl<S: Subscriber> Layer<S> for TuiLayer {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let mut visitor = EventVisitor {
            message: String::new(),
            fields: Vec::new(),
        };
        event.record(&mut visitor);

        if visitor.message.is_empty() {
            return;
        }

        // Build full log line: "message key=val key=val ..."
        let mut log_msg = visitor.message.clone();
        for (k, v) in &visitor.fields {
            log_msg.push_str(&format!(" {}={}", k, v));
        }

        let _ = self.tx.try_send(AppEvent::Log(log_msg.clone()));

        // Detect new order — compact summary line:
        // "[Base→Solana] ▶  0.001000 ETH  ... id=515fa6b0<full_hex>"
        // `id=` is part of the format string, not a structured field, so parse from message.
        if log_msg.contains('▶') && !log_msg.contains("STEP") {
            let id = parse_id_from_msg(&log_msg);

            if let Some(id) = id {
                let tx = Transaction {
                    timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
                    action: detect_route(&log_msg),
                    intent_id: id,
                    amount: detect_amount(&log_msg),
                    status: TxStatus::Pending,
                };
                let _ = self.tx.try_send(AppEvent::Tx(tx));
            }
        }

        // Detect order fulfilled — "✓ ORDER FULFILLED" with [xxxxxxxx] prefix
        if log_msg.contains("ORDER FULFILLED") {
            if let Some(id) = extract_intent_prefix(&log_msg) {
                let _ = self.tx.try_send(AppEvent::TxUpdate(id, TxStatus::Success));
            }
            // Trigger immediate balance refresh
            self.balance_notify.notify_one();
        }

        // Detect failed order
        if log_msg.to_lowercase().contains("failed") || log_msg.to_lowercase().contains("error") {
            if let Some(id) = extract_intent_prefix(&log_msg) {
                let _ = self.tx.try_send(AppEvent::TxUpdate(id, TxStatus::Failed));
            }
        }
    }
}

/// Extract [xxxxxxxx] intent ID prefix from a log message.
fn extract_intent_prefix(msg: &str) -> Option<String> {
    let start = msg.find('[')? + 1;
    let end = msg[start..].find(']')? + start;
    let candidate = &msg[start..end];
    // Intent IDs are hex — 8 chars
    if candidate.len() == 8 && candidate.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(candidate.to_string())
    } else {
        None
    }
}

fn detect_route(msg: &str) -> String {
    if msg.contains("Base") && msg.contains("Solana") {
        "Base→Solana".to_string()
    } else if msg.contains("Fuji") && msg.contains("Sui") {
        "Fuji→Sui".to_string()
    } else if msg.contains("Solana") && msg.contains("EVM") {
        "Solana→EVM".to_string()
    } else if msg.contains("Sui") && msg.contains("EVM") {
        "Sui→EVM".to_string()
    } else {
        "Unknown".to_string()
    }
}

/// Parse `id=<full_hex>` from a message string, return first 8 chars.
fn parse_id_from_msg(msg: &str) -> Option<String> {
    let pos = msg.find("id=")?;
    let rest = &msg[pos + 3..];
    // Take contiguous hex chars (the full order ID)
    let hex: String = rest
        .chars()
        .take_while(|c| c.is_ascii_hexdigit())
        .collect();
    if hex.len() >= 8 {
        Some(hex[..8].to_string())
    } else {
        None
    }
}

fn detect_amount(msg: &str) -> String {
    let parts: Vec<&str> = msg.split_whitespace().collect();
    for (i, part) in parts.iter().enumerate() {
        if *part == "ETH" && i > 0 {
            return format!("{} ETH", parts[i - 1]);
        }
    }
    String::new()
}
