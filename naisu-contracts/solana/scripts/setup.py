#!/usr/bin/env python3
"""
Initialize Intent Bridge Solana Program and Register Emitters
"""

import asyncio
import base58
import json
from pathlib import Path

# Solana imports
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.instruction import Instruction, AccountMeta
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from solders.transaction import Transaction
from solders.message import Message
from solders.hash import Hash
from solana.rpc.async_api import AsyncClient
from solana.rpc.types import TxOpts
from solana.rpc.commitment import Confirmed

# Program ID
PROGRAM_ID = Pubkey.from_string("BKayb1nGGKEWKFbbydpvbEjaDnGRSPgfJLfPmNainru8")

# Seeds
CONFIG_SEED = b"config"
FOREIGN_EMITTER_SEED = b"foreign_emitter"

# Chain IDs
FUJI_CHAIN = 6
BASE_SEPOLIA_CHAIN = 10004
SUI_CHAIN = 21

# Emitter addresses (32-byte format)
FUJI_EMITTER = bytes.fromhex("0000000000000000000000007A3C14505902b4C8dbbe0f688F718C752C2b3DFe")
BASE_SEPOLIA_EMITTER = bytes.fromhex("0000000000000000000000003d5d4a6bc8d5462a66f6ed0869d443caa1aca581")
SUI_EMITTER = bytes.fromhex("920f52f8b6734e5333330d50b8b6925d38b39c6d0498dd0053b76e889365cecb")

# Instruction discriminators (8 bytes each) - calculated from SHA256 hash
INITIALIZE_DISCRIMINATOR = bytes.fromhex('afaf6d1f0d989bed')
REGISTER_EMITTER_DISCRIMINATOR = bytes.fromhex('d9992822be799069')

def load_keypair(path: str) -> Keypair:
    """Load keypair from JSON file"""
    with open(path, 'r') as f:
        secret_key = json.load(f)
    return Keypair.from_bytes(bytes(secret_key))

def find_config_pda() -> tuple[Pubkey, int]:
    """Find config PDA"""
    return Pubkey.find_program_address([CONFIG_SEED], PROGRAM_ID)

def find_emitter_pda(chain: int) -> tuple[Pubkey, int]:
    """Find foreign emitter PDA"""
    chain_bytes = chain.to_bytes(2, 'little')
    return Pubkey.find_program_address([FOREIGN_EMITTER_SEED, chain_bytes], PROGRAM_ID)

def create_initialize_ix(payer: Pubkey, config_pda: Pubkey) -> Instruction:
    """Create initialize instruction"""
    accounts = [
        AccountMeta(payer, is_signer=True, is_writable=True),
        AccountMeta(config_pda, is_signer=False, is_writable=True),
        AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    
    return Instruction(PROGRAM_ID, INITIALIZE_DISCRIMINATOR, accounts)

def create_register_emitter_ix(
    payer: Pubkey, 
    config_pda: Pubkey, 
    emitter_pda: Pubkey,
    chain: int,
    address: bytes
) -> Instruction:
    """Create register_emitter instruction"""
    accounts = [
        AccountMeta(payer, is_signer=True, is_writable=True),
        AccountMeta(config_pda, is_signer=False, is_writable=False),
        AccountMeta(emitter_pda, is_signer=False, is_writable=True),
        AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    
    # Data: discriminator + chain (u16, little-endian) + address (32 bytes)
    chain_bytes = chain.to_bytes(2, 'little')
    data = REGISTER_EMITTER_DISCRIMINATOR + chain_bytes + address
    
    return Instruction(PROGRAM_ID, data, accounts)

async def initialize_program(client: AsyncClient, payer: Keypair) -> str:
    """Initialize the program"""
    print("🚀 Initializing Intent Bridge Program...")
    print(f"Program ID: {PROGRAM_ID}")
    print(f"Payer: {payer.pubkey()}")
    
    config_pda, bump = find_config_pda()
    print(f"Config PDA: {config_pda}")
    
    # Get recent blockhash
    blockhash_resp = await client.get_latest_blockhash()
    blockhash = blockhash_resp.value.blockhash
    
    # Create instruction
    ix = create_initialize_ix(payer.pubkey(), config_pda)
    
    # Create transaction
    tx = Transaction.new_signed_with_payer(
        [ix],
        payer.pubkey(),
        [payer],
        blockhash,
    )
    
    # Send transaction
    try:
        result = await client.send_transaction(
            tx,
            opts=TxOpts(skip_confirmation=False, preflight_commitment=Confirmed),
        )
        signature = result.value
        print(f"✅ Initialized! Signature: {signature}")
        print(f"Explorer: https://explorer.solana.com/tx/{signature}?cluster=devnet")
        return str(signature)
    except Exception as e:
        print(f"❌ Error: {e}")
        raise

async def register_emitter(
    client: AsyncClient, 
    payer: Keypair,
    chain: int,
    chain_name: str,
    address: bytes
) -> str:
    """Register an emitter"""
    print(f"\n🔗 Registering {chain_name} emitter (Chain {chain})...")
    
    config_pda, _ = find_config_pda()
    emitter_pda, bump = find_emitter_pda(chain)
    print(f"Emitter PDA: {emitter_pda}")
    
    # Get recent blockhash
    blockhash_resp = await client.get_latest_blockhash()
    blockhash = blockhash_resp.value.blockhash
    
    # Create instruction
    ix = create_register_emitter_ix(
        payer.pubkey(), 
        config_pda, 
        emitter_pda,
        chain,
        address
    )
    
    # Create transaction
    tx = Transaction.new_signed_with_payer(
        [ix],
        payer.pubkey(),
        [payer],
        blockhash,
    )
    
    # Send transaction
    try:
        result = await client.send_transaction(
            tx,
            opts=TxOpts(skip_confirmation=False, preflight_commitment=Confirmed),
        )
        signature = result.value
        print(f"✅ {chain_name} emitter registered! Signature: {signature}")
        return str(signature)
    except Exception as e:
        print(f"❌ Error registering {chain_name}: {e}")
        raise

async def main():
    # Load keypair
    keypair_path = Path.home() / ".config" / "solana" / "id.json"
    payer = load_keypair(str(keypair_path))
    print(f"Loaded keypair: {payer.pubkey()}")
    
    # Create client
    client = AsyncClient("https://api.devnet.solana.com")
    
    try:
        # Check balance
        balance = await client.get_balance(payer.pubkey())
        print(f"Balance: {balance.value / 1e9:.4f} SOL\n")
        
        # Initialize program
        await initialize_program(client, payer)
        
        # Register emitters
        await register_emitter(client, payer, FUJI_CHAIN, "Fuji", FUJI_EMITTER)
        await register_emitter(client, payer, BASE_SEPOLIA_CHAIN, "Base Sepolia", BASE_SEPOLIA_EMITTER)
        await register_emitter(client, payer, SUI_CHAIN, "Sui", SUI_EMITTER)
        
        print("\n🎉 All emitters registered successfully!")
        
    finally:
        await client.close()

if __name__ == "__main__":
    asyncio.run(main())
