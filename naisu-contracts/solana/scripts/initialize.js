const anchor = require('@coral-xyz/anchor');
const { PublicKey, SystemProgram } = require('@solana/web3.js');

const PROGRAM_ID = new PublicKey('Cp6HRKWXgeEycareLXGttNj8dTNfRiFB4Y4UtDuq5EcN');

async function initialize() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  // Minimal IDL
  const idl = {
    version: '0.1.0',
    name: 'intent_bridge_solana',
    address: 'Cp6HRKWXgeEycareLXGttNj8dTNfRiFB4Y4UtDuq5EcN',
    instructions: [
      {
        name: 'initialize',
        accounts: [
          { name: 'owner', isMut: true, isSigner: true },
          { name: 'config', isMut: true, isSigner: false },
          { name: 'systemProgram', isMut: false, isSigner: false },
        ],
        args: [],
      },
    ],
  };
  
  const program = new anchor.Program(idl, provider);
  
  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    PROGRAM_ID
  );
  
  console.log('Config PDA:', configPDA.toString());
  console.log('Owner:', provider.wallet.publicKey.toString());
  
  try {
    const tx = await program.methods
      .initialize()
      .accounts({
        owner: provider.wallet.publicKey,
        config: configPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log('✅ Initialized! Transaction:', tx);
    console.log('Explorer: https://explorer.solana.com/tx/' + tx + '?cluster=devnet');
  } catch (e) {
    console.error('❌ Error:', e.message);
    if (e.message.includes('already in use')) {
      console.log('ℹ️  Already initialized');
    }
  }
}

initialize();
