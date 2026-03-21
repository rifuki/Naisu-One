use crate::{auction, config::Config, coordinator, executor, wormhole};
use bs58;
use ethers::{
    providers::{Http, Middleware, Provider, StreamExt, Ws},
    types::{Address, Bytes, Filter, Log, TransactionRequest, U256},
};
use eyre::Result;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

#[derive(Debug, Clone)]
pub struct EvmOrder {
    pub order_id: [u8; 32],
    pub creator: String,
    pub recipient: [u8; 32],
    pub destination_chain: u16,
    pub amount: u128,
    pub start_price: u128,
    pub floor_price: u128,
    pub deadline: u64,
    pub created_at: u64,
    pub intent_type: u8,  // 0=SOL, 1=mSOL (Marinade)
}

fn evm_chain_name(chain_id: u64) -> &'static str {
    match chain_id {
        84532 => "Base Sepolia",
        _ => "EVM",
    }
}

fn dest_chain_name(chain: u16) -> &'static str {
    match chain {
        1 => "Solana",
        21 => "Sui",
        _ => "Unknown",
    }
}

fn format_wei_eth(wei: u128) -> String {
    let whole = wei / 1_000_000_000_000_000_000u128;
    let frac = (wei % 1_000_000_000_000_000_000u128) / 1_000_000_000_000u128;
    format!("{}.{:06} ETH", whole, frac)
}

fn evm_explorer_tx(chain_id: u64, tx_hash: &str) -> String {
    match chain_id {
        84532 => format!("https://sepolia.basescan.org/tx/{}", tx_hash),
        _ => format!("(chain_id={}) {}", chain_id, tx_hash),
    }
}

const SEP: &str     = "=======================================================";
const SEP_SUB: &str = "-------------------------------------------------------";

const ORDER_CREATED_EVENT: &str =
    "OrderCreated(bytes32,address,bytes32,uint16,uint256,uint256,uint256,uint256,uint8)";

