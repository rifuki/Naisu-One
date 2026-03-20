use std::time::Duration;

use alloy::{
    primitives::Address,
    providers::{Provider, ProviderBuilder},
    rpc::types::Filter,
    sol,
    sol_types::SolEvent,
    transports::ws::WsConnect,
};
use eyre::Result;
use futures::StreamExt;
use tracing::{error, info, warn};

use crate::{
    AppState,
    feature::intent::{
        events::{SolverProgressEvent, SseEventType},
        model::{IntentOrder, OrderStatus, SupportedChain},
        orderbook,
    },
    infrastructure::db::intent_repo,
};

// ─── ABI ─────────────────────────────────────────────────────────────────────

sol! {
    event OrderCreated(
        bytes32 indexed orderId,
        address indexed creator,
        bytes32 recipient,
        uint16  destinationChain,
        uint256 amount,
        uint256 startPrice,
        uint256 floorPrice,
        uint256 deadline,
        uint8   intentType
    );

    event OrderFulfilled(
        bytes32 indexed orderId,
        address indexed solver
    );
}

// ─── Public entry point ───────────────────────────────────────────────────────

pub async fn start(state: AppState) {
    loop {
        let result = if let Some(ref ws_url) = state.config.chain.ws_url.clone() {
            run_ws(state.clone(), ws_url.clone()).await
        } else {
            run_poll(state.clone()).await
        };

        if let Err(e) = result {
            error!(error = %e, "EVM indexer error — restarting in 10s");
        } else {
            warn!("EVM indexer stream ended — restarting in 10s");
        }

        tokio::time::sleep(Duration::from_secs(10)).await;
    }
}

// ─── WS subscription ─────────────────────────────────────────────────────────

async fn run_ws(state: AppState, ws_url: String) -> Result<()> {
    info!(ws_url = %ws_url, "EVM indexer connecting via WebSocket");

    let ws      = WsConnect::new(&ws_url);
    let provider = ProviderBuilder::new().connect_ws(ws).await?;
    let contract: Address = state.config.chain.contract_address.parse()?;

    let filter = Filter::new()
        .address(contract)
        .event(OrderCreated::SIGNATURE);

    let sub_created = provider.subscribe_logs(&filter).await?;
    let mut stream_created = sub_created.into_stream();

    let filter_fulfilled = Filter::new()
        .address(contract)
        .event(OrderFulfilled::SIGNATURE);

    let sub_fulfilled = provider.subscribe_logs(&filter_fulfilled).await?;
    let mut stream_fulfilled = sub_fulfilled.into_stream();

    info!("EVM indexer subscribed to IntentBridge logs via WS");

    loop {
        tokio::select! {
            Some(log) = stream_created.next() => {
                if let Ok(event) = log.log_decode::<OrderCreated>() {
                    on_order_created(&state, &event.inner.data, &log).await;
                }
            }
            Some(log) = stream_fulfilled.next() => {
                if let Ok(event) = log.log_decode::<OrderFulfilled>() {
                    on_order_fulfilled(&state, &event.inner.data, &log).await;
                }
            }
            else => break,
        }
    }

    warn!("EVM indexer WS streams ended");
    Ok(())
}

// ─── HTTP poll fallback ───────────────────────────────────────────────────────

async fn run_poll(state: AppState) -> Result<()> {
    info!(rpc_url = %state.config.chain.rpc_url, "EVM indexer polling via HTTP");

    let url: alloy::transports::http::reqwest::Url = state.config.chain.rpc_url.parse()?;
    let provider = ProviderBuilder::new().connect_http(url);
    let contract: Address = state.config.chain.contract_address.parse()?;

    let mut last_block = provider.get_block_number().await?;

    loop {
        tokio::time::sleep(Duration::from_secs(10)).await;

        let latest = match provider.get_block_number().await {
            Ok(b) => b,
            Err(e) => { warn!(error = %e, "get_block_number failed"); continue; }
        };

        if latest <= last_block { continue; }

        for sig in [OrderCreated::SIGNATURE, OrderFulfilled::SIGNATURE] {
            let filter = Filter::new()
                .address(contract)
                .event(sig)
                .from_block(last_block + 1)
                .to_block(latest);

            match provider.get_logs(&filter).await {
                Ok(logs) => {
                    for log in &logs {
                        if sig == OrderCreated::SIGNATURE {
                            if let Ok(event) = log.log_decode::<OrderCreated>() {
                                on_order_created(&state, &event.inner.data, log).await;
                            }
                        } else if let Ok(event) = log.log_decode::<OrderFulfilled>() {
                            on_order_fulfilled(&state, &event.inner.data, log).await;
                        }
                    }
                }
                Err(e) => warn!(error = %e, "get_logs failed — will retry"),
            }
        }

        last_block = latest;
    }
}

