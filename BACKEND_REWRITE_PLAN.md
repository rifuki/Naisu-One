# Naisu Backend Rewrite — TypeScript → Rust

> Status: PHASE 1 COMPLETE
> Last updated: 2026-03-20

---

## Overview

Rewrite `naisu-backend` (Hono+Bun) to `naisu-backend-rs` (Axum+Tokio+Alloy).
Pattern base: copy from `/Users/rifuki/mgodonf/aksara/api` then adapt.

**What is being ported (core only):**
- Intent Bridge API (SSE, orders, gasless submit, cancel, nonce)
- Solver WebSocket (register, heartbeat, RFQ, execute relay)
- EVM Indexer (IntentBridge log watcher via alloy-rs)
- Gasless orderbook + state machine
- RFQ auction engine (scoring, winner selection, fade detection)
- Health endpoint

**What is NOT ported (out of scope for now):**
- Sui/Cetus CLMM routes
- Uniswap V4 routes
- Yield/APY routes
- Portfolio aggregation
- Pyth oracle (add later)
- Solana balance endpoint

---

## Target Directory Structure

```
naisu-backend-rs/
├── Cargo.toml
└── src/
    ├── main.rs
    ├── lib.rs
    ├── routes.rs                    — top-level router merge
    ├── state.rs                     — AppState (config + stores)
    ├── feature/
    │   ├── mod.rs
    │   ├── health/
    │   │   ├── mod.rs
    │   │   ├── handlers.rs
    │   │   └── routes.rs
    │   ├── intent/
    │   │   ├── mod.rs
    │   │   ├── model.rs             — IntentOrder, ProgressStep, IntentStatus, SolverProgressEvent
    │   │   ├── store.rs             — DashMap<orderId, IntentOrder> + user nonce map
    │   │   ├── orderbook.rs         — Gasless state machine (pending_rfq → fulfilled/expired)
    │   │   ├── handlers.rs          — REST handlers + SSE watch
    │   │   └── routes.rs
    │   └── solver/
    │       ├── mod.rs
    │       ├── model.rs             — SolverInfo, SolverStatus, RfqQuote, SolverTier
    │       ├── registry.rs          — DashMap<solverId, SolverInfo> connected solvers
    │       ├── auction.rs           — RFQ scoring, winner selection, fade detection, tier
    │       ├── handlers.rs          — WS upgrade handler + REST (list, selection)
    │       └── routes.rs
    └── infrastructure/
        ├── mod.rs
        ├── config.rs                — ServerConfig + ChainConfig (Base Sepolia RPC, contract addr)
        ├── env.rs                   — dotenvy dual-load (local .env + workspace .env)
        ├── logging.rs               — terminal + file rotation layers
        ├── server.rs                — TCP listener + graceful shutdown
        ├── indexer/
        │   ├── mod.rs
        │   └── evm.rs              — alloy-rs WsProvider, subscribe IntentBridge logs, emit events
        └── web/
            ├── mod.rs
            ├── cors.rs
            ├── middleware/
            │   ├── mod.rs
            │   └── http_trace.rs   — request/response tracing (from aksara)
            └── response/
                ├── mod.rs
                ├── error.rs        — ApiError builder (from aksara)
                └── success.rs      — ApiSuccess<T> builder (from aksara)
```

---

## Key Dependencies (Cargo.toml)

```toml
axum          = { version = "0.8", features = ["ws", "macros"] }
tokio         = { version = "1", features = ["full"] }
alloy         = { version = "1", features = ["providers", "transports-ws", "sol-types", "contract"] }
tower-http    = { version = "0.6", features = ["cors"] }
dashmap       = "6"
serde         = { version = "1", features = ["derive"] }
serde_json    = "1"
tokio-stream  = "0.1"           # for SSE stream conversion
futures       = "0.3"
tracing       = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
tracing-appender   = "0.2"
eyre          = "0.6"
color-eyre    = "0.6"
dotenvy       = "0.15"
uuid          = { version = "1", features = ["v4"] }
chrono        = { version = "0.4", features = ["serde"] }
hex           = "0.4"

# Phase 2 (SQLite persistence)
sqlx          = { version = "0.8", features = ["sqlite", "runtime-tokio", "chrono", "uuid"] }
```

