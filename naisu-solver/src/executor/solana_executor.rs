use base64::Engine as _;
use ethers::signers::Signer as _;
use eyre::Result;
use sha2::{Digest, Sha256};
use tracing::{debug, info, warn};

use crate::config::Config;

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/// Anchor instruction discriminator: sha256("global:<name>")[0..8]
fn instruction_discriminator(name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(format!("global:{}", name).as_bytes());
    let result: [u8; 32] = hasher.finalize().into();
    result[..8].try_into().unwrap()
}

/// Parse a Solana private key from hex or base58 string.
/// Accepts:
/// - 64-char hex (32-byte seed)
/// - 128-char hex (64-byte keypair, uses first 32)
/// - 88-char base58 (keypair from id.json, extracts first 32 bytes = seed)
fn parse_solana_private_key(key: &str) -> Result<[u8; 32]> {
    let key = key.trim();
    
    // Try base58 first (88 chars = standard Solana keypair format)
    if key.len() == 88 {
        let bytes = bs58::decode(key).into_vec()
            .map_err(|e| eyre::eyre!("Invalid SOLANA_PRIVATE_KEY base58: {e}"))?;
        if bytes.len() == 64 {
            // Keypair: [32 bytes seed][32 bytes public], return seed
            return Ok(bytes[..32].try_into().unwrap());
        }
    }
    
    // Try hex
    let hex_key = key.trim_start_matches("0x");
    let bytes = hex::decode(hex_key)
        .map_err(|e| eyre::eyre!("Invalid SOLANA_PRIVATE_KEY hex: {e}"))?;
    match bytes.len() {
        32 => Ok(bytes.try_into().unwrap()),
        64 => Ok(bytes[..32].try_into().unwrap()),
        n => Err(eyre::eyre!("SOLANA_PRIVATE_KEY must be 32 or 64 bytes, got {n}")),
    }
}

/// Derive a program address (PDA) without solana-sdk.
/// Returns (address_bytes, bump).
/// Seeds are hashed as: sha256(seed_1 || seed_2 || ... || [nonce] || program_id || "ProgramDerivedAddress")
fn find_pda(seeds: &[&[u8]], program_id: &[u8; 32]) -> ([u8; 32], u8) {
    for nonce in (0u8..=255).rev() {
        let mut hasher = Sha256::new();
        for seed in seeds {
            hasher.update(seed);
        }
        hasher.update([nonce]);
        hasher.update(program_id);
        hasher.update(b"ProgramDerivedAddress");
        let hash: [u8; 32] = hasher.finalize().into();

        // A valid PDA must NOT be a point on the Ed25519 curve.
        // We check this by trying to decode as a compressed Ed25519 point.
        // (ed25519_dalek::VerifyingKey::from_bytes returns Err for off-curve points)
        if ed25519_dalek::VerifyingKey::from_bytes(&hash).is_err() {
            return (hash, nonce);
        }
    }
    panic!("Could not find a valid PDA for the given seeds");
}

/// Encode a u16 as Solana compact-u16 format.
fn compact_u16(mut value: u16) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(3);
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        bytes.push(byte);
        if value == 0 {
            break;
        }
    }
    bytes
}

/// System program address (all zeros except last byte = 1... actually all zeros = 1111...1111)
const SYSTEM_PROGRAM: [u8; 32] = [0u8; 32];

// ──────────────────────────────────────────────────────────────────────────────
// Raw Solana transaction building
// ──────────────────────────────────────────────────────────────────────────────

/// An account reference in a Solana transaction.
struct AccountRef {
    pubkey: [u8; 32],
    is_signer: bool,
    is_writable: bool,
}

/// Build a raw Solana transaction message (v0 legacy format) and sign it.
/// Returns the wire transaction bytes.
/// `extra_signers` are additional signing keys in the order they appear in `accounts`.
fn build_and_sign_transaction(
    accounts: &[AccountRef],
    instruction_data: &[u8],
    instruction_account_indices: &[u8], // indices into accounts[]
    program_id_index: u8,
    recent_blockhash: [u8; 32],
    signing_key: &ed25519_dalek::SigningKey,
    extra_signers: &[&ed25519_dalek::SigningKey],
) -> Vec<u8> {
    let num_signers = accounts.iter().filter(|a| a.is_signer).count() as u8;
    let num_readonly_signers = accounts
        .iter()
        .filter(|a| a.is_signer && !a.is_writable)
        .count() as u8;
    let num_readonly_unsigned = accounts
        .iter()
        .filter(|a| !a.is_signer && !a.is_writable)
        .count() as u8;

    // Build message
    let mut msg = Vec::new();

    // Header
    msg.push(num_signers);
    msg.push(num_readonly_signers);
    msg.push(num_readonly_unsigned);

    // Account keys
    msg.extend_from_slice(&compact_u16(accounts.len() as u16));
    for acc in accounts {
        msg.extend_from_slice(&acc.pubkey);
    }

    // Recent blockhash
    msg.extend_from_slice(&recent_blockhash);

    // Instructions (1 instruction)
    msg.extend_from_slice(&compact_u16(1));
    msg.push(program_id_index);
    msg.extend_from_slice(&compact_u16(instruction_account_indices.len() as u16));
    msg.extend_from_slice(instruction_account_indices);
    msg.extend_from_slice(&compact_u16(instruction_data.len() as u16));
    msg.extend_from_slice(instruction_data);

    // Sign with primary key
    use ed25519_dalek::Signer;
    let sig = signing_key.sign(&msg);

    // Build wire transaction
    let total_sigs = 1 + extra_signers.len();
    let mut tx = Vec::new();
    tx.extend_from_slice(&compact_u16(total_sigs as u16));
    tx.extend_from_slice(&sig.to_bytes());
    for extra in extra_signers {
        let extra_sig = extra.sign(&msg);
        tx.extend_from_slice(&extra_sig.to_bytes());
    }
    tx.extend_from_slice(&msg);

    tx
}

