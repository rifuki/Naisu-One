import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as os from 'os';

const PROGRAM_ID = new PublicKey('CWoFdksgGfJEk73V2u3N58ogBcckFXydKShfJDEUirtk');
const CONFIG_SEED = Buffer.from('config');

async function main() {
  const walletPath = process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`;
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || 'https://api.devnet.solana.com';

  const rawKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(rawKey));

  const connection = new anchor.web3.Connection(rpcUrl, 'confirmed');
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);

  const [configPDA, configBump] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    PROGRAM_ID
  );

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
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },   // owner
      { pubkey: configPDA, isSigner: false, isWritable: true },          // config
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
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
  } catch (e: any) {
    console.error('❌ Error:', e.message || e);
  }
}

main();
