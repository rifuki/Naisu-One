use std::sync::Arc;

use dashmap::DashMap;

use super::model::{IntentOrder, PendingIntent};

/// Combined intent store.
///
/// `orders`  — indexed/injected orders (what the frontend sees via GET /orders)
/// `gasless` — off-chain pending intents with signature, quotes, state machine
/// `nonces`  — expected next nonce per EVM address (lowercase)
#[derive(Debug, Clone)]
pub struct IntentStore {
    pub orders: Arc<DashMap<String, IntentOrder>>,
    pub gasless: Arc<DashMap<String, PendingIntent>>,
    pub nonces: Arc<DashMap<String, u64>>,
}

impl Default for IntentStore {
    fn default() -> Self {
        Self {
            orders: Arc::new(DashMap::new()),
            gasless: Arc::new(DashMap::new()),
            nonces: Arc::new(DashMap::new()),
        }
    }
}

impl IntentStore {
    pub fn new() -> Self {
        Self::default()
    }
}