// ──────────────────────────────────────────────────────────────────────────────
// JSON-RPC helpers
// ──────────────────────────────────────────────────────────────────────────────

async fn get_latest_blockhash(rpc_url: &str) -> Result<[u8; 32]> {
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getLatestBlockhash",
        "params": [{"commitment": "confirmed"}]
    });
    let client = reqwest::Client::new();
    let resp: serde_json::Value = client.post(rpc_url).json(&body).send().await?.json().await?;
    let bh_str = resp["result"]["value"]["blockhash"]
        .as_str()
        .ok_or_else(|| eyre::eyre!("No blockhash in response"))?;
    let bh_bytes = bs58::decode(bh_str).into_vec()?;
    let mut blockhash = [0u8; 32];
    blockhash.copy_from_slice(&bh_bytes);
    Ok(blockhash)
}

async fn send_and_confirm_transaction(rpc_url: &str, tx_b64: &str) -> Result<String> {
    let client = reqwest::Client::new();

    // Production send settings:
    // - skipPreflight=false: simulation catches program errors immediately (wrong accounts,
    //   bad discriminator, etc.) before wasting time polling for a tx that will never land.
    // - maxRetries=0: we handle re-submission ourselves to combat devnet leader drops.
    let send_body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "sendTransaction",
        "params": [tx_b64, {
            "encoding": "base64",
            "skipPreflight": false,
            "preflightCommitment": "confirmed",
            "maxRetries": 0
        }]
    });
    let resp: serde_json::Value = client.post(rpc_url).json(&send_body).send().await?.json().await?;

    if let Some(err) = resp.get("error") {
        // Preflight simulation rejected the tx — permanent failure, no retry needed
        return Err(eyre::eyre!("SolanaTransactionFailed: sendTransaction rejected by simulation: {err}"));
    }
    let signature = resp["result"]
        .as_str()
        .ok_or_else(|| eyre::eyre!("No signature in sendTransaction response"))?
        .to_string();

    info!(signature = %signature, "Solana tx submitted");

    // Poll for confirmation (90s = 45 × 2s), re-sending every 15s to combat devnet leader drops.
    // A Solana blockhash is valid for ~150 slots (~60-90s). Re-sending the same signed tx keeps
    // it alive in the validator queue throughout this window. After 90s, the blockhash is likely
    // expired — the caller must retry with a fresh blockhash.
    let mut last_resend = std::time::Instant::now();
    let poll_start = std::time::Instant::now();

    for _ in 0..45u32 {
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // Re-submit the same signed tx every 15s to prevent it from being dropped by leaders
        if last_resend.elapsed().as_secs() >= 15 {
            let resend_body = serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "sendTransaction",
                "params": [tx_b64, {"encoding": "base64", "skipPreflight": true, "maxRetries": 0}]
            });
            // Fire-and-forget: errors here are non-fatal (tx may already be confirmed)
            let _ = client.post(rpc_url).json(&resend_body).send().await;
            debug!(
                signature = %signature,
                elapsed_s = poll_start.elapsed().as_secs(),
                "Re-submitting Solana tx to prevent leader drop"
            );
            last_resend = std::time::Instant::now();
        }

        let confirm_body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "getSignatureStatuses",
            "params": [[signature], {"searchTransactionHistory": true}]
        });
        let cr: serde_json::Value = client
            .post(rpc_url)
            .json(&confirm_body)
            .send()
            .await?
            .json()
            .await?;
        let status = &cr["result"]["value"][0];
        if status.is_null() {
            continue; // not yet visible — keep polling
        }
        if let Some(err) = status.get("err").and_then(|e| if e.is_null() { None } else { Some(e) }) {
            let logs = fetch_transaction_logs(rpc_url, &signature).await;
            return Err(eyre::eyre!(
                "SolanaTransactionFailed: {err}\nLogs:\n{logs}\nExplorer: https://explorer.solana.com/tx/{signature}?cluster=devnet"
            ));
        }
        if let Some(conf) = status["confirmationStatus"].as_str()
            && (conf == "confirmed" || conf == "finalized")
        {
            return Ok(signature);
        }
    }

    // Blockhash expired after 90s — the tx will never land with this blockhash.
    // Caller should rebuild the tx with a fresh blockhash and retry.
    Err(eyre::eyre!("SolanaTransactionTimeout: {signature} not confirmed after 90s — blockhash expired, caller must retry with fresh blockhash"))
}

