#!/usr/bin/env ts-node
/**
 * jito_stake.ts — Deposit SOL into Jito real devnet stake pool, receive jitoSOL.
 *
 * Uses @solana/spl-stake-pool to fetch pool data, then builds DepositSol instruction
 * manually using Jito's devnet program ID (library hardcodes mainnet SPoo1...).
 * Solver deposits SOL → gets jitoSOL in solver ATA → transfers jitoSOL to recipient.
 *
 * Usage:
 *   node scripts/dist/jito_stake.js <recipient_b58> <amount_lamports> <rpc_url> <solver_private_key>
 *
 * Outputs on stdout (for Rust caller to parse):
 *   TOKEN_MINTED:<amount_raw>
 *
 * All progress/errors go to stderr.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { getStakePoolAccount } from '@solana/spl-stake-pool';

// ──────────────────────────────────────────────────────────────────────────────
// Constants — Jito real devnet
// ──────────────────────────────────────────────────────────────────────────────

const JITO_PROGRAM_ID  = new PublicKey('DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib');
const JITO_STAKE_POOL  = new PublicKey('JitoY5pcAxWX6iyP2QdFwTznGb8A99PRCUCVVxB46WZ');
const JITO_SOL_MINT    = new PublicKey('J1tos8mqbhdGcF3pgj4PCKyVjzWSURcpLZU7pPGHxSYi');

// ──────────────────────────────────────────────────────────────────────────────
// Arguments
// ──────────────────────────────────────────────────────────────────────────────

const [, , recipientB58, amountLamportsStr, rpcUrl, privateKeyArg] = process.argv;

if (!recipientB58 || !amountLamportsStr || !rpcUrl || !privateKeyArg) {
  console.error('Usage: jito_stake.js <recipient_b58> <amount_lamports> <rpc_url> <solver_private_key>');
  process.exit(1);
}

const amountLamports = Number(amountLamportsStr);

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

/** Build DepositSol instruction manually using the given programId. */
function buildDepositSolIx(params: {
  programId: PublicKey;
  stakePool: PublicKey;
  withdrawAuthority: PublicKey;
  reserveStake: PublicKey;
  fundingAccount: PublicKey;
  destinationPoolAccount: PublicKey;
  managerFeeAccount: PublicKey;
  referralPoolAccount: PublicKey;
  poolMint: PublicKey;
  lamports: number;
  depositAuthority?: PublicKey;
}): TransactionInstruction {
  // DepositSol instruction data: discriminator=14 (u8) + lamports (ns64 LE) = 9 bytes
  const data = Buffer.allocUnsafe(9);
  data.writeUInt8(14, 0);
  data.writeBigInt64LE(BigInt(params.lamports), 1);

  const keys = [
    { pubkey: params.stakePool,             isSigner: false, isWritable: true  },
    { pubkey: params.withdrawAuthority,     isSigner: false, isWritable: false },
    { pubkey: params.reserveStake,          isSigner: false, isWritable: true  },
    { pubkey: params.fundingAccount,        isSigner: true,  isWritable: true  },
    { pubkey: params.destinationPoolAccount,isSigner: false, isWritable: true  },
    { pubkey: params.managerFeeAccount,     isSigner: false, isWritable: true  },
    { pubkey: params.referralPoolAccount,   isSigner: false, isWritable: true  },
    { pubkey: params.poolMint,              isSigner: false, isWritable: true  },
    { pubkey: SystemProgram.programId,      isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID,             isSigner: false, isWritable: false },
  ];
  if (params.depositAuthority) {
    keys.push({ pubkey: params.depositAuthority, isSigner: true, isWritable: false });
  }

  return new TransactionInstruction({ programId: params.programId, keys, data });
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  const connection = new Connection(rpcUrl, 'confirmed');
  const solver     = loadKeypair(privateKeyArg);
  const recipient  = new PublicKey(recipientB58);

  console.error(`Solver:    ${solver.publicKey.toBase58()}`);
  console.error(`Recipient: ${recipient.toBase58()}`);
  console.error(`Amount:    ${amountLamports} lamports`);
  console.error(`Pool:      ${JITO_STAKE_POOL.toBase58()}`);

  // Fetch stake pool account data
  const stakePoolAccount = await getStakePoolAccount(connection, JITO_STAKE_POOL);
  const pool = stakePoolAccount.account.data;
  console.error(`Pool mint: ${pool.poolMint.toBase58()}`);
  console.error(`Reserve:   ${pool.reserveStake.toBase58()}`);

  // Derive withdraw authority PDA using Jito's devnet program ID
  const [withdrawAuthority] = await PublicKey.findProgramAddress(
    [JITO_STAKE_POOL.toBuffer(), Buffer.from('withdraw')],
    JITO_PROGRAM_ID,
  );
  console.error(`Withdraw auth: ${withdrawAuthority.toBase58()}`);

  // Ensure solver has a jitoSOL ATA (destination for the deposit)
  const solverAta = await getOrCreateAssociatedTokenAccount(
    connection,
    solver,
    JITO_SOL_MINT,
    solver.publicKey,
  );
  console.error(`Solver jitoSOL ATA: ${solverAta.address.toBase58()}`);
  const balanceBefore = BigInt(solverAta.amount.toString());

  // Ephemeral keypair to fund the deposit (SPL stake pool pattern)
  const ephemeral = Keypair.generate();

  const instructions = [
    // Transfer SOL from solver → ephemeral (funding account for DepositSol)
    SystemProgram.transfer({
      fromPubkey: solver.publicKey,
      toPubkey:   ephemeral.publicKey,
      lamports:   amountLamports,
    }),
    // DepositSol: ephemeral → pool reserve, mint jitoSOL to solver ATA
    buildDepositSolIx({
      programId:              JITO_PROGRAM_ID,
      stakePool:              JITO_STAKE_POOL,
      withdrawAuthority,
      reserveStake:           pool.reserveStake,
      fundingAccount:         ephemeral.publicKey,
      destinationPoolAccount: solverAta.address,
      managerFeeAccount:      pool.managerFeeAccount,
      referralPoolAccount:    solverAta.address, // self-referral
      poolMint:               pool.poolMint,
      lamports:               amountLamports,
      depositAuthority:       pool.solDepositAuthority ?? undefined,
    }),
  ];

  const depositTx = new Transaction().add(...instructions);
  const depositSig = await sendAndConfirmTransaction(
    connection,
    depositTx,
    [solver, ephemeral],
    { commitment: 'confirmed' },
  );
  console.error(`Deposit confirmed: ${depositSig}`);

  // How many jitoSOL were minted?
  const newBalance = await connection.getTokenAccountBalance(solverAta.address, 'confirmed');
  const balanceAfter = BigInt(newBalance.value.amount);
  const jitoSolMinted = balanceAfter - balanceBefore;
  console.error(`jitoSOL minted: ${jitoSolMinted}`);

  // Ensure recipient has a jitoSOL ATA
  const recipientAta = await getOrCreateAssociatedTokenAccount(
    connection,
    solver,
    JITO_SOL_MINT,
    recipient,
  );
  console.error(`Recipient jitoSOL ATA: ${recipientAta.address.toBase58()}`);

  // Transfer jitoSOL from solver → recipient
  const transferTx = new Transaction().add(
    createTransferInstruction(
      solverAta.address,
      recipientAta.address,
      solver.publicKey,
      jitoSolMinted,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );
  const transferSig = await sendAndConfirmTransaction(connection, transferTx, [solver], {
    commitment: 'confirmed',
  });
  console.error(`Transfer confirmed: ${transferSig}`);

  console.log(`TOKEN_MINTED:${jitoSolMinted}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`jito_stake.ts error: ${msg}`);
  process.exit(1);
});
