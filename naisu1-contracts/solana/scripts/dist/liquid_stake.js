"use strict";
/**
 * liquid_stake.js — Deposits SOL into mock-staking pool on behalf of recipient.
 *
 * Uses mock_staking::deposit(lamports_in):
 *   - depositor = solver (pays SOL)
 *   - staker    = recipient (receives staking credit in stake_account PDA)
 *
 * Usage:
 *   node liquid_stake.js <recipient_b58> <amount_lamports> <rpc_url>
 *     <solver_private_key> <liquid_staking_program_id> <pool_authority_b58>
 *
 * Outputs on stdout: LST_MINTED:<amount>
 * All progress/errors go to stderr.
 */

const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } = require('@solana/web3.js');
const crypto = require('crypto');

const [,, recipientB58, amountLamportsStr, rpcUrl, privateKeyArg, liquidStakingProgramIdStr] = process.argv;

if (!recipientB58 || !amountLamportsStr || !rpcUrl || !privateKeyArg || !liquidStakingProgramIdStr) {
  console.error('Usage: liquid_stake.js <recipient_b58> <amount_lamports> <rpc_url> <solver_private_key> <liquid_staking_program_id> <pool_authority_b58>');
  process.exit(1);
}

const amountLamports = BigInt(amountLamportsStr);

function anchorDisc(name) {
  return crypto.createHash('sha256').update('global:' + name).digest().slice(0, 8);
}

function loadKeypair(key) {
  const k = key.trim();
  if (k.length >= 80) {
    try {
      const bs58 = require('bs58');
      const bytes = bs58.default ? bs58.default.decode(k) : bs58.decode(k);
      if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
    } catch {}
  }
  const hex = k.replace(/^0x/, '');
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error('Invalid private key length: ' + bytes.length);
}

async function main() {
  const connection = new Connection(rpcUrl, 'confirmed');
  const liquidStakingProgram = new PublicKey(liquidStakingProgramIdStr);
  const recipient = new PublicKey(recipientB58);
  const solver = loadKeypair(privateKeyArg);

  console.error('Solver (depositor):', solver.publicKey.toBase58());
  console.error('Recipient (staker):', recipient.toBase58());
  console.error('Amount:', amountLamports.toString(), 'lamports');
  console.error('Mock Staking Program:', liquidStakingProgram.toBase58());

  const [stakePoolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('stake_pool')],
    liquidStakingProgram,
  );
  const [stakeAccountPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('stake_account'), recipient.toBytes()],
    liquidStakingProgram,
  );
  console.error('StakePool PDA:   ', stakePoolPDA.toBase58());
  console.error('StakeAccount PDA:', stakeAccountPDA.toBase58());

  const poolInfo = await connection.getAccountInfo(stakePoolPDA, 'confirmed');
  if (!poolInfo) {
    console.error('ERROR: Staking pool not initialized. Run init_stake_pool.js first.');
    process.exit(1);
  }

  // deposit(lamports_in): disc(8) + u64(8) = 16 bytes
  const disc = anchorDisc('deposit');
  const data = Buffer.alloc(16);
  disc.copy(data, 0);
  data.writeBigUInt64LE(amountLamports, 8);

  const ix = new TransactionInstruction({
    programId: liquidStakingProgram,
    keys: [
      { pubkey: solver.publicKey, isSigner: true,  isWritable: true  }, // depositor
      { pubkey: recipient,        isSigner: false, isWritable: true  }, // staker
      { pubkey: stakePoolPDA,     isSigner: false, isWritable: true  }, // stake_pool
      { pubkey: stakeAccountPDA,  isSigner: false, isWritable: true  }, // stake_account
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  console.error('Submitting deposit transaction...');
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [solver], { commitment: 'confirmed' });
  console.error('Deposit confirmed:', sig);
  console.error('Explorer: https://explorer.solana.com/tx/' + sig + '?cluster=devnet');

  console.log('LST_MINTED:' + amountLamports.toString());
}

main().catch(err => {
  console.error('liquid_stake.js error:', err.message || err);
  process.exit(1);
});