// ─── OrderCreated ─────────────────────────────────────────────────────────────

async fn on_order_created(
    state: &AppState,
    event: &OrderCreated,
    log: &alloy::rpc::types::Log,
) {
    let order_id = format!("0x{}", hex::encode(event.orderId));
    let creator  = format!("{:#x}", event.creator);

    info!(order_id = %order_id, creator = %creator, "IndexedOrderCreated");

    let amount_raw = event.amount.to_string();
    let amount_eth = format_eth(&amount_raw);
    let tx_hash    = log.transaction_hash.map(|h| format!("{:#x}", h)).unwrap_or_default();
    let explorer   = format!("https://sepolia.basescan.org/tx/{}", tx_hash);
    let now_ms     = chrono::Utc::now().timestamp_millis();
    let deadline_ms = (event.deadline.to::<u64>() as i64) * 1000;

    let order = IntentOrder {
        order_id:         order_id.clone(),
        chain:            SupportedChain::EvmBase,
        creator:          creator.clone(),
        recipient:        hex::encode(event.recipient),
        destination_chain: event.destinationChain,
        amount:           amount_eth,
        amount_raw,
        start_price:      event.startPrice.to_string(),
        floor_price:      event.floorPrice.to_string(),
        current_price:    Some(event.startPrice.to_string()),
        deadline:         deadline_ms,
        created_at:       now_ms,
        status:           OrderStatus::Open,
        intent_type:      event.intentType,
        explorer_url:     explorer,
        fulfill_tx_hash:  None,
        is_gasless:       false,
    };

    if state.intent_store.orders.contains_key(&order_id) {
        // Gasless intent confirmed on-chain — update is_gasless flag
        if let Some(mut existing) = state.intent_store.orders.get_mut(&order_id) {
            existing.is_gasless = true;
        }
        let _ = state.event_tx.send(SolverProgressEvent {
            event_type: SseEventType::GaslessResolved,
            order_id:   order_id.clone(),
            user_addr:  Some(creator.clone()),
            data: serde_json::json!({ "intentId": order_id, "contractOrderId": order_id }),
        });
    } else {
        // Check if this is a gasless intent submitted via /submit-signature
        // Gasless intents are stored with an internal intentId (not the onchain orderId).
        // Find the match by looking up who the creator is in the gasless store.
        let creator_lower = creator.to_lowercase();
        let matching_intent_id: Option<String> = state.intent_store.gasless
            .iter()
            .find(|entry| entry.value().intent.creator.to_lowercase() == creator_lower)
            .map(|entry| entry.key().clone());

        if let Some(intent_id) = matching_intent_id {
            // Update the order to mark it as gasless and persist
            let mut gasless_order = order.clone();
            gasless_order.is_gasless = true;
            state.intent_store.orders.insert(order_id.clone(), gasless_order.clone());

            let db  = state.db.clone();
            let ord = gasless_order;
            tokio::spawn(async move {
                intent_repo::upsert_order(&db, &ord).await;
            });

            info!(
                intent_id = %intent_id,
                contract_order_id = %order_id,
                creator = %creator,
                "Gasless intent resolved on-chain — emitting gasless_resolved"
            );

            // Emit gasless_resolved so frontend can switch tracking from intentId to contractOrderId
            let _ = state.event_tx.send(SolverProgressEvent {
                event_type: SseEventType::GaslessResolved,
                order_id:   intent_id.clone(),
                user_addr:  Some(creator.clone()),
                data: serde_json::json!({
                    "intentId":        intent_id,
                    "contractOrderId": order_id,
                }),
            });
        } else {
            // New regular on-chain order — persist to DB
            let db  = state.db.clone();
            let ord = order.clone();
            tokio::spawn(async move {
                intent_repo::upsert_order(&db, &ord).await;
            });
            state.intent_store.orders.insert(order_id.clone(), order);
        }
    }

    let _ = state.event_tx.send(SolverProgressEvent {
        event_type: SseEventType::OrderCreated,
        order_id:   order_id.clone(),
        user_addr:  Some(creator),
        data: serde_json::json!({ "chain": "evm-base" }),
    });
}

