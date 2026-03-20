use tracing::{info, warn};

use super::{
    model::{IntentDetails, IntentOrder, IntentStatus, OrderStatus, PendingIntent, SupportedChain},
    store::IntentStore,
};

// ─── Queries ──────────────────────────────────────────────────────────────────

/// Get all orders visible to the frontend for a given user (optionally filtered by chain).
/// Merges indexed orders and injected gasless orders.
pub fn get_orders_by_user(
    store: &IntentStore,
    user: &str,
    chain: Option<&SupportedChain>,
) -> Vec<IntentOrder> {
    let user_lower = user.to_lowercase();

    let mut orders: Vec<IntentOrder> = store
        .orders
        .iter()
        .filter(|entry| {
            let order = entry.value();
            order.creator.to_lowercase() == user_lower
                && chain.map_or(true, |c| &order.chain == c)
        })
        .map(|entry| entry.value().clone())
        .collect();

    // Sort by created_at descending (newest first)
    orders.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    orders
}

/// Get the expected next nonce for an address from the local store.
/// Returns 0 if not tracked (caller may fall back to on-chain read).
pub fn get_cached_nonce(store: &IntentStore, address: &str) -> Option<u64> {
    store
        .nonces
        .get(&address.to_lowercase())
        .map(|n| *n)
}

// ─── Write Operations ─────────────────────────────────────────────────────────

/// Add a new gasless intent to the orderbook.
/// Also injects a synthetic IntentOrder into the `orders` store so the frontend
/// can see the order immediately via GET /orders.
pub fn add_intent(
    store: &IntentStore,
    intent_id: String,
    intent: IntentDetails,
    signature: String,
    injected_order: IntentOrder,
) -> PendingIntent {
    let pending = PendingIntent::new(intent_id.clone(), intent.clone(), signature);

    // Track expected next nonce
    store
        .nonces
        .insert(intent.creator.to_lowercase(), intent.nonce + 1);

    // Inject into orders store so GET /orders shows it
    store.orders.insert(intent_id.clone(), injected_order);

    // Store in gasless map
    store.gasless.insert(intent_id.clone(), pending.clone());

    info!(intent_id = %intent_id, creator = %intent.creator, "Intent added to orderbook");

    pending
}

/// Update the status of a gasless intent.
pub fn update_intent_status(store: &IntentStore, intent_id: &str, status: IntentStatus) -> bool {
    if let Some(mut entry) = store.gasless.get_mut(intent_id) {
        let prev = entry.status.clone();
        entry.status = status.clone();
        info!(intent_id = %intent_id, ?prev, ?status, "Intent status updated");
        true
    } else {
        warn!(intent_id = %intent_id, "Cannot update status: intent not found");
        false
    }
}

/// Cancel a pending gasless intent (off-chain, pre-execute only).
/// Also marks the corresponding IntentOrder as CANCELLED.
/// Returns true if cancelled, false if not found or not cancellable.
pub fn cancel_intent(store: &IntentStore, intent_id: &str) -> bool {
    // Check gasless store first
    if let Some(mut entry) = store.gasless.get_mut(intent_id) {
        if !entry.status.can_cancel() {
            warn!(
                intent_id = %intent_id,
                status = ?entry.status,
                "Cannot cancel: intent already executing or terminal"
            );
            return false;
        }
        let prev = entry.status.clone();
        entry.status = IntentStatus::Cancelled;
        info!(intent_id = %intent_id, ?prev, "Intent cancelled by user");
    } else {
        // Not in gasless store — check indexed orders store
        if !store.orders.contains_key(intent_id) {
            warn!(intent_id = %intent_id, "Cannot cancel: intent not found");
            return false;
        }
    }

    // Update the IntentOrder status in orders store
    if let Some(mut order) = store.orders.get_mut(intent_id) {
        order.status = OrderStatus::Cancelled;
    }

    true
}

/// Mark a gasless intent as fulfilled (called by solver executor or indexer).
pub fn mark_fulfilled(store: &IntentStore, intent_id: &str) -> bool {
    let mut found = false;

    if let Some(mut entry) = store.gasless.get_mut(intent_id) {
        entry.status = IntentStatus::Fulfilled;
        info!(intent_id = %intent_id, "Intent marked fulfilled");
        found = true;
    }

    if let Some(mut order) = store.orders.get_mut(intent_id) {
        order.status = OrderStatus::Fulfilled;
        found = true;
    }

    found
}

/// Clean up expired intents (deadline passed without fulfillment).
/// Should be called periodically (e.g., every 30s via a background task in Phase 4+).
pub fn cleanup_expired(store: &IntentStore) -> usize {
    let now_secs = chrono::Utc::now().timestamp();
    let mut cleaned = 0;

    for mut entry in store.gasless.iter_mut() {
        let intent = entry.value_mut();
        if intent.intent.deadline < now_secs && !intent.status.is_terminal() {
            intent.status = IntentStatus::Expired;
            info!(intent_id = %intent.intent_id, "Intent expired");
            cleaned += 1;
        }
    }

    for mut entry in store.orders.iter_mut() {
        let order = entry.value_mut();
        let deadline_secs = order.deadline / 1000;
        if order.status == OrderStatus::Open && deadline_secs < now_secs {
            order.status = OrderStatus::Expired;
        }
    }

    cleaned
}
