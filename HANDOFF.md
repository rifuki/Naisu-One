# Naisu One — Handoff Document

_Last updated: 2026-03-18 (Session 4)_

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
- Sisa EVM fields: `evm_private_key`, `evm_wormhole_address`, `evm_emitter_address`, `base_rpc_url`, `base_contract_address`, `base_chain_id`

#### evm_executor.rs
- `make_client()` sekarang pakai `base_rpc_url` + `base_chain_id` (Base Sepolia)
- Hapus hardcode gas 25 gwei (Fuji-specific)
- `fulfill_and_prove` → `base_contract_address` (bukan Fuji lagi)

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

## Session 3 Summary (2026-03-18)

Latest commit: `12fc471`

### 7. Decentralized Solver Network — Phase 1 Complete

#### 7A. Backend — Solver Registry + RFQ Engine

**New files:**
- `naisu-backend/src/services/solver.service.ts` — in-memory registry, register/heartbeat/list, RFQ broadcast (3s timeout), scoring formula (price 50% + reliability 25% + speed 15% + liquidity 10%), fade detection + auto-suspend 24h
- `naisu-backend/src/routes/solver.ts` — `POST /register`, `POST /heartbeat` (Bearer auth), `GET /list`, `GET /selection/:orderId`

**Modified:**
- `cron/index.ts` — wired `order_created` → `broadcastRFQ`, `order_update FULFILLED` → `recordFill + clearPendingExclusive`, 30s heartbeat checker, 60s fade detector
- `routes/index.ts` — mount `/api/v1/solver`

#### 7B. naisu-solver (Rust) — Coordinator

**New file:** `src/coordinator.rs`
- Auto-register to backend on startup (`POST /api/v1/solver/register`)
- Heartbeat loop every 30s with live SOL + ETH balances
- axum HTTP server on `SOLVER_RFQ_PORT` (default 3001) — backend calls `POST /rfq`, solver responds with quote

**New config vars** (`config.rs`):
```
SOLVER_NAME               # unique name (alpha / beta / gamma)
SOLVER_BACKEND_URL        # naisu-backend base URL
SOLVER_RFQ_PORT           # port for RFQ server (unique per instance, default 3001)
SOLVER_QUOTE_DISCOUNT_BPS # discount off startPrice (100 = 1%, default 200)
SOLVER_ETA_SECONDS        # claimed fill time in seconds (default 11)
SOLVER_TUI                # set false for plain logs when running 3 instances
```

**Quote formula:** `quotedPrice = startPrice - (range × SOLVER_QUOTE_DISCOUNT_BPS / 10000)`

#### 7C. IntentBridge.sol — Solver Registry + Exclusive Window

- `SolverInfo` struct + `solvers` mapping
- `registerSolver(name)` — `MIN_SOLVER_BOND = 0.05 ETH`
- `unregisterSolver()` + `withdrawBond()` — 7-day cooldown
- `Order.exclusiveSolver` + `Order.exclusivityDeadline` fields
- `setExclusiveSolver(orderId, solver)` — `onlyOwner`, called by backend after RFQ
- `settleOrder()` — enforces exclusive window; falls back to open race after deadline
- Events: `SolverRegistered`, `SolverUnregistered`, `BondWithdrawn`, `ExclusiveAssigned`
- `foundry.toml` — `via_ir = true` + optimizer (stack-too-deep fix for 12-field struct)

**Redeployed to Base Sepolia:**
| | Address |
|---|---|
| New | `0xd0d1856674ba1feabee7dd3d4b22cc80488ac2f1` |
| Old | `0xFCDE966395c39ED59656BC0fd3a310747Eb68740` |

All `.env` files + `env.ts` default updated to new address.

#### 7D. Frontend — SolverAuctionCard

**New file:** `naisu-frontend/components/SolverAuctionCard.tsx`
- Injected into agent chat after tx submitted
- Phase 1: polls orders to detect new orderId (~2-4s)
- Phase 2: polls `/api/v1/solver/selection/:orderId` for RFQ result
- Phase 3: renders comparison table with winner (★), scores, ETA, 30s exclusivity countdown

---

## Session 5 Summary (2026-03-18)

Latest commit: (pending)

### 10. Real Price Quotes via Pyth Network

**New file:** `naisu-backend/src/services/pyth.service.ts`
- Fetch ETH/USD, SOL/USD, SUI/USD dari Pyth Hermes REST API (no install, pure HTTP)
- In-memory cache 10s — hindari spam ke Hermes
- `getPythPrices(chains[])` + `getPythRate(from, to)` helpers

**Modified:** `naisu-backend/src/services/intent.service.ts`
- `IntentQuote` type dapat 5 field baru: `fromUsd`, `toUsd`, `rate`, `confidence`, `priceSource`
- `getIntentQuote` — Pyth first, fallback CoinGecko, fallback 1:1
- `startPrice`/`floorPrice` sekarang dihitung dari harga pasar real

