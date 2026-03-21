#!/usr/bin/env ts-node
/**
 * kamino_stake.ts — Mock Kamino lending: mint kSOL tokens to recipient.
 *
 * Called AFTER solve_and_prove has delivered SOL to the SOLVER.
 * Mints mock kSOL (1:1 with lamports) directly to recipient's ATA.
 * Solver is the mint authority.
 *
 * Usage:
 *   node scripts/dist/kamino_stake.js <recipient_b58> <amount_lamports> <rpc_url> <solver_private_key>
 *
 * Outputs on stdout (for Rust caller to parse):
 *   TOKEN_MINTED:<amount>
 *
 * Reads mint address from scripts/mock_tokens.json (created by create_mock_tokens.js).
 */

import {
  Connection,
  Keypair,
  PublicKey,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────────────────────
// Arguments
// ──────────────────────────────────────────────────────────────────────────────

const [, , recipientB58, amountLamportsStr, rpcUrl, privateKeyArg] = process.argv;

if (!recipientB58 || !amountLamportsStr || !rpcUrl || !privateKeyArg) {
  console.error('Usage: kamino_stake.js <recipient_b58> <amount_lamports> <rpc_url> <solver_private_key>');
  process.exit(1);
}

const amountLamports = BigInt(amountLamportsStr);

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function loadKeypair(key: string): Keypair {
  const k = key.trim();
  if (k.length === 88) {
    try {
      const bytes = Buffer.from(require('bs58').decode(k));
      if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
    } catch {}
  }
  const hex = k.replace(/^0x/, '');
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error(`Invalid private key length: ${bytes.length} bytes`);
}

function loadMintAddress(): string {
  if (process.env.MOCK_KSOL_MINT) return process.env.MOCK_KSOL_MINT;

  const configFile = path.join(__dirname, 'mock_tokens.json');
  if (!fs.existsSync(configFile)) {
    throw new Error(`mock_tokens.json not found at ${configFile}. Run create_mock_tokens.js first.`);
  }
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (!config.kSOL) throw new Error('kSOL mint not found in mock_tokens.json');
  return config.kSOL;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  const connection = new Connection(rpcUrl, 'confirmed');
  const solver = loadKeypair(privateKeyArg);
  const recipient = new PublicKey(recipientB58);
  const mintAddress = loadMintAddress();
  const mint = new PublicKey(mintAddress);

  console.error(`Solver:    ${solver.publicKey.toBase58()}`);
  console.error(`Recipient: ${recipient.toBase58()}`);
  console.error(`Amount:    ${amountLamports} lamports`);
  console.error(`kSOL Mint: ${mintAddress}`);

  // Get or create recipient's kSOL ATA
  console.error('Getting/creating recipient kSOL ATA...');
  const recipientAta = await getOrCreateAssociatedTokenAccount(
    connection,
    solver,
    mint,
    recipient,
  );
  console.error(`Recipient kSOL ATA: ${recipientAta.address.toBase58()}`);

  // Mint kSOL 1:1 with lamports to recipient's ATA
  console.error(`Minting ${amountLamports} kSOL to recipient...`);
  const txSig = await mintTo(
    connection,
    solver,
    mint,
    recipientAta.address,
    solver,
    amountLamports,
  );
  console.error(`kSOL mint confirmed: ${txSig}`);

  console.log(`TOKEN_MINTED:${amountLamports}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`kamino_stake.ts error: ${msg}`);
  process.exit(1);
});
