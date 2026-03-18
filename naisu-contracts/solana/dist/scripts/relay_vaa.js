#!/usr/bin/env ts-node
"use strict";
/**
 * relay_vaa.ts — Relay a Wormhole VAA to Solana (verify_signatures + post_vaa).
 *
 * Usage:
 *   ts-node relay_vaa.ts <vaa_hex> <rpc_url> <private_key_hex> <wormhole_program_id>
 *
 * Outputs: <posted_vaa_address_base58> on stdout on success.
 * Progress/errors go to stderr.
 *
 * The Wormhole Core Bridge on Solana is an Anchor program. Instructions use
 * 8-byte Anchor discriminators (sha256("global:<name>")[0..8]).
 *
 * Dependencies (all transitive from @coral-xyz/anchor):
 *   @solana/web3.js, @noble/hashes
 */
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const sha3_1 = require("@noble/hashes/sha3");
const sha2_1 = require("@noble/hashes/sha2");
// ──────────────────────────────────────────────────────────────────────────────
// Arguments
// ──────────────────────────────────────────────────────────────────────────────
const [, , vaaHex, rpcUrl, privateKeyHex, wormholeProgramIdStr] = process.argv;
if (!vaaHex || !rpcUrl || !privateKeyHex || !wormholeProgramIdStr) {
    console.error('Usage: relay_vaa.ts <vaa_hex> <rpc_url> <private_key_hex> <wormhole_program_id>');
    process.exit(1);
}
// ──────────────────────────────────────────────────────────────────────────────
// Anchor discriminator helper
// ──────────────────────────────────────────────────────────────────────────────
/** Compute Anchor instruction discriminator: sha256("global:<name>")[0..8] */
function anchorDisc(name) {
    return Buffer.from((0, sha2_1.sha256)(`global:${name}`)).slice(0, 8);
}
/** Compute Anchor account discriminator: sha256("account:<name>")[0..8] */
function anchorAccountDisc(name) {
    return Buffer.from((0, sha2_1.sha256)(`account:${name}`)).slice(0, 8);
}
function parseVaa(hex) {
    const buf = Buffer.from(hex, 'hex');
    let offset = 0;
    const version = buf[offset++];
    const guardianSetIndex = buf.readUInt32BE(offset);
    offset += 4;
    const sigCount = buf[offset++];
    const signatures = [];
    for (let i = 0; i < sigCount; i++) {
        const guardianIndex = buf[offset++];
        const r = buf.slice(offset, offset + 32);
        offset += 32;
        const s = buf.slice(offset, offset + 32);
        offset += 32;
        const recoveryId = buf[offset++];
        signatures.push({ guardianIndex, r, s, recoveryId });
    }
    const body = buf.slice(offset);
    const bodyHash = Buffer.from((0, sha3_1.keccak_256)(body));
    const doubleHash = Buffer.from((0, sha3_1.keccak_256)(bodyHash));
    const timestamp = body.readUInt32BE(0);
    const nonce = body.readUInt32BE(4);
    const emitterChain = body.readUInt16BE(8);
    const emitterAddress = body.slice(10, 42);
    const sequence = body.readBigUInt64BE(42);
    const consistencyLevel = body[50];
    const payload = body.slice(51);
    return { version, guardianSetIndex, signatures, body, bodyHash, doubleHash,
        timestamp, nonce, emitterChain, emitterAddress, sequence,
        consistencyLevel, payload };
}
// ──────────────────────────────────────────────────────────────────────────────
// GuardianSet account parsing
// ──────────────────────────────────────────────────────────────────────────────
/** Parse the on-chain GuardianSet Anchor account. */
function parseGuardianSet(data) {
    // Skip 8-byte Anchor discriminator
    let offset = 8;
    const index = data.readUInt32LE(offset);
    offset += 4;
    const keysLen = data.readUInt32LE(offset);
    offset += 4;
    const keys = [];
    for (let i = 0; i < keysLen; i++) {
        keys.push(Buffer.from(data.slice(offset, offset + 20)));
        offset += 20;
    }
    return { index, keys };
}
// ──────────────────────────────────────────────────────────────────────────────
// Instruction builders (Anchor format)
// ──────────────────────────────────────────────────────────────────────────────
/**
 * Build the Wormhole verify_signatures instruction (Anchor format).
 *
 * Discriminator: sha256("global:verify_signatures")[0..8]
 * Data:          discriminator(8) + signers[i8; 19](19) = 27 bytes
 *
 * Accounts (Anchor ordering from IDL):
 *   payer          - writable, signer
 *   guardian_set   - writable (Anchor marks it writable for expiry check logic)
 *   signature_set  - writable, signer (init_if_needed)
 *   instructions   - SYSVAR_INSTRUCTIONS (read-only)
 *   system_program - read-only (needed for init)
 */
