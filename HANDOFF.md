# Naisu One — Handoff Document

_Last updated: 2026-03-18 (Session 2)_

---

## Repo Structure

```
Naisu-One/
├── naisu-frontend/      # React + Vite (wagmi, @solana/wallet-adapter)
├── naisu-backend/       # Hono/Bun backend — intent indexer + API
├── naisu-contracts/     # EVM (Foundry) + Solana (Anchor) + Sui (Move)
├── naisu-program/       # Solana Anchor mock programs
├── naisu-solver/        # Rust intent solver (Base Sepolia ↔ Solana)
└── naisu-agent/         # TypeScript AI agent (Fastify + LangChain)
```

---

## Session 1 Summary (2026-03-18 pagi)

All commits pushed to `main`. Latest session 1: `00b1655`

### 1. naisu-solver: TUI + WS Refactor

#### Env var renames
| Old | New |
|-----|-----|
| `EVM2_WS_URL` | `BASE_SEPOLIA_WS_URL` |

`EVM_RPC_URL`, `EVM_CONTRACT_ADDRESS`, `EVM_CHAIN_ID` (Fuji) → **dihapus total**

#### Config changes (`src/config.rs`)
- Hapus field: `evm_rpc_url`, `evm_contract_address`, `evm_chain_id`
- Rename field: `evm2_ws_url` → `evm_ws_url` (reads `BASE_SEPOLIA_WS_URL`)
- Sisa EVM fields: `evm_private_key`, `evm_wormhole_address`, `evm_emitter_address`, `evm2_rpc_url`, `evm2_contract_address`, `evm2_chain_id`

#### evm_executor.rs
- `make_client()` sekarang pakai `evm2_rpc_url` + `evm2_chain_id` (Base Sepolia)
- Hapus hardcode gas 25 gwei (Fuji-specific)
- `fulfill_and_prove` → `evm2_contract_address` (bukan Fuji lagi)

#### lib.rs
- Hapus `evm_fuji_to_sui` task spawn
- Hapus `sui_to_evm` task spawn
- Hanya running: Base Sepolia listener + Solana listener

#### TUI — AppEvent & App struct
- `AppEvent::Mode(Chain, String)` → **`AppEvent::Mode(Chain, String, String)`** (label + URL)
- App struct tambah: `evm_mode`, `sol_mode`, `sui_mode`, `evm_conn_url`, `sol_conn_url`, `sui_conn_url`
- Balance panel sekarang tampil 3 baris: balance / address / connection URL

#### TUI — Balance panel titles
```
┌ EVM (Base) · WS ──┐  ┌ SOL (Devnet) · WS ──┐  ┌ SUI (Testnet) · HTTP ──┐
│ 0.4380 ETH        │  │ 6.4815 SOL           │  │ 3.9122 SUI             │
│ 0x0b755e...       │  │ 7WkNZxoz6x...        │  │ 0x087a53...            │
│ wss://...alchemy  │  │ wss://api.devnet...  │  │ https://fullnode.sui.. │
└───────────────────┘  └──────────────────────┘  └────────────────────────┘
```

#### SOL balance fix (`main.rs`)
- `watch_sol_balance`: WS connect → HTTP fetch initial balance → subscribe WS
- WS putus → Mode HTTP, HTTP fetch, tunggu 15s, retry WS
- `fetch_sol_balance_http()` helper ditambah

#### SOL WS ping keepalive
- `solana_listener.rs` dan `watch_sol_balance` di `main.rs`
- Kirim ping setiap 30s via `tokio::select!` supaya public devnet tidak timeout idle ~60s

#### sui_listener.rs
- Tambah `#![allow(dead_code)]` — file dikepik karena `SuiIntent` dipakai `solana_listener.rs`

---

### 2. naisu-backend: WS-first Event-driven Indexer

#### Problem yang diperbaiki
Race condition: solver resolve intent dalam ~15s via WS, tapi backend HTTP polling 10s → FE tidak pernah lihat status `OPEN`.

#### Arsitektur baru (`src/services/indexer.ts`)

