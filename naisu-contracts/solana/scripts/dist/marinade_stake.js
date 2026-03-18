#!/usr/bin/env ts-node
"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const marinade_ts_sdk_1 = require("@marinade.finance/marinade-ts-sdk");
const anchor_1 = require("@coral-xyz/anchor");
const bn_js_1 = __importDefault(require("bn.js"));
// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────
const TOKEN_PROGRAM_ID = new web3_js_1.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new web3_js_1.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bbn');
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
    return anchor_1.utils.token.associatedAddress({ mint, owner });
}
/** Build create-ATA instruction (idempotent) */
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
/** Read a token account's balance (u64 at offset 64 in token account layout) */
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
    console.error(`Amount:    ${amountLamports} lamports`);
    // ── Init Marinade ────────────────────────────────────────────────────────────
    // SDK auto-detects devnet from the RPC URL
    const marinadeConfig = new marinade_ts_sdk_1.MarinadeConfig({
        connection,
        publicKey: solver.publicKey,
    });
    const marinade = new marinade_ts_sdk_1.Marinade(marinadeConfig);
    // ── Get mSOL mint from Marinade state ────────────────────────────────────────
    console.error('Fetching Marinade state...');
    const marinadeState = await marinade.getMarinadeState();
    const msolMint = marinadeState.mSolMintAddress;
    console.error(`mSOL Mint: ${msolMint.toBase58()}`);
    // ── mSOL ATA for solver (Marinade will mint here) ────────────────────────────
    const solverMsolAta = getAta(solver.publicKey, msolMint);
    console.error(`Solver mSOL ATA: ${solverMsolAta.toBase58()}`);
    // mSOL balance before deposit (to calculate exactly how many were minted)
    const msolBefore = await getTokenBalance(connection, solverMsolAta);
    console.error(`Solver mSOL balance before deposit: ${msolBefore}`);
    // ── Step 1: Deposit SOL → mSOL via Marinade ──────────────────────────────────
    console.error(`Depositing ${amountLamports} lamports into Marinade...`);
    const { transaction: depositTx, associatedMSolTokenAccountAddress } = await marinade.deposit(new bn_js_1.default(amountLamports.toString()));
    console.error(`Marinade mSOL ATA: ${associatedMSolTokenAccountAddress.toBase58()}`);
    // Fetch blockhash and set fee payer before signing
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    depositTx.recentBlockhash = blockhash;
    depositTx.feePayer = solver.publicKey;
    const depositSig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, depositTx, [solver], {
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
    const recipientMsolAta = getAta(recipient, msolMint);
    console.error(`Recipient mSOL ATA: ${recipientMsolAta.toBase58()}`);
    const transferTx = new web3_js_1.Transaction();
    // Create recipient's mSOL ATA if it doesn't exist
    const recipientAtaInfo = await connection.getAccountInfo(recipientMsolAta, 'confirmed');
    if (!recipientAtaInfo) {
        console.error('Creating recipient mSOL ATA...');
        transferTx.add(buildCreateAtaIx(solver.publicKey, recipientMsolAta, recipient, msolMint));
    }
    // SPL Token transfer: solver's mSOL ATA → recipient's mSOL ATA
    const transferBuf = Buffer.alloc(9);
    transferBuf[0] = 3; // Transfer instruction index
    transferBuf.writeBigUInt64LE(msolMinted, 1);
    const transferIx = new web3_js_1.TransactionInstruction({
        programId: TOKEN_PROGRAM_ID,
        keys: [
            { pubkey: associatedMSolTokenAccountAddress, isSigner: false, isWritable: true }, // source
            { pubkey: recipientMsolAta, isSigner: false, isWritable: true }, // destination
            { pubkey: solver.publicKey, isSigner: true, isWritable: false }, // authority
        ],
        data: transferBuf,
    });
    transferTx.add(transferIx);
    console.error(`Transferring ${msolMinted} mSOL to recipient ${recipientB58}...`);
    const transferSig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, transferTx, [solver], {
        commitment: 'confirmed',
    });
    console.error(`mSOL transfer confirmed: ${transferSig}`);
    // ── Final verification ───────────────────────────────────────────────────────
    const finalRecipientMsol = await getTokenBalance(connection, recipientMsolAta);
    console.error(`Recipient final mSOL balance: ${finalRecipientMsol}`);
    // Output mSOL amount minted (and delivered) to stdout for Rust to parse
    console.log(`MSOL_MINTED:${msolMinted}`);
}
main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`marinade_stake.ts error: ${msg}`);
    process.exit(1);
});
