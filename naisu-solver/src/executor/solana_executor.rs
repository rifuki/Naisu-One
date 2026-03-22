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

/// Build and sign a Solana legacy transaction with multiple instructions.
///
/// `accounts`: pre-sorted (writable signers, readonly signers, writable non-signers,
///             readonly non-signers) — all accounts referenced by ALL instructions.
/// `instructions`: list of (program_id_index, account_indices_slice, instruction_data).
/// `signers`: signing keys in the exact order signer accounts appear in `accounts`.
fn build_and_sign_multi_ix(
    accounts: &[AccountRef],
    instructions: &[(u8, &[u8], &[u8])],
    recent_blockhash: [u8; 32],
    signers: &[&ed25519_dalek::SigningKey],
) -> Vec<u8> {
    use ed25519_dalek::Signer;

    let num_signers = accounts.iter().filter(|a| a.is_signer).count() as u8;
    let num_readonly_signers = accounts
        .iter()
        .filter(|a| a.is_signer && !a.is_writable)
        .count() as u8;
    let num_readonly_unsigned = accounts
        .iter()
        .filter(|a| !a.is_signer && !a.is_writable)
        .count() as u8;

    let mut msg = Vec::new();
    msg.push(num_signers);
    msg.push(num_readonly_signers);
    msg.push(num_readonly_unsigned);
    msg.extend_from_slice(&compact_u16(accounts.len() as u16));
    for acc in accounts {
        msg.extend_from_slice(&acc.pubkey);
    }
    msg.extend_from_slice(&recent_blockhash);
    msg.extend_from_slice(&compact_u16(instructions.len() as u16));
    for (prog_idx, acct_idxs, data) in instructions {
        msg.push(*prog_idx);
        msg.extend_from_slice(&compact_u16(acct_idxs.len() as u16));
        msg.extend_from_slice(acct_idxs);
        msg.extend_from_slice(&compact_u16(data.len() as u16));
        msg.extend_from_slice(data);
    }

    let mut tx = Vec::new();
    tx.extend_from_slice(&compact_u16(signers.len() as u16));
    for key in signers {
        let sig = key.sign(&msg);
        tx.extend_from_slice(&sig.to_bytes());
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

/// Fetch raw base64-decoded account data from the RPC.
async fn fetch_account_data(rpc_url: &str, address: &[u8; 32]) -> Result<Vec<u8>> {
    let client = reqwest::Client::new();
    let addr_b58 = bs58::encode(address).into_string();
    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": 1,
        "method": "getAccountInfo",
        "params": [addr_b58, {"encoding": "base64"}]
    });
    let resp: serde_json::Value = client.post(rpc_url).json(&body).send().await?.json().await?;
    let data_b64 = resp["result"]["value"]["data"][0]
        .as_str()
        .ok_or_else(|| eyre::eyre!("Account not found: {addr_b58}"))?;
    Ok(base64::engine::general_purpose::STANDARD.decode(data_b64)?)
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
            // Fallback: read from on-chain account (less safe but prevents hard failure)
            warn!(
                signature = %sig,
                "Could not parse Wormhole sequence from logs — falling back to account read.\n\
                 Logs:\n{tx_logs}"
            );
            get_account_sequence(&config.solana_rpc_url, &wormhole_sequence_pda)
                .await
                .unwrap_or(0)
                .saturating_sub(1) // account holds *next* sequence; subtract 1 to get the one just used
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

// ──────────────────────────────────────────────────────────────────────────────
// Marinade liquid staking — atomic single-transaction (deposit + prove)
// ──────────────────────────────────────────────────────────────────────────────

const MARINADE_PROGRAM_B58: &str = "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD";
const MARINADE_STATE_B58:   &str = "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC";
const MSOL_MINT_B58:        &str = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";

// Byte offset of liq_pool.msol_leg (Pubkey, 32 bytes) within the Borsh-encoded MarinadeState.
// Verified against devnet state account 8szGkuL... and stable across Marinade versions
// as long as the state layout (anchor IDL) doesn't change.
// mainnet: point MARINADE_STATE_B58 to mainnet state → same offset applies.
const MARINADE_MSOL_LEG_OFFSET: usize = 420;

/// Fetch liq_pool.msol_leg from the Marinade state account at runtime.
/// This avoids hardcoding the address — works for both devnet and mainnet
/// as long as MARINADE_STATE_B58 in config points to the correct network state.
async fn fetch_marinade_msol_leg(rpc_url: &str) -> Result<[u8; 32]> {
    let marinade_state = decode_b58(MARINADE_STATE_B58)?;
    let data = fetch_account_data(rpc_url, &marinade_state).await?;
    if data.len() < MARINADE_MSOL_LEG_OFFSET + 32 {
        return Err(eyre::eyre!(
            "Marinade state account too short ({} bytes), expected >= {}",
            data.len(), MARINADE_MSOL_LEG_OFFSET + 32
        ));
    }
    let mut pubkey = [0u8; 32];
    pubkey.copy_from_slice(&data[MARINADE_MSOL_LEG_OFFSET..MARINADE_MSOL_LEG_OFFSET + 32]);
    Ok(pubkey)
}

/// Solve (Marinade: deposit SOL → mSOL directly to recipient ATA) and prove via Wormhole.
///
/// Single atomic transaction with 3 instructions:
///   1. CreateATA (idempotent) — ensure recipient's mSOL ATA exists
///   2. Marinade deposit — solver deposits SOL, mSOL minted directly to recipient ATA
///   3. prove_stake — emit Wormhole VAA with AUTO_STAKE payload
///
/// VAA is only emitted after mSOL delivery succeeds — fully atomic.
/// Returns (tx_signature, wormhole_sequence, amount_lamports).
pub async fn solve_marinade_and_prove(
    config: &Config,
    order_id: [u8; 32],
    recipient_b58: &str,
    amount_lamports: u64,
) -> Result<(String, u64, u64)> {
    const MAX_ATTEMPTS: u32 = 3;
    let mut last_err = eyre::eyre!("no attempts made");
    for attempt in 1..=MAX_ATTEMPTS {
        match solve_marinade_and_prove_inner(config, order_id, recipient_b58, amount_lamports).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("SolanaTransactionTimeout") {
                    warn!(
                        order_id = %hex::encode(order_id),
                        attempt, max_attempts = MAX_ATTEMPTS,
                        "Solana tx timed out — retrying with fresh blockhash..."
                    );
                    if attempt < MAX_ATTEMPTS {
                        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                        last_err = e;
                        continue;
                    }
                }
                return Err(e);
            }
        }
    }
    Err(last_err)
}

