use std::sync::Arc;

use tokio::sync::broadcast;

use crate::{
    feature::intent::{IntentStore, SolverProgressEvent},
    infrastructure::Config,
};

const EVENT_CHANNEL_CAPACITY: usize = 256;

#[derive(Debug, Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub intent_store: IntentStore,
    pub event_tx: broadcast::Sender<SolverProgressEvent>,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        let (event_tx, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        Self {
            config: Arc::new(config),
            intent_store: IntentStore::new(),
            event_tx,
        }
    }
}
