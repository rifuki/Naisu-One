#!/usr/bin/env ts-node
"use strict";
/**
 * create_mock_tokens.ts — One-time setup: create jitoSOL, jupSOL, and kSOL mock SPL token mints on devnet.
 *
 * The solver keypair becomes the mint authority for all 3 tokens.
 * Outputs mint addresses to scripts/mock_tokens.json for use by stake scripts.
 *
 * Usage:
 *   SOLVER_SOLANA_PRIVATE_KEY=<hex_or_b58> npx ts-node scripts/create_mock_tokens.ts [rpc_url]
 *
 * Or compile and run:
 *   node scripts/dist/create_mock_tokens.js [rpc_url] [solver_private_key]
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
const rpcUrl = process.argv[2] || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const privateKeyArg = process.argv[3] || process.env.SOLVER_SOLANA_PRIVATE_KEY || '';
if (!privateKeyArg) {
    console.error('Error: provide solver private key as arg or SOLVER_SOLANA_PRIVATE_KEY env var');
    process.exit(1);
}
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
const OUTPUT_FILE = path.join(__dirname, 'mock_tokens.json');
const DECIMALS = 9; // Same as SOL/mSOL
// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
    const connection = new web3_js_1.Connection(rpcUrl, 'confirmed');
    const solver = loadKeypair(privateKeyArg);
    console.log(`Solver: ${solver.publicKey.toBase58()}`);
    console.log(`RPC:    ${rpcUrl}`);
    console.log(`Output: ${OUTPUT_FILE}`);
    console.log('');
    // Check if already exists — reuse if so
    let existing = {};
    if (fs.existsSync(OUTPUT_FILE)) {
        try {
            existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
            console.log('Found existing mock_tokens.json — will reuse valid mints:');
            console.log(JSON.stringify(existing, null, 2));
            console.log('');
        }
        catch { }
    }
    const tokens = [
        { name: 'jitoSOL (mock)', key: 'jitoSOL', symbol: 'jitoSOL' },
        { name: 'jupSOL (mock)', key: 'jupSOL', symbol: 'jupSOL' },
        { name: 'kSOL (mock)', key: 'kSOL', symbol: 'kSOL' },
    ];
    const result = { ...existing };
    for (const token of tokens) {
        if (result[token.key]) {
            // Verify the mint still exists
            try {
                const mintInfo = await (0, spl_token_1.getMint)(connection, new web3_js_1.PublicKey(result[token.key]));
                console.log(`✓ ${token.name}: ${result[token.key]} (reused, supply=${mintInfo.supply})`);
                continue;
            }
            catch {
                console.log(`  ${token.name}: existing mint invalid, recreating...`);
            }
        }
        console.log(`Creating ${token.name}...`);
        const mint = await (0, spl_token_1.createMint)(connection, solver, // payer
        solver.publicKey, // mint authority (solver can mint tokens)
        null, // no freeze authority
        DECIMALS);
        result[token.key] = mint.toBase58();
        console.log(`✓ ${token.name}: ${mint.toBase58()}`);
    }
    // Save to JSON
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
    console.log('');
    console.log('Saved to mock_tokens.json:');
    console.log(JSON.stringify(result, null, 2));
    console.log('');
    console.log('Next step: run `npm run build:scripts` to compile stake scripts, then restart the solver.');
}
main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`create_mock_tokens.ts error: ${msg}`);
    process.exit(1);
});
