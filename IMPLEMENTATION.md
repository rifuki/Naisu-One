# Naisu-One — Implementation Notes

_Last updated: 2026-03-17_

---

## Arsitektur Umum

Cross-chain intent bridge dengan Dutch auction solver. User lock aset di chain asal, solver fulfill di chain tujuan, lalu claim reimbursement via Wormhole VAA.

```
User                    Solver                  EVM Contract        Wormhole
 |                        |                          |                  |
 |-- createOrder(ETH) --> |                          |                  |
 |                        |<-- detect OrderCreated --|                  |
 |                        |-- solve_and_prove() -->  |                  |
 |                        |   (Solana: bayar SOL)    |                  |
 |                        |                          |<-- VAA emit -----|
 |                        |<-- fetch VAA ------------|------------------|
 |                        |-- settleOrder(VAA) ----> |                  |
 |                        |<-- ETH reimbursed -------|                  |
```

### Mode Bridge

| `withStake` di order | Mode solver | Recipient dapat |
|---|---|---|
| `false` | `solve_and_prove` | SOL langsung di wallet |
| `true` | `solve_and_liquid_stake` | nSOL di `stake_account` PDA |

Mode ditentukan **100% dari perintah user** via flag `withStake` di `createOrder()`. Agent menset `withStake=true` jika user bilang "bridge and stake" atau "get nSOL".

---

## Chain yang Didukung

| Route | Status |
|---|---|
| Base Sepolia → Solana (bridge) | ✅ Working |
| Base Sepolia → Solana (bridge + liquid stake) | ✅ Working |
| Avalanche Fuji → Solana | ⚠️ Belum ditest |
| Avalanche Fuji → Sui | ⚠️ Belum ditest |
| Solana → EVM | ⚠️ Belum ditest sejak redeploy |
| Sui → EVM | ⚠️ Belum ditest |

---

## Deployment Info (Devnet/Testnet)

### Solana Devnet
| Item | Value |
|---|---|
| intent-bridge-solana | `Cp6HRKWXgeEycareLXGttNj8dTNfRiFB4Y4UtDuq5EcN` |
| mock-staking | `9W1HN3QiTTUjBgr6ACPQT6jR6SQwgBdi2mFbb44aiWvJ` |
| Wormhole Core Bridge | `3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5` |
| Emitter PDA | `AxpJ3u89SfKqxsGbgaSAwheRMnfdQzSqvjxaJRom7wHL` |
| Emitter (hex) | `0x94059a2fe236a3c7445a714ef75ca3496167a5dc2666d82328625868931b773b` |
| Config PDA | `8RjCs8V81TzTu6xKLEqWyof14acf33cauvFaodCx5WmX` |
| Stake Pool PDA | `BN9Zosg7cuFb1cC2tcSZJPz2LHayensG8cg1geXc5wcR` |

### EVM Testnet
| Chain | Contract |
|---|---|
| Avalanche Fuji (43113) | `0x4d7184ec23F564acb5Bea7D3E1F60991389A4357` |
| Base Sepolia (84532) | `0xFCDE966395c39ED59656BC0fd3a310747Eb68740` |

### Registered Emitters (Solana program)
| Chain | Wormhole Chain ID | EVM Contract (padded) |
|---|---|---|
| Avalanche Fuji | 6 | `0x0000...4d7184ec...4357` |
| Base Sepolia | 10004 | `0x0000...FCDE9663...8740` |

---

## Stack & Versi

| Komponen | Stack | Versi penting |
|---|---|---|
| Solana programs | Anchor + Rust | Anchor 0.30.1, wormhole-anchor-sdk 0.30.1-alpha.3 |
| Solver | Rust (tokio) | — |
| Backend | Hono + Bun | @coral-xyz/anchor 0.32.1 (utilities only) |
| Frontend | React 19 + Vite | wagmi 3, viem 2, @solana/web3.js 1 |
| Agent | LangChain + TypeScript | — |

**Catatan versi mismatch:** Program Anchor 0.30.1 vs backend `@coral-xyz/anchor` 0.32.1. Backend hanya pakai Anchor untuk utilities (hash discriminator, base58 encode), bukan Program client, jadi tidak masalah untuk sekarang.

---

## Arsitektur Frontend ↔ Solana

Frontend saat ini **tidak pakai IDL** — semua interaksi Solana dilakukan manual:

