#!/usr/bin/env ts-node
"use strict";
/**
 * orca_swap.ts — Swap SOL → USDC via Orca Whirlpool on Solana devnet.
 *
 * Called AFTER solve_and_prove has delivered SOL to the SOLVER.
 * Swaps that SOL to USDC via Orca Whirlpool → transfers USDC to recipient.
 *
 * Flow:
 *   1. Solver wraps SOL to wSOL (if needed) and swaps to USDC via Orca Whirlpool
 *   2. Solver transfers USDC to recipient's USDC ATA (creating ATA if needed)
 *
 * Net effect:
 *   - Solver: SOL out, USDC in (then USDC transferred out) → net SOL out, covered by ETH from EVM settle
 *   - Recipient: receives USDC tokens, NOT raw SOL
 *
 * Usage:
 *   node scripts/dist/orca_swap.js <recipient_b58> <amount_lamports> <rpc_url> <solver_private_key_hex_or_b58>
 *
 * Outputs on stdout (for the Rust caller to parse):
 *   USDC_SWAPPED:<amount_in_usdc_base_units>
 *   or on pool unavailability:
 *   SWAP_FALLBACK:sol
 *
 * All progress/errors go to stderr.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const whirlpools_sdk_1 = require("@orca-so/whirlpools-sdk");
const anchor_1 = require("@coral-xyz/anchor");
const anchor_2 = require("@coral-xyz/anchor");
const bn_js_1 = __importDefault(require("bn.js"));
// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────
const TOKEN_PROGRAM_ID = new web3_js_1.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new web3_js_1.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bbn');
// USDC devnet mint (standard devnet USDC faucet address)
const USDC_MINT = new web3_js_1.PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
// Wrapped SOL mint
const WSOL_MINT = new web3_js_1.PublicKey('So11111111111111111111111111111111111111112');
// Orca Whirlpool tick spacing for SOL/USDC pool on devnet (64 is most common)
const TICK_SPACING = 64;
// Slippage tolerance: 1% = 100 bps
const SLIPPAGE_BPS = 100;
// ──────────────────────────────────────────────────────────────────────────────
// Arguments
// ──────────────────────────────────────────────────────────────────────────────
const [, , recipientB58, amountLamportsStr, rpcUrl, privateKeyArg] = process.argv;
if (!recipientB58 || !amountLamportsStr || !rpcUrl || !privateKeyArg) {
    console.error('Usage: orca_swap.js <recipient_b58> <amount_lamports> <rpc_url> <solver_private_key>');
    process.exit(1);
}
const amountLamports = BigInt(amountLamportsStr);
// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
/** Load keypair from hex or base58 private key string */
function loadKeypair(key) {
    const k = key.trim();
    // Try base58 (88-char keypair)
    if (k.length === 88) {
        try {
            const bytes = Buffer.from(require('bs58').decode(k));
            if (bytes.length === 64)
                return web3_js_1.Keypair.fromSecretKey(bytes);
        }
        catch { }
    }
    // Hex (64 or 128 hex chars = 32 or 64 bytes)
    const hex = k.replace(/^0x/, '');
    const bytes = Buffer.from(hex, 'hex');
    if (bytes.length === 64)
        return web3_js_1.Keypair.fromSecretKey(bytes);
    if (bytes.length === 32)
        return web3_js_1.Keypair.fromSeed(bytes);
    throw new Error(`Invalid private key length: ${bytes.length} bytes`);
}
/** Derive Associated Token Account address */
function getAta(owner, mint) {
    return anchor_2.utils.token.associatedAddress({ mint, owner });
}
/** Build create-ATA instruction (idempotent — uses createIdempotent if available, else standard) */
function buildCreateAtaIx(payer, ata, owner, mint) {
    return new web3_js_1.TransactionInstruction({
        programId: ASSOCIATED_TOKEN_PROGRAM_ID,
        keys: [
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: ata, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: false, isWritable: false },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: web3_js_1.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: Buffer.alloc(0),
    });
}
/** Read a token account's balance (u64 at offset 64 in SPL token account layout) */
async function getTokenBalance(connection, ata) {
    try {
        const info = await connection.getAccountInfo(ata, 'confirmed');
        if (!info || info.data.length < 72)
            return BigInt(0);
        return info.data.readBigUInt64LE(64);
    }
    catch {
        return BigInt(0);
    }
}
// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
    const connection = new web3_js_1.Connection(rpcUrl, 'confirmed');
    const solver = loadKeypair(privateKeyArg);
    const recipient = new web3_js_1.PublicKey(recipientB58);
    console.error(`Solver:    ${solver.publicKey.toBase58()}`);
    console.error(`Recipient: ${recipient.toBase58()}`);
    console.error(`Amount:    ${amountLamports} lamports (${Number(amountLamports) / web3_js_1.LAMPORTS_PER_SOL} SOL)`);
    // ── Initialise Orca Whirlpool client ────────────────────────────────────────
    // AnchorProvider requires a wallet interface — we use the solver keypair.
    // The provider is read-only for quote fetching; actual tx is sent via sendAndConfirmTransaction.
    const wallet = {
        publicKey: solver.publicKey,
        signTransaction: async (tx) => {
            tx.partialSign(solver);
            return tx;
        },
        signAllTransactions: async (txs) => {
            txs.forEach(tx => tx.partialSign(solver));
            return txs;
        },
    };
    let provider;
    try {
        provider = new anchor_1.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    }
    catch (err) {
        console.error(`Failed to create AnchorProvider: ${err}`);
        // Fallback: Orca SDK unavailable
        console.log('SWAP_FALLBACK:sol');
        process.exit(0);
    }
    const ctx = whirlpools_sdk_1.WhirlpoolContext.withProvider(provider, whirlpools_sdk_1.ORCA_WHIRLPOOL_PROGRAM_ID);
    const client = (0, whirlpools_sdk_1.buildWhirlpoolClient)(ctx);
    // ── Find the SOL/USDC Whirlpool on devnet ───────────────────────────────────
    // Token ordering in Whirlpool: tokenA < tokenB by pubkey sort order
    const [tokenA, tokenB] = whirlpools_sdk_1.PoolUtil.orderMints(WSOL_MINT, USDC_MINT).map(m => new web3_js_1.PublicKey(m));
    const poolAddress = whirlpools_sdk_1.PDAUtil.getWhirlpool(whirlpools_sdk_1.ORCA_WHIRLPOOL_PROGRAM_ID, new web3_js_1.PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'), // Orca Whirlpool config devnet
    tokenA, tokenB, TICK_SPACING).publicKey;
    console.error(`Whirlpool pool address: ${poolAddress.toBase58()}`);
    let pool;
    try {
        pool = await client.getPool(poolAddress);
    }
    catch (err) {
        console.error(`Pool not found or fetch failed: ${err}`);
        // Pool unavailable on devnet — signal fallback to caller
        console.log('SWAP_FALLBACK:sol');
        process.exit(0);
    }
    const poolData = pool.getData();
    const isAtoB = WSOL_MINT.equals(tokenA); // true = selling wSOL for USDC
    // ── Ensure solver has a wSOL ATA and wrap SOL ───────────────────────────────
    const solverWsolAta = getAta(solver.publicKey, WSOL_MINT);
    const solverUsdcAta = getAta(solver.publicKey, USDC_MINT);
    // Prepare setup transaction: create wSOL ATA + fund it + sync native
    const setupTx = new web3_js_1.Transaction();
    const wsolAtaInfo = await connection.getAccountInfo(solverWsolAta, 'confirmed');
    if (!wsolAtaInfo) {
        console.error('Creating solver wSOL ATA...');
        setupTx.add(buildCreateAtaIx(solver.publicKey, solverWsolAta, solver.publicKey, WSOL_MINT));
    }
    // Ensure solver USDC ATA exists for receiving swap output
    const usdcAtaInfo = await connection.getAccountInfo(solverUsdcAta, 'confirmed');
    if (!usdcAtaInfo) {
        console.error('Creating solver USDC ATA...');
        setupTx.add(buildCreateAtaIx(solver.publicKey, solverUsdcAta, solver.publicKey, USDC_MINT));
    }
    // Transfer SOL into the wSOL ATA account (it becomes wrapped SOL)
    setupTx.add(web3_js_1.SystemProgram.transfer({
        fromPubkey: solver.publicKey,
        toPubkey: solverWsolAta,
        lamports: Number(amountLamports),
    }));
    // SyncNative instruction: tell the token program to update wSOL balance from lamports
    const SYNC_NATIVE_DISCRIMINATOR = Buffer.from([17]); // SyncNative = index 17
    setupTx.add(new web3_js_1.TransactionInstruction({
        programId: TOKEN_PROGRAM_ID,
        keys: [{ pubkey: solverWsolAta, isSigner: false, isWritable: true }],
        data: SYNC_NATIVE_DISCRIMINATOR,
    }));
    console.error(`Wrapping ${amountLamports} lamports to wSOL...`);
    const setupSig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, setupTx, [solver], { commitment: 'confirmed' });
    console.error(`wSOL wrap confirmed: ${setupSig}`);
    // ── Get swap quote ─────────────────────────────────────────────────────────
    const amountIn = new bn_js_1.default(amountLamports.toString());
    let quote;
    try {
        quote = await (0, whirlpools_sdk_1.swapQuoteByInputToken)(pool, WSOL_MINT, amountIn, SLIPPAGE_BPS / 10000, // Percentage — decimal fraction
        whirlpools_sdk_1.ORCA_WHIRLPOOL_PROGRAM_ID, ctx.fetcher, { maxSupportedTransactionVersion: 0 });
    }
    catch (err) {
        console.error(`Swap quote failed: ${err}`);
        console.log('SWAP_FALLBACK:sol');
        process.exit(0);
    }
    const estimatedUsdc = quote.estimatedAmountOut.toNumber();
    console.error(`Swap quote: ${amountLamports} lamports SOL → ${estimatedUsdc} USDC base units (min: ${quote.otherAmountThreshold.toNumber()})`);
    // ── Execute swap via Orca SDK ───────────────────────────────────────────────
    const usdcBefore = await getTokenBalance(connection, solverUsdcAta);
    try {
        const swapTx = await pool.swap(quote);
        const swapSig = await swapTx.buildAndExecute();
        console.error(`Orca swap confirmed: ${swapSig}`);
    }
    catch (err) {
        console.error(`Orca swap execution failed: ${err}`);
        console.log('SWAP_FALLBACK:sol');
        process.exit(0);
    }
    const usdcAfter = await getTokenBalance(connection, solverUsdcAta);
    const usdcReceived = usdcAfter - usdcBefore;
    console.error(`Solver USDC after swap: ${usdcAfter} (received this swap: ${usdcReceived})`);
    if (usdcReceived <= BigInt(0)) {
        console.error('ERROR: No USDC received from swap — swap may have failed silently.');
        console.log('SWAP_FALLBACK:sol');
        process.exit(0);
    }
    // ── Transfer USDC from solver to recipient ──────────────────────────────────
    const recipientUsdcAta = getAta(recipient, USDC_MINT);
    console.error(`Recipient USDC ATA: ${recipientUsdcAta.toBase58()}`);
    const transferTx = new web3_js_1.Transaction();
    // Create recipient's USDC ATA if it doesn't exist
    const recipientAtaInfo = await connection.getAccountInfo(recipientUsdcAta, 'confirmed');
    if (!recipientAtaInfo) {
        console.error('Creating recipient USDC ATA...');
        transferTx.add(buildCreateAtaIx(solver.publicKey, recipientUsdcAta, recipient, USDC_MINT));
    }
    // SPL Token transfer: solver's USDC ATA → recipient's USDC ATA
    const transferBuf = Buffer.alloc(9);
    transferBuf[0] = 3; // Transfer instruction index
    transferBuf.writeBigUInt64LE(usdcReceived, 1);
    const transferIx = new web3_js_1.TransactionInstruction({
        programId: TOKEN_PROGRAM_ID,
        keys: [
            { pubkey: solverUsdcAta, isSigner: false, isWritable: true }, // source
            { pubkey: recipientUsdcAta, isSigner: false, isWritable: true }, // destination
            { pubkey: solver.publicKey, isSigner: true, isWritable: false }, // authority
        ],
        data: transferBuf,
    });
    transferTx.add(transferIx);
    console.error(`Transferring ${usdcReceived} USDC base units to recipient ${recipientB58}...`);
    const transferSig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, transferTx, [solver], { commitment: 'confirmed' });
    console.error(`USDC transfer confirmed: ${transferSig}`);
    // ── Final verification ───────────────────────────────────────────────────────
    const finalRecipientUsdc = await getTokenBalance(connection, recipientUsdcAta);
    console.error(`Recipient final USDC balance: ${finalRecipientUsdc}`);
    // Output USDC amount swapped+delivered to stdout for Rust to parse
    console.log(`USDC_SWAPPED:${usdcReceived}`);
}
main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`orca_swap.ts error: ${msg}`);
    // On unexpected crash, emit fallback so Rust caller can handle gracefully
    console.log('SWAP_FALLBACK:sol');
    process.exit(1);
});