/// Fetch program logs for a confirmed (or failed) transaction.
async fn fetch_transaction_logs(rpc_url: &str, signature: &str) -> String {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTransaction",
        "params": [signature, {"encoding": "json", "commitment": "confirmed", "maxSupportedTransactionVersion": 0}]
    });
    match client.post(rpc_url).json(&body).send().await {
        Ok(r) => match r.json::<serde_json::Value>().await {
            Ok(v) => {
                let logs = &v["result"]["meta"]["logMessages"];
                if let Some(arr) = logs.as_array() {
                    arr.iter()
                        .filter_map(|l| l.as_str())
                        .collect::<Vec<_>>()
                        .join("\n")
                } else {
                    format!("(no logs in response: {})", v["result"]["meta"])
                }
            }
            Err(e) => format!("(failed to parse getTransaction: {e})"),
        },
        Err(e) => format!("(failed to call getTransaction: {e})"),
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main entry points
// ──────────────────────────────────────────────────────────────────────────────

/// Relay a Wormhole VAA to Solana and call claim_with_vaa to collect locked SOL.
///
/// This uses a TypeScript helper script for the complex VAA relay
/// (verify_signatures + post_vaa on the Wormhole Core Bridge), then sends
/// the claim_with_vaa instruction directly from Rust.
pub async fn relay_and_claim(
    config: &Config,
    vaa_bytes: &[u8],
    intent_id: [u8; 32],
) -> Result<String> {
    let vaa_hex = hex::encode(vaa_bytes);

    // ── Step A: VAA relay via TypeScript helper ────────────────────────────
    // The helper runs verify_signatures + post_vaa on the Wormhole Core Bridge.
    // It outputs: <posted_vaa_address> (base58) on stdout.
    let scripts_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("naisu-contracts/solana/scripts");

    info!(vaa_len = vaa_bytes.len(), "Relaying VAA to Solana...");

    let solana_dir = scripts_dir.parent().unwrap();
    // Run pre-compiled JS directly (avoids ts-node OOM from large @coral-xyz/anchor dep)
    let relay_js = scripts_dir.join("dist/relay_vaa.js");

    let output = tokio::process::Command::new("node")
        .current_dir(solana_dir)
        .arg(&relay_js)
        .arg(&vaa_hex)
        .arg(&config.solana_rpc_url)
        .arg(&config.solana_private_key)
        .arg(&config.solana_wormhole_program_id)
        .output()
        .await
        .map_err(|e| eyre::eyre!("Failed to run relay_vaa.ts: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(eyre::eyre!("relay_vaa.ts failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let posted_vaa_b58 = stdout.trim().to_string();
    info!(posted_vaa = %posted_vaa_b58, "VAA posted to Solana");

    // ── Step B: claim_with_vaa via raw Rust transaction ───────────────────
    claim_with_vaa(config, vaa_bytes, intent_id, &posted_vaa_b58).await
}

/// Build and submit the claim_with_vaa instruction on Solana.
///
/// Accounts (ordered for the Solana message):
///   Writable signers:   [0] solver (our keypair)
///   Writable non-sig:   [1] intent PDA, [2] received PDA
///   Read-only non-sig:  [3] config PDA, [4] posted_vaa, [5] foreign_emitter PDA,
///                       [6] system_program, [7] intent_bridge_program_id
pub async fn claim_with_vaa(
    config: &Config,
    vaa_bytes: &[u8],
    intent_id: [u8; 32],
    posted_vaa_b58: &str,
) -> Result<String> {
    // Load keypair from hex private key
    let secret_bytes = parse_solana_private_key(&config.solana_private_key)?;
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&secret_bytes);
    let solver_pubkey: [u8; 32] = signing_key.verifying_key().to_bytes();

    // Decode program IDs
    let program_id_bytes = bs58::decode(&config.solana_program_id)
        .into_vec()
        .map_err(|e| eyre::eyre!("Invalid program ID: {e}"))?;
    let program_id: [u8; 32] = program_id_bytes.try_into().map_err(|_| eyre::eyre!("Program ID wrong length"))?;

    // ── Parse VAA for emitter info ──────────────────────────────────────────
    // VAA header: version(1) + guardian_set_index(4) + sig_count(1) + sigs(65 * sig_count)
    if vaa_bytes.len() < 6 {
        return Err(eyre::eyre!("VAA too short"));
    }
    let sig_count = vaa_bytes[5] as usize;
    let body_offset = 6 + sig_count * 65;
    if vaa_bytes.len() < body_offset + 14 {
        return Err(eyre::eyre!("VAA body too short"));
    }
    let body = &vaa_bytes[body_offset..];
    // body: timestamp(4) + nonce(4) + emitter_chain(2) + emitter_address(32) + sequence(8) + ...
    let emitter_chain = u16::from_be_bytes(body[8..10].try_into().unwrap());
    let sequence = u64::from_be_bytes(body[42..50].try_into().unwrap());

    // ── Derive PDAs ─────────────────────────────────────────────────────────
    let (config_pda, _) = find_pda(&[b"config"], &program_id);

    let chain_le = emitter_chain.to_le_bytes();
    let (foreign_emitter_pda, _) = find_pda(&[b"foreign_emitter", &chain_le], &program_id);

    let (intent_pda, _) = find_pda(&[b"intent", &intent_id], &program_id);

    let seq_le = sequence.to_le_bytes();
    let (received_pda, _) = find_pda(&[b"received", &chain_le, &seq_le], &program_id);

    // posted_vaa address (provided by relay script)
    let posted_vaa_bytes = bs58::decode(posted_vaa_b58)
        .into_vec()
        .map_err(|e| eyre::eyre!("Invalid posted_vaa address: {e}"))?;
    let posted_vaa: [u8; 32] = posted_vaa_bytes
        .try_into()
        .map_err(|_| eyre::eyre!("posted_vaa address wrong length"))?;

    // ── Build instruction data ───────────────────────────────────────────────
    // claim_with_vaa takes no extra arguments (reads from posted_vaa account)
    let discriminator = instruction_discriminator("claim_with_vaa");
    let ix_data = discriminator.to_vec();

    // ── Build account list (ordered as Solana expects) ───────────────────────
    // 0 - solver         (writable, signer)
    // 1 - intent         (writable, non-signer)
    // 2 - received       (writable, non-signer) -- init
    // 3 - config         (read-only, non-signer)
    // 4 - posted_vaa     (read-only, non-signer)
    // 5 - foreign_emitter (read-only, non-signer)
    // 6 - system_program (read-only, non-signer)
    // 7 - program_id     (read-only, non-signer) -- for PDA validation
    let accounts = vec![
        AccountRef { pubkey: solver_pubkey, is_signer: true,  is_writable: true  },
        AccountRef { pubkey: intent_pda,    is_signer: false, is_writable: true  },
        AccountRef { pubkey: received_pda,  is_signer: false, is_writable: true  },
        AccountRef { pubkey: config_pda,    is_signer: false, is_writable: false },
        AccountRef { pubkey: posted_vaa,    is_signer: false, is_writable: false },
        AccountRef { pubkey: foreign_emitter_pda, is_signer: false, is_writable: false },
        AccountRef { pubkey: SYSTEM_PROGRAM, is_signer: false, is_writable: false },
        AccountRef { pubkey: program_id,    is_signer: false, is_writable: false },
    ];

    // Instruction account indices (matching Anchor struct order):
    // solver=0, config=3, posted_vaa=4, foreign_emitter=5, intent=1, received=2, system_program=6
    let ix_accounts: Vec<u8> = vec![0, 3, 4, 5, 1, 2, 6];

    // ── Fetch blockhash and submit ───────────────────────────────────────────
    let blockhash = get_latest_blockhash(&config.solana_rpc_url).await?;

    let tx_bytes = build_and_sign_transaction(
        &accounts,
        &ix_data,
        &ix_accounts,
        7, // program_id is at index 7 in accounts list
        blockhash,
        &signing_key,
        &[], // no extra signers for claim_with_vaa
    );

    let tx_b64 = base64::engine::general_purpose::STANDARD.encode(&tx_bytes);

    info!(
        intent_id = %hex::encode(intent_id),
        "Submitting claim_with_vaa transaction..."
    );

    let sig = send_and_confirm_transaction(&config.solana_rpc_url, &tx_b64).await?;

    info!(
        signature = %sig,
        intent_id = %hex::encode(intent_id),
        "claim_with_vaa confirmed! SOL claimed."
    );

    Ok(sig)
}

/// solve_and_prove: For EVM→Solana direction.
/// Sends SOL to recipient + calls Solana program's solve_and_prove (Wormhole CPI).
/// Returns (tx_signature, wormhole_sequence).
///
/// Retries up to 3× on SolanaTransactionTimeout (devnet leader drops / blockhash expiry).
/// Each attempt fetches a fresh blockhash and a new wormhole_message keypair so retries
/// are independent. Returns immediately on SolanaTransactionFailed (program rejection).
pub async fn solve_and_prove(
    config: &Config,
    order_id: [u8; 32],
    recipient_b58: &str,
    amount_lamports: u64,
) -> Result<(String, u64)> {
    const MAX_ATTEMPTS: u32 = 3;
    let mut last_err = eyre::eyre!("no attempts made");

    for attempt in 1..=MAX_ATTEMPTS {
        match solve_and_prove_inner(config, order_id, recipient_b58, amount_lamports).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("SolanaTransactionTimeout") {
                    warn!(
                        order_id = %hex::encode(order_id),
                        attempt,
                        max_attempts = MAX_ATTEMPTS,
                        "Solana tx timed out (blockhash expired) — rebuilding with fresh blockhash..."
                    );
                    if attempt < MAX_ATTEMPTS {
                        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                        last_err = e;
                        continue;
                    }
                }
                // Program rejection or all retries exhausted — propagate error
                return Err(e);
            }
        }
    }
    Err(last_err)
}