**Result:** `GET /quote?fromChain=evm-base&toChain=solana&amount=0.001` sekarang return harga real:
```json
{ "fromUsd": 2321, "toUsd": 94, "rate": 24.65, "priceSource": "pyth" }
```

---

### 11. On-chain Price Validation via Pyth (Security Fix)

**Problem:** `createOrder` (EVM) dan `create_intent` (Solana) menerima arbitrary `startPrice`/`floorPrice`.
Attack vector: user set `floorPrice = 1 lamport` → colluding solver fill untuk hampir 0, klaim ETH.

**EVM — `IntentBridge.sol`:**
- Tambah `IPyth` interface (inline, no dependency)
- Constructor tambah param `address _pyth`
- Pyth contract Base Sepolia: `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729`
- Feed IDs: ETH/USD + SOL/USD (same di semua EVM chains)
- `_validateEthToSolPrice()` internal function:
  - Fetch harga dari Pyth (`getPriceNoOlderThan`, max staleness 5 menit)
  - `floorPrice >= 70% of market rate` (prevent dust attack)
  - `startPrice <= 130% of market rate` (prevent nonsensical high)
  - Called di `createOrder` untuk `destinationChain == WORMHOLE_SOLANA (1)`

**Solana — `lib.rs` (intent-bridge-solana):**
- Tambah sanity bounds di `create_intent`:
  - `floor_price >= 500_000 gwei` (min ~0.0005 ETH, prevent literal zero)
  - `floor_price >= 70% of start_price`
- Note: Full Pyth oracle di Solana = Phase 2 (butuh `pyth-sdk-solana` crate + price account di tx)

**Test — `IntentBridge.t.sol`:**
- Tambah `MockPyth.sol` contract untuk testing
- Update `testSettleOrderSolana` dengan harga realistis (22 SOL start, 15 SOL floor untuk 1 ETH)
- 14/14 tests pass

**Redeployed:**
| | Address |
|---|---|
| EVM IntentBridge (baru, dengan Pyth) | `0xab32659262b0438b3837f0e4e5cb60ae2c9e7701` |
| Solana IntentBridge (upgraded, sama ID) | `Cp6HRKWXgeEycareLXGttNj8dTNfRiFB4Y4UtDuq5EcN` |
| Old EVM | `0xd0d1856674ba1feabee7dd3d4b22cc80488ac2f1` |

Semua `.env` + `env.ts` updated ke address EVM baru.

---

## Next Priorities

### Priority 1 — Manual Swap UI


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
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_SEPOLIA_WS_URL=wss://base-sepolia.g.alchemy.com/v2/KEY
BASE_SEPOLIA_CONTRACT_ADDRESS=0xab32659262b0438b3837f0e4e5cb60ae2c9e7701
BASE_SEPOLIA_CHAIN_ID=84532

# EVM shared
EVM_PRIVATE_KEY=0x...
EVM_WORMHOLE_ADDRESS=0x79A1027a6A159502049F10906D333EC57E95F083
EVM_EMITTER_ADDRESS=0x000000000000000000000000d0d1856674ba1feabee7dd3d4b22cc80488ac2f1

# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_WS_URL=wss://api.devnet.solana.com
SOLANA_PRIVATE_KEY=<32-byte-seed-hex>
SOLANA_PROGRAM_ID=Cp6HRKWXgeEycareLXGttNj8dTNfRiFB4Y4UtDuq5EcN

# Solver network — REQUIRED to register with backend + participate in RFQ auctions
SOLVER_NAME=alpha                          # alpha / beta / gamma
SOLVER_BACKEND_URL=http://localhost:3000
SOLVER_RFQ_PORT=3001                       # 3001 / 3002 / 3003 per instance
SOLVER_QUOTE_DISCOUNT_BPS=200             # discount off startPrice (200 = 2%)
SOLVER_ETA_SECONDS=11                      # claimed fill time in seconds
SOLVER_TUI=false                           # recommended when running 3 instances
```

### naisu-backend `.env`
```bash
BASE_SEPOLIA_RPC=https://sepolia.base.org
BASE_SEPOLIA_WS_URL=wss://base-sepolia.g.alchemy.com/v2/KEY
BASE_SEPOLIA_INTENT_CONTRACT=0xab32659262b0438b3837f0e4e5cb60ae2c9e7701
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_INTENT_PROGRAM_ID=Cp6HRKWXgeEycareLXGttNj8dTNfRiFB4Y4UtDuq5EcN
```

---

## Key Contracts (Testnet)

| Chain | Contract | Address |
|-------|----------|---------|
| Base Sepolia | IntentBridge (+ Pyth oracle) | `0xab32659262b0438b3837f0e4e5cb60ae2c9e7701` |
| Solana Devnet | IntentBridge | `Cp6HRKWXgeEycareLXGttNj8dTNfRiFB4Y4UtDuq5EcN` |
| Sui Testnet | IntentBridge | `0x920f52f8b6734e5333330d50b8b6925d38b39c6d0498dd0053b76e889365cecb` |

---

## Known Issues / Todo

- `cetus.service.ts` — pre-existing TS error `'name' specified more than once` (not our code, skip)
- Sui listener (`sui_listener.rs`) — full dead code, `#![allow(dead_code)]` applied
- WS EVM `watchContractEvent` edge case: if `OrderFulfilled` arrives before `OrderCreated` is indexed → triggers `initialEvmBackfill` as fallback
- Solver stats are in-memory — reset on backend restart (Phase 2: persist to DB)
- `setExclusiveSolver()` requires owner key tx after each RFQ — acceptable for demo, Phase 3 moves this on-chain

