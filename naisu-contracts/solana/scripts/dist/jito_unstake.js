#!/usr/bin/env ts-node
"use strict";
/**
 * jito_unstake.ts — Build an unsigned VersionedTransaction to withdraw jitoSOL → SOL.
 *
 * Builds WithdrawSol instruction manually using Jito's devnet program ID
 * (library hardcodes mainnet SPoo1...).
 * Burns user's jitoSOL, user receives SOL back. Only user needs to sign.
 *
 * Usage:
 *   node scripts/dist/jito_unstake.js <wallet_pubkey> <amount_raw> <rpc_url> <solver_private_key>
 *
 * Outputs on stdout: base64-encoded unsigned VersionedTransaction.
 * The frontend wallet adapter provides the user's signature.
 *
 * All progress/errors go to stderr.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const spl_stake_pool_1 = require("@solana/spl-stake-pool");
// ──────────────────────────────────────────────────────────────────────────────
// Constants — Jito real devnet
// ──────────────────────────────────────────────────────────────────────────────
const JITO_PROGRAM_ID = new web3_js_1.PublicKey('DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib');
const JITO_STAKE_POOL = new web3_js_1.PublicKey('JitoY5pcAxWX6iyP2QdFwTznGb8A99PRCUCVVxB46WZ');
const JITO_SOL_MINT = new web3_js_1.PublicKey('J1tos8mqbhdGcF3pgj4PCKyVjzWSURcpLZU7pPGHxSYi');
// ──────────────────────────────────────────────────────────────────────────────
// Arguments
// ──────────────────────────────────────────────────────────────────────────────
const [, , walletB58, amountRawStr, rpcUrl, privateKeyArg] = process.argv;
if (!walletB58 || !amountRawStr || !rpcUrl || !privateKeyArg) {
    console.error('Usage: jito_unstake.js <wallet_pubkey> <amount_raw> <rpc_url> <solver_private_key>');
    process.exit(1);
}
const amountRaw = Number(amountRawStr); // jitoSOL raw units (pool tokens)
// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function loadKeypair(key) {
    const k = key.trim();
    if (k.length === 88) {
        try {
            const bytes = Buffer.from(require('bs58').decode(k));
            if (bytes.length === 64)
                return web3_js_1.Keypair.fromSecretKey(bytes);
        }
        catch { }
    }
    const hex = k.replace(/^0x/, '');
    const bytes = Buffer.from(hex, 'hex');
    if (bytes.length === 64)
        return web3_js_1.Keypair.fromSecretKey(bytes);
    if (bytes.length === 32)
        return web3_js_1.Keypair.fromSeed(bytes);
    throw new Error(`Invalid private key length: ${bytes.length} bytes`);
}
/** Build WithdrawSol instruction manually using the given programId. */
function buildWithdrawSolIx(params) {
    // WithdrawSol instruction data: discriminator=16 (u8) + poolTokens (ns64 LE) = 9 bytes
    const data = Buffer.allocUnsafe(9);
    data.writeUInt8(16, 0);
    data.writeBigInt64LE(BigInt(params.poolTokens), 1);
    const keys = [
        { pubkey: params.stakePool, isSigner: false, isWritable: true },
        { pubkey: params.withdrawAuthority, isSigner: false, isWritable: false },
        { pubkey: params.sourceTransferAuthority, isSigner: true, isWritable: false },
        { pubkey: params.sourcePoolAccount, isSigner: false, isWritable: true },
        { pubkey: params.reserveStake, isSigner: false, isWritable: true },
        { pubkey: params.destinationSystemAccount, isSigner: false, isWritable: true },
        { pubkey: params.managerFeeAccount, isSigner: false, isWritable: true },
        { pubkey: params.poolMint, isSigner: false, isWritable: true },
        { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: spl_token_1.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
    if (params.solWithdrawAuthority) {
        keys.push({ pubkey: params.solWithdrawAuthority, isSigner: true, isWritable: false });
    }
    return new web3_js_1.TransactionInstruction({ programId: params.programId, keys, data });
}
// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
    const connection = new web3_js_1.Connection(rpcUrl, 'confirmed');
    loadKeypair(privateKeyArg); // validate only — solver doesn't sign unstake tx
    const userWallet = new web3_js_1.PublicKey(walletB58);
    console.error(`Wallet:     ${userWallet.toBase58()}`);
    console.error(`Amount raw: ${amountRaw} jitoSOL pool tokens`);
    console.error(`Pool:       ${JITO_STAKE_POOL.toBase58()}`);
    // Fetch stake pool data
    const stakePoolAccount = await (0, spl_stake_pool_1.getStakePoolAccount)(connection, JITO_STAKE_POOL);
    const pool = stakePoolAccount.account.data;
    console.error(`Reserve:   ${pool.reserveStake.toBase58()}`);
    // Derive withdraw authority PDA using Jito's devnet program ID
    const [withdrawAuthority] = await web3_js_1.PublicKey.findProgramAddress([JITO_STAKE_POOL.toBuffer(), Buffer.from('withdraw')], JITO_PROGRAM_ID);
    console.error(`Withdraw auth: ${withdrawAuthority.toBase58()}`);
    // User's jitoSOL ATA
    const userJitoSolAta = (0, spl_token_1.getAssociatedTokenAddressSync)(JITO_SOL_MINT, userWallet);
    console.error(`User jitoSOL ATA: ${userJitoSolAta.toBase58()}`);
    // Ephemeral transfer authority keypair (signs the Approve instruction)
    const userTransferAuthority = web3_js_1.Keypair.generate();
    const instructions = [
        // Approve: delegate amountRaw jitoSOL tokens to ephemeral authority
        (0, spl_token_1.createApproveInstruction)(userJitoSolAta, userTransferAuthority.publicKey, userWallet, amountRaw),
        // WithdrawSol: burn poolTokens from sourcePoolAccount, send SOL to user
        buildWithdrawSolIx({
            programId: JITO_PROGRAM_ID,
            stakePool: JITO_STAKE_POOL,
            withdrawAuthority,
            sourceTransferAuthority: userTransferAuthority.publicKey,
            sourcePoolAccount: userJitoSolAta,
            reserveStake: pool.reserveStake,
            destinationSystemAccount: userWallet,
            managerFeeAccount: pool.managerFeeAccount,
            poolMint: pool.poolMint,
            poolTokens: amountRaw,
            solWithdrawAuthority: pool.solWithdrawAuthority ?? undefined,
        }),
    ];
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const message = new web3_js_1.TransactionMessage({
        payerKey: userWallet,
        recentBlockhash: blockhash,
        instructions,
    }).compileToV0Message();
    const tx = new web3_js_1.VersionedTransaction(message);
    // Pre-sign with ephemeral transfer authority (not user — user signs in browser)
    tx.sign([userTransferAuthority]);
    const serialized = Buffer.from(tx.serialize());
    console.error('jitoSOL WithdrawSol tx built. Awaiting user signature.');
    console.log(serialized.toString('base64'));
}
main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`jito_unstake.ts error: ${msg}`);
    process.exit(1);
});
