# Naisu One — Handoff Document

_Last updated: 2026-03-18_

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

## Session Summary (2026-03-18)

All commits pushed to `main`. Latest: `00b1655`

---

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

#### .env.example (solver)
- Hapus section Fuji
- Rename `EVM_WS_URL` → `BASE_SEPOLIA_WS_URL`

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

**`getIndexerStatus()`** sekarang expose `mode: 'WS' | 'HTTP_POLL'`

#### env.ts changes
- Hapus: `AVALANCHE_FUJI_RPC`, `AVALANCHE_FUJI_CONTRACT`, `config.intent.evm.fuji`
- Tambah: `BASE_SEPOLIA_WS_URL` (optional)
- Fix: `BASE_SEPOLIA_INTENT_CONTRACT` default → `0xFCDE966395c39ED59656BC0fd3a310747Eb68740`

#### intent.service.ts
- Hapus `getFujiClient()`
- Semua `config.intent.evm.fuji.*` → Base Sepolia equivalent
- Default chain list: `['sui', 'evm-base', 'solana']` (hapus `evm-fuji`)
- Fix pre-existing bug: `ERROR_CODES.UNSUPPORTED_CHAIN` → `ERROR_CODES.VALIDATION_ERROR`

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
BASE_SEPOLIA_WS_URL=wss://base-sepolia.g.alchemy.com/v2/cztilAexgG5aCYvBRkfK-
EVM2_CONTRACT_ADDRESS=0xFCDE966395c39ED59656BC0fd3a310747Eb68740
EVM2_CHAIN_ID=84532

# EVM shared
EVM_PRIVATE_KEY=0x...
EVM_WORMHOLE_ADDRESS=0x...
EVM_EMITTER_ADDRESS=0x...

# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_WS_URL=wss://api.devnet.solana.com   # optional
SOLANA_PRIVATE_KEY=<32-byte-seed-hex>
SOLANA_PROGRAM_ID=Cp6HRKWXgeEycareLXGttNj8dTNfRiFB4Y4UtDuq5EcN

# Sui (config kept, listener not active)
SUI_RPC_URL=https://fullnode.testnet.sui.io:443
SUI_PRIVATE_KEY=...
SUI_PACKAGE_ID=0x920f...
```

### naisu-backend `.env`
```bash
BASE_SEPOLIA_RPC=https://sepolia.base.org
BASE_SEPOLIA_WS_URL=wss://base-sepolia.g.alchemy.com/v2/cztilAexgG5aCYvBRkfK-
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
