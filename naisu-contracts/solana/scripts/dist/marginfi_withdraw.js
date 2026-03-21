#!/usr/bin/env node
"use strict";
/**
 * marginfi_withdraw.js — Withdraw SOL from solver's marginfi account and send to recipient.
 *
 * Args: <recipient_b58> <amount_sol> <rpc_url> <solver_private_key>
 * Stdout: {"signature":"<tx>"}
 *   or on failure: {"error":"<msg>"}
 */
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { MarginfiClient, getConfig } = require('@mrgnlabs/marginfi-client-v2');
const { NodeWallet } = require('@mrgnlabs/mrgn-common');
const bs58 = require('bs58');

const [, , recipientB58, amountSolStr, rpcUrl, privateKeyArg] = process.argv;

if (!recipientB58 || !amountSolStr || !rpcUrl || !privateKeyArg) {
  console.log(JSON.stringify({ error: 'Usage: marginfi_withdraw.js <recipient_b58> <amount_sol> <rpc_url> <solver_private_key>' }));
  process.exit(1);
}

const amountSol = parseFloat(amountSolStr);

function loadKeypair(key) {
  const k = key.trim();
  // Try base58
  try {
    const decoded = bs58.default ? bs58.default.decode(k) : bs58.decode(k);
    if (decoded.length === 64) return Keypair.fromSecretKey(decoded);
    if (decoded.length === 32) return Keypair.fromSeed(decoded);
  } catch {}
  // Hex
  const hex = k.replace(/^0x/, '');
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error(`Invalid private key: ${bytes.length} bytes`);
}

const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

async function main() {
  const connection = new Connection(rpcUrl, 'confirmed');
  const solver = loadKeypair(privateKeyArg);
  const recipient = new PublicKey(recipientB58);

  console.error(`Solver:    ${solver.publicKey.toBase58()}`);
  console.error(`Recipient: ${recipient.toBase58()}`);
  console.error(`Amount:    ${amountSol} SOL`);

  // Load marginfi config
  const marginfiConfig = getConfig('dev');
  const solverWallet = new NodeWallet(solver);
  const client = await MarginfiClient.fetch(marginfiConfig, solverWallet, connection);

  // Find solver's marginfi account
  const accounts = await client.getMarginfiAccountsForAuthority(solver.publicKey);
  if (accounts.length === 0) {
    console.log(JSON.stringify({ error: 'No marginfi account found for solver' }));
    process.exit(1);
  }
  const marginfiAccount = accounts[0];
  console.error(`Marginfi account: ${marginfiAccount.address.toBase58()}`);

  // Find SOL bank
  const solBank = client.getBankByMint(SOL_MINT);
  if (!solBank) {
    console.log(JSON.stringify({ error: 'SOL bank not found in marginfi config' }));
    process.exit(1);
  }

  // Withdraw SOL from marginfi → solver wallet
  console.error(`Withdrawing ${amountSol} SOL from marginfi...`);
  const withdrawSig = await marginfiAccount.withdraw(amountSol, solBank.address);
  console.error(`Withdraw tx: ${withdrawSig}`);

  // Transfer SOL from solver → recipient
  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  console.error(`Transferring ${lamports} lamports to ${recipient.toBase58()}...`);
  const transferTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: solver.publicKey,
      toPubkey: recipient,
      lamports,
    })
  );
  const transferSig = await sendAndConfirmTransaction(connection, transferTx, [solver]);
  console.error(`Transfer tx: ${transferSig}`);

  console.log(JSON.stringify({ signature: transferSig, withdrawSignature: withdrawSig }));
}

main().catch((err) => {
  console.log(JSON.stringify({ error: err.message || String(err) }));
  process.exit(1);
});
