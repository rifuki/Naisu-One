use std::sync::Arc;

use sqlx::SqlitePool;
use tokio::sync::broadcast;

use crate::{
    feature::{
        intent::{IntentStore, SolverProgressEvent},
        solver::SolverRegistry,
    },
    infrastructure::Config,
};

const EVENT_CHANNEL_CAPACITY: usize = 256;

#[derive(Debug, Clone)]
pub struct AppState {
    pub config:          Arc<Config>,
    pub intent_store:    IntentStore,
    pub solver_registry: SolverRegistry,
    pub event_tx:        broadcast::Sender<SolverProgressEvent>,
    pub db:              SqlitePool,
}

impl AppState {
    pub fn new(config: Config, db: SqlitePool) -> Self {
        let (event_tx, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        Self {
            config: Arc::new(config),
            intent_store: IntentStore::new(),
            solver_registry: SolverRegistry::new(),
            event_tx,
            db,
        }
    }
}
