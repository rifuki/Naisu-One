use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::{mpsc, oneshot};
use tracing::{info, warn};
use uuid::Uuid;

use super::model::{RawQuote, RfqResult, SolverInfo};

// ─── Solver session ───────────────────────────────────────────────────────────

pub struct SolverSession {
    pub info: SolverInfo,
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

pub struct RfqCollector {
    pub quotes: Vec<RawQuote>,
    pub expected_count: usize,
    /// Fires when all expected quotes arrive, so the auction can resolve early.
    pub notify: Option<oneshot::Sender<()>>,
}

impl std::fmt::Debug for RfqCollector {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RfqCollector")
            .field("quotes_count", &self.quotes.len())
            .field("expected_count", &self.expected_count)
            .finish_non_exhaustive()
    }
}

// ─── Pending exclusive window ─────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct PendingExclusive {
    pub winner_id: String,
    pub deadline: i64, // unix ms — when the 30s exclusivity window ends
}

// ─── Registry ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct SolverRegistry {
    pub sessions: Arc<DashMap<String, SolverSession>>,
    pub by_token: Arc<DashMap<String, String>>,
    pub by_evm: Arc<DashMap<String, String>>,
    pub rfq_collectors: Arc<DashMap<String, RfqCollector>>,
    pub rfq_results: Arc<DashMap<String, RfqResult>>,
    /// orderId → exclusive window tracking for fade detection
    pub pending_exclusive: Arc<DashMap<String, PendingExclusive>>,
}

impl Default for SolverRegistry {
    fn default() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            by_token: Arc::new(DashMap::new()),
            by_evm: Arc::new(DashMap::new()),
            rfq_collectors: Arc::new(DashMap::new()),
            rfq_results: Arc::new(DashMap::new()),
            pending_exclusive: Arc::new(DashMap::new()),
        }
    }
}