async fn solve_marinade_and_prove_inner(
    config: &Config,
    order_id: [u8; 32],
    recipient_b58: &str,
    amount_lamports: u64,
) -> Result<(String, u64, u64)> {
    // ── Load solver keypair ──────────────────────────────────────────────────
    let secret_bytes = parse_solana_private_key(&config.solana_private_key)?;
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&secret_bytes);
    let solver_pubkey: [u8; 32] = signing_key.verifying_key().to_bytes();

    // ── Decode addresses ─────────────────────────────────────────────────────
    let program_id       = decode_b58(&config.solana_program_id)?;
    let wormhole_prog    = decode_b58(&config.solana_wormhole_program_id)?;
    let token_program    = decode_b58(TOKEN_PROGRAM_B58)?;
    let assoc_token_prog = decode_b58(ASSOC_TOKEN_PROGRAM_B58)?;
    let marinade_program = decode_b58(MARINADE_PROGRAM_B58)?;
    let marinade_state   = decode_b58(MARINADE_STATE_B58)?;
    let msol_mint        = decode_b58(MSOL_MINT_B58)?;
    let recipient        = decode_b58(recipient_b58)?;

    // ── Derive Marinade PDAs ─────────────────────────────────────────────────
    // Seeds: [state_key, "<seed_str>"] @ marinade_program
    let (liq_pool_sol_leg_pda, _)        = find_pda(&[&marinade_state, b"liq_sol"],               &marinade_program);
    let (liq_pool_msol_leg_authority, _) = find_pda(&[&marinade_state, b"liq_st_sol_authority"], &marinade_program);
    let (reserve_pda, _)                 = find_pda(&[&marinade_state, b"reserve"],              &marinade_program);
    let (msol_mint_authority, _)         = find_pda(&[&marinade_state, b"st_mint"],              &marinade_program);
    // liq_pool_msol_leg: stored in MarinadeState.liqPool.msolLeg — fetch at runtime
    // so this works for mainnet without code changes (just update MARINADE_STATE_B58)
    let liq_pool_msol_leg = fetch_marinade_msol_leg(&config.solana_rpc_url).await?;
    // Recipient's mSOL ATA
    let (recipient_msol_ata, _) = find_pda(&[&recipient, &token_program, &msol_mint], &assoc_token_prog);

    // ── Derive Wormhole PDAs ─────────────────────────────────────────────────
    let (config_pda, _)           = find_pda(&[b"config"],                          &program_id);
    let (wh_bridge_pda, _)        = find_pda(&[b"Bridge"],                          &wormhole_prog);
    let (wh_emitter_pda, _)       = find_pda(&[b"emitter"],                         &program_id);
    let (wh_sequence_pda, _)      = find_pda(&[b"Sequence", &wh_emitter_pda],       &wormhole_prog);
    let (wh_fee_collector_pda, _) = find_pda(&[b"fee_collector"],                   &wormhole_prog);

    // ── Fresh wormhole_message keypair ────────────────────────────────────────
    let wh_message_key = {
        use sha2::Digest;
        let now_ns = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
        let mut h = sha2::Sha256::new();
        h.update(order_id); h.update(solver_pubkey); h.update(amount_lamports.to_le_bytes());
        h.update(b"solve_marinade_and_prove"); h.update(now_ns.to_le_bytes());
        ed25519_dalek::SigningKey::from_bytes(&h.finalize().into())
    };
    let wh_message_pubkey: [u8; 32] = wh_message_key.verifying_key().to_bytes();

    // ── Solver EVM address (for VAA payload) ─────────────────────────────────
    let solver_evm: ethers::signers::LocalWallet = config.evm_private_key.parse()
        .map_err(|e| eyre::eyre!("Invalid evm_private_key: {e}"))?;
    let mut solver_evm_addr = [0u8; 32];
    solver_evm_addr[12..].copy_from_slice(solver_evm.address().as_bytes());

    // ── Sysvars ──────────────────────────────────────────────────────────────
    let clock_sysvar = decode_b58("SysvarC1ock11111111111111111111111111111111")?;
    let rent_sysvar  = decode_b58("SysvarRent111111111111111111111111111111111")?;

    // ── Instruction A: CreateATA (idempotent) for recipient mSOL ATA ─────────
    // data = [1] — idempotent discriminator, succeeds even if ATA already exists
    let create_ata_data: &[u8] = &[1u8];

    // ── Instruction B: Marinade deposit ──────────────────────────────────────
    // Anchor: disc(8) + lamports(8 LE) = 16 bytes
    let mut marinade_data = instruction_discriminator("deposit").to_vec();
    marinade_data.extend_from_slice(&amount_lamports.to_le_bytes());

    // ── Instruction C: prove_stake (our program) ──────────────────────────────
    // disc(8) + order_id(32) + solver_evm(32) + amount(8) = 80 bytes
    let mut prove_data = instruction_discriminator("prove_stake").to_vec();
    prove_data.extend_from_slice(&order_id);
    prove_data.extend_from_slice(&solver_evm_addr);
    prove_data.extend_from_slice(&amount_lamports.to_le_bytes());

    // ── Merged account list (Solana ordering) ─────────────────────────────────
    // Writable signers:   [0] solver  [1] wh_message
    // Writable non-sig:   [2] marinade_state  [3] msol_mint  [4] liq_pool_sol_leg_pda
    //                     [5] liq_pool_msol_leg  [6] reserve_pda  [7] recipient_msol_ata
    //                     [8] wh_bridge  [9] wh_sequence  [10] wh_fee_collector
    // Readonly non-sig:   [11] recipient  [12] liq_pool_msol_leg_authority
    //                     [13] msol_mint_authority  [14] assoc_token_prog (ix A prog)
    //                     [15] marinade_program (ix B prog)  [16] token_program
    //                     [17] system_program  [18] config_pda  [19] wormhole_prog
    //                     [20] wh_emitter  [21] clock  [22] rent  [23] program_id (ix C prog)
    let accounts = vec![
        AccountRef { pubkey: solver_pubkey,               is_signer: true,  is_writable: true  }, //  0
        AccountRef { pubkey: wh_message_pubkey,           is_signer: true,  is_writable: true  }, //  1
        AccountRef { pubkey: marinade_state,              is_signer: false, is_writable: true  }, //  2
        AccountRef { pubkey: msol_mint,                   is_signer: false, is_writable: true  }, //  3
        AccountRef { pubkey: liq_pool_sol_leg_pda,        is_signer: false, is_writable: true  }, //  4
        AccountRef { pubkey: liq_pool_msol_leg,           is_signer: false, is_writable: true  }, //  5
        AccountRef { pubkey: reserve_pda,                 is_signer: false, is_writable: true  }, //  6
        AccountRef { pubkey: recipient_msol_ata,          is_signer: false, is_writable: true  }, //  7
        AccountRef { pubkey: wh_bridge_pda,               is_signer: false, is_writable: true  }, //  8
        AccountRef { pubkey: wh_sequence_pda,             is_signer: false, is_writable: true  }, //  9
        AccountRef { pubkey: wh_fee_collector_pda,        is_signer: false, is_writable: true  }, // 10
        AccountRef { pubkey: recipient,                   is_signer: false, is_writable: false }, // 11
        AccountRef { pubkey: liq_pool_msol_leg_authority, is_signer: false, is_writable: false }, // 12
        AccountRef { pubkey: msol_mint_authority,         is_signer: false, is_writable: false }, // 13
        AccountRef { pubkey: assoc_token_prog,            is_signer: false, is_writable: false }, // 14
        AccountRef { pubkey: marinade_program,            is_signer: false, is_writable: false }, // 15
        AccountRef { pubkey: token_program,               is_signer: false, is_writable: false }, // 16
        AccountRef { pubkey: SYSTEM_PROGRAM,              is_signer: false, is_writable: false }, // 17
        AccountRef { pubkey: config_pda,                  is_signer: false, is_writable: false }, // 18
        AccountRef { pubkey: wormhole_prog,               is_signer: false, is_writable: false }, // 19
        AccountRef { pubkey: wh_emitter_pda,              is_signer: false, is_writable: false }, // 20
        AccountRef { pubkey: clock_sysvar,                is_signer: false, is_writable: false }, // 21
        AccountRef { pubkey: rent_sysvar,                 is_signer: false, is_writable: false }, // 22
        AccountRef { pubkey: program_id,                  is_signer: false, is_writable: false }, // 23
    ];

    // Instruction A (CreateATA idempotent): prog=14, accounts=[funding=0, ata=7, wallet=11, mint=3, sys=17, tok=16]
    let ix_a_accounts: &[u8] = &[0, 7, 11, 3, 17, 16];
    // Instruction B (Marinade deposit): prog=15, accounts=[state=2,msol_mint=3,sol_leg=4,msol_leg=5,
    //   msol_leg_auth=12,reserve=6,transfer_from=0,mint_to=7,msol_mint_auth=13,sys=17,tok=16]
    let ix_b_accounts: &[u8] = &[2, 3, 4, 5, 12, 6, 0, 7, 13, 17, 16];
    // Instruction C (prove_stake): prog=23, accounts=[solver=0,config=18,wh_prog=19,wh_bridge=8,
    //   wh_msg=1,wh_emitter=20,wh_seq=9,wh_fee=10,clock=21,rent=22,sys=17]
    let ix_c_accounts: &[u8] = &[0, 18, 19, 8, 1, 20, 9, 10, 21, 22, 17];

    let instructions: &[(u8, &[u8], &[u8])] = &[
        (14, ix_a_accounts, create_ata_data),
        (15, ix_b_accounts, &marinade_data),
        (23, ix_c_accounts, &prove_data),
    ];

    // ── Fetch blockhash and submit ────────────────────────────────────────────
    let blockhash = get_latest_blockhash(&config.solana_rpc_url).await?;
    let tx_bytes = build_and_sign_multi_ix(&accounts, instructions, blockhash, &[&signing_key, &wh_message_key]);
    let tx_b64 = base64::engine::general_purpose::STANDARD.encode(&tx_bytes);

    info!(
        order_id = %hex::encode(order_id), amount_lamports, recipient = %recipient_b58,
        "Submitting Marinade+prove_stake atomic transaction..."
    );

    let sig = send_and_confirm_transaction(&config.solana_rpc_url, &tx_b64).await?;

    let tx_logs = fetch_transaction_logs(&config.solana_rpc_url, &sig).await;
    let wormhole_sequence = match parse_sequence_from_logs(&tx_logs) {
        Some(seq) => seq,
        None => {
            warn!(signature = %sig, "Could not parse Wormhole sequence — falling back to account read");
            get_account_sequence(&config.solana_rpc_url, &wh_sequence_pda).await.unwrap_or(0).saturating_sub(1)
        }
    };

    info!(
        order_id = %hex::encode(order_id), sig = %sig, wormhole_sequence,
        "Marinade+prove_stake confirmed — mSOL delivered to recipient atomically."
    );

    // mSOL received ≈ amount_lamports (Marinade ~1:1 minus small fee)
    Ok((sig, wormhole_sequence, amount_lamports))
}

