#!/usr/bin/env python3
"""
Initialize new intent-bridge-solana + mock-staking deployment.
Runs: initialize, register_emitter x3, initialize_pool
"""
import asyncio
import hashlib
import json
import struct
from pathlib import Path

from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.instruction import Instruction, AccountMeta
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from solders.transaction import Transaction
from solana.rpc.async_api import AsyncClient
from solana.rpc.types import TxOpts
from solana.rpc.commitment import Confirmed

# ── Config ─────────────────────────────────────────────────────────────────
PROGRAM_ID      = Pubkey.from_string("FSHrXSKTZtLisVCssJx5pyUmiL9U3VJL58zSRysBja4k")
MOCK_STAKING_ID = Pubkey.from_string("Hf9NmwtXpzvr31q6v7q6gevDYfEi6NnqbihsRMDkTsii")
RPC_URL         = "https://api.devnet.solana.com"

# EVM emitters — will be updated after EVM deploys; placeholders below are current Base/Fuji
# FORMAT: (wormhole_chain_id, label, 32-byte hex address)
# NOTE: These will be updated by the script if new addresses are provided.
EVM_EMITTERS = [
    # Placeholder — updated in-script after EVM deploy
    (10004, "Base Sepolia",   None),  # filled below
    (6,     "Avalanche Fuji", None),  # filled below
    (21,    "Sui Testnet",    bytes.fromhex("48703a669e62c122b44c83102cadf7215d498692d1076030baedc6da63fbc147")),
]

# ── Helpers ─────────────────────────────────────────────────────────────────

def disc(name: str) -> bytes:
    """Anchor instruction discriminator: sha256('global:<name>')[0:8]"""
    h = hashlib.sha256(f"global:{name}".encode()).digest()
    return h[:8]

def load_keypair(path: str) -> Keypair:
    with open(path) as f:
        return Keypair.from_bytes(bytes(json.load(f)))

def find_pda(seeds, program_id):
    return Pubkey.find_program_address(seeds, program_id)

async def send_ix(client, payer, instruction, label):
    bh = (await client.get_latest_blockhash()).value.blockhash
    tx  = Transaction.new_signed_with_payer([instruction], payer.pubkey(), [payer], bh)
    try:
        sig = (await client.send_transaction(
            tx, opts=TxOpts(skip_preflight=True, preflight_commitment=Confirmed)
        )).value
        # Poll for confirmation
        for _ in range(30):
            await asyncio.sleep(2)
            status = (await client.get_signature_statuses([sig])).value[0]
            if status is None:
                continue
            if status.err:
                print(f"  ❌ {label} failed: {status.err}")
                return None
            if str(status.confirmation_status) in ("confirmed", "finalized"):
                print(f"  ✅ {label}: {sig}")
                print(f"     https://explorer.solana.com/tx/{sig}?cluster=devnet")
                return str(sig)
        print(f"  ⏱ {label}: timed out waiting for confirmation")
        return str(sig)
    except Exception as e:
        print(f"  ❌ {label} error: {e}")
        return None

# ── Instructions ─────────────────────────────────────────────────────────────

async def initialize(client, payer):
    print("\n[1] initialize intent-bridge-solana...")
    config_pda, _ = find_pda([b"config"], PROGRAM_ID)
    print(f"     config PDA: {config_pda}")
    accounts = [
        AccountMeta(payer.pubkey(),  is_signer=True,  is_writable=True),
        AccountMeta(config_pda,      is_signer=False, is_writable=True),
        AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    ix = Instruction(PROGRAM_ID, disc("initialize"), accounts)
    return await send_ix(client, payer, ix, "initialize")

async def register_emitter(client, payer, chain_id, label, address_32):
    print(f"\n[2] register_emitter chain={chain_id} ({label})...")
    if address_32 is None:
        print(f"     ⚠ skipping {label} — address not set yet")
        return None
    config_pda, _  = find_pda([b"config"], PROGRAM_ID)
    emitter_pda, _ = find_pda([b"foreign_emitter", chain_id.to_bytes(2, "little")], PROGRAM_ID)
    print(f"     emitter PDA: {emitter_pda}")
    accounts = [
        AccountMeta(payer.pubkey(),    is_signer=True,  is_writable=True),
        AccountMeta(config_pda,        is_signer=False, is_writable=False),
        AccountMeta(emitter_pda,       is_signer=False, is_writable=True),
        AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    # Borsh: u16 chain_id (LE) + [u8; 32] address
    data = disc("register_emitter") + struct.pack("<H", chain_id) + address_32
    ix = Instruction(PROGRAM_ID, data, accounts)
    return await send_ix(client, payer, ix, f"register_emitter({label})")

async def initialize_pool(client, payer):
    print("\n[3] initialize_pool (mock-staking)...")
    stake_pool_pda, _ = find_pda([b"stake_pool"], MOCK_STAKING_ID)
    print(f"     stake_pool PDA: {stake_pool_pda}")
    accounts = [
        AccountMeta(payer.pubkey(),    is_signer=True,  is_writable=True),
        AccountMeta(stake_pool_pda,    is_signer=False, is_writable=True),
        AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    ix = Instruction(MOCK_STAKING_ID, disc("initialize_pool"), accounts)
    return await send_ix(client, payer, ix, "initialize_pool")

# ── Main ─────────────────────────────────────────────────────────────────────

async def main():
    # Accept EVM addresses as CLI args if provided
    import sys
    base_addr = None
    fuji_addr = None
    if len(sys.argv) >= 3:
        base_addr = bytes.fromhex(sys.argv[1].replace("0x","").zfill(64))
        fuji_addr = bytes.fromhex(sys.argv[2].replace("0x","").zfill(64))

    EVM_EMITTERS[0] = (10004, "Base Sepolia",   base_addr)
    EVM_EMITTERS[1] = (6,     "Avalanche Fuji", fuji_addr)

    keypair_path = Path.home() / ".config" / "solana" / "id.json"
    payer = load_keypair(str(keypair_path))
    print(f"Deployer:  {payer.pubkey()}")
    print(f"Program:   {PROGRAM_ID}")
    print(f"Staking:   {MOCK_STAKING_ID}")

    client = AsyncClient(RPC_URL)
    try:
        bal = (await client.get_balance(payer.pubkey())).value
        print(f"Balance:   {bal / 1e9:.4f} SOL\n")

        # Step 1: initialize intent-bridge
        r = await initialize(client, payer)
        if r is None:
            print("  (may already be initialized — continuing)")

        # Step 2: register EVM + Sui emitters
        for chain_id, label, addr in EVM_EMITTERS:
            await register_emitter(client, payer, chain_id, label, addr)

        # Step 3: initialize mock-staking pool
        r = await initialize_pool(client, payer)
        if r is None:
            print("  (may already be initialized — continuing)")

        print("\n🎉 Setup complete!")
        print(f"   SOLANA_PROGRAM_ID=FSHrXSKTZtLisVCssJx5pyUmiL9U3VJL58zSRysBja4k")
        print(f"   MOCK_STAKING_PROGRAM_ID=Hf9NmwtXpzvr31q6v7q6gevDYfEi6NnqbihsRMDkTsii")
        emitter_pda, _ = find_pda([b"emitter"], PROGRAM_ID)
        print(f"   SOLANA_EMITTER_ADDRESS=0x{bytes(emitter_pda).hex()}")
        print(f"   SOLANA_EMITTER_B58={emitter_pda}")
    finally:
        await client.close()

if __name__ == "__main__":
    asyncio.run(main())
