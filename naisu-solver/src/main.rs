mod auction;
mod chains;
mod config;
mod executor;
mod strategy;
mod wormhole;

use config::Config;
use ethers::signers::Signer;
use eyre::Result;
use std::sync::Arc;
use tracing::info;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter, Layer};

#[tokio::main]
async fn main() -> Result<()> {
    color_eyre::install()?;

    // ── Logging setup: stdout (human-readable) + file (JSON per-day) ──────────
    // Logs dir: /Users/rifuki/mgodonf/web3/intent-bridge/logs/
    // Files rotate daily: solver.2026-02-27.log, solver.2026-02-28.log, ...
    std::fs::create_dir_all("../logs")?;
    let file_appender = tracing_appender::rolling::daily("../logs", "solver.log");
    let (file_writer, _guard) = tracing_appender::non_blocking(file_appender);

    let filter = EnvFilter::new("intent_solver=info");

    tracing_subscriber::registry()
        // Layer 1: stdout — compact human-readable (same as before)
        .with(
            fmt::layer()
                .with_target(false)
                .with_filter(EnvFilter::new("intent_solver=info")),
        )
        // Layer 2: file — JSON for machine parsing / grep
        .with(
            fmt::layer()
                .json()
                .with_writer(file_writer)
                .with_filter(filter),
        )
        .init();

    let config = Arc::new(Config::load()?);
    
    // Derive EVM address from private key for logging
    let evm_wallet: ethers::signers::LocalWallet = config.evm_private_key.parse()?;
    let evm_address = format!("{:?}", evm_wallet.address());
    
    info!(
        evm_contract = %config.evm_contract_address,
        evm_chain_id = config.evm_chain_id,
        evm2_contract = %config.evm2_contract_address,
        evm2_chain_id = config.evm2_chain_id,
        solana_program = %config.solana_program_id,
        enable_auto_stake = config.enable_auto_stake,
        evm_solver_address = %evm_address,
        "Starting Intent Solver..."
    );

    let cfg1 = Arc::clone(&config);
    let sui_to_evm = tokio::spawn(async move {
        loop {
            info!("Starting Sui -> EVM solver...");
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
            info!("Starting Avalanche Fuji → Sui/Solana solver...");
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
            info!("Starting Base Sepolia → Solana solver...");
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
            info!("Starting Solana -> EVM solver...");
            if let Err(e) = chains::solana_listener::run(&cfg3).await {
                tracing::error!("Solana listener error: {e} — restarting in 10s...");
                tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
            }
        }
    });

    let _ = tokio::join!(sui_to_evm, evm_fuji_to_sui, evm_base_to_sol, solana_to_evm);

    Ok(())
}