// ──────────────────────────────────────────────────────────────────────────────
// Mock vault platforms: jupSOL + kSOL (solve_stake_and_prove)
// ──────────────────────────────────────────────────────────────────────────────
//
// These use the `solve_stake_and_prove` Solana program instruction which atomically:
//   1. CPI to mock-staking vault (solver deposits SOL → recipient gets LST)
//   2. Emits Wormhole VAA *after* staking — proof is correct + no self-transfer waste

/// Known mint addresses for mock vault platforms (devnet).
const JUPSOL_MINT_B58: &str = "HD7nTaUNpoNgCZV1wNcNnoksaZYNnQcfUWkypmv5v6sP";
const KSOL_MINT_B58:   &str = "GmPH41w5zofFsdP3LKqCnByFTxNV8r6ajQnivLdTmtpF";

/// SPL token program.
const TOKEN_PROGRAM_B58: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/// Associated token program.
const ASSOC_TOKEN_PROGRAM_B58: &str = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/// Decode a base58 program/address string to 32-byte array.
fn decode_b58(s: &str) -> Result<[u8; 32]> {
    bs58::decode(s)
        .into_vec()?
        .try_into()
        .map_err(|_| eyre::eyre!("Invalid b58 address length: {s}"))
}

/// Atomically stake SOL into mock vault and emit Wormhole proof.
///
/// Calls the Solana program's `solve_stake_and_prove` instruction which:
///   1. CPI: solver deposits `amount_lamports` SOL into the vault → recipient gets LST
///   2. Emits Wormhole VAA with action=AUTO_STAKE flag
///
/// Returns (tx_signature, wormhole_sequence, minted_tokens).
/// minted_tokens = amount_lamports (mock vault uses 1:1 rate by default).
async fn solve_stake_and_prove_inner(
    config: &Config,
    order_id: [u8; 32],
    recipient_b58: &str,
    mint_b58: &str,
    amount_lamports: u64,
) -> Result<(String, u64, u64)> {
    // ── Load keypair ──────────────────────────────────────────────────────────
    let secret_bytes = parse_solana_private_key(&config.solana_private_key)?;
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&secret_bytes);
    let solver_pubkey: [u8; 32] = signing_key.verifying_key().to_bytes();

    // ── Decode addresses ──────────────────────────────────────────────────────
    let program_id        = decode_b58(&config.solana_program_id)?;
    let wormhole_prog     = decode_b58(&config.solana_wormhole_program_id)?;
    let staking_program   = decode_b58(&config.liquid_staking_program_id)?;
    let token_program     = decode_b58(TOKEN_PROGRAM_B58)?;
    let assoc_token_prog  = decode_b58(ASSOC_TOKEN_PROGRAM_B58)?;
    let mint              = decode_b58(mint_b58)?;
    let recipient         = decode_b58(recipient_b58)?;

    // ── Derive PDAs ───────────────────────────────────────────────────────────
    let (config_pda, _)               = find_pda(&[b"config"], &program_id);
    let (wh_bridge_pda, _)            = find_pda(&[b"Bridge"], &wormhole_prog);
    let (wh_emitter_pda, _)           = find_pda(&[b"emitter"], &program_id);
    let (wh_sequence_pda, _)          = find_pda(&[b"Sequence", &wh_emitter_pda], &wormhole_prog);
    let (wh_fee_collector_pda, _)     = find_pda(&[b"fee_collector"], &wormhole_prog);
    // Vault PDA: seeds = ["vault", mint] @ staking_program
    let (vault_state_pda, _)          = find_pda(&[b"vault", &mint], &staking_program);
    // Recipient ATA: seeds = [recipient, token_program, mint] @ assoc_token_prog
    let (recipient_ata, _)            = find_pda(&[&recipient, &token_program, &mint], &assoc_token_prog);

    // ── Fresh wormhole_message keypair ────────────────────────────────────────
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
        h.update(b"solve_stake_and_prove");
        h.update(now_ns.to_le_bytes());
        let r: [u8; 32] = h.finalize().into();
        r
    };
    let wh_message_key = ed25519_dalek::SigningKey::from_bytes(&msg_secret);
    let wh_message_pubkey: [u8; 32] = wh_message_key.verifying_key().to_bytes();

    // ── Solver EVM address (for VAA payload) ──────────────────────────────────
    let solver_evm: ethers::signers::LocalWallet = config
        .evm_private_key
        .parse()
        .map_err(|e| eyre::eyre!("Invalid evm_private_key: {e}"))?;
    let mut solver_evm_addr = [0u8; 32];
    solver_evm_addr[12..].copy_from_slice(solver_evm.address().as_bytes());

    // ── Sysvars ───────────────────────────────────────────────────────────────
    let clock_sysvar = decode_b58("SysvarC1ock11111111111111111111111111111111")?;
    let rent_sysvar  = decode_b58("SysvarRent111111111111111111111111111111111")?;

    // ── Instruction data ──────────────────────────────────────────────────────
    // solve_stake_and_prove(order_id: [u8;32], solver_address: [u8;32], amount_lamports: u64)
    // = disc(8) + [u8;32](32) + [u8;32](32) + u64(8) = 80 bytes
    let discriminator = instruction_discriminator("solve_stake_and_prove");
    let mut ix_data = discriminator.to_vec();
    ix_data.extend_from_slice(&order_id);
    ix_data.extend_from_slice(&solver_evm_addr);
    ix_data.extend_from_slice(&amount_lamports.to_le_bytes());

    // ── Account list (Anchor struct order) ────────────────────────────────────
    // SolveStakeAndProve:
    //  0 solver           mut signer
    //  1 recipient        mut
    //  2 staking_program  readonly
    //  3 vault_state      mut
    //  4 mint             mut
    //  5 recipient_ata    mut
    //  6 token_program    readonly
    //  7 assoc_token_prog readonly
    //  8 config           readonly (PDA)
    //  9 wormhole_program readonly
    // 10 wormhole_bridge  mut
    // 11 wormhole_message mut signer
    // 12 wormhole_emitter readonly (PDA)
    // 13 wormhole_sequence mut
    // 14 wh_fee_collector mut
    // 15 clock            readonly
    // 16 rent             readonly
    // 17 system_program   readonly
    // 18 program_id       (program being called — not in accounts list, separate field)
    let accounts = vec![
        AccountRef { pubkey: solver_pubkey,         is_signer: true,  is_writable: true  }, // 0
        AccountRef { pubkey: recipient,             is_signer: false, is_writable: true  }, // 1
        AccountRef { pubkey: staking_program,       is_signer: false, is_writable: false }, // 2
        AccountRef { pubkey: vault_state_pda,       is_signer: false, is_writable: true  }, // 3
        AccountRef { pubkey: mint,                  is_signer: false, is_writable: true  }, // 4
        AccountRef { pubkey: recipient_ata,         is_signer: false, is_writable: true  }, // 5
        AccountRef { pubkey: token_program,         is_signer: false, is_writable: false }, // 6
        AccountRef { pubkey: assoc_token_prog,      is_signer: false, is_writable: false }, // 7
        AccountRef { pubkey: config_pda,            is_signer: false, is_writable: false }, // 8
        AccountRef { pubkey: wormhole_prog,         is_signer: false, is_writable: false }, // 9
        AccountRef { pubkey: wh_bridge_pda,         is_signer: false, is_writable: true  }, // 10
        AccountRef { pubkey: wh_message_pubkey,     is_signer: true,  is_writable: true  }, // 11
        AccountRef { pubkey: wh_emitter_pda,        is_signer: false, is_writable: false }, // 12
        AccountRef { pubkey: wh_sequence_pda,       is_signer: false, is_writable: true  }, // 13
        AccountRef { pubkey: wh_fee_collector_pda,  is_signer: false, is_writable: true  }, // 14
        AccountRef { pubkey: clock_sysvar,          is_signer: false, is_writable: false }, // 15
        AccountRef { pubkey: rent_sysvar,           is_signer: false, is_writable: false }, // 16
        AccountRef { pubkey: SYSTEM_PROGRAM,        is_signer: false, is_writable: false }, // 17
        AccountRef { pubkey: program_id,            is_signer: false, is_writable: false }, // 18 (program)
    ];
    // ix_accounts: indices into `accounts` in Anchor struct field order (0..17)
    let ix_accounts: Vec<u8> = (0u8..18).collect();
    let program_id_index: u8 = 18;

    // ── Build + submit ────────────────────────────────────────────────────────
    let blockhash = get_latest_blockhash(&config.solana_rpc_url).await?;
    let tx_bytes = build_and_sign_transaction(
        &accounts,
        &ix_data,
        &ix_accounts,
        program_id_index,
        blockhash,
        &signing_key,
        &[&wh_message_key],
    );
    let tx_b64 = base64::engine::general_purpose::STANDARD.encode(&tx_bytes);

    info!(
        order_id = %hex::encode(order_id),
        amount_lamports,
        recipient = %recipient_b58,
        mint = %mint_b58,
        "Submitting solve_stake_and_prove transaction..."
    );

    let sig = send_and_confirm_transaction(&config.solana_rpc_url, &tx_b64).await?;

    // Parse wormhole sequence from logs
    let tx_logs = fetch_transaction_logs(&config.solana_rpc_url, &sig).await;
    let wormhole_sequence = match parse_sequence_from_logs(&tx_logs) {
        Some(seq) => seq,
        None => {
            warn!(signature = %sig, "Could not parse Wormhole sequence from logs — falling back to account read");
            get_account_sequence(&config.solana_rpc_url, &wh_sequence_pda)
                .await
                .unwrap_or(0)
                .saturating_sub(1)
        }
    };

    info!(
        order_id = %hex::encode(order_id),
        signature = %sig,
        wormhole_sequence,
        minted = amount_lamports,
        "solve_stake_and_prove confirmed — LST minted to recipient."
    );

    // minted = amount_lamports (mock vault default 1:1 exchange rate)
    Ok((sig, wormhole_sequence, amount_lamports))
}