/// Inner single-attempt implementation. Each call gets a fresh blockhash and wormhole_message
/// keypair (timestamp-seeded), so retries from the wrapper are fully independent.
///
/// SolveAndProve accounts (Anchor order):
///   solver          (mut, signer)
///   recipient       (mut)
///   config          (PDA: ["config"])
///   wormhole_program
///   wormhole_bridge (mut, PDA: ["Bridge"] @ wormhole_program)
///   wormhole_message (mut, new Keypair — signer!)
///   wormhole_emitter (PDA: ["emitter"] @ intent_bridge_program)
///   wormhole_sequence (mut, PDA: ["Sequence", emitter] @ wormhole_program)
///   wormhole_fee_collector (mut, PDA: ["fee_collector"] @ wormhole_program)
///   clock (sysvar)
///   rent  (sysvar)
///   system_program
async fn solve_and_prove_inner(
    config: &Config,
    order_id: [u8; 32],
    recipient_b58: &str,
    amount_lamports: u64,
) -> Result<(String, u64)> {
    // ── Load solver keypair ──────────────────────────────────────────────────
    let secret_bytes = parse_solana_private_key(&config.solana_private_key)?;
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&secret_bytes);
    let solver_pubkey: [u8; 32] = signing_key.verifying_key().to_bytes();

    // ── Decode program IDs ───────────────────────────────────────────────────
    let program_id: [u8; 32] = bs58::decode(&config.solana_program_id)
        .into_vec()?
        .try_into()
        .map_err(|_| eyre::eyre!("Invalid program ID length"))?;

    let wormhole_program_id: [u8; 32] = bs58::decode(&config.solana_wormhole_program_id)
        .into_vec()?
        .try_into()
        .map_err(|_| eyre::eyre!("Invalid wormhole program ID length"))?;

    let recipient: [u8; 32] = bs58::decode(recipient_b58)
        .into_vec()?
        .try_into()
        .map_err(|_| eyre::eyre!("Invalid recipient address"))?;

    // ── Derive PDAs ──────────────────────────────────────────────────────────
    let (config_pda, _) = find_pda(&[b"config"], &program_id);
    let (wormhole_bridge_pda, _) = find_pda(&[b"Bridge"], &wormhole_program_id);
    let (wormhole_emitter_pda, _) = find_pda(&[b"emitter"], &program_id);
    let (wormhole_sequence_pda, _) =
        find_pda(&[b"Sequence", &wormhole_emitter_pda], &wormhole_program_id);
    let (wormhole_fee_collector_pda, _) = find_pda(&[b"fee_collector"], &wormhole_program_id);

    // ── Generate fresh wormhole_message keypair ──────────────────────────────
    // Must be new each call; the account is created by the Wormhole program.
    // Include nanosecond timestamp so retries on the same order_id use a different key.
    let msg_secret = {
        use sha2::Digest;
        let now_ns = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let mut h = sha2::Sha256::new();
        h.update(order_id);
        h.update(solver_pubkey);
        h.update(amount_lamports.to_le_bytes());
        h.update(b"wormhole_message_nonce");
        h.update(now_ns.to_le_bytes());
        let r: [u8; 32] = h.finalize().into();
        r
    };
    let wormhole_message_key = ed25519_dalek::SigningKey::from_bytes(&msg_secret);
    let wormhole_message_pubkey: [u8; 32] = wormhole_message_key.verifying_key().to_bytes();

    // ── Solver's EVM address (32-byte left-padded) ──────────────────────────
    // The Wormhole payload encodes the solver's EVM address so the EVM contract
    // knows where to send the ETH settlement. Must be the EVM address derived
    // from evm_private_key, NOT the Solana pubkey.
    let solver_evm_wallet: ethers::signers::LocalWallet = config
        .evm_private_key
        .parse::<ethers::signers::LocalWallet>()
        .map_err(|e| eyre::eyre!("Invalid evm_private_key: {e}"))?;
    let mut solver_address = [0u8; 32];
    solver_address[12..].copy_from_slice(solver_evm_wallet.address().as_bytes());

    // ── Build instruction data ───────────────────────────────────────────────
    // solve_and_prove(order_id: [u8;32], solver_address: [u8;32], amount_lamports: u64)
    // Borsh encoding: disc(8) + [u8;32](32) + [u8;32](32) + u64(8) = 80 bytes
    let discriminator = instruction_discriminator("solve_and_prove");
    let mut ix_data = discriminator.to_vec();
    ix_data.extend_from_slice(&order_id);
    ix_data.extend_from_slice(&solver_address);
    ix_data.extend_from_slice(&amount_lamports.to_le_bytes());

    // ── Sysvars ──────────────────────────────────────────────────────────────
    // Clock: SysvarC1ock11111111111111111111111111111111
    let clock_sysvar: [u8; 32] = bs58::decode("SysvarC1ock11111111111111111111111111111111")
        .into_vec()?
        .try_into()
        .map_err(|_| eyre::eyre!("Invalid clock sysvar"))?;
    // Rent: SysvarRent111111111111111111111111111111111
    let rent_sysvar: [u8; 32] = bs58::decode("SysvarRent111111111111111111111111111111111")
        .into_vec()?
        .try_into()
        .map_err(|_| eyre::eyre!("Invalid rent sysvar"))?;

    // ── Build account list ───────────────────────────────────────────────────
    // Solana message ordering: writable signers, readonly signers, writable non-signers, readonly non-signers
    //
    // Special case: when solver == recipient (e.g. bridge+liquid_stake flow where SOL
    // goes to solver first), we must NOT include the same pubkey twice — Solana will
    // reject with AccountLoadedTwice. Instead we de-duplicate and remap ix_accounts.
    let solver_is_recipient = solver_pubkey == recipient;

    let (accounts, ix_accounts, program_id_index) = if solver_is_recipient {
        // Writable signers:    [0] solver/recipient, [1] wormhole_message
        // Writable non-sig:   [2] wormhole_bridge, [3] wormhole_sequence, [4] wormhole_fee_collector
        // Readonly non-sig:   [5] config_pda, [6] wormhole_program, [7] wormhole_emitter,
        //                     [8] clock, [9] rent, [10] system_program, [11] program_id
        let accts = vec![
            AccountRef { pubkey: solver_pubkey,               is_signer: true,  is_writable: true  },
            AccountRef { pubkey: wormhole_message_pubkey,     is_signer: true,  is_writable: true  },
            AccountRef { pubkey: wormhole_bridge_pda,         is_signer: false, is_writable: true  },
            AccountRef { pubkey: wormhole_sequence_pda,       is_signer: false, is_writable: true  },
            AccountRef { pubkey: wormhole_fee_collector_pda,  is_signer: false, is_writable: true  },
            AccountRef { pubkey: config_pda,                  is_signer: false, is_writable: false },
            AccountRef { pubkey: wormhole_program_id,         is_signer: false, is_writable: false },
            AccountRef { pubkey: wormhole_emitter_pda,        is_signer: false, is_writable: false },
            AccountRef { pubkey: clock_sysvar,                is_signer: false, is_writable: false },
            AccountRef { pubkey: rent_sysvar,                 is_signer: false, is_writable: false },
            AccountRef { pubkey: SYSTEM_PROGRAM,              is_signer: false, is_writable: false },
            AccountRef { pubkey: program_id,                  is_signer: false, is_writable: false },
        ];
        // Anchor order: solver=0, recipient=0 (same), config=5, wormhole_program=6,
        // wormhole_bridge=2, wormhole_message=1, wormhole_emitter=7, wormhole_sequence=3,
        // wormhole_fee_collector=4, clock=8, rent=9, system_program=10
        let ix = vec![0u8, 0, 5, 6, 2, 1, 7, 3, 4, 8, 9, 10];
        (accts, ix, 11u8)
    } else {
        // Normal case: solver and recipient are different accounts.
        // Writable signers:    [0] solver, [1] wormhole_message
        // Writable non-sig:   [2] recipient, [3] wormhole_bridge, [4] wormhole_sequence,
        //                     [5] wormhole_fee_collector
        // Readonly non-sig:   [6] config_pda, [7] wormhole_program, [8] wormhole_emitter,
        //                     [9] clock, [10] rent, [11] system_program, [12] program_id
        let accts = vec![
            AccountRef { pubkey: solver_pubkey,               is_signer: true,  is_writable: true  },
            AccountRef { pubkey: wormhole_message_pubkey,     is_signer: true,  is_writable: true  },
            AccountRef { pubkey: recipient,                   is_signer: false, is_writable: true  },
            AccountRef { pubkey: wormhole_bridge_pda,         is_signer: false, is_writable: true  },
            AccountRef { pubkey: wormhole_sequence_pda,       is_signer: false, is_writable: true  },
            AccountRef { pubkey: wormhole_fee_collector_pda,  is_signer: false, is_writable: true  },
            AccountRef { pubkey: config_pda,                  is_signer: false, is_writable: false },
            AccountRef { pubkey: wormhole_program_id,         is_signer: false, is_writable: false },
            AccountRef { pubkey: wormhole_emitter_pda,        is_signer: false, is_writable: false },
            AccountRef { pubkey: clock_sysvar,                is_signer: false, is_writable: false },
            AccountRef { pubkey: rent_sysvar,                 is_signer: false, is_writable: false },
            AccountRef { pubkey: SYSTEM_PROGRAM,              is_signer: false, is_writable: false },
            AccountRef { pubkey: program_id,                  is_signer: false, is_writable: false },
        ];
        // Anchor order: solver=0, recipient=2, config=6, wormhole_program=7, wormhole_bridge=3,
        // wormhole_message=1, wormhole_emitter=8, wormhole_sequence=4,
        // wormhole_fee_collector=5, clock=9, rent=10, system_program=11
        let ix = vec![0u8, 2, 6, 7, 3, 1, 8, 4, 5, 9, 10, 11];
        (accts, ix, 12u8)
    };

    // ── Fetch blockhash and submit ───────────────────────────────────────────
    let blockhash = get_latest_blockhash(&config.solana_rpc_url).await?;

    let tx_bytes = build_and_sign_transaction(
        &accounts,
        &ix_data,
        &ix_accounts,
        program_id_index,
        blockhash,
        &signing_key,
        &[&wormhole_message_key],
    );

    let tx_b64 = base64::engine::general_purpose::STANDARD.encode(&tx_bytes);

    info!(
        order_id = %hex::encode(order_id),
        amount_lamports,
        recipient = %recipient_b58,
        "Submitting solve_and_prove transaction..."
    );

    let sig = send_and_confirm_transaction(&config.solana_rpc_url, &tx_b64).await?;

    // Parse sequence from transaction logs post-submit (safer than pre-reading for concurrent tasks).
    let tx_logs = fetch_transaction_logs(&config.solana_rpc_url, &sig).await;
    let wormhole_sequence = match parse_sequence_from_logs(&tx_logs) {
        Some(seq) => {
            debug!(sequence = seq, "Wormhole sequence parsed from transaction logs");
            seq
        }
        None => {
            // Fallback: baca dari on-chain account (less safe tapi mencegah hard failure)
            warn!(
                signature = %sig,
                "Could not parse Wormhole sequence from logs — falling back to account read.\n\
                 Logs:\n{tx_logs}"
            );
            get_account_sequence(&config.solana_rpc_url, &wormhole_sequence_pda)
                .await
                .unwrap_or(0)
                .saturating_sub(1) // account holds *next* sequence; kita pakai yang baru saja dipakai
        }
    };

    debug!(
        signature = %sig,
        recipient = %recipient_b58,
        amount_lamports,
        wormhole_sequence,
        "solve_and_prove confirmed"
    );

    Ok((sig, wormhole_sequence))
}

