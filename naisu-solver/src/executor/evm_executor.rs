use crate::chains::sui_listener::SuiIntent;
use crate::config::Config;
use ethers::{
    middleware::SignerMiddleware,
    providers::{Http, Middleware, Provider},
    signers::{LocalWallet, Signer},
    types::{Address, Bytes, TransactionRequest, U256},
};
use eyre::Result;
use tracing::{debug, info, warn};

type Client = SignerMiddleware<Provider<Http>, LocalWallet>;

/// M4: Ambil nonce berikutnya menggunakan "pending" block tag.
/// Ini memperhitungkan transaksi yang sudah dikirim tapi belum di-mine,
/// sehingga lebih aman untuk concurrent submissions dibanding "latest".
async fn get_pending_nonce(client: &Client) -> Result<U256> {
    let addr = client.address();
    client
        .provider()
        .get_transaction_count(addr, Some(ethers::types::BlockNumber::Pending.into()))
        .await
        .map_err(|e| eyre::eyre!("Failed to get pending nonce: {e}"))
}

/// Hasil dari settle_order / settle_order_urgent.
/// Digunakan oleh evm_listener untuk menentukan apakah order perlu di-retry atau tidak.
#[derive(Debug)]
pub enum SettleOutcome {
    /// Settlement berhasil — tx_hash
    Success(String),
    /// Error permanen — jangan retry, jangan solve_and_prove ulang.
    /// Contoh: "VAA already processed", "Order not active", on-chain revert.
    PermanentSkip(String),
    /// Error transient — boleh retry di polling berikutnya.
    /// Contoh: RPC timeout, nonce conflict, network error.
    TransientError(String),
}

/// Helper — apakah error ini permanen (tidak akan hilang dengan retry)?
fn is_permanent_error(msg: &str) -> bool {
    msg.contains("VAA already processed")
        || msg.contains("Order not active")
        || msg.contains("execution reverted")
        || msg.contains("revert")
        || msg.contains("already settled")
}

fn make_client(config: &Config) -> Result<Client> {
    let wallet: LocalWallet = config
        .evm_private_key
        .parse::<LocalWallet>()?
        .with_chain_id(config.evm2_chain_id);
    let provider = Provider::<Http>::try_from(config.evm2_rpc_url.as_str())?;
    Ok(SignerMiddleware::new(provider, wallet))
}

/// Chain-specific client for settlement — uses the exact chain/rpc/contract
/// of the listener that detected the order, not the default config values.
fn make_settle_client(config: &Config, chain_id: u64, rpc_url: &str) -> Result<Client> {
    let wallet: LocalWallet = config
        .evm_private_key
        .parse::<LocalWallet>()?
        .with_chain_id(chain_id);
    let provider = Provider::<Http>::try_from(rpc_url)?;
    Ok(SignerMiddleware::new(provider, wallet))
}

