mod auction;
mod chains;
mod config;
mod executor;
mod strategy;
mod tui;
mod wormhole;

use config::Config;
use ethers::signers::Signer;
use eyre::Result;
use std::sync::Arc;
use tracing::info;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter, Layer};

use tui::{AppEvent, Chain};

#[tokio::main]
async fn main() -> Result<()> {
    color_eyre::install()?;

    // TUI aktif by default, set SOLVER_TUI=false untuk plain logs
    let use_tui = std::env::var("SOLVER_TUI")
        .map(|v| !matches!(v.to_lowercase().as_str(), "0" | "false" | "no"))
        .unwrap_or(true);

    // ── Logging setup ──────────────────────────────────────────────────────────
    std::fs::create_dir_all("logs")?;
    let file_appender = tracing_appender::rolling::daily("logs", "solver.log");
    let (file_writer, _guard) = tracing_appender::non_blocking(file_appender);
    let file_filter = EnvFilter::new("intent_solver=info");

    let (tui_tx, tui_rx) = tokio::sync::mpsc::channel::<AppEvent>(2048);

    if use_tui {
        tracing_subscriber::registry()
            .with(
                tui::TuiLayer { tx: tui_tx.clone() }
                    .with_filter(EnvFilter::new("intent_solver=info")),
            )
            .with(
                fmt::layer()
                    .json()
                    .with_writer(file_writer)
                    .with_filter(file_filter),
            )
            .init();
    } else {
        tracing_subscriber::registry()
            .with(
                fmt::layer()
                    .with_target(false)
                    .with_filter(EnvFilter::new("intent_solver=info")),
            )
            .with(
                fmt::layer()
                    .json()
                    .with_writer(file_writer)
                    .with_filter(file_filter),
            )
            .init();
    }

    let config = Arc::new(Config::load()?);

    let evm_wallet: ethers::signers::LocalWallet = config.evm_private_key.parse()?;
    let evm_address = format!("{:?}", evm_wallet.address());

    info!(
        evm_contract = %config.evm_contract_address,
        evm_chain_id = config.evm_chain_id,
        evm2_contract = %config.evm2_contract_address,
        evm2_chain_id = config.evm2_chain_id,
        solana_program = %config.solana_program_id,
        evm_solver_address = %evm_address,
        "Starting Intent Solver..."
    );

    if use_tui {
        // Send EVM address immediately
        let _ = tui_tx.send(AppEvent::Address(Chain::Base, evm_address.clone())).await;

        // EVM: subscribe to new blocks → update ETH balance per block (real-time)
        tokio::spawn(watch_evm_balance(Arc::clone(&config), tui_tx.clone()));
        // SOL: accountSubscribe WS → balance pushed on every account change (real-time)
        tokio::spawn(watch_sol_balance(Arc::clone(&config), tui_tx.clone()));
        // SUI: HTTP poll every 30s (WS not practical for balance on SUI)
        tokio::spawn(poll_sui_balance(Arc::clone(&config), tui_tx.clone()));

        // TUI runs in a dedicated thread (crossterm is blocking)
        std::thread::spawn(move || {
            if let Err(e) = tui::run_tui(tui_rx) {
                eprintln!("TUI error: {e}");
            }
        });
    }

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

    let cfg_fuji = Arc::clone(&config);
    let evm_fuji_to_sui = tokio::spawn(async move {
        loop {
            info!("Starting Avalanche Fuji → Sui/Solana solver...");
            if let Err(e) = chains::evm_listener::run_with_config(
                Arc::clone(&cfg_fuji),
                cfg_fuji.evm_chain_id,
                &cfg_fuji.evm_rpc_url.clone(),
                &cfg_fuji.evm_contract_address.clone(),
            )
            .await
            {
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
            )
            .await
            {
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

/// Subscribe to Base Sepolia new blocks via WS → fetch ETH balance on each block.
async fn watch_evm_balance(config: Arc<Config>, tx: tokio::sync::mpsc::Sender<AppEvent>) {
    use ethers::providers::{Middleware, Provider, StreamExt, Ws};

    let ws_url = http_to_ws(&config.evm2_rpc_url);
    let evm_wallet: ethers::signers::LocalWallet = match config.evm_private_key.parse() {
        Ok(w) => w,
        Err(_) => return,
    };
    let address = evm_wallet.address();

    loop {
        match Provider::<Ws>::connect(&ws_url).await {
            Ok(provider) => match provider.subscribe_blocks().await {
                Ok(mut stream) => {
                    while stream.next().await.is_some() {
                        if let Ok(balance) = provider.get_balance(address, None).await {
                            let eth: f64 =
                                ethers::utils::format_ether(balance).parse().unwrap_or(0.0);
                            let _ = tx
                                .send(AppEvent::Balance(Chain::Base, format!("{eth:.4} ETH")))
                                .await;
                        }
                    }
                }
                Err(e) => tracing::warn!("EVM WS subscribe_blocks: {e}"),
            },
            Err(e) => tracing::warn!("EVM WS connect failed ({ws_url}): {e}"),
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }
}

/// Subscribe to Solana account changes via accountSubscribe WS → real-time balance push.
async fn watch_sol_balance(config: Arc<Config>, tx: tokio::sync::mpsc::Sender<AppEvent>) {
    use futures::{SinkExt, StreamExt};
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    let sol_address = match derive_sol_address(&config.solana_private_key) {
        Ok(a) => a,
        Err(_) => return,
    };
    let _ = tx
        .send(AppEvent::Address(Chain::Solana, sol_address.clone()))
        .await;

    let ws_url = http_to_ws(&config.solana_rpc_url);
    loop {
        match connect_async(&ws_url).await {
            Ok((mut ws, _)) => {
                let sub = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "accountSubscribe",
                    "params": [sol_address, {"encoding": "jsonParsed", "commitment": "confirmed"}]
                });
                if ws.send(Message::Text(sub.to_string().into())).await.is_err() {
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                    continue;
                }
                while let Some(Ok(Message::Text(text))) = ws.next().await {
                    let v: serde_json::Value =
                        serde_json::from_str(&text).unwrap_or_default();
                    if let Some(lamports) =
                        v["params"]["result"]["value"]["lamports"].as_u64()
                    {
                        let sol = lamports as f64 / 1e9;
                        let _ = tx
                            .send(AppEvent::Balance(Chain::Solana, format!("{sol:.4} SOL")))
                            .await;
                    }
                }
            }
            Err(e) => tracing::warn!("SOL WS connect failed ({ws_url}): {e}"),
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }
}

/// Poll SUI balance every 30s (WS not practical for balance on SUI).
async fn poll_sui_balance(config: Arc<Config>, tx: tokio::sync::mpsc::Sender<AppEvent>) {
    loop {
        if let Ok((bal, addr)) =
            fetch_sui_balance(&config.sui_rpc_url, &config.sui_private_key).await
        {
            let _ = tx.send(AppEvent::Balance(Chain::Sui, bal)).await;
            let _ = tx.send(AppEvent::Address(Chain::Sui, addr)).await;
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
    }
}

fn http_to_ws(url: &str) -> String {
    url.replace("https://", "wss://").replace("http://", "ws://")
}

/// Derive base58 Solana pubkey from private key (hex or base58 keypair).
fn derive_sol_address(key: &str) -> eyre::Result<String> {
    let key = key.trim();
    let seed: [u8; 32] = if key.len() == 88 {
        let bytes = bs58::decode(key)
            .into_vec()
            .map_err(|e| eyre::eyre!("{e}"))?;
        bytes[..32].try_into().map_err(|_| eyre::eyre!("bad len"))?
    } else {
        let bytes = hex::decode(key.trim_start_matches("0x"))?;
        bytes.try_into().map_err(|_| eyre::eyre!("bad len"))?
    };
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&seed);
    Ok(bs58::encode(signing_key.verifying_key().as_bytes()).into_string())
}

async fn fetch_sui_balance(rpc: &str, private_key: &str) -> eyre::Result<(String, String)> {
    use sui_types::crypto::{EncodeDecodeBase64, SuiKeyPair};

    let keypair = SuiKeyPair::decode_base64(private_key)
        .or_else(|_| SuiKeyPair::decode(private_key))
        .map_err(|e| eyre::eyre!("SUI key parse: {e}"))?;
    let address = sui_types::base_types::SuiAddress::from(&keypair.public());
    let address_str = address.to_string();

    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "suix_getBalance",
        "params": [address_str, "0x2::sui::SUI"]
    });
    let resp: serde_json::Value = reqwest::Client::new()
        .post(rpc)
        .json(&body)
        .send()
        .await?
        .json()
        .await?;
    let mist: u64 = resp["result"]["totalBalance"]
        .as_str()
        .unwrap_or("0")
        .parse()
        .unwrap_or(0);
    Ok((format!("{:.4} SUI", mist as f64 / 1e9), address_str))
}