| Hal | Cara sekarang | Idealnya |
|---|---|---|
| Account discriminator | Hardcode di `lib/constants.ts` | Generate dari IDL |
| Parse account data | Manual buffer offset di `useIntentOrders.ts` | IDL deserialization |
| Build instruction | Raw `TransactionInstruction` di scripts | Anchor Program client |
| IDL files | Tidak ada (`target/idl/` kosong) | Harus di-build & commit |

**TODO Refactor (prioritas):**
1. Build & commit IDL: `anchor build` di `naisu1-contracts/solana`
2. Tambah `@coral-xyz/anchor` ke frontend
3. Ganti manual buffer parsing di `useIntentOrders.ts` dengan IDL deserialization
4. Refactor `liquid_stake.ts` dan scripts lain pakai Anchor Program client
5. `intent-bridge-solana` tetap sebagian manual karena Wormhole accounts tidak masuk IDL

---

## Solana Program Instructions

### intent-bridge-solana

#### `initialize`
- accounts: owner (signer, mut), config PDA `[b"config"]`, system_program

#### `register_emitter(chain: u16, address: [u8;32])`
- accounts: owner (signer, mut), config PDA (readonly), emitter PDA `[b"foreign_emitter", chain_le]` (mut), system_program

#### `solve_and_prove(order_id: [u8;32], solver_address: [u8;32], amount_lamports: u64)`
- accounts: solver (signer, mut), recipient (mut), config, wormhole_program, wormhole_bridge (mut), wormhole_message (signer, mut — fresh keypair tiap call), wormhole_emitter, wormhole_sequence (mut), wormhole_fee_collector (mut), clock, rent, system_program
- **Catatan:** Jika solver == recipient (mode liquid_stake), solver hanya muncul 1x di account list (de-duplikasi)
- Wormhole payload: `order_id(32) + solver_evm_addr(32) + padding(24) + amount_be(8)` = 96 bytes

#### `claim_with_vaa()`
- accounts: solver (signer, mut), intent PDA, received PDA, config, posted_vaa, foreign_emitter PDA, system_program
- Untuk Solana→EVM reverse flow

### mock-staking

#### `initialize_pool()`
- accounts: authority (signer, mut), stake_pool PDA `[b"stake_pool"]` (mut, init), system_program

#### `deposit(lamports_in: u64)`
- accounts: depositor (signer, mut), staker (mut), stake_pool `[b"stake_pool"]` (mut), stake_account `[b"stake_account", staker]` (mut, init_if_needed), system_program
- 1 lamport = 1 share (mock, no yield)

#### `withdraw(shares_to_burn: u64)`
- accounts: staker (signer, mut), stake_pool (mut), stake_account (mut), system_program

---

## Wormhole Payload Format

```
bytes[0..32]  = order_id (bytes32 dari EVM contract)
bytes[32..64] = solver EVM address (left-padded 32 bytes)
bytes[64..88] = 0x00 * 24 (padding)
bytes[88..96] = amount_lamports (big-endian u64)
```

EVM contract reads via assembly:
```solidity
orderId      := mload(add(payload, 32))  // bytes[0..32]
solverPadded := mload(add(payload, 64))  // bytes[32..64]
amountPaid   := mload(add(payload, 96))  // bytes[64..96] — u256 big-endian
```

---

## EVM Contract ABI — Field Penting

`createOrder(bytes32 recipient, uint16 destinationChain, uint256 startPrice, uint256 floorPrice, uint256 durationSeconds, bool withStake)`

`withStake` harus ada di semua ABI definition:
- `naisu1-fe/lib/abi.ts` — createOrder inputs ✅
- `naisu1-fe/lib/abi.ts` — orders outputs ✅
- `naisu1-fe/lib/abi.ts` — OrderCreated event ✅
- `naisu-backend/src/services/intent.service.ts` — INTENT_BRIDGE_ABI ✅
- `naisu-backend/src/services/indexer.ts` — ORDERS_FUNCTION_ABI + ORDER_CREATED_EVENT ✅

---

## Solver Scripts (naisu1-contracts/solana/scripts/)