impl SolverRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    // ─── Register / re-register ───────────────────────────────────────────────

    pub fn register(
        &self,
        name: String,
        evm_address: String,
        solana_address: String,
        supported_routes: Vec<String>,
        ws_tx: mpsc::Sender<String>,
    ) -> (String, String) {
        let evm_lower = evm_address.to_lowercase();

        if let Some(existing_id) = self.by_evm.get(&evm_lower).map(|r| r.clone()) {
            if let Some(mut session) = self.sessions.get_mut(&existing_id) {
                let tok = self.by_token.iter()
                    .find(|e| e.value() == &existing_id)
                    .map(|e| e.key().clone())
                    .unwrap_or_default();

                session.info.name = name.clone();
                session.info.solana_address = solana_address;
                session.info.supported_routes = supported_routes;
                session.info.online = true;
                session.info.last_heartbeat = chrono::Utc::now().timestamp_millis();
                session.info.suspended = false;
                session.info.suspend_until = None;
                session.tx = ws_tx;

                info!(name = %name, solver_id = %existing_id, "Solver re-registered via WS");
                return (existing_id, tok);
            }
        }

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

    // ─── RFQ collector lifecycle ──────────────────────────────────────────────

    /// Create a new RFQ collector and return the receiver that fires when all
    /// expected quotes arrive (or use with tokio::time::timeout for the deadline).
    pub fn create_collector(&self, order_id: String, expected_count: usize) -> oneshot::Receiver<()> {
        let (tx, rx) = oneshot::channel();
        self.rfq_collectors.insert(order_id, RfqCollector {
            quotes: Vec::new(),
            expected_count,
            notify: Some(tx),
        });
        rx
    }

    /// Push a quote into the collector. Fires notify if all quotes are in.
    /// Returns false if no collector exists for this order_id.
    pub fn push_quote(&self, order_id: &str, quote: RawQuote) -> bool {
        if let Some(mut collector) = self.rfq_collectors.get_mut(order_id) {
            collector.quotes.push(quote);
            if collector.quotes.len() >= collector.expected_count {
                if let Some(notify) = collector.notify.take() {
                    let _ = notify.send(());
                }
            }
            true
        } else {
            false
        }
    }

    /// Remove and return all collected quotes.
    pub fn take_quotes(&self, order_id: &str) -> Vec<RawQuote> {
        self.rfq_collectors
            .remove(order_id)
            .map(|(_, c)| c.quotes)
            .unwrap_or_default()
    }

    // ─── Exclusive window ─────────────────────────────────────────────────────

    pub fn set_exclusive(&self, order_id: String, winner_id: String, deadline: i64) {
        self.pending_exclusive.insert(order_id, PendingExclusive { winner_id, deadline });
    }

    /// Called when execute_confirmed arrives — clears the exclusive window so
    /// fade detection doesn't penalise a solver that actually executed.
    pub fn clear_exclusive(&self, order_id: &str) {
        self.pending_exclusive.remove(order_id);
    }

    // ─── Fade detection ───────────────────────────────────────────────────────

    pub fn check_fades(&self) {
        let now = chrono::Utc::now().timestamp_millis();
        const GRACE_MS: i64 = 5_000;

        let expired: Vec<(String, PendingExclusive)> = self.pending_exclusive
            .iter()
            .filter(|e| now > e.value().deadline + GRACE_MS)
            .map(|e| (e.key().clone(), e.value().clone()))
            .collect();

        for (order_id, exclusive) in expired {
            self.pending_exclusive.remove(&order_id);
            self.apply_fade(&exclusive.winner_id, now);
        }
    }

    fn apply_fade(&self, solver_id: &str, now: i64) {
        if let Some(mut session) = self.sessions.get_mut(solver_id) {
            session.info.fade_penalty += 1;
            session.info.reliability_score =
                (session.info.reliability_score - 10.0).max(0.0);

            if session.info.fade_penalty >= 3 {
                session.info.suspended = true;
                session.info.suspend_until = Some(now + 24 * 60 * 60 * 1_000);
                warn!(
                    name = %session.info.name,
                    fades = session.info.fade_penalty,
                    "Solver suspended: 3 fades"
                );
            } else {
                warn!(
                    name = %session.info.name,
                    fades = session.info.fade_penalty,
                    "Fade penalty applied to solver"
                );
            }
        }
    }

    // ─── Fill recording ───────────────────────────────────────────────────────

    /// Called by the EVM indexer when OrderFulfilled is observed.
    pub fn record_fill(&self, evm_address: &str, fill_time_ms: Option<i64>, _order_id: Option<&str>) {
        let evm_lower = evm_address.to_lowercase();
        if let Some(solver_id) = self.by_evm.get(&evm_lower).map(|r| r.clone()) {
            if let Some(mut session) = self.sessions.get_mut(&solver_id) {
                session.info.total_fills += 1;

                if let Some(ms) = fill_time_ms {
                    let sec = ms as f64 / 1000.0;
                    let n = session.info.total_fills as f64;
                    session.info.avg_fill_time =
                        if n == 1.0 { sec }
                        else { (session.info.avg_fill_time * (n - 1.0) + sec) / n };
                }

                if session.info.total_rfq_accepted > 0 {
                    session.info.reliability_score = (session.info.total_fills as f64
                        / session.info.total_rfq_accepted as f64
                        * 100.0).round().min(100.0);
                }

                session.info.tier = session.info.compute_tier();

                info!(
                    name = %session.info.name,
                    total_fills = session.info.total_fills,
                    reliability = session.info.reliability_score,
                    "Fill recorded"
                );
            }
        }
    }

    // ─── Send message ─────────────────────────────────────────────────────────

    pub async fn send(&self, solver_id: &str, msg: &serde_json::Value) {
        if let Some(session) = self.sessions.get(solver_id) {
            let payload = msg.to_string();
            if let Err(e) = session.tx.send(payload).await {
                warn!(solver_id = %solver_id, error = %e, "Failed to send WS message to solver");
            }
        }
    }

    // ─── Offline detection ────────────────────────────────────────────────────

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
        self.sessions.iter().map(|e| e.value().info.clone()).collect()
    }

    pub fn active_count(&self) -> usize {
        self.sessions.iter().filter(|e| e.value().info.is_eligible()).count()
    }

    pub fn get_rfq_result(&self, order_id: &str) -> Option<RfqResult> {
        self.rfq_results.get(order_id).map(|r| r.clone())
    }

    pub fn eligible_for_route(&self, route: &str) -> Vec<(String, String)> {
        self.sessions
            .iter()
            .filter(|e| {
                let info = &e.value().info;
                info.is_eligible() && info.supported_routes.iter().any(|r| r == route)
            })
            .map(|e| (e.key().clone(), e.value().info.name.clone()))
            .collect()
    }
}