```
Before:  HTTP poll getLogs/getProgramAccounts setiap 10s
After:   WS subscribe dulu → initial backfill → WS stream selamanya
```

**EVM (Base Sepolia):**
- `viem watchContractEvent` dengan `webSocket` transport → `eth_subscribe` (true WS push)
- Subscribe `OrderCreated` → fetch full order via `readContract` → `upsert`
- Subscribe `OrderFulfilled` → update status langsung
- Fallback ke HTTP poll jika `BASE_SEPOLIA_WS_URL` tidak di-set

**Solana:**
- `connection.onProgramAccountChange()` dari `@solana/web3.js`
- Auto-derive WS URL dari HTTP RPC (`https://` → `wss://`)
- Filter by discriminator — hanya Intent accounts

**Startup flow:**
```
startIndexer()
  ├── if BASE_SEPOLIA_WS_URL set:
  │     1. startEvmWsSubscription()    ← subscribe dulu (buffer events)
  │     2. startSolanaWsSubscription() ← subscribe dulu
  │     3. initialEvmBackfill()        ← getLogs historical
  │     4. initialSolanaBackfill()     ← getProgramAccounts
  │     5. WS stream selamanya
  └── else:
        HTTP poll setiap 10s (fallback)
```

---

## Session 2 Summary (2026-03-18 siang)

Latest commit: `550568c`

### 3. Bug Fix: OrderFulfilled ABI Mismatch (Root Cause Frontend Tidak Sync)

**Bug:** `ORDER_FULFILLED_ABI` di `indexer.ts` punya extra field `amount` yang tidak ada di contract.

```typescript
// SEBELUM (salah) — topic hash mismatch, tidak pernah match event apapun
inputs: [
  { name: 'orderId', type: 'bytes32', indexed: true },
  { name: 'solver',  type: 'address', indexed: true },
  { name: 'amount',  type: 'uint256', indexed: false },  // ← tidak ada di contract!
]

// SESUDAH (benar)
inputs: [
  { name: 'orderId', type: 'bytes32', indexed: true },
  { name: 'solver',  type: 'address', indexed: true },
]
```

Contract actual: `event OrderFulfilled(bytes32 indexed orderId, address indexed solver);`

**Impact:** WS subscription backend tidak pernah menerima satupun `OrderFulfilled` event.
Order fulfilled di chain tapi frontend stuck OPEN selamanya.

**Commit:** `cb5122d`

---

### 4. Safety Net: 30s OPEN Order Re-check + SSE Push

**File:** `naisu-backend/src/services/indexer.ts`

- Tambah `setInterval` 30 detik di WS mode yang re-check semua OPEN orders via RPC
- Safety net kalau WS event miss/delayed (Alchemy kadang flaky di testnet)

**File:** `naisu-frontend/hooks/useIntentOrders.ts`

- Wire `useOrderWatch` (SSE) ke dalam hook
- Saat backend detect `OrderFulfilled`, SSE push ke frontend → update instan tanpa tunggu 12s poll

**Commit:** `cb5122d`

---

### 5. Real-time New Intent Detection

**Problem:** Order baru (OPEN) hanya muncul di frontend via polling 12 detik.

**Fix — Backend (`indexer.ts`):**
- `upsert()` emit `order_created` event untuk order baru (pertama kali di-index)

**Fix — Backend (`routes/intent.ts`):**
- SSE `/watch` route subscribe `order_created` event
- Push `order_created` ke connected client

**Fix — Frontend (`useOrderWatch.ts` + `useIntentOrders.ts`):**
- `useOrderWatch` accept `onOrderCreated` callback
- `useIntentOrders` pass `refresh()` ke `onOrderCreated`
- Hasil: order baru muncul dalam ~2-4 detik (block time + Alchemy WS latency)

**Commit:** `2ad1f7d`

---

### 6. Research & Planning Docs

#### `SOLVER_ARCHITECTURE_RESEARCH.md` — commit `ed45db4`
Riset lengkap bagaimana industri handle decentralized solver network:
- Across Protocol, UniswapX, CoW Protocol, 1inch Fusion, NEAR Intents, LI.FI
- Comparison table + smart contract patterns
- Rekomendasi roadmap untuk Naisu

