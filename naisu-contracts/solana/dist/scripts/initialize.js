"use strict";
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
const anchor = __importStar(require("@coral-xyz/anchor"));
const web3_js_1 = require("@solana/web3.js");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const PROGRAM_ID = new web3_js_1.PublicKey('CWoFdksgGfJEk73V2u3N58ogBcckFXydKShfJDEUirtk');
const CONFIG_SEED = Buffer.from('config');
async function main() {
    const walletPath = process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`;
    const rpcUrl = process.env.ANCHOR_PROVIDER_URL || 'https://api.devnet.solana.com';
    const rawKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
    const keypair = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(rawKey));
    const connection = new anchor.web3.Connection(rpcUrl, 'confirmed');
    const wallet = new anchor.Wallet(keypair);
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    anchor.setProvider(provider);
    const [configPDA, configBump] = web3_js_1.PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID);
    console.log('Program ID:', PROGRAM_ID.toString());
    console.log('Config PDA:', configPDA.toString());
    console.log('Owner:', wallet.publicKey.toString());
    // Check if already initialized
    const existing = await connection.getAccountInfo(configPDA);
    if (existing) {
        console.log('✅ Config PDA already exists — program already initialized');
        console.log('   Balance:', existing.lamports / 1e9, 'SOL');
        return;
    }
    // Build initialize instruction manually (discriminator = sha256("global:initialize")[0..8])
    const crypto = require('crypto');
    const discriminator = crypto.createHash('sha256').update('global:initialize').digest().slice(0, 8);
    const initIx = new anchor.web3.TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // owner
            { pubkey: configPDA, isSigner: false, isWritable: true }, // config
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
        ],
        data: Buffer.from(discriminator),
    });
    const tx = new anchor.web3.Transaction().add(initIx);
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(keypair);
    try {
        const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
        await connection.confirmTransaction(sig, 'confirmed');
        console.log('✅ Initialized! Tx:', sig);
        console.log('   View: https://explorer.solana.com/tx/' + sig + '?cluster=devnet');
    }
    catch (e) {
        console.error('❌ Error:', e.message || e);
    }
}
main();
