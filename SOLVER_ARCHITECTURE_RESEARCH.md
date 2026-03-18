# Decentralized Solver Architecture Research
> Riset untuk Naisu One — March 2026
> Sumber: Across Protocol, UniswapX, CoW Protocol, 1inch Fusion, NEAR Intents, LI.FI

---

## Latar Belakang Masalah

Naisu One saat ini menggunakan **single solver** (satu pihak). Untuk decentralize, siapapun harus bisa jadi solver. Masalah yang muncul:

1. **Race condition** — dua solver kirim SOL ke recipient, tapi hanya satu yang bisa claim ETH di contract → yang kalah rugi
2. **Griefing** — solver "claim" order tapi tidak fill → user stuck
3. **Selection** — bagaimana memilih solver yang paling qualified?
4. **Settlement fairness** — bagaimana solver yang kalah tidak rugi gas?

---

## Ringkasan 3 Pattern Utama Industri

### Pattern 1: Exclusive Window + Open Fallback
**Dipakai oleh: Across Protocol, UniswapX**

```
OrderCreated
    ↓
Off-chain: nominate 1 solver (scoring-based)
    ↓
Contract: encode exclusiveSolver + exclusivityDeadline
    ↓
[Dalam deadline] → hanya exclusiveSolver yang bisa fill
    ↓
[Deadline lewat] → open race, siapapun bisa fill (Dutch auction price decay)
```

Kelebihan:
- Race condition hampir nol di fase exclusive
- Liveness terjaga (kalau solver miss, ada fallback)
- Tidak butuh bond/slashing yang kompleks

Kekurangan:
- Butuh off-chain coordinator (Solver Bus) untuk nominasi
- Loser di open phase tetap bayar gas revert

---

### Pattern 2: Batch Auction Off-Chain
**Dipakai oleh: CoW Protocol**

```
Autopilot kumpulkan semua order dalam ~30 detik
    ↓
Semua solver submit solusi OFF-CHAIN dalam 15 detik
    ↓
Autopilot pilih winner (maximise user surplus)
    ↓
Hanya 1 winner yang submit ke chain
```

Kelebihan:
- **Loser = zero gas cost** (yang terbaik secara ekonomi)
- Tidak ada on-chain race sama sekali

Kekurangan:
- Butuh centralized Autopilot yang kompleks
- Latency tinggi (30s+ per batch)
- KYC + bond + DAO governance required

---

### Pattern 3: Staking-Tiered Dutch Auction
**Dipakai oleh: 1inch Fusion**

```
Solver stake 1INCH → dapat Unicorn Power
Top 10 by UP = eligible solver
Top 5 by UP = priority window de facto (isi pertama saat price masih tinggi)
Price decay block-by-block → siapapun fill saat sudah profitable
```

Kelebihan:
- Sybil resistance via staking
- Tidak butuh off-chain coordinator

Kekurangan:
- Max 10 solver aktif (hard cap)
- Loser tetap bayar gas revert
- KYC required

---

## Detail Per Protokol

### 1. Across Protocol

**Arsitektur:** SpokePool (per-chain) + HubPool (Ethereum) + UMA Optimistic Oracle

**Race Condition Handling: Exclusive Relayer Model**
- Saat deposit, dua field ditulis ke event: `exclusiveRelayer` (address) + `exclusivityDeadline` (timestamp)
- SpokePool enforce: hanya `exclusiveRelayer` yang bisa call `fillRelayV3` sebelum deadline
- Setelah deadline → open ke siapapun ("step-in fill")
- Double-fill prevention: SpokePool mark deposit sebagai filled on first successful call, call kedua revert

**Solver Selection Algorithm (off-chain):**
Scoring dievaluasi tiap 2 minggu:
1. **Reliability**: % nominasi yang actually di-fill
2. **Speed**: fill time vs benchmark (<10 detik expected)
3. **Step-in fills**: poin dari mengisi order yang ditinggal solver lain

Solver baru harus buktikan diri via step-in fills dulu sebelum dapat nominasi exclusive.

Solver submit config file (PR ke GitHub repo `exclusive-relayer-configs`):
```json
{
  "minExclusivityPeriod": 15,
  "minProfitThreshold": 0.001,
  "balanceMultiplier": 1.5,
  "maxFillSize": 50000,
  "originChainIds": [1, 137, 42161]
}
```

**Griefing Prevention:**
- Tidak ada step "claim" — solver langsung fill atau tidak sama sekali
- Miss = score turun, nominasi berkurang ke depan
- Tidak ada on-chain slashing untuk missed nomination