#### `SOLVER_NETWORK_PLAN.md` — commit `550568c`
Implementation plan decentralized solver network Naisu:
- Scoring formula + tier system + cold start solution
- Attack vectors & mitigations (sybil bond, fade penalty, SPOF fallback)
- Phase 1/2/3 roadmap
- API spec solver ↔ backend ↔ frontend
- Demo setup 3 solver lokal

---

## Next Priorities (Belum Dikerjakan)

### Priority 1 — Decentralized Solver Network (Phase 1)
Untuk demo dengan 3 solver. Detail lengkap di `SOLVER_NETWORK_PLAN.md`.

**Backend changes:**
- `POST /api/v1/solver/register` — solver daftar saat startup + heartbeat
- `GET  /api/v1/solver/list` — list solver aktif + stats
- `GET  /api/v1/solver/selection/:orderId` — hasil seleksi + reasoning
- RFQ engine: broadcast ke semua solver aktif, collect quotes (timeout 3s)
- Scoring engine: price 50% + reliability 25% + speed 15% + liquidity 10%
- Fade detection + auto-suspend (3 fades → suspend 24 jam)

**Contract changes (`IntentBridge.sol`):**
```solidity
// Tambah ke Order struct:
address exclusiveSolver;
uint256 exclusivityDeadline;

// Tambah solver registry:
mapping(address => SolverInfo) public solvers;
function registerSolver() external payable { ... }  // MIN_BOND = 0.05 ETH

// Update settleOrder():
if (block.timestamp < order.exclusivityDeadline) {
    require(msg.sender == order.exclusiveSolver, "Exclusive window active");
}
// Setelah deadline → open race (fallback tanpa backend)
```

**Solver Rust changes:**
- Tambah config: `SOLVER_NAME`, `SOLVER_BACKEND_URL`
- Auto-register ke backend saat startup
- Heartbeat loop setiap 30 detik
- RFQ handler: terima RFQ → respond dengan quote (SOL balance + estimasi ETA + price)

**Frontend changes:**
- AI Agent tampilkan solver comparison table real-time
- `/solver` page untuk register + bond deposit

---

### Priority 2 — Manual Swap UI (Intent-based)

User bisa swap via UI tradisional (tanpa AI agent) tapi tetap pakai system yang sama di bawah.

```
┌────────────────────────────────────┐
│  Swap                              │
│  From  [Base Sepolia ▼] [ETH ▼]   │
│        Amount: 0.001               │
│               ↕                    │
│  To    [Solana ▼] [SOL ▼]         │
│        ~0.0241 SOL                 │
│                                    │
│  Quote expires: 4:32               │
│  Rate: 1 ETH = 24.1 SOL           │
│  Solver: competing...              │
│  Est. time: ~30s                   │
│                                    │
│  [    Swap via Intent    →    ]    │
└────────────────────────────────────┘
```

**Yang bikin beda dari swap biasa:**
- Ada auction timer (Dutch auction countdown visible)
- Solver selection visible — user tau siapa yang fill order mereka
- Rate berubah real-time mengikuti Dutch auction decay

**Kenapa penting:**
- User non-technical bisa pakai tanpa belajar prompt AI
- Lower barrier to entry
- Untuk demo: show dua entry point (AI Agent + Manual), engine sama

**SwapPage.tsx sudah ada** — perlu di-evolve jadi proper intent-based swap UI.

---

### Priority 3 — Post-Demo Robustness

- Persist solver stats ke DB (sekarang in-memory, reset kalau backend restart)
- Score weighted by USD value (butuh price oracle)
- Step-in fill bonus tracking + reward
- Bond slashing on-chain (Phase 3 dari SOLVER_NETWORK_PLAN.md)

---

## Current Architecture: Active Chains

| Chain | Role | Protocol |
|-------|------|----------|
| Base Sepolia | Intent source | WS (`eth_subscribe` via Alchemy) |
| Solana Devnet | Intent source + destination | WS (`logsSubscribe` + `accountSubscribe`) |
| SUI Testnet | Config kept, listener not spawned | HTTP poll (backend) |

