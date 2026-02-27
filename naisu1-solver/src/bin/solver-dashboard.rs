// Solver Dashboard - TUI version (PRODUCTION)
// Run with: cargo run

use intent_solver::config::Config;
use intent_solver::tui::app::{AppEvent, Chain};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> eyre::Result<()> {
    color_eyre::install()?;
    
    let (event_tx, event_rx) = mpsc::channel::<AppEvent>(1000);
    let cancel_token = CancellationToken::new();
    
    // Spawn REAL solver
    let solver_token = cancel_token.clone();
    let solver_handle = tokio::spawn(run_solver_with_events(event_tx.clone(), solver_token));
    
    // Spawn balance updater
    let balance_token = cancel_token.clone();
    let balance_handle = tokio::spawn(update_balances(event_tx.clone(), balance_token));
    
    // Run TUI (blocks until user quits)
    let tui_result = intent_solver::tui::run_tui(event_rx).await;
    
    // Signal shutdown
    cancel_token.cancel();
    
    // Cleanup dengan timeout (jangan nunggu lama)
    let _ = tokio::time::timeout(
        tokio::time::Duration::from_secs(2),
        solver_handle
    ).await;
    let _ = tokio::time::timeout(
        tokio::time::Duration::from_secs(2),
        balance_handle
    ).await;
    
    tui_result
}

async fn run_solver_with_events(
    event_tx: mpsc::Sender<AppEvent>,
    cancel: CancellationToken
) -> eyre::Result<()> {
    let config = Arc::new(Config::load()?);
    
    event_tx.send(AppEvent::Log("🚀 Solver production mode starting...".to_string())).await.ok();
    event_tx.send(AppEvent::Log("📡 Connecting to blockchains...".to_string())).await.ok();
    
    // Fetch initial balances
    fetch_and_update_balances(&config, &event_tx).await;
    
    // Spawn listeners dengan cancellation
    let cfg1 = Arc::clone(&config);
    let tx1 = event_tx.clone();
    let cancel1 = cancel.clone();
    let sui_to_evm = tokio::spawn(async move {
        loop {
            if cancel1.is_cancelled() {
                break;
            }
            tx1.send(AppEvent::Log("🔄 [Sui→EVM] Starting listener...".to_string())).await.ok();
            
            tokio::select! {
                _ = cancel1.cancelled() => break,
                result = intent_solver::chains::sui_listener::run(&cfg1) => {
                    if let Err(e) = result {
                        tx1.send(AppEvent::Log(format!("❌ [Sui→EVM] Error: {e}"))).await.ok();
                        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
                    }
                }
            }
        }
    });

    // EVM → Sui/Solana: spawn 2 listeners (Fuji + Base)
    let cfg_fuji = Arc::clone(&config);
    let tx_fuji = event_tx.clone();
    let cancel_fuji = cancel.clone();
    let evm_fuji_to_sui = tokio::spawn(async move {
        loop {
            if cancel_fuji.is_cancelled() {
                break;
            }
            tx_fuji.send(AppEvent::Log("🔄 [Fuji→Solana] Starting listener...".to_string())).await.ok();
            
            tokio::select! {
                _ = cancel_fuji.cancelled() => break,
                result = intent_solver::chains::evm_listener::run_with_config(
                    Arc::clone(&cfg_fuji),
                    43113,
                    "https://avalanche-fuji-c-chain-rpc.publicnode.com",
                    "0x274768b4B16841d23B8248d1311fBDC760803E65",
                ) => {
                    match result {
                        Ok(_) => {
                            tx_fuji.send(AppEvent::Log("⚠️ [Fuji→Solana] Listener exited unexpectedly...".to_string())).await.ok();
                            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                        }
                        Err(e) => {
                            tx_fuji.send(AppEvent::Log(format!("❌ [Fuji→Solana] Error: {e}"))).await.ok();
                            tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
                        }
                    }
                }
            }
        }
    });

    let cfg_base = Arc::clone(&config);
    let tx_base = event_tx.clone();
    let cancel_base = cancel.clone();
    let evm_base_to_sol = tokio::spawn(async move {
        loop {
            if cancel_base.is_cancelled() {
                break;
            }
            tx_base.send(AppEvent::Log("🔄 [Base→Solana] Starting listener...".to_string())).await.ok();
            
            tokio::select! {
                _ = cancel_base.cancelled() => break,
                result = intent_solver::chains::evm_listener::run_with_config(
                    Arc::clone(&cfg_base),
                    84532,
                    "https://sepolia.base.org",
                    "0x666ba230d79b3a2fc0713ad3a6bbb67aa467af05",  // Base contract!
                ) => {
                    match result {
                        Ok(_) => {
                            tx_base.send(AppEvent::Log("⚠️ [Base→Solana] Listener exited unexpectedly...".to_string())).await.ok();
                            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                        }
                        Err(e) => {
                            tx_base.send(AppEvent::Log(format!("❌ [Base→Solana] Error: {e}"))).await.ok();
                            tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
                        }
                    }
                }
            }
        }
    });

    let cfg3 = Arc::clone(&config);
    let tx3 = event_tx.clone();
    let cancel3 = cancel.clone();
    let solana_to_evm = tokio::spawn(async move {
        loop {
            if cancel3.is_cancelled() {
                break;
            }
            tx3.send(AppEvent::Log("🔄 [Solana→EVM] Starting listener...".to_string())).await.ok();
            
            tokio::select! {
                _ = cancel3.cancelled() => break,
                result = intent_solver::chains::solana_listener::run(&cfg3) => {
                    if let Err(e) = result {
                        tx3.send(AppEvent::Log(format!("❌ [Solana→EVM] Error: {e}"))).await.ok();
                        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
                    }
                }
            }
        }
    });

    // Wait for cancellation
    cancel.cancelled().await;
    
    // Cancel semua tasks
    sui_to_evm.abort();
    evm_fuji_to_sui.abort();
    evm_base_to_sol.abort();
    solana_to_evm.abort();
    
    Ok(())
}

