#!/usr/bin/env ts-node
/**
 * jupsol_stake.ts — Mock Jupiter liquid staking: mint jupSOL tokens to recipient.
 *
 * Called AFTER solve_and_prove has delivered SOL to the SOLVER.
 * Mints mock jupSOL (1:1 with lamports) directly to recipient's ATA.
 * Solver is the mint authority.
 *
 * Usage:
 *   node scripts/dist/jupsol_stake.js <recipient_b58> <amount_lamports> <rpc_url> <solver_private_key>
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
  console.error('Usage: jupsol_stake.js <recipient_b58> <amount_lamports> <rpc_url> <solver_private_key>');
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
  if (process.env.MOCK_JUPSOL_MINT) return process.env.MOCK_JUPSOL_MINT;

  const configFile = path.join(__dirname, 'mock_tokens.json');
  if (!fs.existsSync(configFile)) {
    throw new Error(`mock_tokens.json not found at ${configFile}. Run create_mock_tokens.js first.`);
  }
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (!config.jupSOL) throw new Error('jupSOL mint not found in mock_tokens.json');
  return config.jupSOL;
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
  console.error(`jupSOL Mint: ${mintAddress}`);

  // Get or create recipient's jupSOL ATA
  console.error('Getting/creating recipient jupSOL ATA...');
  const recipientAta = await getOrCreateAssociatedTokenAccount(
    connection,
    solver,
    mint,
    recipient,
  );
  console.error(`Recipient jupSOL ATA: ${recipientAta.address.toBase58()}`);

  // Mint jupSOL 1:1 with lamports to recipient's ATA
  console.error(`Minting ${amountLamports} jupSOL to recipient...`);
  const txSig = await mintTo(
    connection,
    solver,
    mint,
    recipientAta.address,
    solver,
    amountLamports,
  );
  console.error(`jupSOL mint confirmed: ${txSig}`);

  console.log(`TOKEN_MINTED:${amountLamports}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`jupsol_stake.ts error: ${msg}`);
  process.exit(1);
});