/// Process a single EVM order end-to-end (solve → VAA → settle).
async fn process_evm_order(
    config: Arc<Config>,
    order: EvmOrder,
    price: u64,
    chain_id: u64,
    contract_addr: Address,
    rpc_url: String,
    seen_orders: Arc<Mutex<HashSet<[u8; 32]>>>,
    reporter: coordinator::SharedReporter,
) {
    // 0x-prefixed to match the format used by the backend indexer (viem) and the frontend tracker.
    // Without this prefix, sol_sent/vaa_ready orderId would mismatch the contractOrderId
    // the frontend receives via gasless_resolved, causing progress events to be silently dropped.
    let order_id_hex = format!("0x{}", hex::encode(order.order_id));
    let short = &order_id_hex[2..10]; // skip "0x", take 8 hex chars for display
    let chain_name = evm_chain_name(chain_id);
    let dest_name = dest_chain_name(order.destination_chain);
    let eth_fmt = format_wei_eth(order.amount);

    let recipient_display = if order.destination_chain == 1 {
        bs58::encode(&order.recipient).into_string()
    } else {
        format!("0x{}", hex::encode(&order.recipient[12..]))
    };

    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let deadline_min = order.deadline.saturating_sub(now_secs) / 60;

    info!("{SEP}");
    info!(" NEW ORDER  |  {chain_name} → {dest_name}");
    info!(" id        : {order_id_hex}");
    info!(" amount    : {eth_fmt}  →  {price} lamports/mist");
    info!(" creator   : {}", order.creator);
    info!(" recipient : {recipient_display}");
    info!(" deadline  : {deadline_min} min remaining");
    info!(" intentType: {}", order.intent_type);
    info!("{SEP}");

    let mut solana_payment_sig: Option<String> = None;
    let mut solana_recipient_b58_cap: Option<String> = None;
    let mut payment_amount_lamports: u64 = 0;

    let (wh_chain_id, emitter_address, wh_sequence) =
        if order.destination_chain == 1 {
            let recipient_b58 = bs58::encode(&order.recipient).into_string();
            let mode_label = match order.intent_type {
                1 => "bridge+marinade_stake",
                3 => "bridge+marginfi_lend",
                4 => "bridge+jito_stake",
                5 => "bridge+jupsol_stake",
                6 => "bridge+kamino_stake",
                _ => "bridge",
            };

            info!("{SEP_SUB}");
            info!(" [{short}] STEP 1/3  |  Solana devnet — mode: {mode_label}");
            info!(" [{short}]           |  {price} lamports  →  {recipient_b58}");
            info!("{SEP_SUB}");

            match order.intent_type {
                1 => {
                    match executor::solana_executor::solve_and_liquid_stake(
                        &config, order.order_id, &recipient_b58, price,
                    ).await {
                        Ok((sig, seq, msol_minted)) => {
                            let sol_url = format!("https://explorer.solana.com/tx/{sig}?cluster=devnet");
                            info!(" [{short}] STEP 1/3 ✓  |  SOL bridged + Marinade staked");
                            info!(" [{short}]  mSOL minted : {msol_minted}");
                            info!(" [{short}]  seq : {seq}");
                            info!(" [{short}]  tx  : {sig}");
                            info!(" [{short}]  url : {sol_url}");
                            // Report sol_sent step to backend so frontend can update progress
                            coordinator::report_step(&reporter, &order_id_hex, "sol_sent", Some(&sig)).await;
                            solana_payment_sig = Some(sig);
                            solana_recipient_b58_cap = Some(recipient_b58);
                            payment_amount_lamports = price;
                            (1u16, config.solana_emitter_address.clone(), seq)
                        }
                        Err(e) => {
                            let err_str = e.to_string();
                            error!(" [{short}] STEP 1/3 ✗  |  solve_and_liquid_stake failed: {e}");
                            if !err_str.contains("SolanaTransactionFailed") {
                                seen_orders.lock().await.remove(&order.order_id);
                                warn!(" [{short}]  → removed from dedup, will retry");
                            }
                            info!("{SEP}");
                            info!(" [{short}] ✗ ORDER ABORTED  |  Solana liquid stake step failed");
                            info!("{SEP}");
                            return;
                        }
                    }
                }
                3 => {
                    match executor::solana_executor::solve_and_marginfi(
                        &config, order.order_id, &recipient_b58, price,
                    ).await {
                        Ok((sig, seq)) => {
                            let sol_url = format!("https://explorer.solana.com/tx/{sig}?cluster=devnet");
                            info!(" [{short}] STEP 1/3 ✓  |  SOL bridged + deposited to marginfi");
                            info!(" [{short}]  seq : {seq}");
                            info!(" [{short}]  tx  : {sig}");
                            info!(" [{short}]  url : {sol_url}");
                            coordinator::report_step(&reporter, &order_id_hex, "sol_sent", Some(&sig)).await;
                            solana_payment_sig = Some(sig);
                            solana_recipient_b58_cap = Some(recipient_b58);
                            payment_amount_lamports = price;
                            (1u16, config.solana_emitter_address.clone(), seq)
                        }
                        Err(e) => {
                            let err_str = e.to_string();
                            error!(" [{short}] STEP 1/3 ✗  |  solve_and_marginfi failed: {e}");
                            if !err_str.contains("SolanaTransactionFailed") {
                                seen_orders.lock().await.remove(&order.order_id);
                                warn!(" [{short}]  → removed from dedup, will retry");
                            }
                            info!("{SEP}");
                            info!(" [{short}] ✗ ORDER ABORTED  |  marginfi deposit step failed");
                            info!("{SEP}");
                            return;
                        }
                    }
                }
                it @ (4 | 5 | 6) => {
                    let (label, fn_call) = match it {
                        4 => ("jito_stake",   executor::solana_executor::solve_and_jito(&config, order.order_id, &recipient_b58, price).await),
                        5 => ("jupsol_stake", executor::solana_executor::solve_and_jupsol(&config, order.order_id, &recipient_b58, price).await),
                        _ => ("kamino_stake", executor::solana_executor::solve_and_kamino(&config, order.order_id, &recipient_b58, price).await),
                    };
                    match fn_call {
                        Ok((sig, seq, minted)) => {
                            let sol_url = format!("https://explorer.solana.com/tx/{sig}?cluster=devnet");
                            info!(" [{short}] STEP 1/3 ✓  |  SOL bridged + {label} complete");
                            info!(" [{short}]  minted : {minted}");
                            info!(" [{short}]  seq    : {seq}");
                            info!(" [{short}]  tx     : {sig}");
                            info!(" [{short}]  url    : {sol_url}");
                            coordinator::report_step(&reporter, &order_id_hex, "sol_sent", Some(&sig)).await;
                            solana_payment_sig = Some(sig);
                            solana_recipient_b58_cap = Some(recipient_b58);
                            payment_amount_lamports = price;
                            (1u16, config.solana_emitter_address.clone(), seq)
                        }
                        Err(e) => {
                            let err_str = e.to_string();
                            error!(" [{short}] STEP 1/3 ✗  |  {label} failed: {e}");
                            if !err_str.contains("SolanaTransactionFailed") {
                                seen_orders.lock().await.remove(&order.order_id);
                                warn!(" [{short}]  → removed from dedup, will retry");
                            }
                            info!("{SEP}");
                            info!(" [{short}] ✗ ORDER ABORTED  |  {label} step failed");
                            info!("{SEP}");
                            return;
                        }
                    }
                }
                _ => {
                    match executor::solana_executor::solve_and_prove(
                        &config, order.order_id, &recipient_b58, price,
                    ).await {
                        Ok((sig, seq)) => {
                            let sol_url = format!("https://explorer.solana.com/tx/{sig}?cluster=devnet");
                            info!(" [{short}] STEP 1/3 ✓  |  SOL sent");
                            info!(" [{short}]  seq : {seq}");
                            info!(" [{short}]  tx  : {sig}");
                            info!(" [{short}]  url : {sol_url}");
                            // Report sol_sent step to backend so frontend can update progress
                            coordinator::report_step(&reporter, &order_id_hex, "sol_sent", Some(&sig)).await;
                            solana_payment_sig = Some(sig);
                            solana_recipient_b58_cap = Some(recipient_b58);
                            payment_amount_lamports = price;
                            (1u16, config.solana_emitter_address.clone(), seq)
                        }
                        Err(e) => {
                            let err_str = e.to_string();
                            error!(" [{short}] STEP 1/3 ✗  |  solve_and_prove failed: {e}");
                            if !err_str.contains("SolanaTransactionFailed") {
                                seen_orders.lock().await.remove(&order.order_id);
                                warn!(" [{short}]  → removed from dedup, will retry");
                            }
                            info!("{SEP}");
                            info!(" [{short}] ✗ ORDER ABORTED  |  Solana step failed");
                            info!("{SEP}");
                            return;
                        }
                    }
                }
            }
        } else {
            info!("{SEP_SUB}");
            info!(" [{short}] STEP 1/3  |  Sending SUI on Sui testnet");
            info!("{SEP_SUB}");
            match executor::sui_executor::solve_and_prove(&config, &order, price).await {
                Ok(result) => {
                    info!(" [{short}] STEP 1/3 ✓  |  SUI sent");
                    info!(" [{short}]  seq    : {}", result.1);
                    info!(" [{short}]  digest : {}", result.0);
                    (21u16, config.sui_emitter_address.clone(), result.1)
                }
                Err(e) => {
                    error!(" [{short}] STEP 1/3 ✗  |  Sui solve_and_prove failed: {e}");
                    info!("{SEP}");
                    info!(" [{short}] ✗ ORDER ABORTED  |  Sui step failed");
                    info!("{SEP}");
                    return;
                }
            }
        };

    info!("{SEP_SUB}");
    info!(" [{short}] STEP 2/3  |  Waiting for Wormhole VAA");
    info!(" [{short}]           |  chain={wh_chain_id}  seq={wh_sequence}");
    info!("{SEP_SUB}");

    let vaa_start = std::time::Instant::now();
    let vaa = match wormhole::fetch_vaa(
        &config.wormhole_api_url, wh_chain_id, &emitter_address, wh_sequence,
    ).await {
        Ok(v) => {
            let elapsed = vaa_start.elapsed().as_secs();
            info!(" [{short}] STEP 2/3 ✓  |  VAA ready  ({} bytes, {elapsed}s)", v.len());
            // Report vaa_ready step to backend so frontend can update progress
            coordinator::report_step(&reporter, &order_id_hex, "vaa_ready", None).await;
            v
        }
        Err(e) => {
            error!(" [{short}] STEP 2/3 ✗  |  VAA fetch failed: {e}");
            info!("{SEP}");
            info!(" [{short}] ✗ ORDER ABORTED  |  VAA fetch failed");
            info!("{SEP}");
            return;
        }
    };

    let current_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let time_remaining = order.deadline.saturating_sub(current_time);
    let is_urgent = time_remaining < 120;

    info!("{SEP_SUB}");
    if is_urgent {
        warn!(" [{short}] STEP 3/3  |  ⚠ URGENT — {time_remaining}s to deadline, using HIGH GAS");
    } else {
        info!(" [{short}] STEP 3/3  |  Settling on {chain_name}");
    }
    info!(" [{short}]           |  contract={contract_addr}");
    info!("{SEP_SUB}");

    use executor::evm_executor::SettleOutcome;
    let contract_addr_str = format!("{:?}", contract_addr);
    let settle_result = if is_urgent {
        executor::evm_executor::settle_order_urgent(&config, vaa, chain_id, &rpc_url, &contract_addr_str).await
    } else {
        executor::evm_executor::settle_order(&config, vaa, chain_id, &rpc_url, &contract_addr_str).await
    };

    match settle_result {
        SettleOutcome::Success(tx_hash) => {
            let evm_explorer = evm_explorer_tx(chain_id, &tx_hash);
            info!("{SEP}");
            if let (Some(sol_sig), Some(recipient)) = (&solana_payment_sig, &solana_recipient_b58_cap) {
                let sol_explorer = format!("https://explorer.solana.com/tx/{sol_sig}?cluster=devnet");
                info!(" [{short}] ✓ ORDER FULFILLED  |  {chain_name} → Solana");
                info!(" [{short}]  amount    : {payment_amount_lamports} lamports");
                info!(" [{short}]  recipient : {recipient}");
                info!(" [{short}]  SOL tx  : {sol_sig}");
                info!(" [{short}]  ETH tx  : {tx_hash}");
                info!(" [{short}]  SOL url : {sol_explorer}");
                info!(" [{short}]  ETH url : {evm_explorer}");
            } else {
                info!(" [{short}] ✓ ORDER FULFILLED  |  {chain_name} → Sui");
                info!(" [{short}]  ETH tx  : {tx_hash}");
                info!(" [{short}]  ETH url : {evm_explorer}");
            }
            // Report settle tx to frontend so "Bridge settled" step gets its tx hash
            coordinator::report_step(&reporter, &order_id_hex, "settled", Some(&tx_hash)).await;
            info!("{SEP}");
        }
        SettleOutcome::PermanentSkip(reason) => {
            info!("{SEP}");
            warn!(" [{short}] ⚠ ORDER SKIPPED  |  already processed");
            warn!(" [{short}]  reason : {reason}");
            info!("{SEP}");
        }
        SettleOutcome::TransientError(reason) => {
            info!("{SEP}");
            error!(" [{short}] ✗ ORDER FAILED  |  transient error");
            error!(" [{short}]  reason : {reason}");
            info!("{SEP}");
        }
    }
}