async fn update_balances(
    event_tx: mpsc::Sender<AppEvent>,
    cancel: CancellationToken
) {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
    
    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = interval.tick() => {
                if let Ok(config) = Config::load() {
                    fetch_and_update_balances(&config, &event_tx).await;
                }
            }
        }
    }
}

async fn fetch_and_update_balances(config: &Config, event_tx: &mpsc::Sender<AppEvent>) {
    // Derive and log addresses
    match get_sui_address(config) {
        Ok(addr) => {
            let addr_str = format!("{}", addr);
            let _ = event_tx.send(AppEvent::Log(format!("📍 SUI Address: {}", addr_str))).await;
            let truncated = format!("{}...{}", &addr_str[..6], &addr_str[addr_str.len()-4..]);
            let _ = event_tx.send(AppEvent::Address(Chain::Sui, truncated)).await;
        }
        Err(e) => { let _ = event_tx.send(AppEvent::Log(format!("❌ Failed to derive SUI address: {e}"))).await; }
    }
    
    match get_evm_address(config) {
        Ok(addr) => {
            let addr_str = format!("{:?}", addr);
            let _ = event_tx.send(AppEvent::Log(format!("📍 EVM Address: {}", addr_str))).await;
            let truncated = format!("{}...{}", &addr_str[..8], &addr_str[addr_str.len()-4..]);
            let _ = event_tx.send(AppEvent::Address(Chain::Avax, truncated)).await;
        }
        Err(e) => { let _ = event_tx.send(AppEvent::Log(format!("❌ Failed to derive EVM address: {e}"))).await; }
    }
    
    match get_solana_address(config) {
        Ok(addr) => {
            let _ = event_tx.send(AppEvent::Log(format!("📍 SOL Address: {}", addr))).await;
            let truncated = format!("{}...{}", &addr[..4], &addr[addr.len()-4..]);
            let _ = event_tx.send(AppEvent::Address(Chain::Solana, truncated)).await;
        }
        Err(e) => { let _ = event_tx.send(AppEvent::Log(format!("❌ Failed to derive SOL address: {e}"))).await; }
    }
    
    // SUI Balance
    match get_sui_balance(config).await {
        Ok(balance) => {
            event_tx.send(AppEvent::Log(format!("💰 SUI Balance: {:.4}", balance))).await.ok();
            event_tx.send(AppEvent::Balance(Chain::Sui, format!("{:.4} SUI", balance))).await.ok();
        }
        Err(e) => {
            event_tx.send(AppEvent::Log(format!("⚠️ SUI balance fetch failed: {e}"))).await.ok();
        }
    }
    
    // AVAX Balance
    match get_avax_balance(config).await {
        Ok(balance) => {
            event_tx.send(AppEvent::Log(format!("💰 AVAX Balance fetched: {:.4}", balance))).await.ok();
            event_tx.send(AppEvent::Balance(Chain::Avax, format!("{:.4} AVAX", balance))).await.ok();
        }
        Err(e) => {
            event_tx.send(AppEvent::Log(format!("⚠️ AVAX balance fetch failed: {e}"))).await.ok();
        }
    }
    
    // SOL Balance
    match get_sol_balance(config, event_tx).await {
        Ok(balance) => {
            event_tx.send(AppEvent::Log(format!("💰 SOL Balance fetched: {:.4}", balance))).await.ok();
            event_tx.send(AppEvent::Balance(Chain::Solana, format!("{:.4} SOL", balance))).await.ok();
        }
        Err(e) => {
            event_tx.send(AppEvent::Log(format!("⚠️ SOL balance fetch failed: {e}"))).await.ok();
        }
    }
}