// ──────────────────────────────────────────────────────────────────────────────
// Jito real devnet stake pool — atomic single-transaction (depositSol + prove)
// ──────────────────────────────────────────────────────────────────────────────

const JITO_PROGRAM_B58:       &str = "DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib";
const JITO_STAKE_POOL_B58:    &str = "JitoY5pcAxWX6iyP2QdFwTznGb8A99PRCUCVVxB46WZ";
const JITO_SOL_MINT_B58:      &str = "J1tos8mqbhdGcF3pgj4PCKyVjzWSURcpLZU7pPGHxSYi";
const JITO_RESERVE_B58:       &str = "Dsd1zgN4XtxC6239vNznTNb6akTLNQeSBKoJqYjNps5e";
const JITO_WITHDRAW_AUTH_B58: &str = "8HPpFV5PFqGmDumjRTFw9BhsjrZYjJBDuHX2p6H5nBmd";

/// Fetch manager_fee_account from the Jito stake pool account.
///
/// SPL stake pool layout (borsh, u8 account_type discriminator):
///   [0]       account_type: u8
///   [1..33]   manager: Pubkey
///   [33..65]  staker: Pubkey
///   [65..97]  stake_deposit_authority: Pubkey
///   [97]      stake_withdraw_bump_seed: u8
///   [98..130] validator_list: Pubkey
///   [130..162] reserve_stake: Pubkey
///   [162..194] pool_mint: Pubkey       ← verified against JITO_SOL_MINT_B58
///   [194..226] manager_fee_account     ← what we need
async fn fetch_jito_manager_fee_account(rpc_url: &str) -> Result<[u8; 32]> {
    let stake_pool_addr = decode_b58(JITO_STAKE_POOL_B58)?;
    let data = fetch_account_data(rpc_url, &stake_pool_addr).await?;
    if data.len() < 226 {
        return Err(eyre::eyre!("Jito stake pool account too short: {} bytes", data.len()));
    }
    let pool_mint_at_162: [u8; 32] = data[162..194].try_into().unwrap();
    let expected_mint = decode_b58(JITO_SOL_MINT_B58)?;
    if pool_mint_at_162 != expected_mint {
        return Err(eyre::eyre!(
            "Jito pool_mint mismatch at offset 162 — layout may have changed. \
             Expected {JITO_SOL_MINT_B58}, got {}",
            bs58::encode(pool_mint_at_162).into_string()
        ));
    }
    Ok(data[194..226].try_into().unwrap())
}

