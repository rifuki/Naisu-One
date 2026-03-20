use serde::{Deserialize, Serialize};

// ─── Solver Info ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverInfo {
    pub id: String,
    pub name: String,
    pub evm_address: String,
    pub solana_address: String,
    pub supported_routes: Vec<String>,
    pub online: bool,
    pub last_heartbeat: i64,    // unix ms
    pub suspended: bool,
    pub suspend_until: Option<i64>, // unix ms
    pub fade_penalty: u32,
    pub total_fills: u32,
    pub total_rfq_accepted: u32,
    pub reliability_score: f64,  // 0-100
    pub avg_fill_time: f64,      // seconds
    pub tier: u8,                // 0=new 1=starter 2=established 3=veteran
    pub solana_balance: String,
    pub evm_balance: String,
    pub registered_at: i64,      // unix ms
}

impl SolverInfo {
    pub fn new(id: String, token: String, name: String, evm_address: String, solana_address: String, supported_routes: Vec<String>) -> (Self, String) {
        let now = chrono::Utc::now().timestamp_millis();
        let info = Self {
            id,
            name,
            evm_address,
            solana_address,
            supported_routes,
            online: true,
            last_heartbeat: now,
            suspended: false,
            suspend_until: None,
            fade_penalty: 0,
            total_fills: 0,
            total_rfq_accepted: 0,
            reliability_score: 100.0,
            avg_fill_time: 0.0,
            tier: 0,
            solana_balance: "0".to_string(),
            evm_balance: "0".to_string(),
            registered_at: now,
        };
        (info, token)
    }

    pub fn compute_tier(&self) -> u8 {
        if self.total_fills >= 50 && self.reliability_score >= 80.0 {
            3
        } else if self.total_fills >= 10 && self.reliability_score >= 60.0 {
            2
        } else if self.total_fills >= 1 {
            1
        } else {
            0
        }
    }

    pub fn is_eligible(&self) -> bool {
        let now = chrono::Utc::now().timestamp_millis();
        self.online && !self.suspended && (now - self.last_heartbeat) < 60_000
    }
}

// ─── Incoming WS messages from solver ────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SolverInbound {
    Register {
        name: String,
        #[serde(rename = "evmAddress")]
        evm_address: String,
        #[serde(rename = "solanaAddress")]
        solana_address: String,
        #[serde(rename = "supportedRoutes", default)]
        supported_routes: Vec<String>,
    },
    Heartbeat {
        #[serde(rename = "solanaBalance")]
        solana_balance: Option<String>,
        #[serde(rename = "evmBalance")]
        evm_balance: Option<String>,
        status: Option<String>, // "ready" | "busy" | "draining"
    },
    RfqQuote {
        #[serde(rename = "orderId")]
        order_id: String,
        #[serde(rename = "quotedPrice")]
        quoted_price: String,
        #[serde(rename = "estimatedETA")]
        estimated_eta: u64, // seconds
        #[serde(rename = "expiresAt")]
        expires_at: i64, // unix ms
    },
    ExecuteConfirmed {
        #[serde(rename = "orderId")]
        order_id: String,
        #[serde(rename = "txHash")]
        tx_hash: Option<String>,
    },
    SolSent {
        #[serde(rename = "orderId")]
        order_id: String,
        #[serde(rename = "txHash")]
        tx_hash: Option<String>,
    },
    VaaReady {
        #[serde(rename = "orderId")]
        order_id: String,
    },
    Settled {
        #[serde(rename = "orderId")]
        order_id: String,
        #[serde(rename = "txHash")]
        tx_hash: Option<String>,
    },
}

// ─── Raw quote received during RFQ ───────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct RawQuote {
    pub solver_id: String,
    pub solver_name: String,
    pub quoted_price: String,
    pub estimated_eta: u64,
    pub expires_at: i64,
}

// ─── RFQ result stored after auction ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RfqResult {
    pub order_id: String,
    pub rfq_sent_at: i64,
    pub winner: Option<String>,
    pub winner_id: Option<String>,
    pub winner_address: Option<String>,
    pub reasoning: String,
    pub exclusivity_deadline: Option<i64>,
}
