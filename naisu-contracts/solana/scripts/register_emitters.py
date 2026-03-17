#!/usr/bin/env python3
"""
Register Emitters for Intent Bridge Solana Program
"""

import asyncio
import json
from pathlib import Path

from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.instruction import Instruction, AccountMeta
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from solders.transaction import Transaction
from solana.rpc.async_api import AsyncClient
from solana.rpc.types import TxOpts
from solana.rpc.commitment import Confirmed

PROGRAM_ID = Pubkey.from_string("CWoFdksgGfJEk73V2u3N58ogBcckFXydKShfJDEUirtk")
FOREIGN_EMITTER_SEED = b"foreign_emitter"

# Chains and emitters (current deployed contracts from MEMORY.md)
EMITTERS = [
    # Avalanche Fuji, chain ID 6 — EVM contract 0x4c848d6d8bf04d2484c17bcf2330d9004a931259
    (6,     "Avalanche Fuji",  bytes.fromhex("0000000000000000000000004c848d6d8bf04d2484c17bcf2330d9004a931259")),
    # Base Sepolia, chain ID 10004 — EVM contract 0x52583f5ec5fd77de2424f547d30a622757436c6e
    (10004, "Base Sepolia",    bytes.fromhex("00000000000000000000000052583f5ec5fd77de2424f547d30a622757436c6e")),
    # Sui testnet, chain ID 21 — EmitterCap 0x48703a...
    (21,    "Sui",             bytes.fromhex("48703a669e62c122b44c83102cadf7215d498692d1076030baedc6da63fbc147")),
]

REGISTER_EMITTER_DISCRIMINATOR = bytes.fromhex('d9992822be799069')

def load_keypair(path: str) -> Keypair:
    with open(path, 'r') as f:
        secret_key = json.load(f)
    return Keypair.from_bytes(bytes(secret_key))

def find_config_pda():
    return Pubkey.find_program_address([b"config"], PROGRAM_ID)

def find_emitter_pda(chain: int):
    chain_bytes = chain.to_bytes(2, 'little')
    return Pubkey.find_program_address([FOREIGN_EMITTER_SEED, chain_bytes], PROGRAM_ID)

def create_register_emitter_ix(payer, config_pda, emitter_pda, chain, address):
    accounts = [
        AccountMeta(payer, is_signer=True, is_writable=True),
        AccountMeta(config_pda, is_signer=False, is_writable=False),
        AccountMeta(emitter_pda, is_signer=False, is_writable=True),
        AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    chain_bytes = chain.to_bytes(2, 'little')
    data = REGISTER_EMITTER_DISCRIMINATOR + chain_bytes + address
    return Instruction(PROGRAM_ID, data, accounts)

async def register_emitter(client, payer, chain, name, address):
    print(f"\n🔗 Registering {name} emitter (Chain {chain})...")
    
    config_pda, _ = find_config_pda()
    emitter_pda, _ = find_emitter_pda(chain)
    print(f"Emitter PDA: {emitter_pda}")
    
    blockhash_resp = await client.get_latest_blockhash()
    blockhash = blockhash_resp.value.blockhash
    
    ix = create_register_emitter_ix(payer.pubkey(), config_pda, emitter_pda, chain, address)
    
    tx = Transaction.new_signed_with_payer([ix], payer.pubkey(), [payer], blockhash)
    
    try:
        result = await client.send_transaction(tx, opts=TxOpts(skip_confirmation=False, preflight_commitment=Confirmed))
        signature = result.value
        print(f"✅ {name} emitter registered!")
        print(f"Explorer: https://explorer.solana.com/tx/{signature}?cluster=devnet")
        return str(signature)
    except Exception as e:
        print(f"❌ Error: {e}")
        raise

async def main():
    keypair_path = Path.home() / ".config" / "solana" / "id.json"
    payer = load_keypair(str(keypair_path))
    print(f"Keypair: {payer.pubkey()}")
    
    client = AsyncClient("https://api.devnet.solana.com")
    
    try:
        balance = await client.get_balance(payer.pubkey())
        print(f"Balance: {balance.value / 1e9:.4f} SOL\n")
        
        for chain, name, address in EMITTERS:
            await register_emitter(client, payer, chain, name, address)
        
        print("\n🎉 All emitters registered!")
        
    finally:
        await client.close()

if __name__ == "__main__":
    asyncio.run(main())