/// Solve (Jito: depositSol → jitoSOL directly to recipient ATA) and prove via Wormhole.
///
/// Single atomic transaction with 4 instructions:
///   1. CreateATA (idempotent) — ensure recipient's jitoSOL ATA exists
///   2. SystemProgram::transfer(solver → ephemeral, amount_lamports)
///   3. Jito DepositSol (ephemeral as fundingAccount → jitoSOL to recipient ATA)
///   4. prove_stake — emit Wormhole VAA with AUTO_STAKE payload
pub async fn solve_jito_and_prove(
    config: &Config,
    order_id: [u8; 32],
    recipient_b58: &str,
    amount_lamports: u64,
) -> Result<(String, u64, u64)> {
    const MAX_ATTEMPTS: u32 = 3;
    let mut last_err = eyre::eyre!("no attempts made");
    for attempt in 1..=MAX_ATTEMPTS {
        match solve_jito_and_prove_inner(config, order_id, recipient_b58, amount_lamports).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("SolanaTransactionTimeout") {
                    warn!(
                        order_id = %hex::encode(order_id),
                        attempt, max_attempts = MAX_ATTEMPTS,
                        "Solana tx timed out — retrying with fresh blockhash..."
                    );
                    if attempt < MAX_ATTEMPTS {
                        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                        last_err = e;
                        continue;
                    }
                }
                return Err(e);
            }
        }
    }
    Err(last_err)
}

