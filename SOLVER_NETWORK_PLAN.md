# Naisu Decentralized Solver Network — Implementation Plan
> Dibuat: March 2026
> Status: Planning Phase

---

## Vision

Siapapun bisa jadi solver di Naisu tanpa whitelist. Seleksi murni berbasis
performa on-chain — **pure meritocracy, zero gatekeeping.**

```
User submit order
      ↓
Backend broadcast RFQ ke semua solver aktif (berapapun jumlahnya)
      ↓
Solver compete: quote harga terbaik + ETA
      ↓
AI Agent tampilkan perbandingan → pilih winner
      ↓
Winner dapat exclusive window → fill → claim ETH
      ↓
Stats terupdate on-chain → reputation naik
```

---

## Komponen Arsitektur

```
┌─────────────────────────────────────────────────────────┐
│                     Smart Contract                       │
│  createOrder() → exclusiveSolver + exclusivityDeadline   │
│  settleOrder() → enforce exclusive, fallback open race   │
│  registerSolver() → bond deposit                         │
└─────────────────┬───────────────────────────────────────┘
                  │ events (WS)
┌─────────────────▼───────────────────────────────────────┐
│                  Backend (Coordinator)                    │
│  Solver Registry  │  RFQ Engine  │  Scoring Engine       │
│  /solver/register │  broadcast   │  reliability/speed    │
│  /solver/list     │  collect     │  weighted by value    │
│  /solver/select   │  timeout 3s  │  auto-suspend         │
└──────┬────────────────────────────────────────┬──────────┘
       │ register + respond RFQ                 │ SSE/REST
┌──────▼──────┐  ┌─────────────┐  ┌────────────▼─────────┐
│  Solver A   │  │  Solver B   │  │    Frontend           │
│  (self-host)│  │  (self-host)│  │  AI Agent shows:      │
│  .env config│  │  .env config│  │  - solver comparison  │
│  cargo run  │  │  cargo run  │  │  - winner reasoning   │
└─────────────┘  └─────────────┘  │  - fill progress      │
                                   └──────────────────────┘
```

---

## Solver Selection Criteria

### Scoring Formula
```
score = (quotedPrice / bestPrice)  × 0.50   // harga terbaik untuk user
      + reliability                × 0.25   // % order berhasil di-fill
      + (fastestETA / eta)         × 0.15   // seberapa cepat
      + hasLiquidity               × 0.10   // cukup modal sekarang
```

### Kriteria Detail

| Kriteria | Bobot | Sumber Data | Keterangan |
|---|---|---|---|
| **Quoted price** | 50% | Solver response RFQ | SOL yang dikirim ke recipient — makin tinggi makin bagus untuk user |
| **Reliability** | 25% | On-chain events | `OrderFulfilled / total RFQ accepted` — weighted by order value |
| **Estimated fill time** | 15% | Solver response + history | Klaim ETA vs actual historical ETA |
| **Available liquidity** | 10% | On-chain balance check | SOL balance ≥ order amount × 1.1 |

### Score Weighted by Order Value (Anti-Gaming)
```typescript
// BUKAN: 1 fill = 1 point (bisa di-game dengan spam micro orders)
// TAPI:  weighted by USD value
reliabilityScore = totalFilledValueUSD / totalRFQValueUSD

// Fill 1000x order $1  = $1000 weighted score
// Fill 1x order $1000  = $1000 weighted score
// Sama — tidak bisa boost score murah lewat micro spam
```

---

## Tier System (Cold Start Solution)

New solver tidak langsung lawan veteran di order besar.

### Order Routing by Tier

```
Micro  (< 0.01 ETH)  → semua solver eligible, new solver PRIORITAS
Small  (< 0.1 ETH)   → solver dengan ≥ 1 fill
Medium (< 1 ETH)     → solver dengan ≥ 10 fills + reliability ≥ 60%
Large  (> 1 ETH)     → solver dengan ≥ 50 fills + reliability ≥ 80%
```

