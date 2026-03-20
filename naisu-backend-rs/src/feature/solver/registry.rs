use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::mpsc;
use tracing::info;
use uuid::Uuid;

use super::model::{RawQuote, RfqResult, SolverInfo};

// ─── Solver session ───────────────────────────────────────────────────────────

/// A connected solver's live state.
pub struct SolverSession {
    pub info: SolverInfo,
    /// Channel to push outbound JSON strings to this solver's WS writer task.
    pub tx: mpsc::Sender<String>,
}

impl std::fmt::Debug for SolverSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SolverSession")
            .field("info", &self.info)
            .finish_non_exhaustive()
    }
}

// ─── RFQ collector ────────────────────────────────────────────────────────────

/// Accumulates rfq_quote messages for a single RFQ auction round.
/// Phase 5 will add full auction logic; Phase 4 stores quotes for forward compat.
#[derive(Debug)]
pub struct RfqCollector {
    pub quotes: Vec<RawQuote>,
    pub expected_count: usize,
}

// ─── Registry ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct SolverRegistry {
    /// solver_id → live session (only present while WS is connected)
    pub sessions: Arc<DashMap<String, SolverSession>>,
    /// token → solver_id (persists across reconnects within process lifetime)
    pub by_token: Arc<DashMap<String, String>>,
    /// evm_address (lowercase) → solver_id (for upsert on re-register)
    pub by_evm: Arc<DashMap<String, String>>,
    /// order_id → in-flight RFQ collector
    pub rfq_collectors: Arc<DashMap<String, RfqCollector>>,
    /// order_id → completed RFQ result (for GET /selection/:orderId)
    pub rfq_results: Arc<DashMap<String, RfqResult>>,
}

impl Default for SolverRegistry {
    fn default() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            by_token: Arc::new(DashMap::new()),
            by_evm: Arc::new(DashMap::new()),
            rfq_collectors: Arc::new(DashMap::new()),
            rfq_results: Arc::new(DashMap::new()),
        }
    }
}

impl SolverRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    // ─── Register / re-register ───────────────────────────────────────────────

    /// Register a new solver or upsert an existing one by EVM address.
    /// Returns (solver_id, token, is_new).
    pub fn register(
        &self,
        name: String,
        evm_address: String,
        solana_address: String,
        supported_routes: Vec<String>,
        ws_tx: mpsc::Sender<String>,
    ) -> (String, String) {
        let evm_lower = evm_address.to_lowercase();

        // Check if already registered by EVM address
        if let Some(existing_id) = self.by_evm.get(&evm_lower).map(|r| r.clone()) {
            // Re-register: update info, reattach WS
            if let Some(mut session) = self.sessions.get_mut(&existing_id) {
                let tok = self.by_token.iter()
                    .find(|e| e.value() == &existing_id)
                    .map(|e| e.key().clone())
                    .unwrap_or_default();

                session.info.name = name.clone();
                session.info.solana_address = solana_address.clone();
                session.info.supported_routes = supported_routes.clone();
                session.info.online = true;
                session.info.last_heartbeat = chrono::Utc::now().timestamp_millis();
                session.info.suspended = false;
                session.info.suspend_until = None;
                session.tx = ws_tx;

                info!(name = %name, solver_id = %existing_id, "Solver re-registered via WS");
                return (existing_id, tok);
            }
        }

        // New solver
        let solver_id = Uuid::new_v4().to_string();
        let token = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        let info = SolverInfo {
            id: solver_id.clone(),
            name: name.clone(),
            evm_address: evm_address.clone(),
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

        self.sessions.insert(solver_id.clone(), SolverSession { info, tx: ws_tx });
        self.by_token.insert(token.clone(), solver_id.clone());
        self.by_evm.insert(evm_lower, solver_id.clone());

        info!(name = %name, solver_id = %solver_id, "Solver registered via WS");
        (solver_id, token)
    }

    // ─── Disconnect ────────────────────────────────────────────────────────────

    pub fn disconnect(&self, solver_id: &str) {
        if let Some(mut session) = self.sessions.get_mut(solver_id) {
            session.info.online = false;
            info!(name = %session.info.name, "Solver disconnected — marked offline");
        }
    }

    // ─── Heartbeat ────────────────────────────────────────────────────────────

    pub fn heartbeat(
        &self,
        solver_id: &str,
        solana_balance: Option<String>,
        evm_balance: Option<String>,
        status: Option<&str>,
    ) {
        if let Some(mut session) = self.sessions.get_mut(solver_id) {
            let now = chrono::Utc::now().timestamp_millis();
            session.info.last_heartbeat = now;
            session.info.online = status.map_or(true, |s| s != "draining");

            if let Some(bal) = solana_balance {
                session.info.solana_balance = bal;
            }
            if let Some(bal) = evm_balance {
                session.info.evm_balance = bal;
            }

            // Lift suspension if past suspendUntil
            if session.info.suspended {
                if let Some(until) = session.info.suspend_until {
                    if now >= until {
                        session.info.suspended = false;
                        session.info.suspend_until = None;
                        info!(name = %session.info.name, "Solver suspension lifted");
                    }
                }
            }
        }
    }

    // ─── Send message to a solver ─────────────────────────────────────────────

    pub async fn send(&self, solver_id: &str, msg: &serde_json::Value) {
        if let Some(session) = self.sessions.get(solver_id) {
            let payload = msg.to_string();
            if let Err(e) = session.tx.send(payload).await {
                tracing::warn!(solver_id = %solver_id, error = %e, "Failed to send WS message to solver");
            }
        }
    }

    // ─── Stale offline detection ──────────────────────────────────────────────

    pub fn mark_stale_offline(&self) {
        let cutoff = chrono::Utc::now().timestamp_millis() - 60_000;
        for mut session in self.sessions.iter_mut() {
            if session.info.online && session.info.last_heartbeat < cutoff {
                session.info.online = false;
                info!(name = %session.info.name, "Solver marked offline: missed heartbeats");
            }
        }
    }

    // ─── Queries ──────────────────────────────────────────────────────────────

    pub fn list(&self) -> Vec<SolverInfo> {
        self.sessions
            .iter()
            .map(|e| e.value().info.clone())
            .collect()
    }

    pub fn active_count(&self) -> usize {
        self.sessions
            .iter()
            .filter(|e| e.value().info.is_eligible())
            .count()
    }

    pub fn get_rfq_result(&self, order_id: &str) -> Option<RfqResult> {
        self.rfq_results.get(order_id).map(|r| r.clone())
    }
}