/// Handle a single OrderCreated log: validate, deduplicate, price, and spawn processing.
async fn handle_order_log(
    log: Log,
    http: &Provider<Http>,
    config: &Arc<Config>,
    chain_id: u64,
    contract_addr: Address,
    rpc_url: &str,
    seen_orders: Arc<Mutex<HashSet<[u8; 32]>>>,
    reporter: coordinator::SharedReporter,
) {
    let chain_name = evm_chain_name(chain_id);
    let tx_hash = log.transaction_hash.map(|h| format!("{h:?}")).unwrap_or_default();

    let Some(order) = parse_order_created(&log, http).await else {
        warn!("[{chain_name}] failed to parse order from tx {tx_hash}");
        return;
    };

    let order_id_hex = hex::encode(order.order_id);
    let short = &order_id_hex[..8];

    if seen_orders.lock().await.contains(&order.order_id) {
        debug!("[{chain_name}] {short} already in dedup — skip");
        return;
    }

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    if now_ms >= order.deadline * 1000 {
        info!("[{chain_name}] SKIP {short} — expired");
        seen_orders.lock().await.insert(order.order_id);
        return;
    }

    match query_order_status(http, contract_addr, order.order_id).await {
        Ok(status) if status != 0 => {
            info!("[{chain_name}] SKIP {short} — already settled (status={status})");
            seen_orders.lock().await.insert(order.order_id);
            return;
        }
        Err(e) => {
            warn!("[{chain_name}] SKIP {short} — status query failed: {e}");
            return;
        }
        Ok(_) => {}
    }

    let price = match auction::calculate_price(
        order.start_price as u64,
        order.floor_price as u64,
        order.created_at * 1000,
        order.deadline * 1000,
        now_ms,
    ) {
        Some(p) => p,
        None => {
            error!("[{chain_name}] SKIP {short} — invalid auction params");
            seen_orders.lock().await.insert(order.order_id);
            return;
        }
    };

    const DEADLINE_BUFFER_SECS: u64 = 90;
    let time_until_deadline = order.deadline.saturating_sub(now_ms / 1000);
    if time_until_deadline < DEADLINE_BUFFER_SECS {
        warn!(
            "[{chain_name}] SKIP {short} — deadline too close ({}min left, need 1.5min)",
            time_until_deadline / 60
        );
        seen_orders.lock().await.insert(order.order_id);
        return;
    }

    let eth_fmt = format_wei_eth(order.amount);
    let dest_name = dest_chain_name(order.destination_chain);
    info!(
        "[{chain_name}→{dest_name}] ▶  {}  {} lps  {}min deadline  id={}",
        eth_fmt, price, time_until_deadline / 60, order_id_hex
    );

    seen_orders.lock().await.insert(order.order_id);

    let config_clone  = Arc::clone(config);
    let seen_clone    = Arc::clone(&seen_orders);
    let rpc_clone     = rpc_url.to_string();
    let reporter_clone = Arc::clone(&reporter);

    tokio::spawn(async move {
        process_evm_order(config_clone, order, price, chain_id, contract_addr, rpc_clone, seen_clone, reporter_clone).await;
    });
}

