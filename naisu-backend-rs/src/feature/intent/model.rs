use chrono::Utc;
use serde::{Deserialize, Serialize};

// ─── Supported Chain ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SupportedChain {
    Sui,
    EvmBase,
    Solana,
}

// ─── Order Status (on-chain) ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OrderStatus {
    Open,
    Fulfilled,
    Cancelled,
    Expired,
}

// ─── Intent Status (gasless off-chain state machine) ─────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IntentStatus {
    PendingRfq,
    RfqActive,
    WinnerSelected,
    Executing,
    Fulfilled,
    Expired,
    Cancelled,
}

impl IntentStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Fulfilled | Self::Expired | Self::Cancelled)
    }

    pub fn can_cancel(&self) -> bool {
        !matches!(self, Self::Executing | Self::Fulfilled | Self::Expired | Self::Cancelled)
    }
}

// ─── On-chain / Indexed Order ─────────────────────────────────────────────────

/// Represents a finalized or in-progress order as seen by the indexer.
/// Mirrored from TS IntentOrder.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentOrder {
    pub order_id: String,
    pub chain: SupportedChain,
    pub creator: String,
    pub recipient: String,
    pub destination_chain: u16,
    pub amount: String,           // human-readable
    pub amount_raw: String,
    pub start_price: String,
    pub floor_price: String,
    pub current_price: Option<String>,
    pub deadline: i64,            // unix ms
    pub created_at: i64,          // unix ms
    pub status: OrderStatus,
    pub intent_type: u8,          // 0=SOL, 1=mSOL
    pub explorer_url: String,
    pub fulfill_tx_hash: Option<String>,
    pub is_gasless: bool,
}

// ─── Gasless Intent Details ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentDetails {
    pub creator: String,
    pub recipient: String,
    pub destination_chain: u16,
    pub amount: String,
    pub start_price: String,
    pub floor_price: String,
    pub deadline: i64,   // unix timestamp seconds
    pub intent_type: u8,
    pub nonce: u64,
}

// ─── Solver Quote ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverQuote {
    pub solver: String,
    pub solver_name: String,
    pub price: String,
    pub gas_estimate: String,
    pub estimated_fill_time: u64,  // milliseconds
    pub quoted_at: i64,
}

// ─── Pending Intent (gasless orderbook entry) ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingIntent {
    pub intent_id: String,
    pub intent: IntentDetails,
    pub signature: String,
    pub status: IntentStatus,
    pub submitted_at: i64,
    pub winning_solver: Option<String>,
    pub quotes: Vec<SolverQuote>,
}

impl PendingIntent {
    pub fn new(intent_id: String, intent: IntentDetails, signature: String) -> Self {
        Self {
            intent_id,
            intent,
            signature,
            status: IntentStatus::PendingRfq,
            submitted_at: Utc::now().timestamp_millis(),
            winning_solver: None,
            quotes: Vec::new(),
        }
    }
}