/// Sui→EVM direction (v2 Wormhole):
/// Sends ETH to the user AND publishes a Wormhole message as proof.
/// Returns (tx_hash, wormhole_sequence_number).
pub async fn fulfill_and_prove(
    config: &Config,
    intent: &SuiIntent,
    amount_wei: u64,
) -> Result<(String, u64)> {
    let client = make_client(config)?;
    let contract_addr: Address = config.evm2_contract_address.parse()?;

    // Fetch Wormhole message fee from the Wormhole Core Bridge (not IntentBridge)
    let wormhole_addr: Address = config.evm_wormhole_address.parse()?;
    let fee_selector = &ethers::utils::keccak256(b"messageFee()")[..4];
    let fee_call = TransactionRequest::new()
        .to(wormhole_addr)
        .data(Bytes::from(fee_selector.to_vec()));
    let fee_result = client.call(&fee_call.into(), None).await?;
    let wormhole_fee = U256::from_big_endian(&fee_result).as_u64();

    let total_value = amount_wei + wormhole_fee;

    // Encode intent_id as bytes32
    let intent_id_bytes = hex::decode(
        intent.intent_id.trim_start_matches("0x")
    ).map_err(|e| eyre::eyre!("Invalid intent_id hex: {e}"))?;
    let mut intent_id = [0u8; 32];
    let offset = 32usize.saturating_sub(intent_id_bytes.len());
    intent_id[offset..].copy_from_slice(&intent_id_bytes);

    // Validate recipient is a valid EVM address (20 bytes)
    if intent.recipient.len() != 20 {
        return Err(eyre::eyre!(
            "Invalid recipient: expected 20 bytes for EVM address, got {} bytes",
            intent.recipient.len()
        ));
    }
    
    // Check for zero address
    if intent.recipient.iter().all(|&b| b == 0) {
        return Err(eyre::eyre!("Invalid recipient: zero address"));
    }
    
    // Encode recipient (EVM address, 20 bytes)
    let recipient = Address::from_slice(&intent.recipient);

    // fulfillAndProve(bytes32 intentId, address recipient) selector
    let selector = &ethers::utils::keccak256(b"fulfillAndProve(bytes32,address)")[..4];
    let mut calldata = selector.to_vec();
    calldata.extend_from_slice(&intent_id);          // bytes32
    // ABI-encode address as right-aligned 32 bytes
    let mut addr_padded = [0u8; 32];
    addr_padded[12..].copy_from_slice(recipient.as_bytes());
    calldata.extend_from_slice(&addr_padded);

    let tx = TransactionRequest::new()
        .to(contract_addr)
        .value(U256::from(total_value))
        .data(Bytes::from(calldata));

    info!(
        intent_id = %intent.intent_id,
        to = ?recipient,
        amount_wei = amount_wei,
        wormhole_fee = wormhole_fee,
        "Calling fulfillAndProve on EVM..."
    );

    let pending = client.send_transaction(tx, None).await?;
    let receipt = pending.await?.ok_or_else(|| eyre::eyre!("No receipt"))?;
    let tx_hash = format!("{:?}", receipt.transaction_hash);

    // Parse Wormhole sequence from LogMessagePublished event
    // event LogMessagePublished(address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)
    // topic[0] = keccak256("LogMessagePublished(address,uint64,uint32,bytes,uint8)")
    // topic[1] = sender (indexed address)
    // data     = abi.encode(sequence, nonce, payload_offset, consistencyLevel, payload...)
    //   data[0..32]    = sequence (uint64, right-aligned)
    // Actually the cast log shows:
    // data 0-32: 0 (sequence in the payload above? No, wait)
    // Wait, the cast log shows data:
    // 000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080  <- wait, this is 128 bytes of zeros? No, the first 32 bytes is 0. Second 32 is 0. Third is 0x80. Fourth is 0xc8.
    // The sequence is 0 because I used Sequence #0 on a new bridge!
    // The order of data is: sequence (0), nonce (0), payload_offset (0x80), consistencyLevel (200=0xc8), payload_len (0x60)
    let wh_topic = ethers::utils::keccak256(
        b"LogMessagePublished(address,uint64,uint32,bytes,uint8)"
    );
    
    let sequence = receipt
        .logs
        .iter()
        .find(|log| log.topics.first().map(|t| t.0) == Some(wh_topic))
        .and_then(|log| {
            if log.data.len() >= 32 {
                Some(U256::from_big_endian(&log.data[0..32]).as_u64())
            } else {
                None
            }
        })
        .unwrap_or(0);

    info!(
        tx_hash = %tx_hash,
        wormhole_sequence = sequence,
        "fulfillAndProve complete"
    );

    Ok((tx_hash, sequence))
}

