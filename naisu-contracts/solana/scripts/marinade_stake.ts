#!/usr/bin/env ts-node
/**
 * marinade_stake.ts — Liquid staking via Marinade Finance (devnet).
 *
 * Called AFTER solve_and_prove has delivered SOL to the SOLVER.
 * Deposits that SOL into Marinade → gets mSOL → transfers mSOL to recipient.
 *
 * Flow:
 *   1. Solver deposits SOL into Marinade → mSOL minted to solver's mSOL ATA
 *   2. Solver transfers exactly that mSOL to recipient's mSOL ATA (creating ATA if needed)
 *
 * Net effect:
 *   - Solver: SOL out, mSOL in (then mSOL transferred out) → net SOL out, covered by ETH from EVM settle
 *   - Recipient: receives mSOL tokens, NOT raw SOL
 *
 * Usage:
 *   node scripts/dist/marinade_stake.js <recipient_b58> <amount_lamports> <rpc_url> <solver_private_key_hex_or_b58>
 *
 * Outputs on stdout (for the Rust caller to parse):
 *   MSOL_MINTED:<amount>
 *
 * All progress/errors go to stderr.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { Marinade, MarinadeConfig } from '@marinade.finance/marinade-ts-sdk';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from '@solana/spl-token';
import BN from 'bn.js';

// ──────────────────────────────────────────────────────────────────────────────
// Arguments
// ──────────────────────────────────────────────────────────────────────────────

const [, , recipientB58, amountLamportsStr, rpcUrl, privateKeyArg] = process.argv;

if (!recipientB58 || !amountLamportsStr || !rpcUrl || !privateKeyArg) {
  console.error('Usage: marinade_stake.js <recipient_b58> <amount_lamports> <rpc_url> <solver_private_key>');
  process.exit(1);
}

const amountLamports = BigInt(amountLamportsStr);

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Load keypair from hex or base58 private key string */
function loadKeypair(key: string): Keypair {
  const k = key.trim();
  // Try base58 (88-char keypair)
  if (k.length === 88) {
    try {
      const bytes = Buffer.from(require('bs58').decode(k));
      if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
    } catch {}
  }
  // Hex (64 or 128 hex chars = 32 or 64 bytes)
  const hex = k.replace(/^0x/, '');
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error(`Invalid private key length: ${bytes.length} bytes`);
}

/** Read a token account's balance (u64 at offset 64 in token account layout) */
async function getTokenBalance(connection: Connection, ata: PublicKey): Promise<bigint> {
  try {
    const info = await connection.getAccountInfo(ata, 'confirmed');
    if (!info || info.data.length < 72) return BigInt(0);
    return info.data.readBigUInt64LE(64);
  } catch {
    return BigInt(0);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  const connection = new Connection(rpcUrl, 'confirmed');
  const solver = loadKeypair(privateKeyArg);
  const recipient = new PublicKey(recipientB58);

  console.error(`Solver:    ${solver.publicKey.toBase58()}`);
  console.error(`Recipient: ${recipient.toBase58()}`);
  console.error(`Amount:    ${amountLamports} lamports`);

  // ── Init Marinade ────────────────────────────────────────────────────────────
  // SDK auto-detects devnet from the RPC URL
  const marinadeConfig = new MarinadeConfig({
    connection,
    publicKey: solver.publicKey,
  });
  const marinade = new Marinade(marinadeConfig);

  // ── Get mSOL mint from Marinade state ────────────────────────────────────────
  console.error('Fetching Marinade state...');
  const marinadeState = await marinade.getMarinadeState();
  const msolMint = marinadeState.mSolMintAddress;
  console.error(`mSOL Mint: ${msolMint.toBase58()}`);

  // ── mSOL ATA for solver (Marinade will mint here) ────────────────────────────
  const solverMsolAta = await getAssociatedTokenAddress(msolMint, solver.publicKey);
  console.error(`Solver mSOL ATA: ${solverMsolAta.toBase58()}`);

  // mSOL balance before deposit (to calculate exactly how many were minted)
  const msolBefore = await getTokenBalance(connection, solverMsolAta);
  console.error(`Solver mSOL balance before deposit: ${msolBefore}`);

  // ── Step 1: Deposit SOL → mSOL via Marinade ──────────────────────────────────
  console.error(`Depositing ${amountLamports} lamports into Marinade...`);
  const { transaction: depositTx, associatedMSolTokenAccountAddress } = await marinade.deposit(
    new BN(amountLamports.toString()),
  );

  console.error(`Marinade mSOL ATA: ${associatedMSolTokenAccountAddress.toBase58()}`);

  // Fetch blockhash and set fee payer before signing
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  depositTx.recentBlockhash = blockhash;
  depositTx.feePayer = solver.publicKey;

  const depositSig = await sendAndConfirmTransaction(connection, depositTx, [solver], {
    commitment: 'confirmed',
  });
  console.error(`Marinade deposit confirmed: ${depositSig}`);

  // ── Calculate exactly how many mSOL were minted ──────────────────────────────
  const msolAfter = await getTokenBalance(connection, associatedMSolTokenAccountAddress);
  const msolMinted = msolAfter - msolBefore;
  console.error(`Solver mSOL after deposit: ${msolAfter} (minted this call: ${msolMinted})`);

  if (msolMinted <= BigInt(0)) {
    console.error('ERROR: No mSOL was minted — deposit may have failed silently.');
    process.exit(1);
  }

  // ── Step 2: Transfer mSOL from solver to recipient ──────────────────────────
  const recipientMsolAta = await getAssociatedTokenAddress(msolMint, recipient);
  console.error(`Recipient mSOL ATA: ${recipientMsolAta.toBase58()}`);

  const transferTx = new Transaction();

  // Create recipient's mSOL ATA if it doesn't exist
  const recipientAtaInfo = await connection.getAccountInfo(recipientMsolAta, 'confirmed');
  if (!recipientAtaInfo) {
    console.error('Creating recipient mSOL ATA...');
    transferTx.add(
      createAssociatedTokenAccountInstruction(solver.publicKey, recipientMsolAta, recipient, msolMint),
    );
  }

  // SPL Token transfer: solver's mSOL ATA → recipient's mSOL ATA
  transferTx.add(
    createTransferInstruction(associatedMSolTokenAccountAddress, recipientMsolAta, solver.publicKey, msolMinted),
  );

  console.error(`Transferring ${msolMinted} mSOL to recipient ${recipientB58}...`);
  const transferSig = await sendAndConfirmTransaction(connection, transferTx, [solver], {
    commitment: 'confirmed',
  });
  console.error(`mSOL transfer confirmed: ${transferSig}`);

  // ── Final verification ───────────────────────────────────────────────────────
  const finalRecipientMsol = await getTokenBalance(connection, recipientMsolAta);
  console.error(`Recipient final mSOL balance: ${finalRecipientMsol}`);

  // Output mSOL amount minted (and delivered) to stdout for Rust to parse
  console.log(`MSOL_MINTED:${msolMinted}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`marinade_stake.ts error: ${msg}`);
  process.exit(1);
});