**Optimistic Settlement (UMA Oracle):**
- Dataworker aggregate fill events menjadi bundle (Merkle root) setiap ~60 menit
- Bundle dipropose ke HubPool, diterima optimistically setelah 1 jam challenge window
- Kalau di-dispute → UMA token holders vote
- Bond dipotong untuk pihak yang kalah dispute
- Gas settlement O(1) regardless jumlah fill dalam bundle

---

### 2. UniswapX

**Arsitektur:** EIP-712 signed orders + Permit2 + off-chain RFQ + on-chain Settlement contract

**Race Condition Handling:**
- **Phase 1 (Exclusive):** Fillers submit quote off-chain. Highest quote menang exclusive window. Hanya winner yang bisa submit on-chain. Harga fixed (tidak decay).
- **Phase 2 (Open Dutch Auction):** Kalau exclusive filler tidak fill dalam window → price decay block-by-block → siapapun bisa race.
- **Cosigner Mechanism:** Cosigner update order parameters real-time (starting price, decay curve) untuk prevent exploitation of stale quotes.

**Double-Fill Prevention:**
- Permit2 nonce bitmap
- Tiap order punya nonce unik dalam signed Permit2 message
- Filler pertama yang call settlement → Permit2 flip nonce bit dari 0 ke 1
- Call kedua → nonce bitmap check revert → atomically prevented

**Anti-Griefing (Fader Penalty):**
- Exclusive filler yang tidak fill ("fade") → off-chain routing system exclude mereka dari quote consideration
- Persistent fading → exclusion period makin panjang
- Tidak ada on-chain slashing

**Solver Registration:**
- ETH mainnet: whitelist (permissioned)
- L2s: permissionless, tidak ada whitelist
- Tidak ada published bond requirement

**Loser Cost:** Gas untuk reverted transaction di open auction phase

---

### 3. CoW Protocol

**Arsitektur:** Periodic batch auctions + off-chain Autopilot + on-chain Settlement contract

**Solver Competition:**
- Autopilot buka batch, solver punya 15 detik submit solusi off-chain
- Winner selection via **CIP-67 (Fair Combinatorial Auction)**:
  1. Compute "reference outcome" (best single-token-pair solution)
  2. Filter solusi yang worse dari reference untuk any token pair
  3. Select winner yang maximize total user surplus
- Hanya winner yang submit on-chain → **loser zero gas cost**

**Solver Registration & Bond:**
- Permissioned — harus di-whitelist CoW DAO
- KYC/KYB required (beneficial ownership docs, developer passports)
- Bond: **25% of weekly COW token rewards** dikunci di bonding pool
- **15% service fee** dari weekly rewards mulai 6 bulan setelah onboarding
- Start dari Arbitrum, expand ke L2 lain, mainnet butuh evaluasi tambahan

**Slashing Conditions:**
- EBBO (best execution baseline) violations
- Score inflation via wash trading
- Illegal buffer usage
- "Pennying" (inflate reported scores)
- Denylisting immediate untuk settlement yang deviate dari committed specs

**Griefing Prevention:**
- Batch auction structure sendiri prevent griefing — tidak ada lock/claim step
- Semua solver terima batch yang sama dan race secara algoritmik, bukan on-chain

---

### 4. 1inch Fusion

**Arsitektur:** Dutch auction + Limit Order Protocol + Settlement contract + off-chain Relayer

**Solver Competition:**
- Resolver monitoring price decay curve off-chain
- Submit fill transaction ketika rate sudah profitable
- **Unicorn Power (UP) tiering:**
  - Top 10 by UP = permitted resolver set
  - Top 5 = de facto priority window (isi pertama saat harga masih tinggi)
  - Durasi stake (1 bulan – 2 tahun) amplify voting/resolver power

**Anti-Griefing (Gas Fee Cap):**
Smart contract enforce max priority gas fee:
```
Base fee < 10.6 gwei  → max priority fee 70% of base
10.6 – 104.1 gwei     → max priority fee 50% of base
> 104.1 gwei          → max priority fee 65% of base
```
Violasi → penalty hingga ban 1 tahun dari order filling

**Solver Registration:**
- Staking 1INCH required (min ~5% of total UP supply)
- KYC/KYB verification
- `FeeBank` deposit untuk cover resolving fees
- Hard cap: **max 10 active resolvers**

