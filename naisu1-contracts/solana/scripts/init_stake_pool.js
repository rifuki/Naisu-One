const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } = require('@solana/web3.js');
const crypto = require('crypto');
const fs = require('fs');
const bs58 = require('bs58');

const [,, rpcUrl, privateKeyArg, programIdStr] = process.argv;
if (!rpcUrl || !privateKeyArg || !programIdStr) {
  console.error('Usage: node init_stake_pool.js <rpc_url> <private_key> <program_id>');
  process.exit(1);
}

function disc(name) {
  return crypto.createHash('sha256').update('global:' + name).digest().slice(0, 8);
}

function loadKeypair(key) {
  const k = key.trim();
  try {
    const bytes = bs58.default ? bs58.default.decode(k) : bs58.decode(k);
    return Keypair.fromSecretKey(bytes);
  } catch {
    return Keypair.fromSecretKey(Buffer.from(k, 'hex'));
  }
}

async function main() {
  const connection = new Connection(rpcUrl, 'confirmed');
  const authority = loadKeypair(privateKeyArg);
  const programId = new PublicKey(programIdStr);

  const [stakePoolPDA, bump] = PublicKey.findProgramAddressSync([Buffer.from('stake_pool')], programId);
  console.log('Program:', programId.toString());
  console.log('Authority:', authority.publicKey.toString());
  console.log('StakePool PDA:', stakePoolPDA.toString(), '(bump', bump + ')');

  // Check if already initialized
  const existing = await connection.getAccountInfo(stakePoolPDA);
  if (existing) {
    console.log('Already initialized! (' + existing.data.length + ' bytes)');
    return;
  }

  const data = disc('initialize_pool');
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: stakePoolPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  console.log('Submitting initialize_pool...');
  const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: 'confirmed' });
  console.log('✅ Initialized! Tx:', sig);
  console.log('Explorer: https://explorer.solana.com/tx/' + sig + '?cluster=devnet');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