/// Listen for OrderCreated events.
/// - If BASE_SEPOLIA_WS_URL is set: uses WS subscription (instant) with HTTP catchup on reconnect.
/// - Otherwise: falls back to HTTP polling every 5s.
pub async fn run_with_config(
    config: Arc<Config>,
    chain_id: u64,
    rpc_url: &str,
    contract: &str,
    reporter: coordinator::SharedReporter,
) -> Result<()> {
    let chain_name = evm_chain_name(chain_id);
    let contract_addr: Address = contract.parse()?;
    let seen_orders: Arc<Mutex<HashSet<[u8; 32]>>> = Arc::new(Mutex::new(HashSet::new()));

    let http = Provider::<Http>::try_from(rpc_url)?;
    let mut last_block = http.get_block_number().await?.saturating_sub(2000.into());

    let order_filter = Filter::new()
        .address(contract_addr)
        .event(ORDER_CREATED_EVENT);

    match &config.evm_ws_url {
        Some(ws_url) => {
            info!("[{chain_name}] WS mode | contract={contract_addr} | from block={last_block}");
            run_ws_mode(&config, chain_id, rpc_url, &ws_url.clone(), contract_addr, http, last_block, order_filter, seen_orders, reporter).await;
        }
        None => {
            info!("[{chain_name}] HTTP polling mode | set BASE_SEPOLIA_WS_URL for real-time WS | contract={contract_addr} | from block={last_block}");
            run_http_mode(&config, chain_id, rpc_url, contract_addr, http, &mut last_block, order_filter, seen_orders, reporter).await;
        }
    }

    Ok(())
}