/// EVM→Sui/Solana direction (v2 Wormhole):
/// Submits Wormhole VAA (from Sui/Solana solve_and_prove tx) to settleOrder().
/// EVM contract verifies VAA and releases locked ETH to solver.
/// chain_id/rpc_url/contract_address must match the chain where the order lives.
pub async fn settle_order(
    config: &Config,
    vaa: Vec<u8>,
    chain_id: u64,
    rpc_url: &str,
    contract_address: &str,
) -> SettleOutcome {
    let client = match make_settle_client(config, chain_id, rpc_url) {
        Ok(c) => c,
        Err(e) => return SettleOutcome::TransientError(format!("make_settle_client failed: {e}")),
    };

    let contract_addr: Address = match contract_address.parse() {
        Ok(a) => a,
        Err(e) => return SettleOutcome::TransientError(format!("invalid contract address: {e}")),
    };

    // settleOrder(bytes encodedVaa) selector
    let selector = &ethers::utils::keccak256(b"settleOrder(bytes)")[..4];

    // ABI-encode bytes: offset (32) + length (32) + data (padded to 32-byte boundary)
    let data_len = vaa.len();
    let padded_len = data_len.div_ceil(32) * 32;
    let mut calldata = selector.to_vec();
    // offset to bytes data = 32
    let mut offset_bytes = [0u8; 32];
    offset_bytes[31] = 32;
    calldata.extend_from_slice(&offset_bytes);
    // length
    let mut len_bytes = [0u8; 32];
    len_bytes[24..].copy_from_slice(&(data_len as u64).to_be_bytes());
    calldata.extend_from_slice(&len_bytes);
    // data padded
    calldata.extend_from_slice(&vaa);
    calldata.resize(calldata.len() + (padded_len - data_len), 0);

    // ── H1: Pre-flight simulation ────────────────────────────────────────────
    // Simulasikan transaksi via eth_call. Jika revert → return PermanentSkip
    // tanpa broadcast, hemat gas.
    let simulate_req = TransactionRequest::new()
        .to(contract_addr)
        .data(Bytes::from(calldata.clone()));

    if let Err(e) = client.call(&simulate_req.into(), None).await {
        let msg = format!("{e}");
        if is_permanent_error(&msg) {
            info!(
                "Pre-flight simulation: permanent revert detected — skipping broadcast. Reason: {msg}"
            );
            return SettleOutcome::PermanentSkip(format!("pre-flight: {msg}"));
        }
        // Non-revert error (RPC issue) — lanjutkan broadcast, mungkin berhasil
        warn!("Pre-flight simulation failed with non-revert error: {msg} — attempting broadcast anyway");
    }
    // ────────────────────────────────────────────────────────────────────────

    let mut tx = TransactionRequest::new()
        .to(contract_addr)
        .data(Bytes::from(calldata));

    // Avalanche Fuji requires minimum 25 gwei
    if chain_id == 43113 {
        tx = tx.gas_price(U256::from(25_000_000_000u64));
    }

    // M4: Pending nonce
    if let Ok(nonce) = get_pending_nonce(&client).await {
        tx = tx.nonce(nonce);
    }

    info!(settle_chain_id = chain_id, contract = %contract_address, "Calling settleOrder on EVM with VAA ({} bytes)...", vaa.len());

    // M3: Retry loop
    const MAX_SETTLE_RETRIES: u32 = 3;
    let mut settle_attempt = 0u32;

    loop {
        settle_attempt += 1;

        match client.send_transaction(tx.clone(), None).await {
            Ok(pending) => match pending.await {
                Ok(Some(receipt)) => {
                    let tx_hash = format!("{:?}", receipt.transaction_hash);
                    debug!(tx_hash = %tx_hash, "settleOrder complete");
                    return SettleOutcome::Success(tx_hash);
                }
                Ok(None) => {
                    if settle_attempt >= MAX_SETTLE_RETRIES {
                        return SettleOutcome::TransientError(
                            "No receipt after max retries".to_string()
                        );
                    }
                    let backoff = 1u64 << settle_attempt; // 2s, 4s, 8s
                    warn!(attempt = settle_attempt, backoff_secs = backoff, "settle_order: no receipt, retrying...");
                    tokio::time::sleep(tokio::time::Duration::from_secs(backoff)).await;
                }
                Err(e) => {
                    let msg = format!("{e}");
                    if is_permanent_error(&msg) {
                        return SettleOutcome::PermanentSkip(msg);
                    }
                    if settle_attempt >= MAX_SETTLE_RETRIES {
                        return SettleOutcome::TransientError(msg);
                    }
                    let backoff = 1u64 << settle_attempt;
                    warn!(attempt = settle_attempt, backoff_secs = backoff, error = %msg, "settle_order: receipt error, retrying...");
                    tokio::time::sleep(tokio::time::Duration::from_secs(backoff)).await;
                }
            },
            Err(e) => {
                let msg = format!("{e}");
                if is_permanent_error(&msg) {
                    return SettleOutcome::PermanentSkip(msg);
                }
                if settle_attempt >= MAX_SETTLE_RETRIES {
                    return SettleOutcome::TransientError(msg);
                }
                let backoff = 1u64 << settle_attempt;
                warn!(attempt = settle_attempt, backoff_secs = backoff, error = %msg, "settle_order: send error, retrying...");
                tokio::time::sleep(tokio::time::Duration::from_secs(backoff)).await;
            }
        }
    }
}

