const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } = require('@solana/web3.js');
const crypto = require('crypto');
const fs = require('fs');

const PROGRAM_ID = new PublicKey('Cp6HRKWXgeEycareLXGttNj8dTNfRiFB4Y4UtDuq5EcN');
const RPC = process.env.ANCHOR_PROVIDER_URL || 'https://api.devnet.solana.com';
const WALLET_PATH = (process.env.ANCHOR_WALLET || '~/.config/solana/id.json').replace('~', process.env.HOME);

function discriminator(name) {
  return crypto.createHash('sha256').update('global:' + name).digest().slice(0, 8);
}

const EMITTERS = [
  { chain: 6,     name: 'Avalanche Fuji',  address: '0000000000000000000000004d7184ec23F564acb5Bea7D3E1F60991389A4357' },
  { chain: 10004, name: 'Base Sepolia',     address: '000000000000000000000000FCDE966395c39ED59656BC0fd3a310747Eb68740' },
];

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  const secret = JSON.parse(fs.readFileSync(WALLET_PATH));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));

  const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
  const disc = discriminator('register_emitter');

  for (const { chain, name, address } of EMITTERS) {
    const chainBytes = Buffer.alloc(2);
    chainBytes.writeUInt16LE(chain);
    const [emitterPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('foreign_emitter'), chainBytes],
      PROGRAM_ID
    );

    console.log(`\nRegistering ${name} (chain ${chain})...`);
    console.log('  emitter PDA:', emitterPDA.toString());

    const data = Buffer.concat([disc, chainBytes, Buffer.from(address, 'hex')]);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPDA, isSigner: false, isWritable: false },
        { pubkey: emitterPDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    try {
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
      console.log(`  ✅ Registered! Tx: ${sig}`);
    } catch (e) {
      if (e.message && (e.message.includes('already in use') || e.message.includes('custom program error'))) {
        console.log(`  ℹ️  Already registered or error: ${e.message}`);
      } else {
        console.error(`  ❌ Error: ${e.message}`);
        if (e.logs) console.error('  Logs:', e.logs);
      }
    }
  }

  console.log('\n✅ Done!');
}

main();
