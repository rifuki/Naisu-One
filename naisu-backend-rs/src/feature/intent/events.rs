use serde::Serialize;

/// SSE event type — maps 1:1 to the event name strings the frontend listens for.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SseEventType {
    // Lifecycle
    Snapshot,
    Ping,
    Close,
    // Order lifecycle (user-scoped)
    OrderUpdate,
    OrderCreated,
    GaslessResolved,
    // Solver pipeline (orderId-scoped, frontend filters)
    RfqBroadcast,
    RfqWinner,
    ExecuteSent,
    SolSent,
    VaaReady,
    Settled,
    OrderFulfilled,
}

impl SseEventType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Snapshot => "snapshot",
            Self::Ping => "ping",
            Self::Close => "close",
            Self::OrderUpdate => "order_update",
            Self::OrderCreated => "order_created",
            Self::GaslessResolved => "gasless_resolved",
            Self::RfqBroadcast => "rfq_broadcast",
            Self::RfqWinner => "rfq_winner",
            Self::ExecuteSent => "execute_sent",
            Self::SolSent => "sol_sent",
            Self::VaaReady => "vaa_ready",
            Self::Settled => "settled",
            Self::OrderFulfilled => "order_fulfilled",
        }
    }
}

/// Broadcast event pushed through the tokio broadcast channel.
/// Each SSE connection receives all events and filters based on user_addr / order_id.
#[derive(Debug, Clone)]
pub struct SolverProgressEvent {
    pub event_type: SseEventType,
    pub order_id: String,
    /// If Some, only deliver to SSE connections where this address matches the subscriber.
    /// If None, deliver to all connections (frontend filters by order_id).
    pub user_addr: Option<String>,
    pub data: serde_json::Value,
}