/// solve_and_liquid_stake: EVM→Solana bridge + Marinade liquid staking.
///
/// Correct flow (solver does NOT lose SOL):
///   1. Call solve_and_prove with SOLVER as recipient — solver receives the SOL back.
///      This emits the Wormhole proof needed to settle on EVM (solver gets ETH back).
///   2. Call marinade_stake.js TypeScript helper which:
///      a. Deposits solver's SOL into Marinade Finance → mints mSOL to solver's mSOL ATA
///      b. Transfers mSOL from solver to actual recipient's mSOL ATA
///
/// Net result:
///   - Solver spends SOL, gets back ETH (via EVM settle) → break-even (minus gas)
///   - Recipient gets mSOL (Marinade staked SOL), NOT raw SOL
///
/// Returns (tx_signature, wormhole_sequence, msol_minted).
/// The tx_signature and wormhole_sequence are from solve_and_prove (used for EVM settlement).
/// msol_minted is informational (logged, displayed to user).
pub async fn solve_and_liquid_stake(
    config: &Config,
    order_id: [u8; 32],
    recipient_b58: &str,
    amount_lamports: u64,
) -> Result<(String, u64, u64)> {
    // Derive solver's own Solana pubkey (used as solve_and_prove recipient)
    let secret_bytes = parse_solana_private_key(&config.solana_private_key)?;
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&secret_bytes);
    let solver_pubkey: [u8; 32] = signing_key.verifying_key().to_bytes();
    let solver_b58 = bs58::encode(&solver_pubkey).into_string();

    info!(
        order_id = %hex::encode(order_id),
        amount_lamports,
        actual_recipient = %recipient_b58,
        solver = %solver_b58,
        "Starting bridge+marinade_stake flow — SOL goes to solver, mSOL goes to recipient"
    );

    // ── Step 1: solve_and_prove with SOLVER as recipient ─────────────────────────
    // Solver receives the SOL (not the user). This emits the Wormhole proof for EVM settle.
    // Solver will then deposit that SOL into Marinade and send mSOL to the actual recipient.
    let (sig, wh_seq) = solve_and_prove(config, order_id, &solver_b58, amount_lamports).await?;

    info!(
        order_id = %hex::encode(order_id),
        signature = %sig,
        wormhole_sequence = wh_seq,
        solver = %solver_b58,
        "solve_and_prove confirmed — SOL received by solver, now depositing into Marinade for recipient..."
    );

    // ── Step 2: marinade_stake.js helper ────────────────────────────────────────
    let scripts_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("naisu-contracts/solana/scripts");

    let marinade_stake_js = scripts_dir.join("dist/marinade_stake.js");

    let output = tokio::process::Command::new("node")
        .current_dir(scripts_dir.parent().unwrap())
        .arg(&marinade_stake_js)
        .arg(recipient_b58)
        .arg(amount_lamports.to_string())
        .arg(&config.solana_rpc_url)
        .arg(&config.solana_private_key)
        .output()
        .await
        .map_err(|e| eyre::eyre!("Failed to run marinade_stake.js: {e}"))?;

    let stderr_str = String::from_utf8_lossy(&output.stderr);
    if !stderr_str.is_empty() {
        info!(
            order_id = %hex::encode(order_id),
            "marinade_stake.js stderr:\n{stderr_str}"
        );
    }

    if !output.status.success() {
        return Err(eyre::eyre!(
            "marinade_stake.js failed (exit {}): {}",
            output.status,
            stderr_str
        ));
    }

    // Parse "MSOL_MINTED:<amount>" from stdout
    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let msol_minted = stdout_str
        .lines()
        .find(|l| l.starts_with("MSOL_MINTED:"))
        .and_then(|l| l.trim_start_matches("MSOL_MINTED:").trim().parse::<u64>().ok())
        .unwrap_or(0);

    info!(
        order_id = %hex::encode(order_id),
        signature = %sig,
        wormhole_sequence = wh_seq,
        msol_minted,
        recipient = %recipient_b58,
        "Bridge+marinade_stake complete! Recipient received mSOL tokens."
    );

    Ok((sig, wh_seq, msol_minted))
}