| Script | Fungsi | Usage |
|---|---|---|
| `init_raw.js` | Init config PDA intent-bridge-solana | `node init_raw.js` (pakai ANCHOR_PROVIDER_URL) |
| `init_stake_pool.js` | Init stake pool mock-staking | `node init_stake_pool.js <rpc> <privkey> <program_id>` |
| `register_emitters.js` | Register EVM emitters di Solana | `node register_emitters.js` |
| `dist/liquid_stake.js` | Deposit SOL ke mock-staking untuk recipient | dipanggil otomatis oleh solver |
| `dist/relay_vaa.js` | Relay VAA ke Solana (untuk Solana→EVM) | dipanggil oleh solver |

---

## Cara Redeploy (jika program di-garbage-collect lagi)

```bash
cd naisu1-contracts/solana

# 1. Generate keypair baru (atau pakai yang ada)
solana-keygen new --no-bip39-passphrase -o target/deploy/intent_bridge_solana-keypair.json --force

# 2. Update declare_id! dan semua .env
NEW_ID=$(solana-keygen pubkey target/deploy/intent_bridge_solana-keypair.json)
sed -i "s/Cp6HRK.*/\"$NEW_ID\";/" programs/intent-bridge-solana/src/lib.rs
# update juga Anchor.toml, naisu1-solver/.env, naisu-backend/.env, naisu1-fe/.env

# 3. Build
cargo build-sbf --manifest-path programs/intent-bridge-solana/Cargo.toml

# 4. Deploy
solana program deploy target/deploy/intent_bridge_solana.so \
  --program-id target/deploy/intent_bridge_solana-keypair.json \
  --url devnet

# 5. Initialize
node scripts/init_raw.js  # (ANCHOR_PROVIDER_URL=https://api.devnet.solana.com)

# 6. Register emitters
node scripts/register_emitters.js  # (update program ID di script dulu)

# 7. Update SOLANA_EMITTER_ADDRESS di solver .env
# Emitter PDA = findProgramAddressSync([b"emitter"], programId)

# 8. Register emitter baru di Base Sepolia EVM contract
cast send 0xFCDE... "registerEmitter(uint16,bytes32)" 1 <new_emitter_hex> \
  --rpc-url https://sepolia.base.org --private-key <EVM_PRIVATE_KEY>

# Ulangi untuk mock-staking jika perlu
```

---

## Cara Withdraw nSOL dari Stake Account

Setelah bridge+stake, recipient punya `stake_account` PDA. Cek balance:

```javascript
const [stakeAccountPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('stake_account'), recipientPubkey.toBytes()],
  MOCK_STAKING_PROGRAM
);
const info = await connection.getAccountInfo(stakeAccountPDA);
// info.data[8..16] = shares (u64 LE) = jumlah nSOL dalam lamports
const shares = info.data.readBigUInt64LE(8);
```

Withdraw (burn shares → dapat SOL kembali):

```javascript
const disc = crypto.createHash('sha256').update('global:withdraw').digest().slice(0, 8);
const data = Buffer.alloc(16);
disc.copy(data, 0);
data.writeBigUInt64LE(BigInt(shares), 8);

const ix = new TransactionInstruction({
  programId: MOCK_STAKING_PROGRAM,
  keys: [
    { pubkey: staker,         isSigner: true,  isWritable: true  },
    { pubkey: stakePoolPDA,   isSigner: false, isWritable: true  },
    { pubkey: stakeAccountPDA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data,
});
```

---

## Known Issues / TODO

1. **IDL tidak di-generate/commit** — `target/idl/` kosong. Frontend & scripts pakai manual instruction building dan hardcoded discriminator. Perlu: `anchor build` → commit IDL → refactor ke Anchor Program client.

2. **`wormhole_sequence=0`** kadang muncul — fallback ke account read sudah ada, monitor jika settlement fail.

3. **Solana devnet garbage collect** — program account di-reclaim jika tidak dipakai ~2 minggu. Redeploy berkala atau upgrade ke mainnet.

4. **Solana→EVM (reverse)** belum ditest sejak redeploy program baru. `claim_with_vaa` dan `relay_vaa.js` perlu ditest ulang.

5. **Avalanche Fuji flows** belum ditest sejak perubahan terakhir.

6. **Anchor version mismatch** — Program 0.30.1 vs backend @coral-xyz/anchor 0.32.1. Tidak masalah sekarang, tapi perlu diselesaikan sebelum bisa pakai IDL client dari backend.