**On-Chain Fill:**
- `settleOrders()` proses batch up to 32 orders per tx
- Limit order contract call `fillOrderInteraction()` callback setelah transfer source tokens → resolver routing atomic dalam satu tx

**Loser Cost:** Gas untuk reverted transactions (sama seperti UniswapX open phase)

---

### 5. NEAR Intents

**Arsitektur:** Off-chain Solver Bus + on-chain Verifier contract (`intents.near`) + internal ledger

**Solver Competition:**
- Solver Bus query registered market-makers, return competitive quotes dalam detik
- User pilih quote terbaik (atau auto-selected)
- Signed intents di-bundle dan submit ke `execute_intents` on Verifier
- **Verifier atomically evaluate seluruh bundle** — all execute atau nothing

**Race Condition Handling:**
- Solver Bus sebagai centralized coordinator → match 1 solver ke 1 intent sebelum ke chain
- Hanya 1 quote yang di-package ke final `execute_intents` call
- On-chain atomicity enforce tidak ada partial execution

**Griefing Prevention:**
- Cancellation lock: user tidak bisa cancel in-flight intent
- Tidak ada published bond/slashing mechanism

**Loser Cost:** Hampir nol (NEAR gas murah + Solver Bus prevent most on-chain races)

**Catatan:** Solver Bus infrastruktur act sebagai gating layer meskipun positioning-nya "permissionless"

---

### 6. LI.FI

**Arsitektur:** Aggregator of aggregators — routing through Across, Relay, Mayan, dll + Catalyst intent layer

**Key Finding:**
LI.FI research explicitly identifies bahwa **dalam praktiknya, handful of well-capitalized solvers dominates order flow** di semua protokol. Banyak active solvers dirun oleh team yang sama yang build protokolnya (e.g., Risk Labs untuk Across). Practical centralization undermines theoretical permissionlessness.

**Solver Competition:**
LI.FI support semua 6 auction type:
1. No Selection/Mempool — pure race, first on-chain wins
2. RFQ — solvers quote off-chain, user pilih terbaik
3. Private Intent Pools — permissioned solver set
4. Public Intent Pools — open semua solver
5. Dutch Auction — descending price
6. Batch Auction — multiple intents grouped

Tipe yang dipakai tergantung protokol mana yang dipakai untuk route order tersebut.

**Griefing Prevention:**
- Transaction cancellation lock: setelah user initiate (funds masuk escrow), tidak bisa cancel sampai timeout lewat
- Melindungi solver yang sudah selesai sisi mereka dari user yang cancel

---

## Perbandingan Lengkap

| Aspek | Across | UniswapX | CoW Protocol | 1inch Fusion | NEAR Intents |
|---|---|---|---|---|---|
| **Race condition model** | Exclusive window + open fallback | Exclusive period → open Dutch | Batch auction (off-chain) | Staking-tiered Dutch | Solver Bus coordination + atomic |
| **Solver selection** | Off-chain scoring → deposit-time assignment | Off-chain RFQ highest quote | Fair Combinatorial Auction | Top-10 UP staking | Solver Bus RFQ |
| **Double-fill prevention** | SpokePool mark filled on first call | Permit2 nonce bitmap (bit flip) | Not needed (1 tx per batch) | Limit order protocol | Verifier atomicity |
| **Loser solver cost** | Score degradation only | Gas (reverted tx) | **Zero (off-chain)** | Gas (reverted tx) | Near-zero |
| **Solver registration** | Public config + API review | Whitelist (L1) / permissionless (L2) | Permissioned + KYC | KYC + staking | WebSocket dengan Solver Bus |
| **Bond/slashing** | Tidak ada | Tidak ada | 25% weekly reward bond | Staking (UP) | Tidak ada |
| **Griefing prevention** | No reservation step + score penalty | Reputation fade penalty | DAO slashing | Gas cap enforcement + ban | Cancellation lock |
| **Decentralization level** | Medium (API gating) | Medium (L1 whitelist) | Low (DAO permissioned) | Low (KYC + hard cap 10) | Medium (Solver Bus gating) |

---

## Smart Contract Patterns yang Dipakai

### 1. Exclusive Relayer Pattern (Across)
```solidity
struct Deposit {
    address exclusiveRelayer;     // nominated solver
    uint256 exclusivityDeadline;  // timestamp
    // ... other fields
}

function fill(bytes32 depositId) external {
    Deposit storage d = deposits[depositId];
    if (block.timestamp < d.exclusivityDeadline) {
        require(msg.sender == d.exclusiveRelayer, "Not exclusive relayer");
    }
    // mark as filled
    d.filled = true;
    emit DepositFilled(depositId, msg.sender);
}
```