function buildVerifySignaturesIx(wormholeProgram, payer, guardianSetPda, signatureSet, signersArray) {
    const disc = anchorDisc('verify_signatures');
    // signers: [i8; 19] in Borsh = 19 bytes, each as two's-complement u8
    const signersBuf = Buffer.alloc(19);
    for (let i = 0; i < 19; i++) {
        signersBuf[i] = signersArray[i] < 0 ? 255 : signersArray[i];
    }
    const data = Buffer.concat([disc, signersBuf]); // 27 bytes
    return new web3_js_1.TransactionInstruction({
        programId: wormholeProgram,
        keys: [
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: guardianSetPda, isSigner: false, isWritable: true },
            { pubkey: signatureSet, isSigner: true, isWritable: true },
            { pubkey: web3_js_1.SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
    });
}
/**
 * Build the Wormhole post_vaa instruction (Anchor format).
 *
 * Discriminator: sha256("global:post_vaa")[0..8]
 * Data:          discriminator + borsh(PostVAAData)
 *
 * PostVAAData Borsh layout:
 *   version             u8
 *   guardian_set_index  u32 LE
 *   timestamp           u32 LE
 *   nonce               u32 LE
 *   emitter_chain       u16 LE
 *   emitter_address     [u8; 32]
 *   sequence            u64 LE
 *   consistency_level   u8
 *   payload             Vec<u8> = u32 LE length + bytes
 *
 * Accounts:
 *   guardian_set   - read-only (verify finality)
 *   bridge_config  - writable
 *   signature_set  - read-only
 *   posted_vaa     - writable (created here)
 *   payer          - writable, signer
 *   clock          - SYSVAR_CLOCK
 *   rent           - SYSVAR_RENT
 *   system_program - read-only
 */
function buildPostVaaIx(wormholeProgram, payer, guardianSetPda, bridgePda, signatureSet, postedVaaPda, vaa) {
    const disc = anchorDisc('post_vaa');
    const payload = vaa.payload;
    // Borsh-encode PostVAAData
    const payloadLen = 8 + 1 + 4 + 4 + 4 + 2 + 32 + 8 + 1 + 4 + payload.length;
    const body = Buffer.alloc(payloadLen);
    let off = 0;
    disc.copy(body, off);
    off += 8;
    body[off++] = vaa.version;
    body.writeUInt32LE(vaa.guardianSetIndex, off);
    off += 4;
    body.writeUInt32LE(vaa.timestamp, off);
    off += 4;
    body.writeUInt32LE(vaa.nonce, off);
    off += 4;
    body.writeUInt16LE(vaa.emitterChain, off);
    off += 2;
    vaa.emitterAddress.copy(body, off);
    off += 32;
    body.writeBigUInt64LE(vaa.sequence, off);
    off += 8;
    body[off++] = vaa.consistencyLevel;
    body.writeUInt32LE(payload.length, off);
    off += 4;
    payload.copy(body, off);
    return new web3_js_1.TransactionInstruction({
        programId: wormholeProgram,
        keys: [
            { pubkey: guardianSetPda, isSigner: false, isWritable: false },
            { pubkey: bridgePda, isSigner: false, isWritable: true },
            { pubkey: signatureSet, isSigner: false, isWritable: false },
            { pubkey: postedVaaPda, isSigner: false, isWritable: true },
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: web3_js_1.SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
            { pubkey: web3_js_1.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: body,
    });
}
// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
    const connection = new web3_js_1.Connection(rpcUrl, 'confirmed');
    const wormholeProgram = new web3_js_1.PublicKey(wormholeProgramIdStr);
    // Load payer keypair from hex private key (32-byte seed)
    const seedHex = privateKeyHex.replace(/^0x/, '');
    const seedBytes = Buffer.from(seedHex.slice(0, 64), 'hex'); // first 32 bytes
    const payer = web3_js_1.Keypair.fromSeed(seedBytes);
    console.error(`Payer: ${payer.publicKey.toString()}`);
    // Parse VAA
    const vaa = parseVaa(vaaHex);
    console.error(`Emitter chain: ${vaa.emitterChain}, sequence: ${vaa.sequence}`);
    console.error(`Body hash (PostedVAA seed): ${vaa.bodyHash.toString('hex')}`);
    // ── Derive PDAs ────────────────────────────────────────────────────────────
    const guardianIndexBuf = Buffer.alloc(4);
    guardianIndexBuf.writeUInt32LE(vaa.guardianSetIndex, 0);
    const [guardianSetPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('GuardianSet'), guardianIndexBuf], wormholeProgram);
    const [bridgePda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('Bridge')], wormholeProgram);
    const [postedVaaPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('PostedVAA'), vaa.bodyHash], wormholeProgram);
    console.error(`GuardianSet PDA: ${guardianSetPda.toString()}`);
    console.error(`Bridge PDA:      ${bridgePda.toString()}`);
    console.error(`PostedVAA PDA:   ${postedVaaPda.toString()}`);
    // ── Check if PostedVAA already exists ─────────────────────────────────────
    const existingInfo = await connection.getAccountInfo(postedVaaPda);
    if (existingInfo) {
        console.error('PostedVAA already exists — skipping relay');
        console.log(postedVaaPda.toString()); // output for Rust caller
        return;
    }
    // ── Read GuardianSet to get ETH addresses ─────────────────────────────────
    const gsAccount = await connection.getAccountInfo(guardianSetPda);
    if (!gsAccount)
        throw new Error(`GuardianSet not found: ${guardianSetPda}`);
    const guardianSet = parseGuardianSet(Buffer.from(gsAccount.data));
    console.error(`Guardian count: ${guardianSet.keys.length}`);
    // ── Create SignatureSet keypair ────────────────────────────────────────────
    const signatureSetKeypair = web3_js_1.Keypair.generate();
    console.error(`SignatureSet:    ${signatureSetKeypair.publicKey.toString()}`);
    // ── Build Secp256k1 pre-instructions (one per guardian signature) ─────────
    // The Secp256k1 program computes keccak256(message) and recovers the ETH address.
    // message = bodyHash (keccak256 of body) → the program computes keccak256(bodyHash) = doubleHash
    // This matches what guardians sign: keccak256(keccak256(body))
    const secp256k1Ixs = [];
    const signersArr = new Array(19).fill(-1);
    for (let i = 0; i < vaa.signatures.length; i++) {
        const sig = vaa.signatures[i];
        const ethAddress = guardianSet.keys[sig.guardianIndex];
        if (!ethAddress)
            throw new Error(`Guardian index ${sig.guardianIndex} not in set`);
        const signature64 = Buffer.concat([sig.r, sig.s]);
        const secp256k1Ix = web3_js_1.Secp256k1Program.createInstructionWithEthAddress({
            ethAddress: ethAddress.toString('hex'), // 40-char hex (no "0x")
            message: vaa.bodyHash, // 32 bytes — program will keccak256 this
            signature: signature64, // r || s (64 bytes)
            recoveryId: sig.recoveryId,
        });
        secp256k1Ixs.push(secp256k1Ix);
        signersArr[sig.guardianIndex] = i;
    }
    // ── Build verify_signatures instruction ───────────────────────────────────
    const verifyIx = buildVerifySignaturesIx(wormholeProgram, payer.publicKey, guardianSetPda, signatureSetKeypair.publicKey, signersArr);
    // ── Submit verify_signatures (Secp256k1 ixs MUST come before verify_signatures) ──
    const verifyTx = new web3_js_1.Transaction();
    for (const ix of secp256k1Ixs)
        verifyTx.add(ix);
    verifyTx.add(verifyIx);
    console.error('Submitting verify_signatures...');
    const verifySig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, verifyTx, [payer, signatureSetKeypair], { commitment: 'confirmed' });
    console.error(`verify_signatures confirmed: ${verifySig}`);
    // ── Build and submit post_vaa ─────────────────────────────────────────────
    const postVaaIx = buildPostVaaIx(wormholeProgram, payer.publicKey, guardianSetPda, bridgePda, signatureSetKeypair.publicKey, postedVaaPda, vaa);
    const postVaaTx = new web3_js_1.Transaction();
    postVaaTx.add(postVaaIx);
    console.error('Submitting post_vaa...');
    const postVaaSig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, postVaaTx, [payer], { commitment: 'confirmed' });
    console.error(`post_vaa confirmed: ${postVaaSig}`);
    // ── Output PostedVAA address for the Rust caller ──────────────────────────
    console.log(postedVaaPda.toString());
}
main().catch((err) => {
    console.error('relay_vaa.ts error:', err?.message || err);
    process.exit(1);
});