async fn run_ws_mode(
    config: &Arc<Config>,
    chain_id: u64,
    rpc_url: &str,
    ws_url: &str,
    contract_addr: Address,
    http: Provider<Http>,
    mut last_block: ethers::types::U64,
    order_filter: Filter,
    seen_orders: Arc<Mutex<HashSet<[u8; 32]>>>,
    reporter: coordinator::SharedReporter,
) {
    let chain_name = evm_chain_name(chain_id);

    loop {
        // ── Catchup missed blocks via HTTP ─────────────────────────────────
        if let Ok(current) = http.get_block_number().await {
            let safe = current.saturating_sub(2.into());
            if safe > last_block {
                let catchup = order_filter.clone().from_block(last_block + 1).to_block(safe);
                match http.get_logs(&catchup).await {
                    Ok(logs) => {
                        if !logs.is_empty() {
                            info!("[{chain_name}] Catchup: {} event(s) in blocks {}→{}", logs.len(), last_block + 1, safe);
                        }
                        for log in logs {
                            handle_order_log(log, &http, config, chain_id, contract_addr, rpc_url, Arc::clone(&seen_orders), Arc::clone(&reporter)).await;
                        }
                    }
                    Err(e) => warn!("[{chain_name}] Catchup get_logs failed: {e}"),
                }
                last_block = safe;
            }
        }

        // ── WS subscription ────────────────────────────────────────────────
        match Provider::<Ws>::connect(ws_url).await {
            Ok(ws) => match ws.subscribe_logs(&order_filter).await {
                Ok(mut stream) => {
                    info!("[{chain_name}] WS connected ✓  streaming OrderCreated events...");
                    while let Some(log) = stream.next().await {
                        if let Some(bn) = log.block_number { last_block = bn; }
                        handle_order_log(log, &http, config, chain_id, contract_addr, rpc_url, Arc::clone(&seen_orders), Arc::clone(&reporter)).await;
                    }
                    warn!("[{chain_name}] WS stream ended — reconnecting...");
                }
                Err(e) => warn!("[{chain_name}] subscribe_logs failed: {e}"),
            },
            Err(e) => warn!("[{chain_name}] WS connect failed: {e}"),
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
    }
}

async fn run_http_mode(
    config: &Arc<Config>,
    chain_id: u64,
    rpc_url: &str,
    contract_addr: Address,
    http: Provider<Http>,
    last_block: &mut ethers::types::U64,
    order_filter: Filter,
    seen_orders: Arc<Mutex<HashSet<[u8; 32]>>>,
    reporter: coordinator::SharedReporter,
) {
    let chain_name = evm_chain_name(chain_id);
    const LAG: u64 = 2;

    loop {
        let current = match http.get_block_number().await {
            Ok(b) => b,
            Err(e) => {
                warn!("[{chain_name}] get_block_number failed: {e}");
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                continue;
            }
        };

        let safe = current.saturating_sub(LAG.into());
        if safe > *last_block {
            let filter = order_filter.clone().from_block(*last_block + 1).to_block(safe);
            match http.get_logs(&filter).await {
                Ok(logs) => {
                    for log in logs {
                        handle_order_log(log, &http, config, chain_id, contract_addr, rpc_url, Arc::clone(&seen_orders), Arc::clone(&reporter)).await;
                    }
                }
                Err(e) => warn!("[{chain_name}] get_logs failed: {e}"),
            }
            *last_block = safe;
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }
}

async fn query_order_status(
    provider: &Provider<Http>,
    contract_addr: Address,
    order_id: [u8; 32],
) -> eyre::Result<u8> {
    let selector = &ethers::utils::keccak256(b"orders(bytes32)")[..4];
    let mut calldata = selector.to_vec();
    calldata.extend_from_slice(&order_id);

    let call = TransactionRequest::new()
        .to(contract_addr)
        .data(Bytes::from(calldata));

    let result = provider.call(&call.into(), None).await
        .map_err(|e| eyre::eyre!("orders() call failed: {e}"))?;

    if result.len() < 9 * 32 {
        return Err(eyre::eyre!("orders() returned too few bytes: {}", result.len()));
    }
    Ok(result[8 * 32 + 31])
}

async fn parse_order_created(log: &Log, provider: &Provider<Http>) -> Option<EvmOrder> {
    let topics = &log.topics;
    if topics.len() < 3 { return None; }

    let data: &[u8] = log.data.as_ref();
    if data.len() < 224 { return None; }

    let order_id: [u8; 32] = topics[1].as_bytes().try_into().ok()?;
    let creator = format!("{:?}", Address::from(topics[2]));

    let mut recipient = [0u8; 32];
    recipient.copy_from_slice(&data[0..32]);

    let destination_chain = U256::from_big_endian(&data[32..64]).as_u32() as u16;
    let amount = U256::from_big_endian(&data[64..96]).as_u128();
    let start_price = U256::from_big_endian(&data[96..128]).as_u128();
    let floor_price = U256::from_big_endian(&data[128..160]).as_u128();
    let deadline = U256::from_big_endian(&data[160..192]).as_u64();
    let intent_type = data[223]; // 0=SOL, 1=mSOL (Marinade)

    let created_at = if let Some(block_number) = log.block_number {
        provider.get_block(block_number).await.ok().flatten()
            .map(|b| b.timestamp.as_u64())
            .unwrap_or(0)
    } else {
        0
    };

    Some(EvmOrder {
        order_id, creator, recipient, destination_chain,
        amount, start_price, floor_price, deadline, created_at, intent_type,
    })
}