async fn solve_jito_and_prove_inner(
    config: &Config,
    order_id: [u8; 32],
    recipient_b58: &str,
    amount_lamports: u64,
) -> Result<(String, u64, u64)> {
    let secret_bytes = parse_solana_private_key(&config.solana_private_key)?;
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&secret_bytes);
    let solver_pubkey: [u8; 32] = signing_key.verifying_key().to_bytes();

    let program_id       = decode_b58(&config.solana_program_id)?;
    let wormhole_prog    = decode_b58(&config.solana_wormhole_program_id)?;
    let token_program    = decode_b58(TOKEN_PROGRAM_B58)?;
    let assoc_token_prog = decode_b58(ASSOC_TOKEN_PROGRAM_B58)?;
    let jito_program     = decode_b58(JITO_PROGRAM_B58)?;
    let stake_pool       = decode_b58(JITO_STAKE_POOL_B58)?;
    let jitosol_mint     = decode_b58(JITO_SOL_MINT_B58)?;
    let reserve_stake    = decode_b58(JITO_RESERVE_B58)?;
    let withdraw_auth    = decode_b58(JITO_WITHDRAW_AUTH_B58)?;
    let recipient        = decode_b58(recipient_b58)?;

    let manager_fee_account = fetch_jito_manager_fee_account(&config.solana_rpc_url).await?;
    info!(manager_fee = %bs58::encode(manager_fee_account).into_string(), "Fetched Jito manager_fee_account");

    let (recipient_jitosol_ata, _) = find_pda(&[&recipient, &token_program, &jitosol_mint], &assoc_token_prog);

    // Ephemeral keypair — fundingAccount for Jito DepositSol. Pre-funded by ix 2, drained by ix 3.
    let ephemeral_key = {
        use sha2::Digest;
        let now_ns = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
        let mut h = sha2::Sha256::new();
        h.update(order_id); h.update(solver_pubkey); h.update(amount_lamports.to_le_bytes());
        h.update(b"jito_ephemeral"); h.update(now_ns.to_le_bytes());
        ed25519_dalek::SigningKey::from_bytes(&h.finalize().into())
    };
    let ephemeral_pubkey: [u8; 32] = ephemeral_key.verifying_key().to_bytes();

    let (config_pda, _)           = find_pda(&[b"config"],                    &program_id);
    let (wh_bridge_pda, _)        = find_pda(&[b"Bridge"],                    &wormhole_prog);
    let (wh_emitter_pda, _)       = find_pda(&[b"emitter"],                   &program_id);
    let (wh_sequence_pda, _)      = find_pda(&[b"Sequence", &wh_emitter_pda], &wormhole_prog);
    let (wh_fee_collector_pda, _) = find_pda(&[b"fee_collector"],             &wormhole_prog);

    let wh_message_key = {
        use sha2::Digest;
        let now_ns = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
        let mut h = sha2::Sha256::new();
        h.update(order_id); h.update(solver_pubkey); h.update(amount_lamports.to_le_bytes());
        h.update(b"solve_jito_and_prove"); h.update(now_ns.to_le_bytes());
        ed25519_dalek::SigningKey::from_bytes(&h.finalize().into())
    };
    let wh_message_pubkey: [u8; 32] = wh_message_key.verifying_key().to_bytes();

    let solver_evm: ethers::signers::LocalWallet = config.evm_private_key.parse()
        .map_err(|e| eyre::eyre!("Invalid evm_private_key: {e}"))?;
    let mut solver_evm_addr = [0u8; 32];
    solver_evm_addr[12..].copy_from_slice(solver_evm.address().as_bytes());

    let clock_sysvar = decode_b58("SysvarC1ock11111111111111111111111111111111")?;
    let rent_sysvar  = decode_b58("SysvarRent111111111111111111111111111111111")?;

    // ix A: CreateATA idempotent — data = [1]
    let create_ata_data: &[u8] = &[1u8];

    // ix B: SystemProgram transfer(solver → ephemeral) — [u32 LE type=2] + [u64 LE lamports]
    let mut sys_transfer_data = Vec::with_capacity(12);
    sys_transfer_data.extend_from_slice(&2u32.to_le_bytes());
    sys_transfer_data.extend_from_slice(&amount_lamports.to_le_bytes());

    // ix C: Jito DepositSol — [u8 disc=14] + [i64 LE lamports]
    let mut jito_data = Vec::with_capacity(9);
    jito_data.push(14u8);
    jito_data.extend_from_slice(&(amount_lamports as i64).to_le_bytes());

    // ix D: prove_stake — disc(8) + order_id(32) + solver_evm(32) + amount(8)
    let mut prove_data = instruction_discriminator("prove_stake").to_vec();
    prove_data.extend_from_slice(&order_id);
    prove_data.extend_from_slice(&solver_evm_addr);
    prove_data.extend_from_slice(&amount_lamports.to_le_bytes());

    // Merged account list:
    // Writable signers:  [0] solver  [1] ephemeral  [2] wh_message
    // Writable non-sig:  [3] stake_pool  [4] reserve_stake  [5] recipient_jitosol_ata
    //                    [6] manager_fee_account  [7] jitosol_mint
    //                    [8] wh_bridge  [9] wh_sequence  [10] wh_fee_collector
    // Readonly non-sig:  [11] recipient  [12] withdraw_auth
    //                    [13] assoc_token_prog  [14] jito_program  [15] token_program
    //                    [16] SYSTEM_PROGRAM  [17] config_pda  [18] wormhole_prog
    //                    [19] wh_emitter  [20] clock  [21] rent  [22] program_id
    let accounts = vec![
        AccountRef { pubkey: solver_pubkey,        is_signer: true,  is_writable: true  }, //  0
        AccountRef { pubkey: ephemeral_pubkey,      is_signer: true,  is_writable: true  }, //  1
        AccountRef { pubkey: wh_message_pubkey,     is_signer: true,  is_writable: true  }, //  2
        AccountRef { pubkey: stake_pool,            is_signer: false, is_writable: true  }, //  3
        AccountRef { pubkey: reserve_stake,         is_signer: false, is_writable: true  }, //  4
        AccountRef { pubkey: recipient_jitosol_ata, is_signer: false, is_writable: true  }, //  5
        AccountRef { pubkey: manager_fee_account,   is_signer: false, is_writable: true  }, //  6
        AccountRef { pubkey: jitosol_mint,          is_signer: false, is_writable: true  }, //  7
        AccountRef { pubkey: wh_bridge_pda,         is_signer: false, is_writable: true  }, //  8
        AccountRef { pubkey: wh_sequence_pda,       is_signer: false, is_writable: true  }, //  9
        AccountRef { pubkey: wh_fee_collector_pda,  is_signer: false, is_writable: true  }, // 10
        AccountRef { pubkey: recipient,             is_signer: false, is_writable: false }, // 11
        AccountRef { pubkey: withdraw_auth,         is_signer: false, is_writable: false }, // 12
        AccountRef { pubkey: assoc_token_prog,      is_signer: false, is_writable: false }, // 13
        AccountRef { pubkey: jito_program,          is_signer: false, is_writable: false }, // 14
        AccountRef { pubkey: token_program,         is_signer: false, is_writable: false }, // 15
        AccountRef { pubkey: SYSTEM_PROGRAM,        is_signer: false, is_writable: false }, // 16
        AccountRef { pubkey: config_pda,            is_signer: false, is_writable: false }, // 17
        AccountRef { pubkey: wormhole_prog,         is_signer: false, is_writable: false }, // 18
        AccountRef { pubkey: wh_emitter_pda,        is_signer: false, is_writable: false }, // 19
        AccountRef { pubkey: clock_sysvar,          is_signer: false, is_writable: false }, // 20
        AccountRef { pubkey: rent_sysvar,           is_signer: false, is_writable: false }, // 21
        AccountRef { pubkey: program_id,            is_signer: false, is_writable: false }, // 22
    ];

    // ix A (CreateATA): prog=13, [funding=0, ata=5, wallet=11, mint=7, sys=16, tok=15]
    let ix_a: &[u8] = &[0, 5, 11, 7, 16, 15];
    // ix B (SystemTransfer): prog=16, [from=0, to=1]
    let ix_b: &[u8] = &[0, 1];
    // ix C (Jito DepositSol): prog=14,
    //   [pool=3, withdraw_auth=12, reserve=4, funding=1, dest=5, mgr_fee=6, referral=5, mint=7, sys=16, tok=15]
    let ix_c: &[u8] = &[3, 12, 4, 1, 5, 6, 5, 7, 16, 15];
    // ix D (prove_stake): prog=22,
    //   [solver=0, config=17, wh_prog=18, wh_bridge=8, wh_msg=2, wh_emitter=19,
    //    wh_seq=9, wh_fee=10, clock=20, rent=21, sys=16]
    let ix_d: &[u8] = &[0, 17, 18, 8, 2, 19, 9, 10, 20, 21, 16];

    let instructions: &[(u8, &[u8], &[u8])] = &[
        (13, ix_a, create_ata_data),
        (16, ix_b, &sys_transfer_data),
        (14, ix_c, &jito_data),
        (22, ix_d, &prove_data),
    ];

    let blockhash = get_latest_blockhash(&config.solana_rpc_url).await?;
    let tx_bytes = build_and_sign_multi_ix(
        &accounts, instructions, blockhash,
        &[&signing_key, &ephemeral_key, &wh_message_key],
    );
    let tx_b64 = base64::engine::general_purpose::STANDARD.encode(&tx_bytes);

    info!(
        order_id = %hex::encode(order_id), amount_lamports, recipient = %recipient_b58,
        "Submitting Jito+prove_stake atomic transaction..."
    );

    let sig = send_and_confirm_transaction(&config.solana_rpc_url, &tx_b64).await?;

    let tx_logs = fetch_transaction_logs(&config.solana_rpc_url, &sig).await;
    let wormhole_sequence = match parse_sequence_from_logs(&tx_logs) {
        Some(seq) => seq,
        None => {
            warn!(signature = %sig, "Could not parse Wormhole sequence — falling back to account read");
            get_account_sequence(&config.solana_rpc_url, &wh_sequence_pda).await.unwrap_or(0).saturating_sub(1)
        }
    };

    info!(
        order_id = %hex::encode(order_id), sig = %sig, wormhole_sequence,
        "Jito+prove_stake confirmed — jitoSOL delivered to recipient atomically."
    );

    Ok((sig, wormhole_sequence, amount_lamports))
}

