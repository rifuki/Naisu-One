const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } = require('@solana/web3.js');
const crypto = require('crypto');
const fs = require('fs');

const PROGRAM_ID = new PublicKey('Cp6HRKWXgeEycareLXGttNj8dTNfRiFB4Y4UtDuq5EcN');
const RPC = process.env.ANCHOR_PROVIDER_URL || 'https://api.devnet.solana.com';
const WALLET_PATH = process.env.ANCHOR_WALLET || (process.env.HOME + '/.config/solana/id.json');

function discriminator(name) {
  return crypto.createHash('sha256').update('global:' + name).digest().slice(0, 8);
}

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  const secret = JSON.parse(fs.readFileSync(WALLET_PATH.replace('~', process.env.HOME)));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));

  const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
  console.log('Program:', PROGRAM_ID.toString());
  console.log('Config PDA:', configPDA.toString());
  console.log('Owner:', payer.publicKey.toString());

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator('initialize'),
  });

  const tx = new Transaction().add(ix);
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
    console.log('✅ Initialized! Tx:', sig);
    console.log('Explorer: https://explorer.solana.com/tx/' + sig + '?cluster=devnet');
  } catch (e) {
    if (e.message && e.message.includes('already in use')) {
      console.log('ℹ️  Already initialized');
    } else {
      console.error('❌ Error:', e.message || e);
      if (e.logs) console.error('Logs:', e.logs);
    }
  }
}

main();
