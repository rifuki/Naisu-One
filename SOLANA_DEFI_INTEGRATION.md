# Naisu One — Solana DeFi Integration Plan

_Created: 2026-03-18_

---

## Context

Naisu One adalah cross-chain intent bridge (Base Sepolia ↔ Solana Devnet).
Saat ini solver hanya bisa **bridge** ETH↔SOL dengan harga dari dutch auction contract,
bukan harga pasar. Liquid staking masih pakai mock program buatan sendiri.

Tujuan dokumen ini: upgrade ke DeFi protokol **real** di Solana devnet/testnet.
Tidak boleh mainnet — biaya deploy terlalu mahal.

---

## Kondisi Saat Ini (Baseline)

### Apa yang sudah jalan

| Flow | Deskripsi | Status |
|---|---|---|
| EVM → Solana bridge | Lock ETH di Base Sepolia → solver kirim SOL ke recipient | ✅ Working |
| Solana → EVM bridge | Lock SOL di Devnet → solver kirim ETH ke recipient | ✅ Working |
| Bridge + Liquid Stake | Bridge ETH → SOL → stake → recipient dapat nSOL | ⚠️ Mock only |

### Masalah utama

1. **Harga tidak real** — `startPrice`/`floorPrice` diisi manual atau dari hardcode.
   User tidak tau berapa SOL yang bakal didapat sebelum create order.
2. **Liquid staking = mockup** — `mock_liquid_staking` program buatan sendiri,
   bukan protokol nyata.
3. **Tidak ada swap on-chain** — solver tidak bisa lakukan DEX swap di sisi Solana.

### File-file kunci

```
naisu-solver/src/
├── executor/solana_executor.rs   # solve_and_prove, solve_and_liquid_stake, relay_and_claim
├── chains/solana_listener.rs     # listen OrderCreated Solana → execute fulfill ke EVM
├── chains/evm_listener.rs        # listen OrderCreated EVM → execute solve_and_prove Solana
├── config.rs                     # env vars + Config struct
└── coordinator.rs                # register ke backend, heartbeat, RFQ server

naisu-backend/src/
├── services/indexer.ts           # WS subscribe + backfill intent events
├── routes/intent.ts              # GET /quote, POST /build-tx — harga saat ini hardcode
└── services/solver.service.ts    # registry + RFQ engine

naisu-frontend/
└── components/SolverAuctionCard.tsx  # tampilkan RFQ result
```

### Contracts aktif

| Chain | Contract | Address |
|---|---|---|
| Base Sepolia | IntentBridge.sol | `0xd0d1856674ba1feabee7dd3d4b22cc80488ac2f1` |
| Solana Devnet | IntentBridge (Anchor) | `Cp6HRKWXgeEycareLXGttNj8dTNfRiFB4Y4UtDuq5EcN` |

---

## Hasil Riset: DeFi Protokol di Solana Devnet

### Yang Bisa Dipakai

| Protocol | Fungsi | Devnet? | Program ID (devnet) |
|---|---|---|---|
| **Pyth Network** | Price oracle (SOL/USD, ETH/USD, dll) | ✅ Full | Lihat bagian Pyth di bawah |
| **Marinade Finance** | Liquid staking SOL → mSOL | ✅ Full | `MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD` |
| **Orca Whirlpools** | DEX swap on-chain | ✅ Full | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` |
| **SPL Stake Pool** | Native staking pool | ✅ Full | `DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib` |
| **Drift Protocol** | Perps/derivatives | ✅ Full | Ada devnet env di SDK |

### Yang TIDAK Bisa Dipakai di Devnet

| Protocol | Alasan |
|---|---|
| **Jupiter Quote API** | Mainnet only — tidak ada `?cluster=devnet` yang works |
| **Raydium** | API tidak support devnet; SDK ada tapi tidak direkomendasikan oleh dev-nya sendiri |

---

## Rencana Implementasi

### Phase A — Real Price Quotes via Pyth (Prioritas Tertinggi)

**Problem:** User tidak tau berapa SOL yang didapat. Harga di UI tidak mencerminkan market.

**Solution:** Integrasikan Pyth Network devnet price feeds ke backend.
Backend hitung `startPrice`/`floorPrice` otomatis berdasarkan harga pasar real.

#### Pyth di Devnet

- Program ID: `gSbePebfvPy7tRqimPoVecS2UsBvYv46ynrzWocc92s` (Pyth Oracle devnet)
- SDK: `@pythnetwork/client` atau `@pythnetwork/price-service-client`
- Price Service endpoint (Hermes): `https://hermes.pyth.network/` (works untuk devnet feeds)
- Feed IDs yang dibutuhkan:
  - SOL/USD: `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`
  - ETH/USD: `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace`

#### Yang perlu diubah