### 20% Reserved Slot untuk New Solver
```typescript
function selectWinner(quotes: Quote[], order: Order): Quote {
  const veterans = quotes.filter(s => s.totalFills >= 10)
  const newbies  = quotes.filter(s => s.totalFills < 10)

  // 20% chance → new solver dapat kesempatan
  // (antar newbie masih dicompete berdasarkan score)
  if (Math.random() < 0.20 && newbies.length > 0) {
    return pickBest(newbies)
  }
  return pickBest(veterans)
}
```

### Step-In Fill Bonus (Persis Across Protocol)
```
Veteran dapat exclusive window 30 detik
Deadline lewat, veteran tidak fill → open race
Solver yang step-in fill → +10 bonus reliability points
→ New solver bisa naik tier cepat tanpa butuh exclusive window
```

### Journey New Solver
```
Register + deposit bond
      ↓
Dapat micro orders + step-in opportunity
      ↓ (3-5 fills berhasil)
Tier 1 → dapat small orders + 20% slot
      ↓ (10+ fills, reliability > 60%)
Tier 2 → kompetisi penuh sama veteran
      ↓ (50+ fills, reliability > 80%)
Veteran → eligible semua order size
```

---

## Attack Vectors & Mitigations

### 🔴 Critical

#### 1. Sybil Attack + Wash Trading
**Attack:**
```
Attacker buat 50 wallet baru
Semua register sebagai solver
Saling fill order micro satu sama lain
→ Build fake reliability score dengan biaya hampir nol
→ Naik tier → manipulate large orders
```

**Mitigation: Registration Bond**
```solidity
uint256 public constant MIN_SOLVER_BOND = 0.05 ether;

function registerSolver(string calldata name) external payable {
    require(msg.value >= MIN_SOLVER_BOND, "Insufficient bond");
    require(!solvers[msg.sender].active, "Already registered");

    solvers[msg.sender] = SolverInfo({
        name:        name,
        bond:        msg.value,
        active:      true,
        registeredAt: block.timestamp
    });
    emit SolverRegistered(msg.sender, name, msg.value);
}

function unregisterSolver() external {
    require(solvers[msg.sender].active, "Not registered");
    // 7 hari cooldown sebelum bond bisa di-withdraw
    // mencegah hit-and-run
    solvers[msg.sender].unregisterAt = block.timestamp;
    solvers[msg.sender].active = false;
}

function withdrawBond() external {
    SolverInfo storage s = solvers[msg.sender];
    require(s.unregisterAt > 0, "Not unregistered");
    require(block.timestamp >= s.unregisterAt + 7 days, "Cooldown active");
    uint256 amount = s.bond;
    s.bond = 0;
    payable(msg.sender).transfer(amount);
}
```
Buat 50 identity = **2.5 ETH cost** → tidak worth it.

---

#### 2. Quote-and-Fade (Paling Berbahaya untuk UX)
**Attack:**
```
Solver quote harga bagus → dapat exclusive window
Sengaja tidak fill
→ Order delay 30 detik nunggu deadline
→ User experience rusak
→ Dipakai untuk delay kompetitor atau testing tanpa komitmen
```

**Mitigation: Fade Penalty**
```typescript
// Backend track setiap exclusive window yang missed
async function checkExpiredExclusiveWindows() {
  const expired = await getExpiredUnfilledOrders()

  for (const order of expired) {
    const solver = registry.get(order.exclusiveSolver)
    if (!solver) continue

    solver.fadePenalty++
    solver.reliabilityScore -= 10  // langsung potong score

    if (solver.fadePenalty >= 3) {
      solver.suspended    = true
      solver.suspendUntil = Date.now() + 24 * 60 * 60 * 1000 // 24 jam
      logger.warn({ solver: solver.name }, 'Solver suspended: too many fades')
    }

    await registry.save(solver)
  }
}
```

---

#### 3. Backend Single Point of Failure
**Attack / Risk:**
```
Backend down atau dikompromis
→ Tidak ada yang assign exclusive solver
→ Atau attacker manipulate selection
→ User stuck / sistem tidak jalan
```