---

## AppState

```rust
pub struct AppState {
    pub config:         Arc<Config>,
    pub intent_store:   Arc<IntentStore>,    // DashMap orders
    pub solver_registry: Arc<SolverRegistry>, // DashMap solvers
    pub event_tx:       tokio::sync::broadcast::Sender<SolverProgressEvent>, // SSE fan-out
}
```

SSE uses `broadcast::channel` — one sender (indexer + solver WS), N receivers (frontend SSE connections).

---

## SSE Architecture

```
alloy indexer  ─┐
solver WS rx   ─┼──► broadcast::Sender<SolverProgressEvent>
                │
                ├──► SSE subscriber 1 (frontend tab A)
                ├──► SSE subscriber 2 (frontend tab B)
                └──► SSE subscriber N
```

Frontend connects to `GET /api/v1/intent/watch?user=<addr>`.
Each SSE handler subscribes to the broadcast channel and filters by user/orderId.

---

## Solver WS Architecture

```
Solver connects to ws://backend/api/v1/solver/ws
  → sends { type: "register", name, evmAddress, solanaAddress }
  → backend sends { type: "registered", solverId, token }

Active session:
  solver → { type: "heartbeat", balances... }       every 30s
  backend → { type: "rfq", orderId, prices... }     on new gasless intent
  solver → { type: "rfq_quote", orderId, price }    within 5s
  backend → { type: "execute", intentId, intent, sig } to winner
  solver → { type: "execute_confirmed", txHash }
  solver → { type: "sol_sent", txHash }
  solver → { type: "vaa_ready" }
  solver → { type: "settled", txHash }
```

Each solver WS connection holds a `mpsc::Sender` for backend→solver messages.
Registry stores `DashMap<String, SolverSession>` where session contains the sender.

---

## EVM Indexer (alloy-rs)

Watch `IntentCreated` and `IntentFulfilled` events on IntentBridge (Base Sepolia):

```rust
// Filter for IntentBridge contract logs
let filter = Filter::new()
    .address(contract_address)
    .events(["IntentCreated(...)", "IntentFulfilled(...)"]);

let sub = provider.subscribe_logs(&filter).await?;
```

On `IntentCreated` → insert into `intent_store` → emit `order_created` via broadcast.
On `IntentFulfilled` → update store status → emit `order_fulfilled` via broadcast.

HTTP fallback: poll `eth_getLogs` every 10s if WS disconnects.

---

## Gasless Flow (Rust equivalent)

```
POST /intent/submit-signature
  → verify EIP-712 signature (alloy SignTypedData verify)
  → orderbook.add_intent(intent)
  → trigger RFQ broadcast to eligible solvers
  → return { intentId }

RFQ:
  → collect quotes from solvers (5s window)
  → score: price 60% + tier 25% + ETA 15%
  → pick winner (20% slot for new solvers)
  → send { type: "execute" } to winner via WS
  → emit rfq_winner via broadcast → SSE to frontend
```

---

## Implementation Phases

### Phase 1 — Scaffold (copy aksara, wire basics) ✅ DONE
- [x] Copy aksara/api to naisu-backend-rs
- [x] Update Cargo.toml (name, new deps)
- [x] Remove aksara-specific: wallet_auth middleware, on_chain middleware, aksara feature
- [x] Add health feature (keep from aksara)
- [x] Verify: `cargo build` clean

### Phase 2 — Intent Store + REST (no SSE yet) ✅ DONE
- [x] `feature/intent/model.rs` — all types ported from TS
- [x] `feature/intent/store.rs` — DashMap store + nonce map
- [x] `feature/intent/orderbook.rs` — state machine
- [x] `feature/intent/handlers.rs` — GET /orders, GET /nonce, PATCH /cancel
- [x] State wired to AppState