/// solve_and_marginfi: EVM→Solana bridge + marginfi SOL lending deposit.
///
/// Flow:
///   1. solve_and_prove with SOLVER as recipient (solver receives SOL)
///   2. marginfi_deposit.js helper — deposits SOL into marginfi on behalf of recipient
///
/// On any error in the marginfi step, falls back gracefully (the Wormhole proof
/// was already submitted, so EVM settlement will still succeed).
pub async fn solve_and_marginfi(
    config: &Config,
    order_id: [u8; 32],
    recipient_b58: &str,
    amount_lamports: u64,
) -> Result<(String, u64)> {
    // Derive solver's own Solana pubkey
    let secret_bytes = parse_solana_private_key(&config.solana_private_key)?;
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&secret_bytes);
    let solver_pubkey: [u8; 32] = signing_key.verifying_key().to_bytes();
    let solver_b58 = bs58::encode(&solver_pubkey).into_string();

    info!(
        order_id = %hex::encode(order_id),
        amount_lamports,
        actual_recipient = %recipient_b58,
        solver = %solver_b58,
        "Starting bridge+marginfi flow — SOL goes to solver, then deposited into marginfi for recipient"
    );

    // ── Step 1: solve_and_prove with SOLVER as recipient ─────────────────────
    // Solver receives the SOL. This emits the Wormhole proof for EVM settlement.
    let (sig, wh_seq) = solve_and_prove(config, order_id, &solver_b58, amount_lamports).await?;

    info!(
        order_id = %hex::encode(order_id),
        signature = %sig,
        wormhole_sequence = wh_seq,
        solver = %solver_b58,
        "solve_and_prove confirmed — SOL received by solver, now depositing into marginfi for recipient..."
    );

    // ── Step 2: marginfi_deposit.js helper ───────────────────────────────────
    let scripts_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("naisu-contracts/solana/scripts");

    let marginfi_js = scripts_dir.join("dist/marginfi_deposit.js");

    let output = tokio::process::Command::new("node")
        .current_dir(scripts_dir.parent().unwrap())
        .arg(&marginfi_js)
        .arg(recipient_b58)
        .arg(amount_lamports.to_string())
        .arg(&config.solana_rpc_url)
        .arg(&config.solana_private_key)
        .output()
        .await
        .map_err(|e| eyre::eyre!("Failed to run marginfi_deposit.js: {e}"))?;

    let stderr_str = String::from_utf8_lossy(&output.stderr);
    if !stderr_str.is_empty() {
        info!(
            order_id = %hex::encode(order_id),
            "marginfi_deposit.js stderr:\n{stderr_str}"
        );
    }

    if !output.status.success() {
        // Non-fatal: Wormhole proof already submitted. Log and continue.
        warn!(
            order_id = %hex::encode(order_id),
            exit_code = %output.status,
            "marginfi_deposit.js exited non-zero — marginfi step failed, SOL stayed with solver"
        );
        return Ok((sig, wh_seq));
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout);

    // Handle fallback: marginfi_deposit.js emitted MARGINFI_FALLBACK:sol
    if stdout_str.lines().any(|l| l.starts_with("MARGINFI_FALLBACK:")) {
        warn!(
            order_id = %hex::encode(order_id),
            "marginfi_deposit.js reported MARGINFI_FALLBACK — marginfi unavailable on devnet, SOL was sent to solver"
        );
        return Ok((sig, wh_seq));
    }

    // Parse "MARGINFI_DEPOSITED:<amount>" from stdout
    let deposited_lamports = stdout_str
        .lines()
        .find(|l| l.starts_with("MARGINFI_DEPOSITED:"))
        .and_then(|l| l.trim_start_matches("MARGINFI_DEPOSITED:").trim().parse::<u64>().ok())
        .unwrap_or(0);

    info!(
        order_id = %hex::encode(order_id),
        signature = %sig,
        wormhole_sequence = wh_seq,
        deposited_lamports,
        recipient = %recipient_b58,
        "Bridge+marginfi complete! SOL deposited into marginfi lending pool for recipient."
    );

    Ok((sig, wh_seq))
}

