# Frontend Refactor Migration Plan - HANDOFF

## 🚨 CURRENT STATUS - WIP

**Branch:** `refactor/frontend-atomic-design`
**Last Updated:** 18 Mar 2026
**Status:** Phase 6 in progress - Build failing due to import issues

---

## ✅ COMPLETED PHASES

### Phase 0-1: Infrastructure ✅
- ✅ TanStack Query installed
- ✅ Folder structure created in `src/`
- ✅ `api-client.ts` - centralized API
- ✅ `format.ts` - all formatters (fmtRate, fmtUsd, rawToUi, etc)
- ✅ `global.types.ts` - shared types
- ✅ vite.config.ts updated with `@` → `./src`
- ✅ tsconfig.json updated with `@/*` → `./src/*`

### Phase 2: Intent Feature ✅
**Location:** `src/features/intent/`
- ✅ API functions (get-intent-quote, create-intent-order, etc)
- ✅ TanStack Query hooks (use-intent-quote, use-create-intent-order, etc)
- ✅ Components extracted:
  - `intent-zero-state.tsx`
  - `intent-chat/` (message-bubble, message-input, message-list)
  - `order-monitor-widget/`
  - `transaction-review-card.tsx`
  - `settings-modal.tsx`
- ✅ New page: `src/pages/intent-page.tsx` (120 lines, was 824)

### Phase 3: Swap Feature ✅
**Location:** `src/features/swap/`
- ✅ Hooks: use-swap-quote, use-swap-order, use-eth-balance, use-sol-balance
- ✅ Components extracted:
  - `swap-form/` (token-input, token-selector, wallet-status, quote-info)
- ✅ New page: `src/pages/swap-page.tsx` (200 lines, was 489)

### Phase 4: Earn Feature ✅
**Location:** `src/features/earn/`
- ✅ API: get-yield-rates, get-portfolio-balances
- ✅ Hooks: use-yield-rates, use-portfolio-balances, use-unstake-msol
- ✅ Components:
  - `stake-tab/` (protocol-icon, protocol-card, index)
  - `positions-tab/` (index)
- ✅ New page: `src/pages/earn-page.tsx`

### Phase 5: Portfolio Feature ✅
**Location:** `src/pages/portfolio-page.tsx`
- ✅ Simplified version using Earn feature hooks
- ✅ PositionCard component inline

### Phase 6: Structure Migration (IN PROGRESS)
✅ **Completed:**
- Moved all old files to `src/`:
  - `hooks/` → `src/hooks/`
  - `lib/` (abi, idl, constants) → `src/lib/`
  - `components/` → `src/components/`
  - `pages/` (old) → `src/pages/`
  - `config/` → `src/config/`
- Moved entry files:
  - `App.tsx` → `src/App.tsx`
  - `index.tsx` → `src/index.tsx`
- Updated `index.html` to point to `/src/index.tsx`

---

## ❌ CURRENT ISSUES TO FIX

### Build Errors

1. **Import Path Issues in New Pages**
   
   The new pages use relative imports like `../../hooks/` instead of `@/hooks/`.
   
   **Files to fix:**
   - `src/pages/intent-page.tsx` - ✅ FIXED
   - `src/pages/swap-page.tsx` - ✅ FIXED  
   - `src/pages/earn-page.tsx` - ❌ STILL BROKEN
   - `src/pages/portfolio-page.tsx` - ❌ CHECK & FIX
   
   **Fix:** Change all relative imports to use `@/` alias:
   ```typescript
   // BEFORE (broken)
   import { useSolanaAddress } from '../../../hooks/useSolanaAddress';
   
   // AFTER (correct)
   import { useSolanaAddress } from '@/hooks/useSolanaAddress';
   ```

2. **Check for remaining relative imports:**
   ```bash
   grep -r "from '\.\./" src/pages/
   grep -r "from '\.\./" src/features/
   ```

3. **Old Pages Might Have Issues**
   The old pages (LandingPage, DashboardPage, etc) that weren't refactored might have import issues. Check and fix any broken imports.

---

## 📝 NEXT STEPS (For Next AI)

### Step 1: Fix All Imports
Run this command to find all relative imports:
```bash
cd naisu-frontend
grep -r "from '\.\./" src/pages/ src/features/
```

Fix all of them to use `@/` prefix.

### Step 2: Test Build
```bash
npm run build
```

### Step 3: Run Dev Server (Optional)
```bash
npm run dev
```