### 2. Permit2 Nonce Bitmap (UniswapX)
```solidity
// Satu nonce per order dalam signed message
// Permit2 flip bit → revert kalau sudah dipakai
// Atomic, tidak butuh state lock terpisah
```

### 3. Dutch Auction Price Decay
```solidity
function getCurrentPrice(Order storage order) view returns (uint256) {
    if (block.timestamp >= order.deadline) return order.floorPrice;
    if (block.timestamp <= order.createdAt) return order.startPrice;

    uint256 elapsed  = block.timestamp - order.createdAt;
    uint256 duration = order.deadline - order.createdAt;
    uint256 decay    = (order.startPrice - order.floorPrice) * elapsed / duration;
    return order.startPrice - decay;
}
```

### 4. Optimistic Bundle Settlement (Across/UMA)
```
Solver fill → emit event
Dataworker aggregate N fills → Merkle root
Propose bundle ke HubPool
1 jam challenge window → kalau tidak ada dispute, accepted
Solver di-repay di chain asal
```

### 5. ERC-7683 (Standard Emerging)
Cross-chain intents standard yang muncul:
```solidity
struct CrossChainOrder {
    address settlementContract;
    address swapper;
    uint256 nonce;
    uint32  originChainId;
    uint32  initiateDeadline;
    uint32  fillDeadline;
    bytes   orderData;  // implementation-specific
}
```

---

## Rekomendasi Roadmap untuk Naisu

### Phase 1 — Permissioned Solver Set (Paling Pragmatis, Sekarang)
```
- Whitelist beberapa solver address di contract
- Hanya whitelisted solver yang bisa call settleOrder
- Tidak butuh orchestration kompleks
- Sama seperti UniswapX mainnet early days
```

Contract change minimal:
```solidity
mapping(address => bool) public approvedSolvers;

modifier onlyApprovedSolver() {
    require(approvedSolvers[msg.sender], "Not approved solver");
    _;
}

function settleOrder(bytes calldata encodedVaa) external onlyApprovedSolver {
    // ... existing logic
}
```

### Phase 2 — Exclusive Window + Open Fallback (Industry Standard)
```
OrderCreated event
    ↓
Backend (Solver Bus) nominate 1 solver berdasarkan:
  - Reliability score (% order yang di-fill)
  - Speed score (waktu rata-rata fill)
  - Balance (cukup untuk fill?)
    ↓
Contract: exclusiveSolver + exclusivityDeadline (misal 30 detik)
    ↓
[< deadline] → hanya exclusiveSolver
[> deadline] → open Dutch auction, siapapun bisa fill
```

Contract change:
```solidity
struct Order {
    address creator;
    bytes32 recipient;
    uint16  destinationChain;
    uint256 amount;
    uint256 startPrice;
    uint256 floorPrice;
    uint256 deadline;
    uint256 createdAt;
    uint8   status;
    bool    withStake;
    // ← tambah:
    address exclusiveSolver;
    uint256 exclusivityDeadline;
}

function settleOrder(bytes calldata encodedVaa) external {
    // ... parse VAA, get orderId
    Order storage order = orders[orderId];

    if (block.timestamp < order.exclusivityDeadline) {
        require(msg.sender == order.exclusiveSolver, "Exclusive window active");
    }
    // ... rest of settle logic
    emit OrderFulfilled(orderId, msg.sender);
}
```

Backend Solver Bus scoring:
```typescript
interface SolverScore {
  address:     string
  reliability: number  // % filled / nominated
  avgSpeed:    number  // seconds to fill
  balance:     bigint  // available capital
  stepInFills: number  // fills after other solvers missed
}

function nominateSolver(order: Order, solvers: SolverScore[]): string {
  const eligible = solvers.filter(s => s.balance >= order.amount * 1.1n)
  return eligible.sort((a, b) =>
    (b.reliability * 0.5 + (1/b.avgSpeed) * 0.3 + b.stepInFills * 0.2) -
    (a.reliability * 0.5 + (1/a.avgSpeed) * 0.3 + a.stepInFills * 0.2)
  )[0].address
}
```

### Phase 3 — Solver Bond + Slashing
```
Solver deposit bond ETH ke contract (misal 0.1 ETH)
Bond di-lock selama order active
Kalau exclusive solver tidak fill sebelum deadline:
  - Bond sebagian di-slash (penalty)
  - Sisa dikembalikan
Bond dirilis setelah order settled
```

