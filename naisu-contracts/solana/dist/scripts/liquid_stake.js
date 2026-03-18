#!/usr/bin/env ts-node
"use strict";
/**
 * liquid_stake.ts — Liquid staking helper for the bridge+stake flow.
 *
 * Called AFTER solve_and_prove has delivered SOL to the SOLVER (not to recipient).
 * The solver then stakes that SOL into the mock liquid staking pool and transfers
 * the resulting LST (nSOL) tokens to the actual recipient.
 *
 * Flow:
 *   1. Solver wraps its SOL → wSOL ATA
 *   2. Solver calls mock_liquid_staking::stake(amount) → gets LST into solver's LST ATA
 *   3. Solver transfers exactly that many LST tokens to recipient's LST ATA
 *
 * Net effect:
 *   - Solver: SOL out, LST in (then LST transferred out) → net SOL out, covered by ETH from EVM settle
 *   - Recipient: receives LST (nSOL) tokens, NOT raw SOL
 *
 * Usage:
 *   node scripts/dist/liquid_stake.js <recipient_b58> <amount_lamports> <rpc_url>
 *     <solver_private_key_hex_or_b58> <liquid_staking_program_id> <pool_authority_b58>
 *
 * Outputs on stdout (for the Rust caller to parse):
 *   LST_MINTED:<amount>
 *
 * All progress/errors go to stderr.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const sha2_1 = require("@noble/hashes/sha2");
const anchor_1 = require("@coral-xyz/anchor");
// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────
// Native mint for wSOL (wrapped SOL) — well-known address on all clusters
const NATIVE_MINT = new web3_js_1.PublicKey('So11111111111111111111111111111111111111112');
const TOKEN_PROGRAM_ID = new web3_js_1.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new web3_js_1.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bbn');
// ──────────────────────────────────────────────────────────────────────────────
// Arguments
// ──────────────────────────────────────────────────────────────────────────────
const [, , recipientB58, amountLamportsStr, rpcUrl, privateKeyArg, liquidStakingProgramIdStr, poolAuthorityB58] = process.argv;
if (!recipientB58 || !amountLamportsStr || !rpcUrl || !privateKeyArg || !liquidStakingProgramIdStr || !poolAuthorityB58) {
    console.error('Usage: liquid_stake.js <recipient_b58> <amount_lamports> <rpc_url> <solver_private_key> <liquid_staking_program_id> <pool_authority_b58>');
    process.exit(1);
}
const amountLamports = BigInt(amountLamportsStr);
// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
/** Anchor instruction discriminator: sha256("global:<name>")[0..8] */
function anchorDisc(name) {
    return Buffer.from((0, sha2_1.sha256)(`global:${name}`)).slice(0, 8);
}
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
/** Build create-ATA instruction (idempotent — ATokenGPvbdG...) */
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
        data: Buffer.alloc(0), // create_idempotent variant uses empty data
    });
}
/** Build SPL Token syncNative instruction (updates wSOL ATA balance from lamports) */
function buildSyncNativeIx(wsolAta) {
    // syncNative discriminator = 17 (single byte instruction index in Token Program)
    return new web3_js_1.TransactionInstruction({
        programId: TOKEN_PROGRAM_ID,
        keys: [{ pubkey: wsolAta, isSigner: false, isWritable: true }],
        data: Buffer.from([17]),
    });
}
/** Build mock_liquid_staking::stake(amount) instruction */
function buildStakeIx(liquidStakingProgram, user, pool, lstMint, wsolVault, userUnderlying, userLst, amount) {
    // Discriminator for "stake"
    const disc = anchorDisc('stake');
    // Borsh encode: u64 LE (8 bytes)
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(amount, 0);
    const data = Buffer.concat([disc, amountBuf]);
    // Accounts ordered per Stake struct in mock-liquid-staking:
    // user (mut, signer)
    // pool (mut, PDA)
    // lst_mint (mut)
    // wsol_vault (mut)
    // user_underlying (mut, token::mint=underlying_mint, token::authority=user)
    // user_lst (mut, init_if_needed, associated_token)
    // token_program
    // associated_token_program
    // system_program
    return new web3_js_1.TransactionInstruction({
        programId: liquidStakingProgram,
        keys: [
            { pubkey: user, isSigner: true, isWritable: true },
            { pubkey: pool, isSigner: false, isWritable: true },
            { pubkey: lstMint, isSigner: false, isWritable: true },
            { pubkey: wsolVault, isSigner: false, isWritable: true },
            { pubkey: userUnderlying, isSigner: false, isWritable: true },
            { pubkey: userLst, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
    });
}
/** Read a token account's balance (u64 at offset 64 in token account layout) */
async function getTokenBalance(connection, ata) {
    try {
        const info = await connection.getAccountInfo(ata, 'confirmed');
        if (!info || info.data.length < 72)
            return BigInt(0);
        // SPL token account layout: mint(32) + owner(32) + amount(8) + ...
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
    const liquidStakingProgram = new web3_js_1.PublicKey(liquidStakingProgramIdStr);
    const recipient = new web3_js_1.PublicKey(recipientB58);
    const poolAuthority = new web3_js_1.PublicKey(poolAuthorityB58);
    // Load solver keypair (fee payer)
    const solver = loadKeypair(privateKeyArg);
    console.error(`Solver (fee payer): ${solver.publicKey.toBase58()}`);
    console.error(`Recipient: ${recipient.toBase58()}`);
    console.error(`Amount to liquid stake: ${amountLamports} lamports`);
    console.error(`Liquid Staking Program: ${liquidStakingProgram.toBase58()}`);
    // ── Derive PDAs ─────────────────────────────────────────────────────────────
    const [pool] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('pool'), poolAuthority.toBytes()], liquidStakingProgram);
    const [lstMint] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('lst_mint'), pool.toBytes()], liquidStakingProgram);
    const [wsolVault] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('wsol_vault'), pool.toBytes()], liquidStakingProgram);
    console.error(`Pool PDA:      ${pool.toBase58()}`);
    console.error(`LST Mint PDA:  ${lstMint.toBase58()}`);
    console.error(`wSOL Vault:    ${wsolVault.toBase58()}`);
    // ── Derive ATAs ─────────────────────────────────────────────────────────────
    // Solver's wSOL ATA (underlying = NATIVE_MINT) — solver wraps its own SOL here
    const solverWsolAta = getAta(solver.publicKey, NATIVE_MINT);
    // Solver's LST ATA — LST minted here first, then transferred to recipient
    const solverLstAta = getAta(solver.publicKey, lstMint);
    // Recipient's LST ATA — final destination for LST tokens
    const recipientLstAta = getAta(recipient, lstMint);
    console.error(`Solver wSOL ATA:    ${solverWsolAta.toBase58()}`);
    console.error(`Solver LST ATA:     ${solverLstAta.toBase58()}`);
    console.error(`Recipient LST ATA:  ${recipientLstAta.toBase58()}`);
    // ── Check pool is initialized ────────────────────────────────────────────────
    const poolInfo = await connection.getAccountInfo(pool, 'confirmed');
    if (!poolInfo) {
        console.error('ERROR: Liquid staking pool not initialized. Run the initialize script first.');
        process.exit(1);
    }
    console.error(`Pool account size: ${poolInfo.data.length} bytes — pool initialized OK`);
    // ── LST balance BEFORE stake (to calculate exactly how many were minted) ────
    const lstBefore = await getTokenBalance(connection, solverLstAta);
    console.error(`Solver LST balance before stake: ${lstBefore}`);
    // ── Step A: Create solver's wSOL ATA + wrap SOL → wSOL ────────────────────
    // Solver already received the SOL from solve_and_prove (delivered to solver, not recipient).
    // Now solver wraps that SOL into its wSOL ATA to use as input for the stake call.
    {
        const tx = new web3_js_1.Transaction();
        // Create solver's wSOL ATA if needed (idempotent)
        const ataInfo = await connection.getAccountInfo(solverWsolAta, 'confirmed');
        if (!ataInfo) {
            console.error('Creating solver wSOL ATA...');
            tx.add(buildCreateAtaIx(solver.publicKey, solverWsolAta, solver.publicKey, NATIVE_MINT));
        }
        // Transfer SOL from solver to solver's wSOL ATA, then sync
        tx.add(web3_js_1.SystemProgram.transfer({
            fromPubkey: solver.publicKey,
            toPubkey: solverWsolAta,
            lamports: amountLamports,
        }));
        tx.add(buildSyncNativeIx(solverWsolAta));
        console.error(`Wrapping ${amountLamports} lamports to wSOL...`);
        const sig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [solver], { commitment: 'confirmed' });
        console.error(`Wrap wSOL confirmed: ${sig}`);
    }
    // ── Step B: Create solver's LST ATA if needed ───────────────────────────────
    {
        const lstAtaInfo = await connection.getAccountInfo(solverLstAta, 'confirmed');
        if (!lstAtaInfo) {
            console.error('Creating solver LST ATA...');
            const tx = new web3_js_1.Transaction();
            tx.add(buildCreateAtaIx(solver.publicKey, solverLstAta, solver.publicKey, lstMint));
            const sig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [solver], { commitment: 'confirmed' });
            console.error(`Create solver LST ATA confirmed: ${sig}`);
        }
    }
    // ── Step C: Stake — solver is user, LST minted to solver's LST ATA ──────────
    // user = solver (has authority over user_underlying = solverWsolAta)
    // LST minted to solverLstAta, then transferred to recipient in step D.
    {
        const stakeIx = buildStakeIx(liquidStakingProgram, solver.publicKey, pool, lstMint, wsolVault, solverWsolAta, solverLstAta, amountLamports);
        const tx = new web3_js_1.Transaction();
        tx.add(stakeIx);
        console.error(`Staking ${amountLamports} lamports into liquid staking pool...`);
        const sig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [solver], { commitment: 'confirmed' });
        console.error(`Stake confirmed: ${sig}`);
    }
    // ── Calculate exactly how many LST were minted in this call ─────────────────
    const lstAfterStake = await getTokenBalance(connection, solverLstAta);
    const lstMintedThisCall = lstAfterStake - lstBefore;
    console.error(`Solver LST after stake: ${lstAfterStake} (minted this call: ${lstMintedThisCall})`);
    if (lstMintedThisCall <= BigInt(0)) {
        console.error('ERROR: No LST was minted — stake may have failed silently.');
        process.exit(1);
    }
    // ── Step D: Transfer exactly the minted LST from solver to recipient ─────────
    {
        const tx = new web3_js_1.Transaction();
        // Create recipient's LST ATA if needed
        const recipientLstAtaInfo = await connection.getAccountInfo(recipientLstAta, 'confirmed');
        if (!recipientLstAtaInfo) {
            console.error('Creating recipient LST ATA...');
            tx.add(buildCreateAtaIx(solver.publicKey, recipientLstAta, recipient, lstMint));
        }
        // SPL Token transfer: solver's LST ATA → recipient's LST ATA
        // Transfer exactly what was minted in this call (not solver's full LST balance)
        const transferBuf = Buffer.alloc(9);
        transferBuf[0] = 3; // Transfer instruction
        transferBuf.writeBigUInt64LE(lstMintedThisCall, 1);
        const transferIx = new web3_js_1.TransactionInstruction({
            programId: TOKEN_PROGRAM_ID,
            keys: [
                { pubkey: solverLstAta, isSigner: false, isWritable: true }, // source
                { pubkey: recipientLstAta, isSigner: false, isWritable: true }, // destination
                { pubkey: solver.publicKey, isSigner: true, isWritable: false }, // authority
            ],
            data: transferBuf,
        });
        tx.add(transferIx);
        console.error(`Transferring ${lstMintedThisCall} LST tokens to recipient ${recipientB58}...`);
        const sig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [solver], { commitment: 'confirmed' });
        console.error(`LST transfer confirmed: ${sig}`);
    }
    // ── Final verification ───────────────────────────────────────────────────────
    const finalRecipientLst = await getTokenBalance(connection, recipientLstAta);
    console.error(`Recipient final LST balance: ${finalRecipientLst}`);
    // Output LST amount minted (and delivered) to stdout for Rust to parse
    console.log(`LST_MINTED:${lstMintedThisCall}`);
}
main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`liquid_stake.ts error: ${msg}`);
    process.exit(1);
});