**`naisu-backend/src/routes/intent.ts`** — endpoint `GET /quote`:
```typescript
// SEKARANG: hardcode atau estimasi kasar
// TARGET: ambil dari Pyth, hitung otomatis

import { PriceServiceConnection } from "@pythnetwork/price-service-client";

const SOL_USD_FEED = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const ETH_USD_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

async function getQuote(ethAmountWei: bigint) {
  const conn = new PriceServiceConnection("https://hermes.pyth.network");
  const [solPrice, ethPrice] = await conn.getLatestPriceFeeds([SOL_USD_FEED, ETH_USD_FEED]);

  const ethUsd = Number(ethPrice.price.price) * 10 ** ethPrice.price.expo;
  const solUsd = Number(solPrice.price.price) * 10 ** solPrice.price.expo;

  const ethAmount = Number(ethAmountWei) / 1e18;
  const solAmount = (ethAmount * ethUsd) / solUsd;

  // startPrice = 105% dari market rate (user willing to pay premium untuk kecepatan)
  // floorPrice = 95% dari market rate (minimum acceptable)
  const startPriceLamports = BigInt(Math.floor(solAmount * 1.05 * 1e9));
  const floorPriceLamports = BigInt(Math.floor(solAmount * 0.95 * 1e9));

  return { startPriceLamports, floorPriceLamports, solAmount, ethUsd, solUsd };
}
```

**`naisu-frontend`** — tampilkan rate real di SwapPage dan agent chat:
```typescript
// Saat user input amount ETH, fetch /api/v1/intent/quote
// Tampilkan: "~X.XX SOL" dengan confidence interval dari Pyth
```

**`naisu-agent/nesu.md`** (system prompt):
- Tambahkan instruksi: sebelum buat order, selalu fetch `/quote` untuk dapat harga real
- Agent informasikan ke user berapa SOL yang akan didapat

---

### Phase B — Real Liquid Staking via Marinade Devnet

**Problem:** `solve_and_liquid_stake` di `solana_executor.rs` memanggil
`liquid_stake.js` yang pakai mock program. Tidak ada staking beneran.

**Solution:** Replace dengan Marinade Finance SDK di devnet.

#### Marinade di Devnet

- Program ID: `MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD`
- mSOL Mint: `mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So`
- SDK: `@marinade.finance/marinade-ts-sdk`
- SDK auto-detect devnet dari RPC URL yang diberikan

#### Cara kerja Marinade stake

```typescript
import { MarinadeUtils, Marinade } from "@marinade.finance/marinade-ts-sdk";
import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection("https://api.devnet.solana.com");
const marinade = new Marinade({ connection });

// Stake SOL → dapat mSOL
const { transaction } = await marinade.deposit(solAmount);
// Submit transaction → recipient dapat mSOL di wallet mereka
```

#### Yang perlu diubah

**`naisu-solver/src/executor/solana_executor.rs`** — fungsi `solve_and_liquid_stake`:
```rust
// SEKARANG: panggil liquid_stake.js (mock)
// TARGET: panggil marinade_stake.js (Marinade SDK)
```

Buat file baru: `naisu1-contracts/solana/scripts/marinade_stake.js`
```javascript
// args: recipient_b58, amount_lamports, rpc_url, private_key
// 1. Connect ke Marinade dengan devnet RPC
// 2. Deposit SOL → dapat mSOL ke solver dulu
// 3. Transfer mSOL dari solver ke recipient
// output: "MSOL_MINTED:<amount>" ke stdout
```

Ubah `solve_and_liquid_stake` di Rust untuk panggil `marinade_stake.js`
sebagai ganti `liquid_stake.js`.

---

### Phase C — On-chain Swap via Orca Whirlpools Devnet

**Problem:** Saat ini solver hanya kirim raw SOL ke recipient.
Tidak ada kemampuan untuk swap SOL → token lain di sisi Solana.

**Solution:** Integrasikan Orca Whirlpools untuk enable intent type baru:
`bridge_and_swap` — user lock ETH di EVM, recipient dapat token lain di Solana
(contoh: ETH → devUSDC).

#### Orca Whirlpools di Devnet

- Program ID: `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` (sama dengan mainnet)
- SDK: `@orca-so/whirlpools` (v2, support devnet)
- Pool SOL/devUSDC di devnet: ada, perlu di-lookup via SDK
- devUSDC mint di devnet: `3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt`

#### Quote dari Orca (untuk Phase A jika Pyth tidak cukup)

```typescript
import { WhirlpoolContext, buildWhirlpoolClient, ORCA_WHIRLPOOL_PROGRAM_ID } from "@orca-so/whirlpools-sdk";

// Bisa dapat quote swap SOL → USDC dari devnet pool
// Ini lebih akurat karena berdasarkan actual on-chain liquidity
```

#### Intent type baru yang perlu ditambah

Di `IntentBridge.sol`, tambah field `destinationToken` (optional) — jika diisi,
solver expected untuk swap dulu sebelum deliver ke recipient.

Di contract Solana, tambah instruction baru atau extend `solve_and_prove`
untuk handle post-swap scenario.

