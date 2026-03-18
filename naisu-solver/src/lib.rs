pub mod auction;
pub mod chains;
pub mod config;
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
        evm_contract = %config.evm_contract_address,
        evm_chain_id = config.evm_chain_id,
        evm2_contract = %config.evm2_contract_address,
        evm2_chain_id = config.evm2_chain_id,
        sui_package = %config.sui_package_id,
        solana_program = %config.solana_program_id,
        "Starting Intent Solver (Headless)..."
    );

    let cfg1 = Arc::clone(&config);
    let sui_to_evm = tokio::spawn(async move {
        loop {
            tracing::info!("Starting Sui -> EVM solver...");
            if let Err(e) = chains::sui_listener::run(&cfg1).await {
                tracing::error!("Sui listener error: {e} — restarting in 10s...");
                tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
            }
        }
    });

    // EVM → Sui/Solana: spawn 2 listeners (Fuji + Base), all config from .env
    let cfg_fuji = Arc::clone(&config);
    let evm_fuji_to_sui = tokio::spawn(async move {
        loop {
            tracing::info!("Starting Avalanche Fuji → Sui/Solana solver...");
            if let Err(e) = chains::evm_listener::run_with_config(
                Arc::clone(&cfg_fuji),
                cfg_fuji.evm_chain_id,
                &cfg_fuji.evm_rpc_url.clone(),
                &cfg_fuji.evm_contract_address.clone(),
            ).await {
                tracing::error!("Fuji listener error: {e} — restarting in 10s...");
                tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
            }
        }
    });

    let cfg_base = Arc::clone(&config);
    let evm_base_to_sol = tokio::spawn(async move {
        loop {
            tracing::info!("Starting Base Sepolia → Solana solver...");
            if let Err(e) = chains::evm_listener::run_with_config(
                Arc::clone(&cfg_base),
                cfg_base.evm2_chain_id,
                &cfg_base.evm2_rpc_url.clone(),
                &cfg_base.evm2_contract_address.clone(),
            ).await {
                tracing::error!("Base listener error: {e} — restarting in 10s...");
                tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
            }
        }
    });

    let cfg3 = Arc::clone(&config);
    let solana_to_evm = tokio::spawn(async move {
        loop {
            tracing::info!("Starting Solana -> EVM solver...");
            if let Err(e) = chains::solana_listener::run(&cfg3).await {
                tracing::error!("Solana listener error: {e} — restarting in 10s...");
                tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
            }
        }
    });

    let _ = tokio::join!(sui_to_evm, evm_fuji_to_sui, evm_base_to_sol, solana_to_evm);

    Ok(())
}