### Step 4: Cleanup (After build succeeds)
Delete old files that are no longer used:
- `src/pages/IntentPage.tsx` (old, 824 lines)
- `src/pages/SwapPage.tsx` (old, 489 lines)  
- `src/pages/EarnPage.tsx` (old, 714 lines)
- `src/pages/AgentPage.tsx` (unused)
- `src/hooks/useOpenClaw.ts` (unused)

Keep:
- `src/pages/LandingPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/PortfolioPage.tsx` (old version, if new one works)

### Step 5: Final Commit
```bash
git add -A
git commit -m "feat: Complete atomic design refactor

- Migrated to feature-based architecture
- Implemented TanStack Query for all server state
- Extracted atomic components
- Standardized naming conventions (kebab-case)
- Reduced IntentPage: 824 → 120 lines
- Reduced SwapPage: 489 → 200 lines"
```

---

## 📁 FINAL STRUCTURE (Target)

```
naisu-frontend/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
└── src/
    ├── App.tsx
    ├── index.tsx
    ├── features/
    │   ├── intent/
    │   │   ├── api/
    │   │   ├── components/
    │   │   ├── hooks/
    │   │   └── index.ts
    │   ├── swap/
    │   │   ├── api/
    │   │   ├── components/
    │   │   ├── hooks/
    │   │   └── index.ts
    │   └── earn/
    │       ├── api/
    │       ├── components/
    │       ├── hooks/
    │       └── index.ts
    ├── components/
    │   ├── ui/
    │   ├── layout/
    │   ├── providers/
    │   ├── Navbar.tsx
    │   ├── ActiveIntents.tsx
    │   └── SolverAuctionCard.tsx
    ├── hooks/
    │   ├── useAgent.ts
    │   ├── useSolanaAddress.ts
    │   ├── useOrderWatch.ts
    │   └── ... (other existing hooks)
    ├── lib/
    │   ├── api-client.ts
    │   ├── constants.ts
    │   ├── utils/
    │   │   └── format.ts
    │   ├── abi/
    │   └── idl/
    ├── config/
    │   └── wagmi.ts
    ├── types/
    │   └── global.types.ts
    └── pages/
        ├── LandingPage.tsx
        ├── DashboardPage.tsx
        ├── intent-page.tsx (NEW)
        ├── swap-page.tsx (NEW)
        ├── earn-page.tsx (NEW)
        └── portfolio-page.tsx (NEW)
```

---

## 🎯 NAMING CONVENTIONS

✅ **Files/Folders:** kebab-case
   - `use-intent-quote.ts`
   - `intent-chat/`

✅ **Functions:** camelCase
   - `function useIntentQuote() {}`

✅ **Components:** PascalCase (exports)
   - `export function MessageBubble() {}`

✅ **Types:** PascalCase
   - `type IntentQuote = {}`

---

## 🔧 PATH ALIASES

Already configured:
- `vite.config.ts`: `@` → `./src`
- `tsconfig.json`: `@/*` → `./src/*`

Usage:
```typescript
// Good
import { useIntentQuote } from '@/features/intent/hooks/use-intent-quote';
import { apiClient } from '@/lib/api-client';

// Bad (don't use relative imports for cross-module imports)
import { useIntentQuote } from '../../../features/intent/hooks/use-intent-quote';
```

---

## 🧪 TESTING CHECKLIST

- [ ] Build succeeds: `npm run build`
- [ ] Dev server starts: `npm run dev`
- [ ] Intent page loads and works
- [ ] Swap page loads and works
- [ ] Earn page loads and works
- [ ] Portfolio page loads and works
- [ ] Wallet connections work
- [ ] Transactions work (if test wallet available)

---

## 💡 NOTES

1. **Old vs New Pages:**
   - Old: `IntentPage.tsx`, `SwapPage.tsx`, `EarnPage.tsx`, `PortfolioPage.tsx`
   - New: `intent-page.tsx`, `swap-page.tsx`, `earn-page.tsx`, `portfolio-page.tsx`
   - App.tsx is using new pages (kebab-case)

2. **TanStack Query:**
   - All new hooks use TanStack Query
   - Old hooks still exist in `src/hooks/` but can be removed after full migration

3. **Feature Folders:**
   - Each feature has its own API, hooks, and components
   - Features don't import from each other except through barrel exports (`index.ts`)

4. **Shared Code:**
   - `src/lib/` - utilities, API client, constants
   - `src/types/` - shared TypeScript types
   - `src/components/ui/` - shared UI primitives (if any)

---

**End of Handoff Document**