```solidity
mapping(address => uint256) public solverBonds;
uint256 public constant MIN_BOND = 0.1 ether;
uint256 public constant MISS_PENALTY_BPS = 500; // 5%

function depositBond() external payable {
    require(msg.value >= MIN_BOND, "Insufficient bond");
    solverBonds[msg.sender] += msg.value;
}

function slashMissedSolver(bytes32 orderId) external {
    Order storage order = orders[orderId];
    require(block.timestamp > order.exclusivityDeadline, "Window not expired");
    require(order.status == STATUS_OPEN, "Already filled");

    uint256 penalty = solverBonds[order.exclusiveSolver] * MISS_PENALTY_BPS / 10000;
    solverBonds[order.exclusiveSolver] -= penalty;
    // penalty ke treasury atau ke user sebagai kompensasi
}
```

### Yang Tidak Perlu (Over-engineering untuk sekarang)
- ❌ Batch auction off-chain seperti CoW — butuh Autopilot kompleks, latency tinggi
- ❌ ZK proof verification — mahal, overkill untuk bridge
- ❌ Full DAO governance untuk slash — prematur
- ❌ KYC/KYB requirement — terlalu centralized

---

## Key Takeaways

1. **Tidak ada yang benar-benar fully decentralized** — semua protokol punya gating layer (API, whitelist, staking, KYC). LI.FI research confirm ini.

2. **Standard industri = Exclusive Window + Open Fallback** (Across model) — balance antara efficiency (1 solver tidak rebutan) dan liveness (kalau miss, ada fallback).

3. **Tidak ada on-chain "claim" step** — ini yang paling critical. Solver langsung fill atau tidak sama sekali. Tidak ada state "reserved" yang bisa dipakai untuk griefing.

4. **Off-chain coordination + on-chain enforcement** — solver selection selalu off-chain (lebih flexible), enforcement selalu on-chain (trustless). Jangan balik urutan ini.

5. **Loser solver bayar gas adalah masalah nyata di scale** — hanya CoW yang solve ini via batch auction. Untuk Naisu, exclusive window meminimize race sehingga loser cost praktis nol.

6. **Bond/slashing tidak wajib di awal** — Across tidak pakai slashing sama sekali, hanya reputation scoring. Mulai tanpa slashing, tambah kalau ekosistem solver sudah mature.

---

## Sumber Referensi

- [Across - Relayer Nomination](https://docs.across.to/relayers/relayer-nomination)
- [Across - Intent Lifecycle](https://docs.across.to/concepts/intent-lifecycle-in-across)
- [Across - exclusive-relayer-configs GitHub](https://github.com/across-protocol/exclusive-relayer-configs)
- [UMA Case Study: How UMA Secures Across](https://blog.uma.xyz/articles/case-study-how-uma-secures-across-protocol)
- [UniswapX Overview](https://docs.uniswap.org/contracts/uniswapx/overview)
- [UniswapX Auction Types](https://docs.uniswap.org/contracts/uniswapx/auctiontypes)
- [UniswapX Filler Overview](https://docs.uniswap.org/contracts/uniswapx/fillers/filleroverview)
- [CoW Protocol Solver Competition Rules](https://docs.cow.fi/cow-protocol/reference/core/auctions/competition-rules)
- [CoW Protocol Solver Onboarding](https://docs.cow.fi/cow-protocol/tutorials/solvers/onboard)
- [1inch Fusion FAQ](https://help.1inch.com/en/articles/6800254-1inch-fusion-faq)
- [1inch Fusion Resolving: Offchain Component](https://blog.1inch.com/fusion-swap-resolving-the-offchain-component/)
- [1inch Fusion Resolving: Onchain Component](https://blog.1inch.com/fusion-swap-resolving-onchain-component/)
- [NEAR Intents Documentation](https://docs.near.org/chain-abstraction/intents/overview)
- [LI.FI - Under the Hood of Intent-Based Bridges](https://li.fi/knowledge-hub/under-the-hood-of-intent-based-bridges/)
- [LI.FI - With Intents, Solvers All The Way Down](https://li.fi/knowledge-hub/with-intents-its-solvers-all-the-way-down/)
- [ERC-7683: Cross-Chain Intents Standard](https://www.archetype.fund/media/erc7683-the-cross-chain-intents-standard)