// ─── OrderFulfilled ───────────────────────────────────────────────────────────

async fn on_order_fulfilled(
    state: &AppState,
    event: &OrderFulfilled,
    log: &alloy::rpc::types::Log,
) {
    let order_id    = format!("0x{}", hex::encode(event.orderId));
    let solver_addr = format!("{:#x}", event.solver);
    let tx_hash     = log.transaction_hash.map(|h| format!("{:#x}", h));
    let creator     = state.intent_store.orders.get(&order_id).map(|o| o.creator.clone());

    info!(order_id = %order_id, solver = %solver_addr, "IndexedOrderFulfilled");

    if let Some(mut order) = state.intent_store.orders.get_mut(&order_id) {
        order.status = OrderStatus::Fulfilled;
        order.fulfill_tx_hash = tx_hash.clone();
    }

    orderbook::mark_fulfilled(&state.intent_store, &order_id);
    state.solver_registry.record_fill(&solver_addr, None, Some(&order_id));

    // Persist fulfilled status to DB (fire-and-forget)
    {
        let db  = state.db.clone();
        let oid = order_id.clone();
        let txh = tx_hash.clone();
        tokio::spawn(async move {
            intent_repo::update_order_status(
                &db, &oid,
                &crate::feature::intent::model::OrderStatus::Fulfilled,
                txh.as_deref(),
            ).await;
            intent_repo::update_gasless_status(
                &db, &oid,
                &crate::feature::intent::model::IntentStatus::Fulfilled,
                None,
            ).await;
        });
    }

    let mut data = serde_json::json!({ "solverAddress": solver_addr });
    if let Some(ref h) = tx_hash { data["txHash"] = serde_json::json!(h); }

    // Calculate fill time using created_at from the original order
    if let Some(order) = state.intent_store.orders.get(&order_id) {
        let now_ms = chrono::Utc::now().timestamp_millis();
        data["fillTimeMs"] = serde_json::json!(now_ms - order.created_at);
    }

    // Try to get solver name and quoted price if this was a gasless intent routed via RFQ
    let intent_id_opt = creator.as_ref().and_then(|c| {
        let c_lower = c.to_lowercase();
        state.intent_store.gasless
            .iter()
            .find(|e| e.value().intent.creator.to_lowercase() == c_lower)
            .map(|e| e.key().clone())
    });

    if let Some(iid) = intent_id_opt {
        if let Some(rfq) = state.solver_registry.get_rfq_result(&iid) {
            if let Some(name) = rfq.winner {
                data["solverName"] = serde_json::json!(name);
            }
            if let Some(winner_id) = rfq.winner_id {
                if let Some(quote) = rfq.quotes.iter().find(|q| q.solver_id == winner_id) {
                    data["quotedPrice"] = serde_json::json!(quote.quoted_price);
                }
            }
        }
    }

    let _ = state.event_tx.send(SolverProgressEvent {
        event_type: SseEventType::OrderFulfilled,
        order_id:   order_id.clone(),
        user_addr:  creator,
        data,
    });
}

// ─── Helper ───────────────────────────────────────────────────────────────────

fn format_eth(raw: &str) -> String {
    let Ok(val) = raw.parse::<u128>() else { return raw.to_string() };
    let whole = val / 1_000_000_000_000_000_000u128;
    let frac  = (val % 1_000_000_000_000_000_000u128) / 1_000_000_000_000u128; // 6 decimals
    format!("{}.{:06}", whole, frac)
}
