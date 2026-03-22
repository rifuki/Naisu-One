#!/usr/bin/env ts-node
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

import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { Marinade, MarinadeConfig } from '@marinade.finance/marinade-ts-sdk';
import BN from 'bn.js';

const [, , walletB58, amountRawStr, rpcUrl] = process.argv;

if (!walletB58 || !amountRawStr || !rpcUrl) {
  console.error('Usage: marinade_liquid_unstake_tx.js <wallet_pubkey> <msol_amount_raw> <rpc_url>');
  process.exit(1);
}

async function main() {
  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = new PublicKey(walletB58);
  const amount = new BN(amountRawStr);

  console.error(`Wallet:      ${wallet.toBase58()}`);
  console.error(`mSOL amount: ${amountRawStr} raw units`);

  const marinadeConfig = new MarinadeConfig({ connection, publicKey: wallet });
  const marinade = new Marinade(marinadeConfig);

  console.error('Building liquid unstake transaction...');
  const { transaction } = await marinade.liquidUnstake(amount);

  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  // Convert legacy Transaction to VersionedTransaction (V0) so the frontend widget
  // can deserialize it with VersionedTransaction.deserialize().
  const message = new TransactionMessage({
    payerKey: wallet,
    recentBlockhash: blockhash,
    instructions: transaction.instructions,
  }).compileToV0Message();

  const versionedTx = new VersionedTransaction(message);

  const serialized = Buffer.from(versionedTx.serialize());

  console.error('Transaction built successfully.');
  console.log(serialized.toString('base64'));
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`marinade_liquid_unstake_tx error: ${msg}`);
  process.exit(1);
});
