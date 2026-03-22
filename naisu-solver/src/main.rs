mod auction;
mod chains;
mod config;
mod coordinator;
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

    // TUI is enabled by default; set SOLVER_TUI=false for plain log output.
    let use_tui = std::env::var("SOLVER_TUI")
        .map(|v| !matches!(v.to_lowercase().as_str(), "0" | "false" | "no"))
        .unwrap_or(true);

    // ── Logging setup ──────────────────────────────────────────────────────────
    std::fs::create_dir_all("logs")?;
    let file_appender = tracing_appender::rolling::daily("logs", "solver.log");
    let (file_writer, _guard) = tracing_appender::non_blocking(file_appender);
    let file_filter = EnvFilter::new("naisu_solver=info");

    let (tui_tx, tui_rx) = tokio::sync::mpsc::channel::<AppEvent>(2048);

    if use_tui {
        tracing_subscriber::registry()
            .with(
                tui::TuiLayer { tx: tui_tx.clone() }
                    .with_filter(EnvFilter::new("naisu_solver=info")),
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
                    .with_filter(EnvFilter::new("naisu_solver=info")),
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
        base_contract = %config.base_contract_address,
        base_chain_id = config.base_chain_id,
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

    // Create shared reporter — written by coordinator after registration,
    // read by evm_listener to post sol_sent / vaa_ready progress to backend.
    let reporter = coordinator::make_shared_reporter();

    // Solver network: register + heartbeat + RFQ server (no-op if env vars not set)
    {
        let cfg_coord      = Arc::clone(&config);
        let reporter_coord = Arc::clone(&reporter);
        tokio::spawn(async move { coordinator::start(cfg_coord, reporter_coord).await });
    }

    let cfg_base = Arc::clone(&config);
    let evm_base_to_sol = tokio::spawn(async move {
        loop {
            info!("Starting Base Sepolia → Solana solver (WS)...");
            if let Err(e) = chains::evm_listener::run_with_config(
                Arc::clone(&cfg_base),
                cfg_base.base_chain_id,
                &cfg_base.base_rpc_url.clone(),
                &cfg_base.base_contract_address.clone(),
                Arc::clone(&reporter),
            )
            .await
            {
                tracing::error!("Base listener error: {e} — restarting in 10s...");
                tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
            }
        }
    });

    let cfg_sol = Arc::clone(&config);
    let solana_to_evm = tokio::spawn(async move {
        loop {
            info!("Starting Solana → Base solver (WS)...");
            if let Err(e) = chains::solana_listener::run(&cfg_sol).await {
                tracing::error!("Solana listener error: {e} — restarting in 10s...");
                tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
            }
        }
    });

    let _ = tokio::join!(evm_base_to_sol, solana_to_evm);

    Ok(())
}

/// Update ETH balance for TUI.
/// WS mode (per-block) if BASE_SEPOLIA_WS_URL is set, otherwise HTTP poll every 15s.
async fn watch_evm_balance(config: Arc<Config>, tx: tokio::sync::mpsc::Sender<AppEvent>) {
    use ethers::providers::{Http, Middleware, Provider, StreamExt, Ws};

    let evm_wallet: ethers::signers::LocalWallet = match config.evm_private_key.parse() {
        Ok(w) => w,
        Err(_) => return,
    };
    let address = evm_wallet.address();

    if let Some(ws_url) = &config.evm_ws_url {
        let ws_url = ws_url.clone();
        loop {
            match Provider::<Ws>::connect(&ws_url).await {
                Ok(provider) => match provider.subscribe_blocks().await {
                    Ok(mut stream) => {
                        let _ = tx.send(AppEvent::Mode(Chain::Base, "WS".to_string(), ws_url.clone())).await;
                        while stream.next().await.is_some() {
                            if let Ok(balance) = provider.get_balance(address, None).await {
                                let eth: f64 = ethers::utils::format_ether(balance).parse().unwrap_or(0.0);
                                let _ = tx.send(AppEvent::Balance(Chain::Base, format!("{eth:.4} ETH"))).await;
                            }
                        }
                    }
                    Err(e) => tracing::warn!("EVM WS subscribe_blocks: {e}"),
                },
                Err(e) => tracing::warn!("EVM balance WS connect failed: {e}"),
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        }
    } else {
        // No WS URL — HTTP poll every 15s
        let Ok(provider) = Provider::<Http>::try_from(config.base_rpc_url.as_str()) else { return };
        let _ = tx.send(AppEvent::Mode(Chain::Base, "HTTP".to_string(), config.base_rpc_url.clone())).await;
        loop {
            if let Ok(balance) = provider.get_balance(address, None).await {
                let eth: f64 = ethers::utils::format_ether(balance).parse().unwrap_or(0.0);
                let _ = tx.send(AppEvent::Balance(Chain::Base, format!("{eth:.4} ETH"))).await;
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;
        }
    }
}

/// Subscribe to Solana account changes via accountSubscribe WS → real-time balance push.
/// WS first; on failure fetches HTTP once then retries WS.
async fn watch_sol_balance(config: Arc<Config>, tx: tokio::sync::mpsc::Sender<AppEvent>) {
    use futures::{SinkExt, StreamExt};
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    let sol_address = match derive_sol_address(&config.solana_private_key) {
        Ok(a) => a,
        Err(_) => return,
    };
    let _ = tx.send(AppEvent::Address(Chain::Solana, sol_address.clone())).await;

    let ws_url = config.solana_ws_url.clone()
        .unwrap_or_else(|| http_to_ws(&config.solana_rpc_url));
    let rpc_url = config.solana_rpc_url.clone();

    loop {
        match connect_async(&ws_url).await {
            Ok((mut ws, _)) => {
                let _ = tx.send(AppEvent::Mode(Chain::Solana, "WS".to_string(), ws_url.clone())).await;
                // accountSubscribe doesn't push initial value — fetch via HTTP first
                if let Ok(lamports) = fetch_sol_balance_http(&rpc_url, &sol_address).await {
                    let sol = lamports as f64 / 1e9;
                    let _ = tx.send(AppEvent::Balance(Chain::Solana, format!("{sol:.4} SOL"))).await;
                }
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
                let mut ping_interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
                ping_interval.tick().await;
                loop {
                    let text = tokio::select! {
                        msg = ws.next() => match msg {
                            Some(Ok(tokio_tungstenite::tungstenite::Message::Text(t))) => t,
                            Some(Ok(tokio_tungstenite::tungstenite::Message::Ping(p))) => {
                                let _ = ws.send(tokio_tungstenite::tungstenite::Message::Pong(p)).await;
                                continue;
                            }
                            Some(Ok(_)) => continue,
                            _ => break,
                        },
                        _ = ping_interval.tick() => {
                            if ws.send(tokio_tungstenite::tungstenite::Message::Ping(vec![].into())).await.is_err() { break; }
                            continue;
                        }
                    };
                    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
                    if let Some(lamports) = v["params"]["result"]["value"]["lamports"].as_u64() {
                        let sol = lamports as f64 / 1e9;
                        let _ = tx.send(AppEvent::Balance(Chain::Solana, format!("{sol:.4} SOL"))).await;
                    }
                }
                tracing::warn!("SOL WS stream ended — reconnecting...");
            }
            Err(e) => {
                tracing::warn!("SOL WS connect failed ({ws_url}): {e}");
                // Fallback: HTTP fetch, then retry WS
                let _ = tx.send(AppEvent::Mode(Chain::Solana, "HTTP".to_string(), rpc_url.clone())).await;
                if let Ok(lamports) = fetch_sol_balance_http(&rpc_url, &sol_address).await {
                    let sol = lamports as f64 / 1e9;
                    let _ = tx.send(AppEvent::Balance(Chain::Solana, format!("{sol:.4} SOL"))).await;
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;
                continue;
            }
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }
}

/// Poll SUI balance every 30s (WS not practical for balance on SUI).
async fn poll_sui_balance(config: Arc<Config>, tx: tokio::sync::mpsc::Sender<AppEvent>) {
    let _ = tx.send(AppEvent::Mode(Chain::Sui, "HTTP".to_string(), config.sui_rpc_url.clone())).await;
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

async fn fetch_sol_balance_http(rpc: &str, address: &str) -> eyre::Result<u64> {
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getBalance",
        "params": [address, {"commitment": "confirmed"}]
    });
    let resp: serde_json::Value = reqwest::Client::new()
        .post(rpc)
        .json(&body)
        .send()
        .await?
        .json()
        .await?;
    resp["result"]["value"].as_u64().ok_or_else(|| eyre::eyre!("no balance in response"))
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
