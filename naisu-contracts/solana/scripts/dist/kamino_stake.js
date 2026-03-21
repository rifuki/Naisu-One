#!/usr/bin/env ts-node
"use strict";
/**
 * kamino_stake.ts — Mock Kamino lending: mint kSOL tokens to recipient.
 *
 * Called AFTER solve_and_prove has delivered SOL to the SOLVER.
 * Mints mock kSOL (1:1 with lamports) directly to recipient's ATA.
 * Solver is the mint authority.
 *
 * Usage:
 *   node scripts/dist/kamino_stake.js <recipient_b58> <amount_lamports> <rpc_url> <solver_private_key>
 *
 * Outputs on stdout (for Rust caller to parse):
 *   TOKEN_MINTED:<amount>
 *
 * Reads mint address from scripts/mock_tokens.json (created by create_mock_tokens.js).
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
const spl_token_1 = require("@solana/spl-token");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ──────────────────────────────────────────────────────────────────────────────
// Arguments
// ──────────────────────────────────────────────────────────────────────────────
const [, , recipientB58, amountLamportsStr, rpcUrl, privateKeyArg] = process.argv;
if (!recipientB58 || !amountLamportsStr || !rpcUrl || !privateKeyArg) {
    console.error('Usage: kamino_stake.js <recipient_b58> <amount_lamports> <rpc_url> <solver_private_key>');
    process.exit(1);
}
const amountLamports = BigInt(amountLamportsStr);
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
function loadMintAddress() {
    if (process.env.MOCK_KSOL_MINT)
        return process.env.MOCK_KSOL_MINT;
    const configFile = path.join(__dirname, 'mock_tokens.json');
    if (!fs.existsSync(configFile)) {
        throw new Error(`mock_tokens.json not found at ${configFile}. Run create_mock_tokens.js first.`);
    }
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (!config.kSOL)
        throw new Error('kSOL mint not found in mock_tokens.json');
    return config.kSOL;
}
// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
    const connection = new web3_js_1.Connection(rpcUrl, 'confirmed');
    const solver = loadKeypair(privateKeyArg);
    const recipient = new web3_js_1.PublicKey(recipientB58);
    const mintAddress = loadMintAddress();
    const mint = new web3_js_1.PublicKey(mintAddress);
    console.error(`Solver:    ${solver.publicKey.toBase58()}`);
    console.error(`Recipient: ${recipient.toBase58()}`);
    console.error(`Amount:    ${amountLamports} lamports`);
    console.error(`kSOL Mint: ${mintAddress}`);
    // Get or create recipient's kSOL ATA
    console.error('Getting/creating recipient kSOL ATA...');
    const recipientAta = await (0, spl_token_1.getOrCreateAssociatedTokenAccount)(connection, solver, mint, recipient);
    console.error(`Recipient kSOL ATA: ${recipientAta.address.toBase58()}`);
    // Mint kSOL 1:1 with lamports to recipient's ATA
    console.error(`Minting ${amountLamports} kSOL to recipient...`);
    const txSig = await (0, spl_token_1.mintTo)(connection, solver, mint, recipientAta.address, solver, amountLamports);
    console.error(`kSOL mint confirmed: ${txSig}`);
    console.log(`TOKEN_MINTED:${amountLamports}`);
}
main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`kamino_stake.ts error: ${msg}`);
    process.exit(1);
});
