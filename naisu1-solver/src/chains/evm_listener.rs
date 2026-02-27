use crate::{auction, config::Config, executor, wormhole};
use bs58;
use ethers::{
    providers::{Http, Middleware, Provider},
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
    pub creator: String,     // EVM address
    pub recipient: [u8; 32], // Sui address
    pub destination_chain: u16,
    pub amount: u128,
    pub start_price: u128,
    pub floor_price: u128,
    pub deadline: u64,
    pub created_at: u64,
}

fn evm_chain_name(chain_id: u64) -> &'static str {
    match chain_id {
        43113 => "Avalanche Fuji",
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

/// Format wei as human-readable ETH (6 decimal places).
fn format_wei_eth(wei: u128) -> String {
    let whole = wei / 1_000_000_000_000_000_000u128;
    let frac = (wei % 1_000_000_000_000_000_000u128) / 1_000_000_000_000u128;
    format!("{}.{:06} ETH", whole, frac)
}

fn evm_explorer_tx(chain_id: u64, tx_hash: &str) -> String {
    match chain_id {
        43113 => format!("https://testnet.snowtrace.io/tx/{}", tx_hash),
        84532 => format!("https://sepolia.basescan.org/tx/{}", tx_hash),
        _ => format!("(chain_id={}) {}", chain_id, tx_hash),
    }
}

const SEP: &str    = "=======================================================";
const SEP_SUB: &str = "-------------------------------------------------------";

/// Process a single EVM order end-to-end (solve, fetch VAA, settle).
/// This runs in a separate Tokio task for concurrent order processing.
async fn process_evm_order(
    config: Arc<Config>,
    provider: Provider<Http>,
    order: EvmOrder,
    price: u64,
    chain_id: u64,
    contract_addr: Address,
    rpc_url: String,
    seen_orders: Arc<Mutex<HashSet<[u8; 32]>>>,
) {
    let order_id_hex = hex::encode(&order.order_id);
    let short = &order_id_hex[..8];
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

    // ── ORDER HEADER ─────────────────────────────────────────────────────
    info!("{SEP}");
    info!(" NEW ORDER  |  {chain_name} → {dest_name}");
    info!(" id        : {order_id_hex}");
    info!(" amount    : {eth_fmt}  →  {price} lamports/mist");
    info!(" creator   : {}", order.creator);
    info!(" recipient : {recipient_display}");
    info!(" deadline  : {deadline_min} min remaining");
    info!("{SEP}");

    let mut solana_payment_sig: Option<String> = None;
    let mut solana_recipient_b58_cap: Option<String> = None;
    let mut payment_amount_lamports: u64 = 0;

    // ── STEP 1 ───────────────────────────────────────────────────────────
    let (wh_chain_id, emitter_address, wh_sequence) =
        if order.destination_chain == 1 {
            let recipient_b58 = bs58::encode(&order.recipient).into_string();

            info!("{SEP_SUB}");
            info!(" [{short}] STEP 1/3  |  Sending SOL on Solana devnet");
            info!(" [{short}]           |  {price} lamports  →  {recipient_b58}");
            info!("{SEP_SUB}");

            let solana_result = if config.enable_auto_stake {
                executor::solana_executor::solve_and_stake(
                    &config,
                    order.order_id,
                    order.recipient,
                    price,
                )
                .await
            } else {
                executor::solana_executor::solve_and_prove(
                    &config,
                    order.order_id,
                    &recipient_b58,
                    price,
                )
                .await
            };

            match solana_result {
                Ok((sig, seq)) => {
                    let action = if config.enable_auto_stake { "staked" } else { "sent" };
                    let sol_url = format!("https://explorer.solana.com/tx/{sig}?cluster=devnet");
                    info!(" [{short}] STEP 1/3 ✓  |  SOL {action}");
                    info!(" [{short}]  seq : {seq}");
                    info!(" [{short}]  tx  : {sig}");
                    info!(" [{short}]  url : {sol_url}");
                    solana_payment_sig = Some(sig);
                    solana_recipient_b58_cap = Some(recipient_b58);
                    payment_amount_lamports = price;
                    (1u16, config.solana_emitter_address.clone(), seq)
                }
                Err(e) => {
                    let err_str = e.to_string();
                    let action = if config.enable_auto_stake { "solve_and_stake" } else { "solve_and_prove" };
                    error!(" [{short}] STEP 1/3 ✗  |  Solana {action} failed: {e}");
                    if !err_str.contains("SolanaTransactionFailed") {
                        seen_orders.lock().await.remove(&order.order_id);
                        warn!(" [{short}]  → removed from dedup, will retry on next poll");
                    }
                    info!("{SEP}");
                    info!(" [{short}] ✗ ORDER ABORTED  |  Solana step failed");
                    info!("{SEP}");
                    return;
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

    // ── STEP 2: Fetch Wormhole VAA ────────────────────────────────────────
    info!("{SEP_SUB}");
    info!(" [{short}] STEP 2/3  |  Waiting for Wormhole VAA");
    info!(" [{short}]           |  chain={wh_chain_id}  seq={wh_sequence}");
    info!("{SEP_SUB}");

    let vaa_start = std::time::Instant::now();
    let vaa = match wormhole::fetch_vaa(
        &config.wormhole_api_url,
        wh_chain_id,
        &emitter_address,
        wh_sequence,
    )
    .await
    {
        Ok(v) => {
            let elapsed = vaa_start.elapsed().as_secs();
            info!(" [{short}] STEP 2/3 ✓  |  VAA ready  ({} bytes, {elapsed}s)", v.len());
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

    // Final deadline check — we MUST settle after sending SOL/SUI or we lose funds
    let current_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let time_remaining = order.deadline.saturating_sub(current_time);
    let is_urgent = time_remaining < 120;

    // ── STEP 3: Settle on EVM ─────────────────────────────────────────────
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

    // ── RESULT ───────────────────────────────────────────────────────────
    match settle_result {
        SettleOutcome::Success(tx_hash) => {
            let evm_explorer = evm_explorer_tx(chain_id, &tx_hash);
            info!("{SEP}");
            if let (Some(sol_sig), Some(recipient)) =
                (&solana_payment_sig, &solana_recipient_b58_cap)
            {
                let sol_explorer = format!(
                    "https://explorer.solana.com/tx/{sol_sig}?cluster=devnet"
                );
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
            info!("{SEP}");
        }
        SettleOutcome::PermanentSkip(reason) => {
            info!("{SEP}");
            warn!(" [{short}] ⚠ ORDER SKIPPED  |  already processed (permanent skip)");
            warn!(" [{short}]  reason : {reason}");
            info!("{SEP}");
        }
        SettleOutcome::TransientError(reason) => {
            info!("{SEP}");
            error!(" [{short}] ✗ ORDER FAILED  |  transient error, no auto-retry");
            error!(" [{short}]  reason : {reason}");
            info!("{SEP}");
        }
    }
}

/// Run EVM listener with explicit chain config (avoids env var race conditions)
pub async fn run_with_config(
    config: Arc<Config>,
    chain_id: u64,
    rpc_url: &str,
    contract: &str,
) -> Result<()> {
    let chain_name = evm_chain_name(chain_id);
    let provider = Provider::<Http>::try_from(rpc_url)?;
    let contract_addr: Address = contract.parse()?;
    let current = provider.get_block_number().await?;
    let mut last_block = current.saturating_sub(2000.into());

    // Dedup: shared across polling loop and spawned tasks.
    let seen_orders: Arc<Mutex<HashSet<[u8; 32]>>> = Arc::new(Mutex::new(HashSet::new()));

    info!(
        "[{}] Listener ready | contract {} | head={} | scanning from block {}",
        chain_name, contract_addr, current, last_block
    );

    // RPC lag buffer: public RPCs often return latest block before eth_getLogs has
    // indexed those blocks. Without this buffer, we advance last_block past un-indexed
    // blocks and permanently miss orders. The seen_orders dedup prevents double-processing.
    const RPC_LAG_BUFFER_BLOCKS: u64 = 5;

    loop {
        let current_block = provider.get_block_number().await?;
        let safe_block = current_block.saturating_sub(RPC_LAG_BUFFER_BLOCKS.into());

        if safe_block > last_block {
            debug!(
                "[{}] scan blocks {}→{} (head: {})",
                chain_name,
                last_block + 1,
                safe_block,
                current_block
            );

            let filter = Filter::new()
                .address(contract_addr)
                .from_block(last_block + 1)
                .to_block(safe_block)
                .event(
                    "OrderCreated(bytes32,address,bytes32,uint16,uint256,uint256,uint256,uint256)",
                );

            let logs = provider.get_logs(&filter).await?;

            if !logs.is_empty() {
                debug!(
                    "[{}] {} order event(s) in blocks {}→{}",
                    chain_name,
                    logs.len(),
                    last_block + 1,
                    safe_block
                );
            }

            for log in &logs {
                let tx_hash = log.transaction_hash.map(|h| format!("{:?}", h)).unwrap_or_default();
                debug!("[{}] parsing tx {}", chain_name, tx_hash);

                let Some(order) = parse_order_created(log, &provider).await else {
                    warn!("[{}] failed to parse order from tx {}", chain_name, tx_hash);
                    continue;
                };

                let order_id_hex = hex::encode(&order.order_id);
                let short = &order_id_hex[..8];

                debug!(
                    "[{}] parsed order {}  dest={}  amount={}",
                    chain_name, short, order.destination_chain, order.amount
                );

                // Skip orders already processed in this session
                if seen_orders.lock().await.contains(&order.order_id) {
                    debug!("[{}] {} already in dedup — skip", chain_name, short);
                    continue;
                }

                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64;

                let expired = now_ms >= order.deadline * 1000;
                if expired {
                    info!("[{}] SKIP {} — expired", chain_name, short);
                    seen_orders.lock().await.insert(order.order_id);
                    continue;
                }

                // Query on-chain order status — skip if already fulfilled (1) or cancelled (2)
                match query_order_status(&provider, contract_addr, order.order_id).await {
                    Ok(status) if status != 0 => {
                        info!(
                            "[{}] SKIP {} — already settled on-chain (status={})",
                            chain_name, short, status
                        );
                        seen_orders.lock().await.insert(order.order_id);
                        continue;
                    }
                    Err(e) => {
                        warn!(
                            "[{}] SKIP {} — status query failed, skipping to be safe: {}",
                            chain_name, short, e
                        );
                        continue;
                    }
                    Ok(_) => {} // status == 0 (Open), proceed
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
                        error!(
                            "[{}] SKIP {} — invalid auction params (floor > start or bad deadline)",
                            chain_name, short
                        );
                        seen_orders.lock().await.insert(order.order_id);
                        continue;
                    }
                };

                // Ensure enough time before deadline for full processing (~10-20s + 5min buffer)
                const DEADLINE_BUFFER_SECS: u64 = 300;
                let time_until_deadline = order.deadline.saturating_sub(now_ms / 1000);
                if time_until_deadline < DEADLINE_BUFFER_SECS {
                    warn!(
                        "[{}] SKIP {} — deadline too close ({}min left, need 5min)",
                        chain_name, short, time_until_deadline / 60
                    );
                    seen_orders.lock().await.insert(order.order_id);
                    continue;
                }

                let eth_fmt = format_wei_eth(order.amount);
                let dest_name = dest_chain_name(order.destination_chain);
                info!(
                    "[{}→{}] ▶  {}  {} lps  {}min deadline  id={}",
                    chain_name, dest_name, eth_fmt, price, time_until_deadline / 60, order_id_hex
                );

                // Mark as seen before spawning (prevents re-entry while processing)
                seen_orders.lock().await.insert(order.order_id);

                let config_clone = Arc::clone(&config);
                let provider_clone = provider.clone();
                let order_clone = order.clone();
                let seen_orders_clone = Arc::clone(&seen_orders);
                let rpc_url_clone = rpc_url.to_string();

                tokio::spawn(async move {
                    process_evm_order(
                        config_clone,
                        provider_clone,
                        order_clone,
                        price,
                        chain_id,
                        contract_addr,
                        rpc_url_clone,
                        seen_orders_clone,
                    ).await;
                });
            }

            last_block = safe_block;
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }
}

/// Query the `status` field of an order from the EVM contract.
/// `orders(bytes32)` returns a tuple: (creator, recipient, destinationChain, amount,
///  startPrice, floorPrice, deadline, createdAt, status)
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
    let status = result[8 * 32 + 31];
    Ok(status)
}

async fn parse_order_created(log: &Log, provider: &Provider<Http>) -> Option<EvmOrder> {
    let topics = &log.topics;

    if topics.len() < 3 {
        return None;
    }

    let data: &[u8] = log.data.as_ref();
    if data.len() < 192 {
        return None;
    }

    let order_id: [u8; 32] = topics[1].as_bytes().try_into().ok()?;
    let creator = format!("{:?}", Address::from(topics[2]));

    let mut recipient = [0u8; 32];
    recipient.copy_from_slice(&data[0..32]);

    let destination_chain = U256::from_big_endian(&data[32..64]).as_u32() as u16;
    let amount = U256::from_big_endian(&data[64..96]).as_u128();
    let start_price = U256::from_big_endian(&data[96..128]).as_u128();
    let floor_price = U256::from_big_endian(&data[128..160]).as_u128();
    let deadline = U256::from_big_endian(&data[160..192]).as_u64();

    let created_at = if let Some(block_number) = log.block_number {
        provider
            .get_block(block_number)
            .await
            .ok()
            .flatten()
            .map(|b| b.timestamp.as_u64())
            .unwrap_or(0)
    } else {
        0
    };

    Some(EvmOrder {
        order_id,
        creator,
        recipient,
        destination_chain,
        amount,
        start_price,
        floor_price,
        deadline,
        created_at,
    })
}

/// Backward compatibility: Run with config from env vars
pub async fn run(config: Arc<Config>) -> Result<()> {
    let chain_id = config.evm_chain_id;
    let rpc_url = config.evm_rpc_url.clone();
    let contract = config.evm_contract_address.clone();
    run_with_config(config, chain_id, &rpc_url, &contract).await
}
