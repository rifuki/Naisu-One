#!/usr/bin/env node
"use strict";
/**
 * marginfi_balance.js — Get SOL balance in solver's marginfi account.
 *
 * Args: <rpc_url> <solver_private_key>
 * Stdout: {"solLamports":"<amount>","solAmount":"<decimal>","accountAddress":"<pubkey>"}
 *   or on failure: {"error":"<msg>"}
 */
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { MarginfiClient, getConfig } = require('@mrgnlabs/marginfi-client-v2');
const { NodeWallet } = require('@mrgnlabs/mrgn-common');
const bs58 = require('bs58');

const [, , rpcUrl, privateKeyArg] = process.argv;

if (!rpcUrl || !privateKeyArg) {
  console.log(JSON.stringify({ error: 'Usage: marginfi_balance.js <rpc_url> <solver_private_key>' }));
  process.exit(1);
}

function loadKeypair(key) {
  const k = key.trim();
  try {
    const decoded = bs58.default ? bs58.default.decode(k) : bs58.decode(k);
    if (decoded.length === 64) return Keypair.fromSecretKey(decoded);
    if (decoded.length === 32) return Keypair.fromSeed(decoded);
  } catch {}
  const hex = k.replace(/^0x/, '');
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error(`Invalid private key`);
}

const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

async function main() {
  const connection = new Connection(rpcUrl, 'confirmed');
  const solver = loadKeypair(privateKeyArg);

  const config = getConfig('dev');
  const wallet = new NodeWallet(solver);
  const client = await MarginfiClient.fetch(config, wallet, connection);

  const accounts = await client.getMarginfiAccountsForAuthority(solver.publicKey);
  if (accounts.length === 0) {
    console.log(JSON.stringify({ solLamports: '0', solAmount: '0', accountAddress: null }));
    return;
  }

  const acct = accounts[0];
  const bank = client.getBankByMint(SOL_MINT);

  if (!bank) {
    console.log(JSON.stringify({ error: 'SOL bank not found' }));
    return;
  }

  const bal = acct.activeBalances.find(b => b.bankPk.toBase58() === bank.address.toBase58());
  if (!bal || !bal.active) {
    console.log(JSON.stringify({ solLamports: '0', solAmount: '0.000000000', accountAddress: acct.address.toBase58() }));
    return;
  }

  // assetShares * assetShareValue = lamports (in this devnet config, shareValue = 1)
  const lamports = Math.floor(Number(bal.assetShares) * Number(bank.assetShareValue));
  const solAmount = (lamports / 1e9).toFixed(9);

  console.log(JSON.stringify({
    solLamports: lamports.toString(),
    solAmount,
    accountAddress: acct.address.toBase58(),
  }));
}

main().catch((err) => {
  console.log(JSON.stringify({ error: err.message || String(err) }));
  process.exit(1);
});
