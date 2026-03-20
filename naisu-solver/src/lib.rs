pub mod auction;
pub mod chains;
pub mod config;
pub mod coordinator;
pub mod executor;
pub mod strategy;
pub mod wormhole;
pub mod tui;

use color_eyre::eyre;
use std::sync::Arc;

/// Run the solver in headless mode (original behavior).
/// All addresses and RPC URLs are loaded from config/.env — no hardcoded values.
pub async fn run_headless() -> eyre::Result<()> {
    let config = Arc::new(config::Config::load()?);

    tracing::info!(
        base_contract = %config.base_contract_address,
        base_chain_id = config.base_chain_id,
        sui_package = %config.sui_package_id,
        solana_program = %config.solana_program_id,
        "Starting Intent Solver (Headless)..."
    );

    // Headless mode has no coordinator registration — use an empty reporter
    let headless_reporter = coordinator::make_shared_reporter();

    let cfg_base = Arc::clone(&config);
    let evm_base_to_sol = tokio::spawn(async move {
        loop {
            tracing::info!("Starting Base Sepolia → Solana solver...");
            if let Err(e) = chains::evm_listener::run_with_config(
                Arc::clone(&cfg_base),
                cfg_base.base_chain_id,
                &cfg_base.base_rpc_url.clone(),
                &cfg_base.base_contract_address.clone(),
                Arc::clone(&headless_reporter),
            ).await {
                tracing::error!("Base listener error: {e} — restarting in 10s...");
                tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
            }
        }
    });

    let cfg_sol = Arc::clone(&config);
    let solana_to_evm = tokio::spawn(async move {
        loop {
            tracing::info!("Starting Solana -> EVM solver...");
            if let Err(e) = chains::solana_listener::run(&cfg_sol).await {
                tracing::error!("Solana listener error: {e} — restarting in 10s...");
                tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
            }
        }
    });

    let _ = tokio::join!(evm_base_to_sol, solana_to_evm);

    Ok(())
}