**Fuji/Avalanche: dihapus total dari solver dan backend.**

---

## Connection Mode Logic (Solver)

### EVM Balance (`watch_evm_balance`)
```
BASE_SEPOLIA_WS_URL set → subscribe_blocks WS → get_balance per block
                 unset → HTTP poll setiap 15s
```

### SOL Balance (`watch_sol_balance`)
```
Connect WS → Mode "WS" → HTTP fetch initial balance → accountSubscribe stream
WS fail   → Mode "HTTP" → HTTP fetch → tunggu 15s → retry WS
```

### SOL Intent Listener (`solana_listener::run`)
```
WS logsSubscribe → trigger (notify ada tx baru)
  └── HTTP getProgramAccounts → fetch actual intent data
Ping setiap 30s → prevent idle timeout disconnect
```

### EVM Intent Listener (`evm_listener::run_with_config`)
```
BASE_SEPOLIA_WS_URL set → subscribe_logs WS (OrderCreated events real-time)
                 unset → HTTP getLogs poll setiap 5s
```

---

## Environment Variables

### naisu-solver `.env`
```bash
# Base Sepolia
EVM2_RPC_URL=https://sepolia.base.org
BASE_SEPOLIA_WS_URL=wss://base-sepolia.g.alchemy.com/v2/KEY
EVM2_CONTRACT_ADDRESS=0xFCDE966395c39ED59656BC0fd3a310747Eb68740
EVM2_CHAIN_ID=84532

# EVM shared
EVM_PRIVATE_KEY=0x...
EVM_WORMHOLE_ADDRESS=0x...
EVM_EMITTER_ADDRESS=0x...

# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_WS_URL=wss://api.devnet.solana.com
SOLANA_PRIVATE_KEY=<32-byte-seed-hex>
SOLANA_PROGRAM_ID=Cp6HRKWXgeEycareLXGttNj8dTNfRiFB4Y4UtDuq5EcN

# NEW (untuk decentralized solver network nanti)
# SOLVER_NAME=alpha
# SOLVER_BACKEND_URL=http://localhost:3000
```

### naisu-backend `.env`
```bash
BASE_SEPOLIA_RPC=https://sepolia.base.org
BASE_SEPOLIA_WS_URL=wss://base-sepolia.g.alchemy.com/v2/KEY
BASE_SEPOLIA_INTENT_CONTRACT=0xFCDE966395c39ED59656BC0fd3a310747Eb68740
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_INTENT_PROGRAM_ID=Cp6HRKWXgeEycareLXGttNj8dTNfRiFB4Y4UtDuq5EcN
```

---

## Key Contracts (Testnet)

| Chain | Contract | Address |
|-------|----------|---------|
| Base Sepolia | IntentBridge | `0xFCDE966395c39ED59656BC0fd3a310747Eb68740` |
| Solana Devnet | IntentBridge | `Cp6HRKWXgeEycareLXGttNj8dTNfRiFB4Y4UtDuq5EcN` |
| Sui Testnet | IntentBridge | `0x920f52f8b6734e5333330d50b8b6925d38b39c6d0498dd0053b76e889365cecb` |

---

## Known Issues / Todo

- `cetus.service.ts` — pre-existing TS error `'name' specified more than once` (bukan kode kita, skip)
- `Chain::Avax` dan `AppEvent::Shutdown` di `tui/app.rs` — dead code warnings, intentional (kept for future)
- Sui listener (`sui_listener.rs`) — full dead code, `#![allow(dead_code)]` applied
- WS EVM `watchContractEvent` edge case: jika `OrderFulfilled` datang sebelum `OrderCreated` di-index → trigger `initialEvmBackfill` otomatis sebagai fallback

---

## Commit Log Session 2

| Commit | Deskripsi |
|--------|-----------|
| `cb5122d` | fix(indexer): correct OrderFulfilled ABI + add WS safety net |
| `2ad1f7d` | feat(indexer+sse): push order_created via SSE for real-time new intent |
| `ed45db4` | docs: add solver architecture research |
| `550568c` | docs: add decentralized solver network plan |
