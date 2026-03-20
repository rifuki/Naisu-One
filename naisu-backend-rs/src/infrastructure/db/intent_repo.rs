use eyre::Result;
use sqlx::SqlitePool;
use tracing::warn;

use crate::feature::intent::model::{
    IntentDetails, IntentOrder, IntentStatus, OrderStatus, PendingIntent, SupportedChain,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn serialize_enum<T: serde::Serialize>(val: &T) -> String {
    serde_json::to_value(val)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

fn deserialize_enum<T: for<'de> serde::Deserialize<'de>>(s: &str) -> Result<T> {
    serde_json::from_str(&format!("\"{s}\"")).map_err(|e| eyre::eyre!(e))
}

// ─── intent_orders ────────────────────────────────────────────────────────────

pub async fn upsert_order(pool: &SqlitePool, order: &IntentOrder) {
    let chain   = serialize_enum(&order.chain);
    let status  = serialize_enum(&order.status);
    let gasless = order.is_gasless as i64;

    let result = sqlx::query!(
        r#"
        INSERT INTO intent_orders
            (order_id, chain, creator, recipient, destination_chain,
             amount, amount_raw, start_price, floor_price, current_price,
             deadline, created_at, status, intent_type, explorer_url,
             fulfill_tx_hash, is_gasless)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(order_id) DO UPDATE SET
            status          = excluded.status,
            current_price   = excluded.current_price,
            fulfill_tx_hash = excluded.fulfill_tx_hash,
            is_gasless      = excluded.is_gasless
        "#,
        order.order_id,
        chain,
        order.creator,
        order.recipient,
        order.destination_chain,
        order.amount,
        order.amount_raw,
        order.start_price,
        order.floor_price,
        order.current_price,
        order.deadline,
        order.created_at,
        status,
        order.intent_type,
        order.explorer_url,
        order.fulfill_tx_hash,
        gasless,
    )
    .execute(pool)
    .await;

    if let Err(e) = result {
        warn!(error = %e, order_id = %order.order_id, "Failed to upsert intent_order to DB");
    }
}

pub async fn update_order_status(
    pool: &SqlitePool,
    order_id: &str,
    status: &OrderStatus,
    fulfill_tx_hash: Option<&str>,
) {
    let status_str = serialize_enum(status);
    let result = sqlx::query!(
        "UPDATE intent_orders SET status = ?, fulfill_tx_hash = COALESCE(?, fulfill_tx_hash) WHERE order_id = ?",
        status_str,
        fulfill_tx_hash,
        order_id,
    )
    .execute(pool)
    .await;

    if let Err(e) = result {
        warn!(error = %e, order_id = %order_id, "Failed to update order status in DB");
    }
}

pub async fn load_all_orders(pool: &SqlitePool) -> Result<Vec<IntentOrder>> {
    let rows = sqlx::query!(
        "SELECT order_id, chain, creator, recipient, destination_chain,
                amount, amount_raw, start_price, floor_price, current_price,
                deadline, created_at, status, intent_type, explorer_url,
                fulfill_tx_hash, is_gasless
         FROM intent_orders"
    )
    .fetch_all(pool)
    .await?;

    let mut orders = Vec::with_capacity(rows.len());
    for row in rows {
        let chain: SupportedChain = deserialize_enum(&row.chain)?;
        let status: OrderStatus   = deserialize_enum(&row.status)?;

        orders.push(IntentOrder {
            order_id:          row.order_id.unwrap_or_default(),
            chain,
            creator:           row.creator,
            recipient:         row.recipient,
            destination_chain: row.destination_chain as u16,
            amount:            row.amount,
            amount_raw:        row.amount_raw,
            start_price:       row.start_price,
            floor_price:       row.floor_price,
            current_price:     row.current_price,
            deadline:          row.deadline,
            created_at:        row.created_at,
            status,
            intent_type:       row.intent_type as u8,
            explorer_url:      row.explorer_url,
            fulfill_tx_hash:   row.fulfill_tx_hash,
            is_gasless:        row.is_gasless != 0,
        });
    }

    Ok(orders)
}

// ─── gasless_intents ──────────────────────────────────────────────────────────

pub async fn upsert_gasless(pool: &SqlitePool, pending: &PendingIntent) {
    let status = serialize_enum(&pending.status);
    let i      = &pending.intent;
    let nonce  = i.nonce as i64; // SQLite doesn't support u64 directly

    let result = sqlx::query!(
        r#"
        INSERT INTO gasless_intents
            (intent_id, creator, recipient, destination_chain, amount,
             start_price, floor_price, deadline, intent_type, nonce,
             signature, status, submitted_at, winning_solver)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(intent_id) DO UPDATE SET
            status         = excluded.status,
            winning_solver = excluded.winning_solver
        "#,
        pending.intent_id,
        i.creator,
        i.recipient,
        i.destination_chain,
        i.amount,
        i.start_price,
        i.floor_price,
        i.deadline,
        i.intent_type,
        nonce,
        pending.signature,
        status,
        pending.submitted_at,
        pending.winning_solver,
    )
    .execute(pool)
    .await;

    if let Err(e) = result {
        warn!(error = %e, intent_id = %pending.intent_id, "Failed to upsert gasless_intent to DB");
    }
}

pub async fn update_gasless_status(
    pool: &SqlitePool,
    intent_id: &str,
    status: &IntentStatus,
    winning_solver: Option<&str>,
) {
    let status_str = serialize_enum(status);
    let result = sqlx::query!(
        "UPDATE gasless_intents SET status = ?, winning_solver = COALESCE(?, winning_solver) WHERE intent_id = ?",
        status_str,
        winning_solver,
        intent_id,
    )
    .execute(pool)
    .await;

    if let Err(e) = result {
        warn!(error = %e, intent_id = %intent_id, "Failed to update gasless status in DB");
    }
}

pub async fn load_all_gasless(pool: &SqlitePool) -> Result<Vec<PendingIntent>> {
    let rows = sqlx::query!(
        "SELECT intent_id, creator, recipient, destination_chain, amount,
                start_price, floor_price, deadline, intent_type, nonce,
                signature, status, submitted_at, winning_solver
         FROM gasless_intents"
    )
    .fetch_all(pool)
    .await?;

    let mut intents = Vec::with_capacity(rows.len());
    for row in rows {
        let status: IntentStatus = deserialize_enum(&row.status)?;

        intents.push(PendingIntent {
            intent_id: row.intent_id.clone().unwrap_or_default(),
            intent: IntentDetails {
                creator:           row.creator,
                recipient:         row.recipient,
                destination_chain: row.destination_chain as u16,
                amount:            row.amount,
                start_price:       row.start_price,
                floor_price:       row.floor_price,
                deadline:          row.deadline,
                intent_type:       row.intent_type as u8,
                nonce:             row.nonce as u64,
            },
            signature:      row.signature,
            status,
            submitted_at:   row.submitted_at,
            winning_solver: row.winning_solver,
            quotes:         Vec::new(), // ephemeral, not persisted
        });
    }

    Ok(intents)
}
