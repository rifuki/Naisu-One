use std::{net::SocketAddr, time::Duration};

use naisu_backend::{
    AppState, app_routes,
    infrastructure::{
        Config, db, env, indexer, logging,
        server::{create_listener, shutdown_signal},
        web::{cors::build_cors_layer, middleware::http_trace_middleware},
    },
};
use axum::middleware::from_fn;
use eyre::Result;
use tracing::info;
use tracing_subscriber::util::SubscriberInitExt;

#[tokio::main]
async fn main() -> Result<()> {
    env::load();

    color_eyre::install()?;

    let config = Config::load()?;

    let (subscriber, _) = logging::setup();
    subscriber.init();
    info!(
        rust_env = %config.rust_env,
        "Application starting..."
    );

    // Ensure SQLite data directory exists
    if let Some(path) = config.database_url.strip_prefix("sqlite://") {
        if let Some(parent) = std::path::Path::new(path).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).ok();
            }
        }
    }

    let pool = db::create_pool(&config.database_url).await?;
    info!(database_url = %config.database_url, "Database connected and migrations applied");

    let port  = config.server.port;
    let state = AppState::new(config, pool);

    // Restore persisted state into DashMap on startup
    match db::intent_repo::load_all_orders(&state.db).await {
        Ok(orders) => {
            let count = orders.len();
            for order in orders {
                state.intent_store.orders.insert(order.order_id.clone(), order);
            }
            info!(count, "Restored intent orders from DB");
        }
        Err(e) => tracing::warn!(error = %e, "Failed to restore intent orders from DB"),
    }
    match db::intent_repo::load_all_gasless(&state.db).await {
        Ok(intents) => {
            let count = intents.len();
            for intent in intents {
                state.intent_store.nonces.insert(
                    intent.intent.creator.to_lowercase(),
                    intent.intent.nonce + 1,
                );
                state.intent_store.gasless.insert(intent.intent_id.clone(), intent);
            }
            info!(count, "Restored gasless intents from DB");
        }
        Err(e) => tracing::warn!(error = %e, "Failed to restore gasless intents from DB"),
    }

    info!("Application state initialized");

    // Background: mark solvers offline if they miss heartbeats (every 30s)
    {
        let registry = state.solver_registry.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                registry.mark_stale_offline();
            }
        });
    }

    // Background: check for fade penalties on exclusive windows (every 60s)
    {
        let registry = state.solver_registry.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                registry.check_fades();
            }
        });
    }

    // Background: EVM indexer (WS subscription with HTTP poll fallback)
    {
        let state_idx = state.clone();
        tokio::spawn(async move {
            indexer::evm::start(state_idx).await;
        });
    }

    let cors = build_cors_layer(&state.config);

    // Background task: sweep expired intents every 10 seconds
    let state_clone = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(10));
        loop {
            interval.tick().await;
            let cleaned = naisu_backend::feature::intent::orderbook::cleanup_expired(&state_clone);
            if cleaned > 0 {
                info!("Swept {} expired intents", cleaned);
            }
        }
    });

    let app = app_routes(state)
        .layer(from_fn(http_trace_middleware))
        .layer(cors);

    let listener = create_listener(port).await?;

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .map_err(|e| eyre::eyre!("Server error: {}", e))?;

    info!("Server shut down gracefully");

    Ok(())
}