**Mitigation: Contract Fallback — Open Race Tanpa Backend**
```solidity
function settleOrder(bytes calldata encodedVaa) external {
    // ... parse VAA, get orderId

    Order storage order = orders[orderId];
    require(order.status == STATUS_OPEN, "Order not active");

    // Enforce exclusive window kalau ada dan belum expired
    if (order.exclusiveSolver != address(0) &&
        block.timestamp < order.exclusivityDeadline) {
        require(msg.sender == order.exclusiveSolver, "Exclusive window active");
    }
    // Kalau exclusiveSolver == address(0) ATAU deadline lewat:
    // → siapapun bisa fill (open race / Dutch auction)

    // ... rest of settle logic
    emit OrderFulfilled(orderId, msg.sender);
}
```
**Backend = optimization layer, bukan requirement.**
Contract tetap jalan meskipun backend down — hanya kehilangan smart selection.

---

### 🟡 Medium

#### 4. Collusion Step-In
**Attack:**
```
Solver A (veteran) dan Solver B (newbie) satu owner
A sengaja miss exclusive window
B step-in → dapat bonus reputation
→ B naik tier cepat tanpa beneran kompetisi
```

**Mitigation (Partial):**
```typescript
// Step-in bonus HANYA kalau exclusive solver benar-benar tidak respond
// Bukan kalau mereka respond tapi tidak fill (yang bisa dicollude)
// Susah prevent sepenuhnya tanpa ZK proof of non-collusion
// Acceptable risk: cost of collusion = bond dua wallet + gas
```

---

#### 5. Score Gaming dengan Micro Orders
**Attack:**
```
Fill 1000 micro orders → reliability 99%
Naik ke tier veteran
Fade pada large order → user stuck, damage done
```

**Mitigation:** Score weighted by USD value (sudah di-cover di atas).

---

#### 6. Liquidity Spoofing
**Attack:**
```
Balance on-chain tinggi saat di-check
Dapat exclusive window
Pindahin dana sebelum fill
→ Tidak bisa fill, order delay
```

**Mitigation:**
```typescript
// Cek balance SAAT respond RFQ (bukan cached)
// Dan tambah buffer requirement
const required = order.amountSOL * 1.2  // 20% buffer
const balance  = await connection.getBalance(solver.solanaAddress)
if (balance < required) {
  // Jangan include dalam kandidat winner
  return null
}

// Kalau solver dapat exclusive tapi ternyata balance kurang saat fill
// → Fade penalty tetap berlaku
```

---

### 🔴 Tidak Bisa Di-fix Sempurna (Accepted Risk)

| Celah | Kenapa Susah | Status Industri |
|---|---|---|
| **Colluding solvers** | Tidak bisa prove dua address satu owner on-chain | Across, UniswapX juga tidak solve |
| **Pricing cartel** | Kalau semua solver quote jelek, user tidak punya pilihan | Butuh token economics lebih complex |
| **MEV frontrun** | Solver skip RFQ, frontrun saat exclusive expired | Mitigasi partial via private mempool |

---

## Implementation Plan

### Phase 1 — Foundation (Untuk Demo 3 Solver)

#### 1A. Smart Contract Changes
- [ ] Tambah `SolverInfo` struct + `solvers` mapping
- [ ] `registerSolver()` dengan bond requirement
- [ ] `unregisterSolver()` + `withdrawBond()` dengan 7 hari cooldown
- [ ] Tambah `exclusiveSolver` + `exclusivityDeadline` ke `Order` struct
- [ ] Update `settleOrder()` — enforce exclusive + open fallback
- [ ] Event: `SolverRegistered`, `SolverUnregistered`, `ExclusiveAssigned`

#### 1B. Backend — Solver Registry + RFQ Engine
- [ ] In-memory solver registry (name, address, stats, status)
- [ ] `POST /api/v1/solver/register` — solver daftar saat startup
- [ ] `GET  /api/v1/solver/list` — list semua solver aktif + stats
- [ ] `GET  /api/v1/solver/selection/:orderId` — hasil seleksi + reasoning
- [ ] RFQ broadcast: saat `OrderCreated`, broadcast ke semua solver aktif
- [ ] Quote collection: tunggu max 3 detik, collect semua response
- [ ] Winner selection: scoring formula + tier check
- [ ] Fade detection: cron job cek expired exclusive windows
- [ ] Auto-suspend: logic suspend solver yang terlalu banyak fade
- [ ] Heartbeat: solver kirim ping setiap 30s, yang tidak ping dianggap offline

