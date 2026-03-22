#!/usr/bin/env ts-node
"use strict";
/**
 * marinade_liquid_unstake_tx.ts — Build an UNSIGNED Marinade liquid-unstake transaction.
 *
 * Liquid unstake = instant mSOL → SOL via Marinade liquidity pool (small fee ~0.3%).
 *
 * Usage:
 *   node scripts/dist/marinade_liquid_unstake_tx.js <wallet_pubkey> <msol_amount_raw> <rpc_url>
 *
 * Outputs to stdout: base64-encoded unsigned VersionedTransaction (V0).
 * The caller (frontend / backend) must sign with the wallet keypair and send.
 *
 * All progress/errors go to stderr.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const marinade_ts_sdk_1 = require("@marinade.finance/marinade-ts-sdk");
const bn_js_1 = __importDefault(require("bn.js"));
const [, , walletB58, amountRawStr, rpcUrl] = process.argv;
if (!walletB58 || !amountRawStr || !rpcUrl) {
    console.error('Usage: marinade_liquid_unstake_tx.js <wallet_pubkey> <msol_amount_raw> <rpc_url>');
    process.exit(1);
}
async function main() {
    const connection = new web3_js_1.Connection(rpcUrl, 'confirmed');
    const wallet = new web3_js_1.PublicKey(walletB58);
    const amount = new bn_js_1.default(amountRawStr);
    console.error(`Wallet:      ${wallet.toBase58()}`);
    console.error(`mSOL amount: ${amountRawStr} raw units`);
    const marinadeConfig = new marinade_ts_sdk_1.MarinadeConfig({ connection, publicKey: wallet });
    const marinade = new marinade_ts_sdk_1.Marinade(marinadeConfig);
    console.error('Building liquid unstake transaction...');
    const { transaction } = await marinade.liquidUnstake(amount);
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    // Convert legacy Transaction to VersionedTransaction (V0) so the frontend widget
    // can deserialize it with VersionedTransaction.deserialize().
    const message = new web3_js_1.TransactionMessage({
        payerKey: wallet,
        recentBlockhash: blockhash,
        instructions: transaction.instructions,
    }).compileToV0Message();
    const versionedTx = new web3_js_1.VersionedTransaction(message);
    const serialized = Buffer.from(versionedTx.serialize());
    console.error('Transaction built successfully.');
    console.log(serialized.toString('base64'));
}
main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`marinade_liquid_unstake_tx error: ${msg}`);
    process.exit(1);
});