/// solve_and_jupsol: EVM→Solana bridge + jupSOL vault staking (atomic proof).
///
/// Uses `solve_stake_and_prove` — solver deposits SOL into mock vault,
/// recipient receives jupSOL, Wormhole VAA emitted atomically in same tx.
pub async fn solve_and_jupsol(
    config: &Config,
    order_id: [u8; 32],
    recipient_b58: &str,
    amount_lamports: u64,
) -> Result<(String, u64, u64)> {
    info!(
        order_id = %hex::encode(order_id),
        amount_lamports,
        actual_recipient = %recipient_b58,
        "Starting bridge+jupsol_stake (solve_stake_and_prove)"
    );
    solve_stake_and_prove_inner(config, order_id, recipient_b58, JUPSOL_MINT_B58, amount_lamports).await
}

/// solve_and_kamino: EVM→Solana bridge + kSOL vault staking (atomic proof).
///
/// Uses `solve_stake_and_prove` — solver deposits SOL into mock vault,
/// recipient receives kSOL, Wormhole VAA emitted atomically in same tx.
pub async fn solve_and_kamino(
    config: &Config,
    order_id: [u8; 32],
    recipient_b58: &str,
    amount_lamports: u64,
) -> Result<(String, u64, u64)> {
    info!(
        order_id = %hex::encode(order_id),
        amount_lamports,
        actual_recipient = %recipient_b58,
        "Starting bridge+kamino_stake (solve_stake_and_prove)"
    );
    solve_stake_and_prove_inner(config, order_id, recipient_b58, KSOL_MINT_B58, amount_lamports).await
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