#### 1C. naisu-solver (Rust) Changes
- [ ] Tambah config: `SOLVER_NAME`, `SOLVER_BACKEND_URL`
- [ ] Startup: auto-register ke backend (`POST /solver/register`)
- [ ] Heartbeat loop: ping backend setiap 30 detik
- [ ] RFQ handler: terima RFQ dari backend, respond dengan quote
- [ ] Quote calculation: hitung SOL balance, estimasi fill time, compute price
- [ ] Graceful shutdown: unregister dari backend saat SIGTERM

#### 1D. Frontend — AI Agent Solver Selection UI
- [ ] Setelah order confirmed, agent tampilkan:
  ```
  "Broadcasting RFQ to N active solvers..."
  "Received quotes from N solvers:"

  ┌──────────────┬────────────┬──────┬─────────────┬───────┐
  │ Solver       │ Quote      │ ETA  │ Reliability │ Score │
  ├──────────────┼────────────┼──────┼─────────────┼───────┤
  │ 🥇 Alpha     │ 0.0241 SOL │  8s  │   98%       │ 94.2  │ ← WINNER
  │    Beta      │ 0.0239 SOL │ 15s  │   94%       │ 88.1  │
  │    Gamma     │ 0.0240 SOL │ 11s  │   96%       │ 91.0  │
  └──────────────┴────────────┴──────┴─────────────┴───────┘

  "Selected Alpha — best price with high reliability.
   Exclusive window: 30 seconds."
  ```
- [ ] Live update: show fill progress dari solver yang menang
- [ ] `/solver` page: register form + bond deposit + personal dashboard

---

### Phase 2 — Robustness (Post-Demo)

- [ ] Persist solver stats ke database (sekarang in-memory, reset kalau backend restart)
- [ ] Score weighted by USD value (butuh price oracle)
- [ ] Step-in fill bonus — track dan reward solver yang step-in
- [ ] Solver dashboard: earnings history, fill rate chart, tier progress
- [ ] Bond slashing on-chain (bukan hanya reputation penalty)
- [ ] Private mempool integration (mitigate MEV frontrun)

---

### Phase 3 — Decentralization Maturity

- [ ] On-chain solver scoring (bukan off-chain backend)
- [ ] DAO governance untuk slash parameters
- [ ] ERC-7683 compliance (cross-chain intents standard)
- [ ] Multi-chain solver (solver bisa fill Base→Sui, Base→Solana, dll)
- [ ] Solver SDK documentation + onboarding guide publik

---

## Demo Setup (3 Solver Lokal)

```bash
# Siapkan 3 set private keys berbeda
# Masing-masing punya SOL + ETH untuk operasi

# Terminal 1 — Solver Alpha (fast, slightly expensive)
SOLVER_NAME=alpha \
SOLVER_EVM_KEY=0xAAA... \
SOLVER_SOL_KEY=AAA... \
SOLVER_BACKEND_URL=http://localhost:3000 \
cargo run --release

# Terminal 2 — Solver Beta (cheap, slightly slower)
SOLVER_NAME=beta \
SOLVER_EVM_KEY=0xBBB... \
SOLVER_SOL_KEY=BBB... \
SOLVER_BACKEND_URL=http://localhost:3000 \
cargo run --release

# Terminal 3 — Solver Gamma (balanced)
SOLVER_NAME=gamma \
SOLVER_EVM_KEY=0xCCC... \
SOLVER_SOL_KEY=CCC... \
SOLVER_BACKEND_URL=http://localhost:3000 \
cargo run --release
```

Scaleable: untuk tambah solver ke-4 atau ke-5, cukup run instance baru.
Backend auto-detect via register endpoint. **Zero config di coordinator.**

---

## Solver Profiles untuk Demo