---

## Urutan Implementasi yang Disarankan

```
Week 1: Phase A — Pyth price feeds
  ├── Install @pythnetwork/price-service-client di naisu-backend
  ├── Tambah fungsi getPythPrices() di backend
  ├── Update GET /quote response dengan harga real
  ├── Update POST /build-tx untuk pakai Pyth prices
  ├── Update frontend SwapPage untuk tampilkan rate real
  └── Update agent prompt untuk selalu fetch quote sebelum buat order

Week 2: Phase B — Marinade liquid staking
  ├── Install @marinade.finance/marinade-ts-sdk di naisu1-contracts/solana
  ├── Buat marinade_stake.js script
  ├── Update solve_and_liquid_stake di solana_executor.rs
  ├── Test end-to-end: bridge ETH → lock SOL → Marinade → recipient dapat mSOL
  └── Update frontend untuk tampilkan "mSOL" bukan "nSOL"

Week 3: Phase C — Orca swap
  ├── Research pool addresses di devnet via Orca SDK
  ├── Buat orca_swap.js helper script
  ├── Tambah intent type baru (bridge_and_swap)
  ├── Update contract (optional) atau handle di solver level
  └── End-to-end test: ETH → devUSDC ke recipient Solana
```

---

## Dependency yang Perlu Diinstall

### naisu-backend

```bash
cd naisu-backend
bun add @pythnetwork/price-service-client
```

### naisu1-contracts/solana (scripts)

```bash
cd naisu1-contracts/solana
npm install @marinade.finance/marinade-ts-sdk
npm install @orca-so/whirlpools @orca-so/whirlpools-sdk  # untuk Phase C
```

---

## Catatan Penting

### Faucet untuk Devnet Testing

| Token | Cara dapat | Limit |
|---|---|---|
| SOL devnet | `solana airdrop 2 <address> --url devnet` atau https://faucet.solana.com | 2 SOL per 8 jam |
| devUSDC | https://faucet.circle.com | 20 USDC per 2 jam |
| mSOL devnet | Didapat dari staking SOL via Marinade devnet | Tidak terbatas (perlu SOL) |

### Pyth Price Feeds — Catatan Confidence

Pyth feeds punya `confidence` interval. Saat harga volatile, confidence lebar.
Frontend sebaiknya tampilkan: `"~X.XX SOL (±0.05)"` bukan angka pasti.

Backend sebaiknya tolak quote jika `confidence / price > 2%` (harga terlalu volatile
untuk buat order).

### Marinade Rate

Marinade exchange rate (SOL → mSOL) tidak 1:1 — mSOL selalu appreciate vs SOL
karena staking rewards terakumulasi. Rate bisa diambil dari:
```typescript
const { mSolPrice } = await marinade.getMarinadeState();
// mSolPrice = berapa SOL per 1 mSOL
```

Tampilkan ke user: `"X SOL → Y mSOL (rate: 1 mSOL = Z SOL)"`

### Orca Pool Discovery

Pool SOL/devUSDC di devnet mungkin perlu di-lookup dulu. Gunakan:
```typescript
import { WhirlpoolContext, PDAUtil } from "@orca-so/whirlpools-sdk";
// atau gunakan Orca API untuk list pools di devnet
```

Pool bisa sepi (low liquidity) — solver perlu handle slippage dan failure gracefully.

---

## File yang TIDAK Perlu Disentuh

- `IntentBridge.sol` — contract EVM tidak perlu diubah untuk Phase A & B
- `naisu-solver/src/chains/` — listener tidak perlu diubah
- `naisu-solver/src/coordinator.rs` — coordinator tidak perlu diubah
- `naisu-solver/src/auction.rs` — dutch auction logic tidak perlu diubah

---

## Definition of Done

### Phase A selesai kalau:
- [ ] `GET /api/v1/intent/quote?amount=0.001&from=evm&to=solana` return `startPrice`, `floorPrice`, `ethUsd`, `solUsd`, `estimatedSol`
- [ ] Harga berubah real-time mengikuti pasar (refresh setiap request)
- [ ] Frontend SwapPage tampilkan "~X.XX SOL" yang akurat
- [ ] Agent Nesu otomatis pakai harga dari Pyth saat build intent tx

### Phase B selesai kalau:
- [ ] `withStake: true` pada order menghasilkan recipient dapat mSOL di wallet Solana devnet
- [ ] mSOL beneran ada di wallet recipient (bisa dicek di Solscan devnet)
- [ ] `solve_and_liquid_stake` tidak lagi memanggil `liquid_stake.js` mock

### Phase C selesai kalau:
- [ ] User bisa buat order "bridge ETH, recipient dapat USDC di Solana"
- [ ] Solver eksekusi: bridge → swap SOL→devUSDC via Orca → kirim USDC ke recipient
- [ ] devUSDC beneran ada di wallet recipient (bisa dicek di Solscan devnet)
