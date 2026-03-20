use std::sync::Arc;

use crate::{feature::intent::IntentStore, infrastructure::Config};

#[derive(Debug, Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub intent_store: IntentStore,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        Self {
            config: Arc::new(config),
            intent_store: IntentStore::new(),
        }
    }
}