// Derive Sui address from bech32 private key (suiprivkey1...)
fn get_sui_address(config: &Config) -> eyre::Result<sui_sdk::types::base_types::SuiAddress> {
    use sui_sdk::types::crypto::{SuiKeyPair, SignatureScheme};
    
    // Decode bech32 format
    let keypair = SuiKeyPair::decode(&config.sui_private_key)?;
    let address = sui_sdk::types::base_types::SuiAddress::from(&keypair.public());
    
    Ok(address)
}

async fn get_sui_balance(config: &Config) -> eyre::Result<f64> {
    use sui_sdk::SuiClientBuilder;
    
    let sui_client = SuiClientBuilder::default()
        .build(&config.sui_rpc_url)
        .await?;
    
    let address = get_sui_address(config)?;
    
    // Fetch only SUI coins (not ETH, USDC, etc)
    let coins = sui_client.coin_read_api()
        .get_coins(address, Some("0x2::sui::SUI".to_string()), None, None)
        .await?;
    
    let total: u64 = coins.data.iter().map(|c| c.balance as u64).sum();
    Ok(total as f64 / 1_000_000_000.0) // Convert from MIST to SUI
}

// Derive EVM address from private key
fn get_evm_address(config: &Config) -> eyre::Result<ethers::types::Address> {
    use ethers::signers::Signer;
    let wallet: ethers::signers::LocalWallet = config.evm_private_key.parse()?;
    Ok(wallet.address())
}

async fn get_avax_balance(config: &Config) -> eyre::Result<f64> {
    use ethers::providers::{Provider, Http};
    use ethers::prelude::*;
    
    let provider = Provider::<Http>::try_from(&config.evm_rpc_url)?;
    let address = get_evm_address(config)?;
    let balance = provider.get_balance(address, None).await?;
    
    Ok(balance.as_u128() as f64 / 1e18)
}

// Derive Solana address from private key
// Supports: base58 keypair (88 chars), hex keypair (128 chars), or hex seed (64 chars)
fn get_solana_address(config: &Config) -> eyre::Result<String> {
    let key_str = &config.solana_private_key;
    
    // Try base58 first (88 chars = standard Solana keypair format)
    if key_str.len() == 88 {
        let bytes = bs58::decode(key_str).into_vec()?;
        if bytes.len() == 64 {
            // [32 bytes secret][32 bytes public]
            return Ok(bs58::encode(&bytes[32..64]).into_string());
        }
    }
    
    // Try hex (128 chars = 64 bytes keypair, or 64 chars = 32 bytes seed)
    let bytes = hex::decode(key_str)?;
    
    if bytes.len() == 64 {
        // Full keypair: [32 bytes secret][32 bytes public]
        Ok(bs58::encode(&bytes[32..64]).into_string())
    } else if bytes.len() == 32 {
        // Just seed - derive public key
        use ed25519_dalek::SigningKey;
        let signing_key = SigningKey::from_bytes(&bytes.try_into().unwrap());
        Ok(bs58::encode(signing_key.verifying_key().as_bytes()).into_string())
    } else {
        Err(eyre::eyre!("Invalid key length: {} bytes (expected 32 or 64)", bytes.len()))
    }
}

async fn get_sol_balance(config: &Config, event_tx: &mpsc::Sender<AppEvent>) -> eyre::Result<f64> {
    use reqwest::Client;
    use serde_json::json;
    
    let address = get_solana_address(config)?;
    event_tx.send(AppEvent::Log(format!("🔍 Fetching SOL balance for: {}", address))).await.ok();
    
    let client = Client::new();
    let response = client
        .post(&config.solana_rpc_url)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getBalance",
            "params": [address]
        }))
        .send()
        .await?;
    
    let json: serde_json::Value = response.json().await?;
    let lamports = json["result"]["value"].as_u64().unwrap_or(0);
    
    Ok(lamports as f64 / 1_000_000_000.0) // Convert to SOL
}