---

## Session 4 Summary (2026-03-18)

Latest commit: `bfb6551`

### 8. Cleanup: Remove All Avax/Fuji References + Rename EVM2_ → BASE_SEPOLIA_

**Scope:** naisu-solver, naisu-backend, naisu-frontend, naisu-contracts

#### Env var renames (naisu-solver)
| Old | New |
|-----|-----|
| `EVM2_RPC_URL` | `BASE_SEPOLIA_RPC_URL` |
| `EVM2_CONTRACT_ADDRESS` | `BASE_SEPOLIA_CONTRACT_ADDRESS` |
| `EVM2_CHAIN_ID` | `BASE_SEPOLIA_CHAIN_ID` |

#### Config struct field renames (`src/config.rs`)
| Old | New |
|-----|-----|
| `evm2_rpc_url` | `base_rpc_url` |
| `evm2_contract_address` | `base_contract_address` |
| `evm2_chain_id` | `base_chain_id` |

#### Removed entirely
- `Chain::Avax` enum variant + `AppEvent::Shutdown` (unused) from `tui/app.rs`
- Fuji gas price override (25 gwei) from `evm_executor.rs`
- Hardcoded Fuji wormhole chain ID 6 from `sui_listener.rs`
- `FUJI_CONTRACT`, `AVALANCHE_FUJI_CHAIN_ID`, `WORMHOLE_CHAIN_FUJI`, `AVALANCHE_FUJI_RPC` from frontend constants
- `evm-fuji` from `SupportedChain` type in backend
- `[profile.fuji]` from `foundry.toml`
- `AVALANCHE_FUJI_CHAIN_ID` constant + assert from Sui Move contract
- All snowtrace.io explorer URLs from frontend

**Commits:** `362a92e`, `bfb6551`

---

### 9. Solver Pre-flight Check + activeSolvers in Quote

**Problem:** User could create an on-chain order (locking ETH) with 0 solvers running → funds stuck until deadline.

**Fix — `solver.service.ts`:**
- `getActiveSolverCount()` — returns count of `online && !suspended` solvers

**Fix — `routes/intent.ts`:**
- `GET /quote` response now includes `activeSolvers: number`
- `POST /build-tx` with `action === 'create_order'` returns **503** if `activeSolvers === 0`

**Fix — `nesu.md` (agent system prompt):**
- Rule 2: if `activeSolvers === 0` from quote → **do NOT build tx**, warn user instead
- Double protection: agent blocks first, backend blocks as fallback

**Solver backfill (already existed):** `run_ws_mode` catchup scans 2000 blocks back (~67 min on Base Sepolia) on every start/reconnect — solver started late still catches existing OPEN orders.

**Commit:** `1b9ded3`

---

## Commit Log Session 4

| Commit | Description |
|--------|-------------|
| `362a92e` | refactor: remove all Avax/Fuji references, rename EVM2_ to BASE_SEPOLIA_ |
| `1b9ded3` | feat: block tx build + warn agent when no solver is active |
| `bfb6551` | fix(solver): update .env.example emitter address to new contract |

---

## Commit Log Session 3

| Commit | Description |
|--------|-------------|
| `18b1678` | feat(backend): add solver registry + RFQ engine + scoring (Phase 1) |
| `89aae95` | feat(solver): add coordinator — register + heartbeat + RFQ server (Phase 1C) |
| `cb356cb` | docs(solver): update .env.example with solver network vars |
| `8a0ea3e` | feat(contracts): add solver registry + exclusive window to IntentBridge |
| `eb47d8f` | feat(frontend): add solver auction card in agent chat after tx submit |
| `12fc471` | feat(contracts): redeploy IntentBridge to Base Sepolia with solver registry |
| `f470304` | docs: update HANDOFF.md — session 3 summary + solver network complete |

## Commit Log Session 2

| Commit | Description |
|--------|-------------|
| `cb5122d` | fix(indexer): correct OrderFulfilled ABI + add WS safety net |
| `2ad1f7d` | feat(indexer+sse): push order_created via SSE for real-time new intent |
| `ed45db4` | docs: add solver architecture research |
| `550568c` | docs: add decentralized solver network plan |