### Phase 3 — SSE Watch Endpoint ✅ DONE
- [x] `broadcast::channel` in AppState
- [x] `GET /intent/watch` — axum SSE handler
- [x] Snapshot on connect (current orders for user)
- [x] Ping heartbeat every 30s
- [x] 10-min auto-close

### Phase 4 — Solver WebSocket
- [ ] `feature/solver/model.rs`
- [ ] `feature/solver/registry.rs` — DashMap sessions
- [ ] `feature/solver/handlers.rs` — WS upgrade, message loop
- [ ] Register/heartbeat/rfq_quote handling
- [ ] Heartbeat cron (check 60s timeout)

### Phase 5 — RFQ Auction Engine
- [ ] `feature/solver/auction.rs` — scoring, winner selection
- [ ] Fade detection (3 fades → 24h suspend)
- [ ] Tier computation (0-3 based on fill rate)
- [ ] RFQ broadcast to eligible solvers
- [ ] Winner execute relay + SSE emit

### Phase 6 — EVM Indexer (alloy-rs)
- [ ] `infrastructure/indexer/evm.rs`
- [ ] alloy WsProvider subscribe IntentBridge logs
- [ ] Parse IntentCreated → store + broadcast
- [ ] Parse IntentFulfilled → store update + broadcast
- [ ] HTTP poll fallback on WS disconnect

### Phase 7 — Gasless Submit + EIP-712
- [ ] `POST /intent/build-gasless` — compute prices, return unsigned intent
- [ ] `POST /intent/submit-signature` — verify EIP-712 + trigger RFQ
- [ ] Alloy EIP-712 signature verification
- [ ] `GET /intent/quote` + `GET /intent/price`

### Phase 8 — SQLite Persistence (sqlx)
- [ ] sqlx + SQLite migrations
- [ ] Persist orders on write
- [ ] Restore on startup
- [ ] Keep DashMap as L1 cache

### Phase 9 — Cutover
- [ ] Integration test all endpoints match TS backend
- [ ] Deploy to VPS alongside TS backend
- [ ] Switch frontend env to Rust backend
- [ ] Deprecate TS backend

---

## What to Copy Verbatim from Aksara

| File | Action |
|---|---|
| `infrastructure/env.rs` | Copy as-is |
| `infrastructure/logging.rs` | Copy as-is |
| `infrastructure/server.rs` | Copy as-is |
| `infrastructure/web/cors.rs` | Copy, simplify (remove RFC headers) |
| `infrastructure/web/middleware/http_trace.rs` | Copy as-is |
| `infrastructure/web/response/error.rs` | Copy as-is |
| `infrastructure/web/response/success.rs` | Copy as-is |
| `infrastructure/config.rs` | Rewrite (different env vars) |
| `feature/health/` | Copy as-is |
| `state.rs` | Rewrite |
| `routes.rs` | Rewrite |
| `main.rs` | Rewrite |

---

## Env Vars (naisu-backend-rs)

```env
# Server
PORT=3000
RUST_ENV=development
CORS_ALLOWED_ORIGINS=http://localhost:8080

# EVM
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_SEPOLIA_WS_URL=wss://...
BASE_SEPOLIA_CONTRACT_ADDRESS=0x26B7E5af3F1831ca938444c02CecFeBBb86F748e
BASE_SEPOLIA_CHAIN_ID=84532

# Optional persistence
DATABASE_URL=sqlite://data/naisu.db
```

---

## Frontend Impact

Zero changes needed during Phase 1-7.
All endpoint paths identical to TS backend:
- `GET /api/v1/intent/watch` ✓
- `POST /api/v1/intent/submit-signature` ✓
- `ws://backend/api/v1/solver/ws` ✓
- etc.

Only `VITE_BACKEND_URL` env change on cutover.
