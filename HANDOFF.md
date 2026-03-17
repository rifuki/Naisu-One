# Naisu-One — Handoff Notes

_Updated: 2026-03-17 (session 2)_

---

## Status Keseluruhan

| Flow | Status |
|---|---|
| Base Sepolia → Solana (bridge) | ✅ Working & tested |
| Base Sepolia → Solana (bridge + liquid stake) | ✅ Working & tested |
| Avalanche Fuji → Solana | ⚠️ Belum ditest |
| Solana → EVM / Sui → EVM | ⚠️ Belum ditest sejak redeploy |

Semua commit sudah di-push ke `origin main`.

---

## Apa yang Dikerjakan di Session Ini (2026-03-17)

### 1. Fix: Routing bridge vs stake dari global config → per-order
**File:** `naisu1-solver/src/chains/evm_listener.rs` line ~112

```rust
// Sebelum (bug — ENABLE_LIQUID_STAKE override semua order):
let use_liquid_stake = order.with_stake || config.enable_liquid_stake;

// Sesudah (fix — murni dari order):
let use_liquid_stake = order.with_stake;
```

Mode sekarang 100% dari perintah user:
- User chat "bridge" → `withStake=false` → SOL langsung ke wallet
- User chat "bridge and stake" / "get nSOL" → `withStake=true` → nSOL di stake_account PDA

---

### 2. Fix: ABI frontend missing `withStake` → tx revert
**File:** `naisu1-fe/lib/abi.ts`

`createOrder` ABI di frontend tidak punya `bool withStake` sebagai input parameter ke-6. Akibatnya waktu agent build tx dengan `withStake=true` dari backend (6 params), frontend decode dengan ABI 5 params → calldata corrupt → tx revert.

**Fix:** Tambah `{ name: "withStake", type: "bool" }` ke:
- `createOrder` inputs
- `orders` outputs
- `OrderCreated` event

---

### 3. Fix: `withStake` tidak di-read dari contract → UI selalu "SOL delivered"
Field `withStake` tidak ada di ABI `orders()` di backend dan indexer, sehingga tidak terbaca dari contract storage.

**Files yang difix:**
- `naisu-backend/src/services/intent.service.ts` — `INTENT_BRIDGE_ABI` orders outputs + `IntentOrder` interface + `listEvmOrders` parse + `withStake: false` di Sui & Solana orders
- `naisu-backend/src/services/indexer.ts` — `ORDERS_FUNCTION_ABI` outputs + `ORDER_CREATED_EVENT` + upsert

---

### 4. Fix: UI Auction Prices label salah
**File:** `naisu1-fe/components/ActiveIntents.tsx`

Label "AUCTION PRICES (ETH)" selalu pakai source currency, padahal prices dalam destination units (lamports untuk Solana).

**Fix:** Tambah `dstCurrency` variable, pakai untuk label auction prices dan current price di compact card.

---

### 5. Fix: Monitor widget tunjuk amount dari order lama
**File:** `naisu1-fe/pages/IntentPage.tsx`

`orders.find(o => o.status === 'FULFILLED')` menemukan order lama yang fulfilled, bukan yang baru disubmit. Fix: hanya cek `orders[0]` (most recent).

---

### 6. Fix: Backend WARN "Invalid Solana address" untuk EVM users
**File:** `naisu-backend/src/services/intent.service.ts`

Saat query all chains tanpa filter, backend coba `listSolanaOrders` dengan EVM address `0xE31B...` → throw error.

**Fix:** Skip chain berdasarkan format address:
```typescript
const isEvmAddress    = /^0x[0-9a-fA-F]{40}$/.test(user)
const isSolanaAddress = !isEvmAddress && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(user)
```

---

## Commit History Session Ini

```
d31938e  fix: correct bridge/stake routing and UI display bugs
5b07f95  fix: propagate withStake field from contract through backend to UI
```

---

## TODO / Next Steps

### Prioritas Tinggi
1. **IDL Refactor** — Frontend pakai raw instruction + hardcoded discriminator. Perlu:
   - Build IDL: `anchor build` di `naisu1-contracts/solana/`
   - Commit IDL JSON files ke repo
   - Tambah `@coral-xyz/anchor` ke `naisu1-fe/package.json`
   - Ganti manual buffer parsing di `useIntentOrders.ts` (lines ~179-197) dengan IDL deserialization
   - Refactor `liquid_stake.ts` pakai Anchor Program client
   - `intent-bridge-solana` tetap sebagian manual karena Wormhole accounts

2. **Test Avalanche Fuji → Solana** — Belum ditest sejak perubahan

3. **Test Solana → EVM reverse** — `claim_with_vaa` dan `relay_vaa.js` belum ditest sejak redeploy

### Prioritas Rendah
4. **Anchor version mismatch** — Program 0.30.1 vs backend @coral-xyz/anchor 0.32.1. Tidak urgent tapi perlu diselesaikan sebelum IDL refactor.
5. **Solana devnet garbage collect** — Program di-reclaim ~2 minggu tidak dipakai. Redeploy sesuai panduan di IMPLEMENTATION.md.

---

## Deployment Info (terkini)

### Solana Devnet
| Item | Value |
|---|---|
| intent-bridge-solana | `Cp6HRKWXgeEycareLXGttNj8dTNfRiFB4Y4UtDuq5EcN` |
| mock-staking | `9W1HN3QiTTUjBgr6ACPQT6jR6SQwgBdi2mFbb44aiWvJ` |
| Stake Pool PDA | `BN9Zosg7cuFb1cC2tcSZJPz2LHayensG8cg1geXc5wcR` |
| Emitter (hex) | `0x94059a2fe236a3c7445a714ef75ca3496167a5dc2666d82328625868931b773b` |

### EVM Testnet
| Chain | Contract |
|---|---|
| Base Sepolia (84532) | `0xFCDE966395c39ED59656BC0fd3a310747Eb68740` |
| Avalanche Fuji (43113) | `0x4d7184ec23F564acb5Bea7D3E1F60991389A4357` |

---

## Proof of Working (Session Ini)

**Bridge biasa** — order `124fbda1`:
- `withStake: false` → mode: `bridge (direct SOL)`
- 2,466,349 lamports → `FN6KP2aS8hTBdUeHJnKhMYBAsQKg3W8zyx29qAnqY8LS`
- SOL tx: `5XcivFKMXeU4hYuhTNrVwz1QnSe8xBDK7D9JtVeQSZb7K2ndL4aZQogFCmeF8SbzncY3Zojpp9MbE2Jzk7GS9hAo`

**Bridge + liquid stake** — order `e1f98af5`:
- `withStake: true` → mode: `bridge+liquid_stake`
- 24,607,562 lamports → nSOL di stake_account PDA `AEvjKUacxwW97Ye31oRwm57t6r5FTb2Qm1Te54iVfigA`
- Deposit tx: `5FjCkVteCJ4jnWsFerCz5Ffb9JNv79xphSEzKoh29pWoDfsfVse64Ti3eYMNH9k3b4YHc17qPcmcjF8hKvVkUitF`
- ETH settlement: `0x2189b82c84a1ddaa4d823bc137a5f57eaade1f03d5e901f8fda79fb2c36e56ff`
