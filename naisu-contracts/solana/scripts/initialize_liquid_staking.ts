#!/usr/bin/env ts-node
/**
 * initialize_liquid_staking.ts — One-time setup for mock-liquid-staking pool.
 *
 * Initializes the StakingPool PDA with:
 *   - authority = solver keypair (same one used by naisu1-solver)
 *   - underlying_mint = wSOL (So11111111111111111111111111111111111111112)
 *   - lst_mint = new PDA [b"lst_mint", pool]
 *   - wsol_vault = new PDA [b"wsol_vault", pool]
 *   - cooldown_slots = 0 (no cooldown for testnet)
 *   - yield_bps_per_epoch = 100 (1% mock yield)
 *
 * After running, outputs:
 *   POOL_AUTHORITY:<base58_pubkey>
 *   POOL_PDA:<base58_address>
 *   LST_MINT:<base58_address>
 *
 * Usage:
 *   node scripts/dist/initialize_liquid_staking.js <rpc_url> <solver_private_key> <liquid_staking_program_id>
 *
 * Then update naisu1-solver/.env:
 *   LIQUID_STAKING_POOL_AUTHORITY=<POOL_AUTHORITY value>
 *   ENABLE_LIQUID_STAKE=true
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha2';
import { utils as anchorUtils } from '@coral-xyz/anchor';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bbn');

// ──────────────────────────────────────────────────────────────────────────────
// Arguments
// ──────────────────────────────────────────────────────────────────────────────

const [, , rpcUrl, privateKeyArg, liquidStakingProgramIdStr] = process.argv;

if (!rpcUrl || !privateKeyArg || !liquidStakingProgramIdStr) {
  console.error('Usage: initialize_liquid_staking.js <rpc_url> <solver_private_key> <liquid_staking_program_id>');
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function anchorDisc(name: string): Buffer {
  return Buffer.from(sha256(`global:${name}`)).slice(0, 8);
}

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

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  const connection = new Connection(rpcUrl, 'confirmed');
  const liquidStakingProgram = new PublicKey(liquidStakingProgramIdStr);
  const authority = loadKeypair(privateKeyArg);

  console.error(`Authority (pool owner): ${authority.publicKey.toBase58()}`);
  console.error(`Liquid Staking Program: ${liquidStakingProgram.toBase58()}`);
  console.error(`Underlying mint (wSOL): ${NATIVE_MINT.toBase58()}`);

  // ── Derive PDAs ──────────────────────────────────────────────────────────────
  const [pool, poolBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), authority.publicKey.toBytes()],
    liquidStakingProgram,
  );
  const [lstMint, lstMintBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('lst_mint'), pool.toBytes()],
    liquidStakingProgram,
  );
  const [wsolVault, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('wsol_vault'), pool.toBytes()],
    liquidStakingProgram,
  );

  console.error(`Pool PDA:     ${pool.toBase58()} (bump ${poolBump})`);
  console.error(`LST Mint PDA: ${lstMint.toBase58()} (bump ${lstMintBump})`);
  console.error(`wSOL Vault:   ${wsolVault.toBase58()} (bump ${vaultBump})`);

  // ── Check if already initialized ─────────────────────────────────────────────
  const existing = await connection.getAccountInfo(pool, 'confirmed');
  if (existing) {
    console.error(`Pool already initialized (${existing.data.length} bytes). Skipping.`);
    console.log(`POOL_AUTHORITY:${authority.publicKey.toBase58()}`);
    console.log(`POOL_PDA:${pool.toBase58()}`);
    console.log(`LST_MINT:${lstMint.toBase58()}`);
    return;
  }

  // ── Build initialize instruction ─────────────────────────────────────────────
  // mock_liquid_staking::initialize(cooldown_slots: u64, yield_bps_per_epoch: u16)
  // Borsh: disc(8) + u64(8) + u16(2) = 18 bytes
  const disc = anchorDisc('initialize');
  const data = Buffer.alloc(18);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(0), 8);   // cooldown_slots = 0 (no cooldown on testnet)
  data.writeUInt16LE(100, 16);            // yield_bps_per_epoch = 100 (1% mock yield)

  // Accounts per Initialize struct:
  //   authority      (mut, signer)
  //   underlying_mint (read-only — wSOL)
  //   pool           (mut, init, PDA seeds=[b"pool", authority])
  //   lst_mint       (mut, init, PDA seeds=[b"lst_mint", pool])
  //   wsol_vault     (mut, init, PDA seeds=[b"wsol_vault", pool])
  //   token_program
  //   associated_token_program
  //   system_program
  //   rent
  const initIx = new TransactionInstruction({
    programId: liquidStakingProgram,
    keys: [
      { pubkey: authority.publicKey,       isSigner: true,  isWritable: true  },
      { pubkey: NATIVE_MINT,               isSigner: false, isWritable: false },
      { pubkey: pool,                      isSigner: false, isWritable: true  },
      { pubkey: lstMint,                   isSigner: false, isWritable: true  },
      { pubkey: wsolVault,                 isSigner: false, isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID,          isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY,        isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction();
  tx.add(initIx);

  console.error('Submitting initialize transaction...');
  const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: 'confirmed' });
  console.error(`Initialize confirmed: ${sig}`);
  console.error(`Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);

  // ── Output for .env setup ──────────────────────────────────────────────────
  console.log(`POOL_AUTHORITY:${authority.publicKey.toBase58()}`);
  console.log(`POOL_PDA:${pool.toBase58()}`);
  console.log(`LST_MINT:${lstMint.toBase58()}`);

  console.error('\n✓ Done! Add to naisu1-solver/.env:');
  console.error(`  LIQUID_STAKING_POOL_AUTHORITY=${authority.publicKey.toBase58()}`);
  console.error(`  ENABLE_LIQUID_STAKE=true`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`initialize_liquid_staking.ts error: ${msg}`);
  process.exit(1);
});