/// Settle with higher gas price for urgent transactions (deadline approaching)
pub async fn settle_order_urgent(
    config: &Config,
    vaa: Vec<u8>,
    chain_id: u64,
    rpc_url: &str,
    contract_address: &str,
) -> SettleOutcome {
    let client = match make_settle_client(config, chain_id, rpc_url) {
        Ok(c) => c,
        Err(e) => return SettleOutcome::TransientError(format!("make_settle_client failed: {e}")),
    };

    let contract_addr: Address = match contract_address.parse() {
        Ok(a) => a,
        Err(e) => return SettleOutcome::TransientError(format!("invalid contract address: {e}")),
    };

    // settleOrder(bytes encodedVaa) selector
    let selector = &ethers::utils::keccak256(b"settleOrder(bytes)")[..4];

    // ABI-encode bytes
    let data_len = vaa.len();
    let padded_len = data_len.div_ceil(32) * 32;
    let mut calldata = selector.to_vec();
    let mut offset_bytes = [0u8; 32];
    offset_bytes[31] = 32;
    calldata.extend_from_slice(&offset_bytes);
    let mut len_bytes = [0u8; 32];
    len_bytes[24..].copy_from_slice(&(data_len as u64).to_be_bytes());
    calldata.extend_from_slice(&len_bytes);
    calldata.extend_from_slice(&vaa);
    calldata.resize(calldata.len() + (padded_len - data_len), 0);

    // ── H1: Pre-flight simulation ────────────────────────────────────────────
    let simulate_req = TransactionRequest::new()
        .to(contract_addr)
        .data(Bytes::from(calldata.clone()));

    if let Err(e) = client.call(&simulate_req.into(), None).await {
        let msg = format!("{e}");
        if is_permanent_error(&msg) {
            info!(
                "Pre-flight simulation (URGENT): permanent revert detected — skipping broadcast. Reason: {msg}"
            );
            return SettleOutcome::PermanentSkip(format!("pre-flight: {msg}"));
        }
        warn!("Pre-flight simulation (URGENT) failed with non-revert error: {msg} — attempting broadcast anyway");
    }
    // ────────────────────────────────────────────────────────────────────────

    // URGENT: Use 2x gas price for faster inclusion
    let gas_price = if chain_id == 43113 {
        50_000_000_000u64 // 50 gwei for Avalanche (2x normal)
    } else {
        2_000_000_000u64  // 2 gwei for Base (2x normal)
    };

    let mut tx = TransactionRequest::new()
        .to(contract_addr)
        .data(Bytes::from(calldata))
        .gas_price(U256::from(gas_price));

    // M4: Pending nonce
    if let Ok(nonce) = get_pending_nonce(&client).await {
        tx = tx.nonce(nonce);
    }

    debug!(gas_price_gwei = gas_price / 1_000_000_000, "URGENT settleOrder sending with high gas");

    // M3: Retry loop
    const MAX_SETTLE_RETRIES: u32 = 3;
    let mut settle_attempt = 0u32;

    loop {
        settle_attempt += 1;

        match client.send_transaction(tx.clone(), None).await {
            Ok(pending) => match pending.await {
                Ok(Some(receipt)) => {
                    let tx_hash = format!("{:?}", receipt.transaction_hash);
                    debug!(tx_hash = %tx_hash, "URGENT settleOrder complete");
                    return SettleOutcome::Success(tx_hash);
                }
                Ok(None) => {
                    if settle_attempt >= MAX_SETTLE_RETRIES {
                        return SettleOutcome::TransientError(
                            "No receipt after max retries (URGENT)".to_string()
                        );
                    }
                    let backoff = 1u64 << settle_attempt;
                    warn!(attempt = settle_attempt, backoff_secs = backoff, "settle_order_urgent: no receipt, retrying...");
                    tokio::time::sleep(tokio::time::Duration::from_secs(backoff)).await;
                }
                Err(e) => {
                    let msg = format!("{e}");
                    if is_permanent_error(&msg) {
                        return SettleOutcome::PermanentSkip(msg);
                    }
                    if settle_attempt >= MAX_SETTLE_RETRIES {
                        return SettleOutcome::TransientError(msg);
                    }
                    let backoff = 1u64 << settle_attempt;
                    warn!(attempt = settle_attempt, backoff_secs = backoff, error = %msg, "settle_order_urgent: receipt error, retrying...");
                    tokio::time::sleep(tokio::time::Duration::from_secs(backoff)).await;
                }
            },
            Err(e) => {
                let msg = format!("{e}");
                if is_permanent_error(&msg) {
                    return SettleOutcome::PermanentSkip(msg);
                }
                if settle_attempt >= MAX_SETTLE_RETRIES {
                    return SettleOutcome::TransientError(msg);
                }
                let backoff = 1u64 << settle_attempt;
                warn!(attempt = settle_attempt, backoff_secs = backoff, error = %msg, "settle_order_urgent: send error, retrying...");
                tokio::time::sleep(tokio::time::Duration::from_secs(backoff)).await;
            }
        }
    }
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_permanent_error_vaa_already_processed() {
        assert!(is_permanent_error("VAA already processed"));
        assert!(is_permanent_error("Error: VAA already processed for this order"));
    }

    #[test]
    fn test_is_permanent_error_order_not_active() {
        assert!(is_permanent_error("Order not active"));
        assert!(is_permanent_error("execution reverted: Order not active"));
    }

    #[test]
    fn test_is_permanent_error_revert() {
        assert!(is_permanent_error("execution reverted"));
        assert!(is_permanent_error("transaction revert"));
        assert!(is_permanent_error("already settled"));
    }

    #[test]
    fn test_is_not_permanent_error_transient() {
        // These should NOT be permanent errors
        assert!(!is_permanent_error("RPC timeout"));
        assert!(!is_permanent_error("connection refused"));
        assert!(!is_permanent_error("nonce too low"));
        assert!(!is_permanent_error("replacement transaction underpriced"));
    }

    #[test]
    fn test_settle_outcome_variants() {
        let success = SettleOutcome::Success("0x123...".to_string());
        let permanent = SettleOutcome::PermanentSkip("VAA already processed".to_string());
        let transient = SettleOutcome::TransientError("RPC timeout".to_string());

        // Test debug format
        let success_str = format!("{:?}", success);
        assert!(success_str.contains("Success"));

        let permanent_str = format!("{:?}", permanent);
        assert!(permanent_str.contains("PermanentSkip"));

        let transient_str = format!("{:?}", transient);
        assert!(transient_str.contains("TransientError"));
    }
}
