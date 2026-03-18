# Naisu One — Pitch Deck Outline
> For: Hackathon / Investor Pitch
> Last updated: March 2026

---

## Slide Structure (10 slides, ~3 menit pitch)

---

### Slide 1 — Hook (Opening)

**Visual:** Demo GIF — user ketik kalimat, 30 detik kemudian SOL landing di wallet

**Text:**
> *"You told it what you wanted. It figured out the rest."*

Tidak ada bullet point. Biarkan visual bicara.

---

### Slide 2 — Problem

**Headline:** Cross-chain is broken for normal people.

```
❌ "Which bridge do I use?"
❌ "Is this safe?"
❌ "Why did I get less than expected?"
❌ "My transaction is stuck — what do I do?"
```

**Sub-text:** Cross-chain volume $50B+/year. UX masih sama seperti 2019.

---

### Slide 3 — Solution

**Headline:** Just say what you want.

**Visual:** Split screen
```
Before (tanpa Naisu):          After (dengan Naisu):
  1. Buka bridge app             User: "Bridge 0.001 ETH ke Solana"
  2. Pilih chain
  3. Pilih token                 AI: "Found 3 solvers. Alpha wins
  4. Approve + sign                   with best price. Bridging..."
  5. Wait, check explorer
  6. Arrive? Maybe.              ✓ Done. 0.0241 SOL in your wallet.
```

---

### Slide 4 — How It Works (Technical, Simple)

**Headline:** Intent-based. Solver-powered. AI-native.

```
1. User expresses intent (natural language or swap UI)
        ↓
2. AI Agent broadcasts RFQ to decentralized solver network
        ↓
3. Solvers compete — best price + speed wins
        ↓
4. Winner fills cross-chain via Wormhole VAA
        ↓
5. Smart contract settles. User gets funds.
```

**Footer note:** Built on Wormhole. Dutch auction on-chain. No custody.

---

### Slide 5 — Demo Moment

**Headline:** See it live.

> (Live demo atau video recording)

Show:
- Natural language input
- 3 solver competing (tabel comparison)
- AI reasoning kenapa pilih winner
- Fill progress step by step
- SOL landing di wallet

**This is the most important slide. Spend the most time here.**

---

### Slide 6 — Market Opportunity

**Headline:** Big market, bad UX = opportunity.

```
Cross-chain bridge volume:    $50B+/year (growing)
Solana ecosystem TVL:         $8B+ (target market)
Sui ecosystem TVL:            $1B+ (blue ocean)

Across Protocol revenue:      ~$2-4M/month at $2B volume
If Naisu captures 1% market:  $500M volume = ~$500K/year fee
```

**Why now:** AI UX inflection point. Users expect intelligence, not forms.

---

### Slide 7 — Business Model

**Headline:** Protocol fee. Simple. Proven.

```
Primary:    10 bps fee on every intent filled
            → Solver pays from spread, user gets best price

Secondary:  Solver bond yield (bonds deployed to liquid staking)

Future:     Premium AI features (scheduled intents, portfolio rebalance)
            B2B SDK (wallets + portfolio apps embed Naisu solver network)
```

**Unit economics:**
```
Average order: $50
Fee per order: $0.05 (10 bps)
Break-even:    ~500 tx/day = ~$9K/year
Target Y1:     5,000 tx/day = ~$90K/year
```

---

### Slide 8 — Why Naisu Wins (Moat)

**Headline:** Not just another bridge.

| | Existing Bridges | Naisu |
|---|---|---|
| UX | Form input | Natural language |
| Solver visibility | Hidden | Visible + explained |
| Competition | Centralized | Open solver network |
| AI layer | None / gimmick | Core architecture |
| Chains | Usually 1-2 | EVM + Solana + Sui |

**Switching cost:** Once users trust AI to handle cross-chain, they don't go back to manual bridges.

---

### Slide 9 — Traction & Roadmap

**Current (Demo-ready):**
- ✅ Base Sepolia → Solana Devnet live
- ✅ Dutch auction on-chain
- ✅ Wormhole VAA settlement
- ✅ AI agent (natural language → intent)
- ✅ Real-time frontend (SSE + WS indexer)

**Next 30 days:**
- 🔲 Decentralized solver network (3+ solvers competing)
- 🔲 Manual swap UI (second entry point)
- 🔲 Solver selection visible in AI agent

**Next 90 days:**
- 🔲 Sui integration
- 🔲 Mainnet deployment
- 🔲 Solver SDK public (anyone can run a solver)

---

### Slide 10 — Ask / Close

**For Hackathon:**
> *"We built a working cross-chain intent protocol with AI-native UX in [X weeks].
> Solver network launches next. We're here to win — and to show
> that DeFi UX doesn't have to suck."*

**For Investor:**
> *"We're raising $[X] to bootstrap solver liquidity, launch mainnet,
> and capture the Solana + Sui cross-chain market before anyone else does."*

---

## Key Narratives (Pilih sesuai audience)

### Untuk Hackathon Teknikal (ETHGlobal, Wormhole, Solana)
Lead with architecture:
> *"Intent protocol + Dutch auction + decentralized solver network + Wormhole VAA.
> AI is the UX layer. Everything else is real infra."*

### Untuk General Hackathon / Demo Day
Lead with UX:
> *"You tell it what you want. AI finds the best solver. Cross-chain in 30 seconds."*

### Untuk Investor
Lead with market + moat:
> *"$50B/year cross-chain market. UX hasn't changed in 5 years.
> We're building the intent layer with AI as the interface —
> before Mayan or Jupiter gets there."*

---

## One-liner Options

1. *"The first cross-chain protocol where AI finds you the best solver — transparently."*
2. *"Say what you want. AI handles the rest. Cross-chain in 30 seconds."*
3. *"Intent-based bridging with decentralized solvers and AI-native UX."*
4. *"Naisu: where DeFi complexity meets AI simplicity."*

---

## Slide Design Notes

- **Max 1 big idea per slide** — juri baca cepat
- **Demo video/GIF wajib** — tech tanpa demo = tidak dipercaya
- **Numbers konkret** — "$50B market", "10 bps", "30 seconds" — bukan "large market" atau "fast"
- **Competitor slide optional** — kalau ada, tunjukkan gap yang jelas, bukan attack
- **Team slide** — kalau solo atau tim kecil, tonjolkan execution speed bukan jumlah orang

---

## Hackathon Judging Criteria yang Biasanya Dipakai

| Kriteria | Cara Naisu Menang |
|---|---|
| **Innovation** | AI-native intent + visible solver competition = genuinely new |
| **Technical execution** | Live demo working, real contracts, real chains |
| **Market potential** | $50B+ market, clear revenue model |
| **Presentation** | Clean narrative: problem → solution → demo → business |
| **Completeness** | End-to-end working, bukan prototype/mockup |