Tiap solver dikonfigurasi dengan "personality" berbeda agar demo menarik:

| Solver | Karakter | Quote Strategy | ETA Strategy |
|---|---|---|---|
| **Alpha** | Fast but pricey | startPrice - 1% | Klaim 8 detik |
| **Beta** | Cheap but slower | startPrice - 3% | Klaim 15 detik |
| **Gamma** | Balanced | startPrice - 2% | Klaim 11 detik |

Winner bervariasi tergantung order:
- Order kecil → Beta sering menang (price matters more)
- Order dengan deadline ketat → Alpha menang (speed matters more)
- Normal → Gamma atau Alpha bergantian

---

## API Spec — Solver ↔ Backend

### Solver → Backend

```
POST /api/v1/solver/register
Body: {
  name:           "alpha",
  evmAddress:     "0x...",
  solanaAddress:  "7Wk...",
  supportedRoutes: ["evm-base→solana", "evm-base→sui"]
}
Response: { solverId: "uuid", token: "jwt-for-heartbeat" }

POST /api/v1/solver/heartbeat
Headers: Authorization: Bearer <token>
Body: {
  solanaBalance: "6.42",
  evmBalance:    "0.43",
  status:        "ready"
}

POST /api/v1/solver/quote  (backend call ini ke solver via HTTP)
Body: {
  orderId:          "0x...",
  amount:           "0.001",
  destinationChain: 1,
  deadline:         1710000000
}
Response: {
  solverId:    "uuid",
  quotedPrice: "24500000",   // lamports
  estimatedETA: 8,           // seconds
  expiresAt:   1710000030
}
```

### Backend → Frontend (SSE + REST)

```
GET /api/v1/solver/list
Response: [{
  name:         "alpha",
  tier:         2,
  reliability:  0.98,
  totalFills:   147,
  avgFillTime:  8.3,
  suspended:    false
}]

GET /api/v1/solver/selection/:orderId
Response: {
  orderId:    "0x...",
  rfqSentAt:  1710000000,
  quotes: [{
    solver:       "alpha",
    quotedPrice:  "24500000",
    estimatedETA: 8,
    score:        94.2,
    winner:       true
  }, ...],
  winner:     "alpha",
  reasoning:  "Best overall score: highest price quote with top reliability",
  exclusivityDeadline: 1710000030
}
```

---

## Key Design Decisions

1. **Backend = optimization only, contract = source of truth**
   Backend down → contract tetap jalan via open Dutch auction. User tidak pernah stuck.

2. **Stats dari on-chain, bukan self-report**
   Reliability dihitung dari `OrderFulfilled` events on-chain. Tidak bisa dimanipulasi.

3. **Tidak ada on-chain "claim" step**
   Solver langsung fill atau tidak. Tidak ada state "reserved" yang bisa dipakai untuk griefing.

4. **Bond sebagai sybil resistance, bukan collateral**
   Bond tidak di-slash untuk miss (hanya reputation yang kena). Di-slash hanya untuk violation eksplisit (Phase 3).

5. **Scaleable by design**
   Coordinator tidak hardcode jumlah solver. Tambah solver = run instance baru. Zero config di backend.

---

## File yang Perlu Diubah

```
naisu-contracts/evm/src/IntentBridge.sol    ← exclusive solver + bond
naisu-backend/src/services/indexer.ts       ← track solver stats
naisu-backend/src/services/solver.service.ts ← NEW: registry + RFQ + scoring
naisu-backend/src/routes/solver.ts          ← NEW: solver endpoints
naisu-backend/src/routes/index.ts           ← register solver router
naisu-solver/src/config.rs                  ← tambah SOLVER_NAME, BACKEND_URL
naisu-solver/src/lib.rs                     ← auto-register + heartbeat + RFQ handler
naisu-frontend/hooks/useSolverSelection.ts  ← NEW: query solver selection
naisu-frontend/pages/AgentPage.tsx          ← tampilkan solver comparison
naisu-frontend/pages/SwapPage.tsx           ← NEW: /solver registration page (atau halaman terpisah)
```
