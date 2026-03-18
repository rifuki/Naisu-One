"use strict";
/**
 * create_intent.ts — creates a test intent on Solana (Solana→EVM direction)
 *
 * Usage:
 *   ts-node create_intent.ts [amount_sol] [evm_recipient]
 *
 * Defaults:
 *   amount_sol    = 0.01 SOL
 *   evm_recipient = solver's own EVM address (0x0B755E8fDf4239198d99B3431C44Af112a29810f)
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
const PROGRAM_ID = new web3_js_1.PublicKey('CWoFdksgGfJEk73V2u3N58ogBcckFXydKShfJDEUirtk');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
// Destination chain: Avalanche Fuji (Wormhole chain ID 6)
const DEST_CHAIN = 6;
function disc(name) {
    return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}
async function main() {
    const amountSol = parseFloat(process.argv[2] || '0.01');
    const amountLamports = BigInt(Math.round(amountSol * 1e9));
    // EVM recipient — right-padded as bytes32
    const evmAddr = (process.argv[3] || '0x0B755E8fDf4239198d99B3431C44Af112a29810f').replace('0x', '');
    const recipientBytes = Buffer.alloc(32);
    Buffer.from(evmAddr.padStart(64, '0'), 'hex').copy(recipientBytes);
    const walletPath = process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`;
    const rawKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
    const keypair = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(rawKey));
    const connection = new web3_js_1.Connection(RPC_URL, 'confirmed');
    console.log('Creator  :', keypair.publicKey.toString());
    console.log('Amount   :', amountSol, 'SOL =', amountLamports.toString(), 'lamports');
    console.log('Dest chain:', DEST_CHAIN, '(Avalanche Fuji)');
    console.log('Recipient:', '0x' + evmAddr);
    // Random intent_id (32 bytes)
    const intentId = crypto.randomBytes(32);
    console.log('Intent ID:', intentId.toString('hex'));
    // Derive intent PDA
    const [intentPDA] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('intent'), intentId], PROGRAM_ID);
    console.log('Intent PDA:', intentPDA.toString());
    // Auction params (in gwei, as if we're paying in ETH equivalent)
    // start_price = 12000 gwei, floor_price = 10000 gwei, duration = 300s (5 min)
    const startPrice = BigInt(12000);
    const floorPrice = BigInt(10000);
    const durationSecs = BigInt(1800); // 30 minutes
    // Build create_intent instruction
    // Args borsh: intent_id([u8;32]) + recipient([u8;32]) + dest_chain(u16 LE) +
    //             start_price(u64 LE) + floor_price(u64 LE) + duration_seconds(u64 LE)
    const argsData = Buffer.alloc(32 + 32 + 2 + 8 + 8 + 8);
    let offset = 0;
    intentId.copy(argsData, offset);
    offset += 32;
    recipientBytes.copy(argsData, offset);
    offset += 32;
    argsData.writeUInt16LE(DEST_CHAIN, offset);
    offset += 2;
    argsData.writeBigUInt64LE(startPrice, offset);
    offset += 8;
    argsData.writeBigUInt64LE(floorPrice, offset);
    offset += 8;
    argsData.writeBigUInt64LE(durationSecs, offset);
    const ixData = Buffer.concat([disc('create_intent'), argsData]);
    // payment account = creator (lamports deducted from here via CPI transfer)
    const ix = new web3_js_1.TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: keypair.publicKey, isSigner: true, isWritable: true }, // creator
            { pubkey: keypair.publicKey, isSigner: true, isWritable: true }, // payment (same as creator)
            { pubkey: intentPDA, isSigner: false, isWritable: true }, // intent
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
        ],
        data: ixData,
    });
    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new web3_js_1.Transaction();
    tx.add(ix);
    tx.feePayer = keypair.publicKey;
    tx.recentBlockhash = blockhash;
    // Transfer amount_lamports to intent PDA via system_program (the program does it via CPI)
    // BUT create_intent reads lamports from `payment` account — we need to pre-fund
    // Actually the program does: amount = payment.lamports() THEN does transfer
    // So we need to send amount_lamports to the payment account first...
    // Wait — payment = creator here, which already has SOL. The program does:
    //   let amount = ctx.accounts.payment.lamports();  ← entire balance of payment!
    // That would drain everything. Let's use a fresh payment keypair with exact amount.
    // Use a fresh ephemeral keypair as the payment account
    const paymentKeypair = web3_js_1.Keypair.generate();
    console.log('Payment  :', paymentKeypair.publicKey.toString(), '(ephemeral, funded with', amountSol, 'SOL)');
    // Fund the payment account
    const fundIx = web3_js_1.SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: paymentKeypair.publicKey,
        lamports: amountLamports,
    });
    const ix2 = new web3_js_1.TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: keypair.publicKey, isSigner: true, isWritable: true }, // creator
            { pubkey: paymentKeypair.publicKey, isSigner: true, isWritable: true }, // payment
            { pubkey: intentPDA, isSigner: false, isWritable: true }, // intent
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
        ],
        data: ixData,
    });
    const tx2 = new web3_js_1.Transaction();
    tx2.add(fundIx);
    tx2.add(ix2);
    tx2.feePayer = keypair.publicKey;
    tx2.recentBlockhash = blockhash;
    tx2.sign(keypair, paymentKeypair);
    try {
        const sig = await connection.sendRawTransaction(tx2.serialize(), { skipPreflight: false });
        await connection.confirmTransaction(sig, 'confirmed');
        console.log('\n✅ Intent created!');
        console.log('   Tx:', sig);
        console.log('   Explorer: https://explorer.solana.com/tx/' + sig + '?cluster=devnet');
        console.log('   Intent PDA:', intentPDA.toString());
        console.log('\nSolver should now pick this up and fill on Fuji (chain 6).');
    }
    catch (e) {
        console.error('❌ Error:', e.message || e);
        if (e.logs)
            console.error('Logs:', e.logs.join('\n'));
    }
}
main();