/// Parse the Wormhole sequence number from confirmed transaction logs.
///
/// Wormhole Anchor SDK v0.30.x emits: "Program log: wormhole_sequence: N"
/// or via msg!() from our own program.
///
/// Returns None if not found — caller can fall back to reading the on-chain
/// sequence account (less reliable, but better than nothing).
fn parse_sequence_from_logs(logs: &str) -> Option<u64> {
    for line in logs.lines() {
        let lower = line.to_lowercase();
        // Format Wormhole Anchor SDK: "wormhole_sequence: N"
        if let Some(pos) = lower.find("wormhole_sequence: ") {
            let rest = &line[pos + "wormhole_sequence: ".len()..];
            if let Ok(seq) = rest.trim().parse::<u64>() {
                return Some(seq);
            }
        }
        // Wormhole Core Bridge: "Sequence: N" (capital S) or "sequence: N"
        // Case-insensitive match via lowercased line
        if let Some(pos) = lower.find("sequence: ") {
            let rest = &line[pos + "sequence: ".len()..];
            if let Ok(seq) = rest.trim().parse::<u64>() {
                return Some(seq);
            }
        }
    }
    None
}

/// Read the Wormhole sequence number from the sequence account.
/// The sequence account stores a u64 at offset 0 (after the Anchor discriminator at 0..8).
async fn get_account_sequence(rpc_url: &str, account: &[u8; 32]) -> Result<u64> {
    let client = reqwest::Client::new();
    let address = bs58::encode(account).into_string();
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getAccountInfo",
        "params": [address, {"encoding": "base64"}]
    });
    let resp: serde_json::Value = client
        .post(rpc_url)
        .json(&body)
        .send()
        .await?
        .json()
        .await?;

    let data_b64 = resp["result"]["value"]["data"][0]
        .as_str()
        .ok_or_else(|| eyre::eyre!("Sequence account not found or no data"))?;

    let data = base64::engine::general_purpose::STANDARD.decode(data_b64)?;
    // Wormhole sequence account layout (non-Anchor): just u64 LE at offset 0
    // But if it's an Anchor account it'd be disc(8) + u64
    // Wormhole core bridge sequence accounts are NOT Anchor — raw u64
    if data.len() < 8 {
        return Ok(0);
    }
    let seq = u64::from_le_bytes(data[0..8].try_into().unwrap());
    Ok(seq)
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sequence_from_logs_wormhole_format() {
        let logs = r#"
Program log: Instruction: SolveAndProve
Program log: Transferring SOL to recipient
Program log: wormhole_sequence: 42
Program log: CPI to Wormhole
Program log: Success
        "#;
        
        assert_eq!(parse_sequence_from_logs(logs), Some(42));
    }

    #[test]
    fn test_parse_sequence_from_logs_generic_format() {
        let logs = r#"
Program log: Processing transaction
Program log: sequence: 123
Program log: Done
        "#;

        assert_eq!(parse_sequence_from_logs(logs), Some(123));
    }

    #[test]
    fn test_parse_sequence_from_logs_capital_s() {
        // This is the ACTUAL format Wormhole Core Bridge emits on Solana
        let logs = r#"
Program log: Instruction: SolveAndProve
Program 3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5 invoke [2]
Program log: Sequence: 11
Program 3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5 consumed 10
Program 3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5 success
        "#;

        assert_eq!(parse_sequence_from_logs(logs), Some(11));
    }

    #[test]
    fn test_parse_sequence_from_logs_not_found() {
        let logs = r#"
Program log: Instruction: SomeOtherInstruction
Program log: Processing...
Program log: Done
        "#;
        
        assert_eq!(parse_sequence_from_logs(logs), None);
    }

    #[test]
    fn test_parse_sequence_from_logs_empty() {
        assert_eq!(parse_sequence_from_logs(""), None);
        assert_eq!(parse_sequence_from_logs("   "), None);
    }

    #[test]
    fn test_parse_sequence_from_logs_large_number() {
        let logs = "Program log: wormhole_sequence: 18446744073709551615";
        assert_eq!(parse_sequence_from_logs(logs), Some(u64::MAX));
    }

    #[test]
    fn test_parse_sequence_first_match_wins() {
        // If both formats present on different lines, first one in file wins
        let logs = r#"
Program log: sequence: 999
Program log: wormhole_sequence: 42
        "#;
        
        // sequence: 999 comes first in the file (line 1)
        assert_eq!(parse_sequence_from_logs(logs), Some(999));
    }

    #[test]
    fn test_parse_sequence_wormhole_comes_first() {
        // If wormhole_sequence comes before sequence in file
        let logs = r#"
Program log: wormhole_sequence: 42
Program log: sequence: 999
        "#;
        
        // wormhole_sequence: 42 comes first in the file (line 1)
        assert_eq!(parse_sequence_from_logs(logs), Some(42));
    }
}
