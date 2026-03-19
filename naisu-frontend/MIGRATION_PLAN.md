# Frontend Refactor Migration Plan

## Overview
Migrasi dari struktur monolith ke feature-based + atomic design dengan TanStack Query

---

## Phase 0: Setup Infrastructure (Day 1)

### 0.1 Install Dependencies
```bash
npm install @tanstack/react-query @tanstack/react-query-devtools
npm install -D @tanstack/eslint-plugin-query
```

### 0.2 Create Folder Structure
```
src/
├── features/                 # [NEW]
│   ├── intent/
│   ├── swap/
│   ├── earn/
│   └── portfolio/
├── components/               # [MODIFY]
│   ├── ui/                   # [NEW]
│   ├── layout/               # [NEW]
│   └── providers/            # [NEW]
├── hooks/                    # [EXISTING - reduce]
├── lib/                      # [EXISTING - expand]
│   ├── api-client.ts         # [NEW]
│   └── utils/                # [NEW]
│       ├── format.ts
│       └── date.ts
├── types/                    # [NEW]
├── pages/                    # [EXISTING - refactor]
└── routes/                   # [NEW]
```

### 0.3 Create Base Files
- `src/lib/api-client.ts` - Centralized API client
- `src/lib/utils/format.ts` - All formatting utilities
- `src/components/providers/query-provider.tsx`
- `src/types/global.types.ts`

### 0.4 Update tsconfig.json
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@/features/*": ["./src/features/*"],
      "@/components/*": ["./src/components/*"],
      "@/hooks/*": ["./src/hooks/*"],
      "@/lib/*": ["./src/lib/*"],
      "@/types/*": ["./src/types/*"]
    }
  }
}
```

---

## Phase 1: Extract Shared Utilities (Day 1-2)

### 1.1 Create Format Utilities
**File:** `src/lib/utils/format.ts`

Extract from:
- `SwapPage.tsx` (lines 13-30)
- `EarnPage.tsx` (lines 16-35)
- `IntentPage.tsx` (lines 68-84)

**Functions to extract:**
- `fmtRate()` - format percentage/APR
- `fmtUsd()` - format USD amounts
- `fmtCrypto()` - format crypto amounts
- `secondsAgo()` - relative time
- `rawToUi()` - convert raw to UI amount
- `lamportsToSol()` - Solana specific

### 1.2 Create API Client
**File:** `src/lib/api-client.ts`

Consolidate from 6 files:
- `useIntentQuote.ts` (lines 1-7)
- `useCreateOrder.ts` (lines 1-7)
- `useYieldRates.ts` (lines 1-7)
- `usePortfolio.ts` (lines 1-7)
- `useSwapQuote.ts` (lines 8-19)
- `useSwapBuild.ts` (lines 8-19)

**Implementation:**
```typescript
const API_BASE = (import.meta.env.VITE_API_URL?.trim()) || 'http://localhost:3000/api/v1'

export const apiClient = {
  get: (url: string, config?: AxiosRequestConfig) => axios.get(`${API_BASE}${url}`, config),
  post: (url: string, data?: unknown, config?: AxiosRequestConfig) => 
    axios.post(`${API_BASE}${url}`, data, config),
}
```

### 1.3 Create Type Definitions
**File:** `src/types/global.types.ts`

Extract shared types:
- Chain types (0=EVM, 1=Solana, 2=Sui)
- Intent types
- Order status types
- Token types

### 1.4 Move Existing Files
**Files to move/rename:**
- `components/Navbar.tsx` → `components/layout/navbar.tsx`
- `config/wagmi.ts` → `lib/wagmi-config.ts`

---

## Phase 2: Feature Intent Migration (Day 2-4)

### 2.1 Create Feature Structure
```
src/features/intent/
├── api/
│   ├── get-intent-quote.ts
│   ├── create-intent-order.ts
│   ├── get-intent-orders.ts
│   └── delete-intent.ts
├── components/
│   ├── intent-chat/
│   │   ├── index.tsx
│   │   ├── message-bubble.tsx
│   │   ├── message-input.tsx
│   │   └── message-list.tsx
│   ├── order-monitor-widget/
│   │   ├── index.tsx
│   │   └── status-indicator.tsx
│   ├── intent-zero-state.tsx
│   ├── intent-active-state.tsx
│   ├── intent-settings-modal.tsx
│   └── chain-selector.tsx
├── hooks/
│   ├── use-intent-chat.ts
│   ├── use-intent-quote.ts
│   ├── use-intent-orders.ts
│   └── use-order-monitor.ts
├── types/
│   └── intent.types.ts
├── utils/
│   ├── format-intent.ts
│   └── validate-intent.ts
└── index.ts
```

### 2.2 Extract API Functions

**get-intent-quote.ts**
```typescript
// From: useIntentQuote.ts (lines 9-76)
// Migration: Convert hook to pure async function
```

**create-intent-order.ts**
```typescript
// From: useCreateOrder.ts (lines 9-89)
// Migration: Remove hook wrapper, keep API call logic
```

**get-intent-orders.ts**
```typescript
// From: useIntentOrders.ts (lines 50-180)
// Migration: Extract backend + RPC logic
// Split into: getOrdersFromBackend() + getOrdersFromRPC()
```

### 2.3 Create TanStack Query Hooks

**use-intent-quote.ts**
```typescript
import { useQuery } from '@tanstack/react-query'
import { getIntentQuote } from '../api/get-intent-quote'

export function useIntentQuote(params: GetIntentQuoteParams) {
  return useQuery({
    queryKey: ['intent', 'quote', params],
    queryFn: () => getIntentQuote(params),
    enabled: !!params.amount && parseFloat(params.amount) > 0,
    staleTime: 30000,
    refetchInterval: 30000,
  })
}
```

**use-intent-orders.ts**
```typescript
// Consolidate from: useIntentOrders.ts (319 lines)
// Split into smaller, focused hooks

export function useIntentOrders(address: string | null) {
  return useQuery({
    queryKey: ['intent', 'orders', address],
    queryFn: () => getIntentOrders(address),
    enabled: !!address,
    refetchInterval: 12000,
  })
}
```

### 2.4 Extract Components

**intent-zero-state.tsx**
```typescript
// From: IntentPage.tsx (lines 280-400)
// Extract: Zero-state view with chain selector, amount input, etc.
```

**intent-active-state.tsx**
```typescript
// From: IntentPage.tsx (lines 400-600)
// Extract: Active order view with monitor widget
```

**intent-chat/message-bubble.tsx**
```typescript
// From: IntentPage.tsx (lines 745-852)
// Extract: Message bubble component
```

**order-monitor-widget/index.tsx**
```typescript
// From: IntentPage.tsx (lines 12-136)
// Extract: OrderMonitor component (120+ lines)
```

### 2.5 Refactor IntentPage.tsx

**Before:** 900+ lines
**After:** ~100 lines (composition only)

```typescript
// pages/intent-page.tsx
export default function IntentPage() {
  const { hasActiveOrder } = useIntentOrders()
  
  return (
    <div className="intent-page">
      {hasActiveOrder ? (
        <IntentActiveState />
      ) : (
        <IntentZeroState />
      )}
    </div>
  )
}
```

### 2.6 Delete Old Files
- `hooks/useIntentQuote.ts` → Replaced by feature hook
- `hooks/useCreateOrder.ts` → Replaced by feature hook
- `hooks/useIntentOrders.ts` → Replaced by feature hook

---

## Phase 3: Feature Swap Migration (Day 4-5)

### 3.1 Create Feature Structure
```
src/features/swap/
├── api/
│   ├── get-swap-quote.ts
│   └── build-swap-tx.ts
├── components/
│   ├── swap-form/
│   │   ├── index.tsx
│   │   ├── token-selector.tsx
│   │   └── amount-input.tsx
│   └── swap-button.tsx
├── hooks/
│   ├── use-swap-quote.ts
│   └── use-swap-build.ts
└── types/
    └── swap.types.ts
```

### 3.2 Extract Components

**swap-form/index.tsx**
```typescript
// From: SwapPage.tsx (lines 100-400)
// Extract: Main swap form component
```

**token-selector.tsx**
```typescript
// From: SwapPage.tsx (lines 150-200)
// Extract: Token dropdown selector
```

### 3.3 Refactor SwapPage.tsx

**Before:** ~500 lines
**After:** ~80 lines

---

## Phase 4: Feature Earn Migration (Day 5-6)

### 4.1 Create Feature Structure
```
src/features/earn/
├── api/
│   ├── get-yield-rates.ts
│   ├── stake-tokens.ts
│   └── unstake-tokens.ts
├── components/
│   ├── stake-tab/
│   │   ├── index.tsx
│   │   ├── protocol-card.tsx
│   │   └── stake-form.tsx
│   └── positions-tab/
│       ├── index.tsx
│       └── position-card.tsx
├── hooks/
│   ├── use-yield-rates.ts
│   ├── use-stake.ts
│   └── use-unstake.ts
└── types/
    └── earn.types.ts
```

### 4.2 Refactor EarnPage.tsx

**Before:** 714 lines
**After:** ~100 lines

Split tabs into separate components:
- `stake-tab/index.tsx`
- `positions-tab/index.tsx`

---

## Phase 5: Feature Portfolio Migration (Day 6)

### 5.1 Create Feature Structure
```
src/features/portfolio/
├── api/
│   └── get-portfolio.ts
├── components/
│   ├── portfolio-overview.tsx
│   ├── position-list.tsx
│   ├── position-card.tsx
│   └── unstake-modal.tsx
├── hooks/
│   └── use-portfolio.ts
└── types/
    └── portfolio.types.ts
```

### 5.2 Refactor PortfolioPage.tsx

**Before:** 421 lines
**After:** ~80 lines

---

## Phase 6: Shared Components & Cleanup (Day 6-7)

### 6.1 Create UI Components
```
src/components/ui/
├── button.tsx
├── input.tsx
├── select.tsx
├── modal.tsx
├── card.tsx
├── badge.tsx
├── loading-spinner.tsx
└── error-boundary.tsx
```

Extract reusable UI from:
- `IntentPage.tsx` - buttons, inputs, modals
- `SwapPage.tsx` - token selector UI
- `EarnPage.tsx` - protocol cards

### 6.2 Create Layout Components
```
src/components/layout/
├── main-layout.tsx
├── navbar.tsx (moved)
├── sidebar.tsx
└── footer.tsx
```

### 6.3 Update App.tsx
```typescript
// Simplified routing
import { IntentPage } from '@/features/intent'
import { SwapPage } from '@/features/swap'
import { EarnPage } from '@/features/earn'
import { PortfolioPage } from '@/features/portfolio'

function App() {
  return (
    <QueryProvider>
      <MainLayout>
        <Routes>
          <Route path="/intent" element={<IntentPage />} />
          <Route path="/swap" element={<SwapPage />} />
          <Route path="/earn" element={<EarnPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
        </Routes>
      </MainLayout>
    </QueryProvider>
  )
}
```

### 6.4 Remove Dead Code
- [ ] Delete `pages/AgentPage.tsx` (duplicate functionality)
- [ ] Delete `hooks/useOpenClaw.ts` (unused)
- [ ] Delete `hooks/useAgent.ts` (replaced)
- [ ] Delete old CSS overrides (moved to components)

### 6.5 Verify No Duplicates
Check for remaining duplicates:
- [ ] `fmtRate()` - Should only exist in `lib/utils/format.ts`
- [ ] `API base URL` - Should only exist in `lib/api-client.ts`
- [ ] CSS wallet adapter override - Should be in one place

---

## File Mapping (Old → New)

| Old File | New Location | Action |
|----------|-------------|---------|
| `pages/IntentPage.tsx` | `pages/intent-page.tsx` | Refactor to composition |
| | `features/intent/components/intent-chat/` | Extract |
| | `features/intent/components/order-monitor-widget/` | Extract |
| | `features/intent/components/intent-zero-state.tsx` | Extract |
| | `features/intent/components/intent-active-state.tsx` | Extract |
| `hooks/useIntentQuote.ts` | `features/intent/hooks/use-intent-quote.ts` | Rewrite with TanStack Query |
| `hooks/useCreateOrder.ts` | `features/intent/api/create-intent-order.ts` | Convert to API function |
| | `features/intent/hooks/use-create-intent.ts` | Create mutation hook |
| `hooks/useIntentOrders.ts` | `features/intent/hooks/use-intent-orders.ts` | Rewrite with TanStack Query |
| `hooks/useSolanaAddress.ts` | `hooks/use-wallet-address.ts` | Move & rename |
| `pages/SwapPage.tsx` | `pages/swap-page.tsx` | Refactor |
| | `features/swap/components/swap-form/` | Extract |
| `hooks/useSwapQuote.ts` | `features/swap/hooks/use-swap-quote.ts` | Rewrite |
| `hooks/useSwapBuild.ts` | `features/swap/hooks/use-swap-build.ts` | Rewrite |
| `pages/EarnPage.tsx` | `pages/earn-page.tsx` | Refactor |
| | `features/earn/components/stake-tab/` | Extract |
| | `features/earn/components/positions-tab/` | Extract |
| `hooks/useYieldRates.ts` | `features/earn/hooks/use-yield-rates.ts` | Rewrite |
| `pages/PortfolioPage.tsx` | `pages/portfolio-page.tsx` | Refactor |
| `hooks/usePortfolio.ts` | `features/portfolio/hooks/use-portfolio.ts` | Rewrite |
| `pages/ActiveIntents.tsx` | `pages/active-intents-page.tsx` | Rename & refactor |
| `components/Navbar.tsx` | `components/layout/navbar.tsx` | Move & refactor |
| `pages/AgentPage.tsx` | — | **DELETE** (duplicate) |
| `hooks/useOpenClaw.ts` | — | **DELETE** (unused) |

---

## Testing Strategy

### Unit Tests (Jest/Vitest)
- [ ] `lib/utils/format.ts` - Test all formatters
- [ ] `lib/api-client.ts` - Test API calls
- [ ] Feature hooks - Test with MSW

### Integration Tests
- [ ] Intent creation flow
- [ ] Swap execution flow
- [ ] Earn staking flow
- [ ] Portfolio viewing flow

### E2E Tests (Playwright/Cypress)
- [ ] End-to-end intent bridge
- [ ] Cross-page navigation
- [ ] Wallet connection flows

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Breaking changes during refactor | High | High | Feature flag old code, test thoroughly |
| TanStack Query cache issues | Medium | Medium | Use devtools, test cache invalidation |
| Type errors after move | Medium | Medium | Strict TypeScript check before each phase |
| Missing imports after rename | High | Low | IDE refactor tools, systematic checking |
| Component state bugs | Medium | High | Test each component in isolation |

---

## Timeline Summary

| Phase | Duration | Deliverables |
|-------|----------|-------------|
| Phase 0 | 4 hours | Dependencies, folder structure, tsconfig |
| Phase 1 | 1 day | Shared utilities, API client, base types |
| Phase 2 | 2 days | Intent feature fully migrated |
| Phase 3 | 1 day | Swap feature fully migrated |
| Phase 4 | 1 day | Earn feature fully migrated |
| Phase 5 | 0.5 day | Portfolio feature fully migrated |
| Phase 6 | 1 day | Shared UI, cleanup, final testing |
| **Total** | **~7 days** | **Complete refactor** |

---

## Success Criteria

✅ All files use kebab-case naming
✅ No file exceeds 150 lines (except barrel exports)
✅ No duplicate utility functions
✅ All API calls centralized through `api-client.ts`
✅ TanStack Query used for all server state
✅ All hooks in kebab-case files with camelCase function names
✅ All components in kebab-case files with PascalCase exports
✅ Zero `any` type usage (except unavoidable third-party)
✅ All features follow atomic design structure
✅ Tests pass (if any exist)
✅ App builds without errors
✅ All features functional (manual QA)

---

## Pre-Execution Checklist

Before starting:
- [ ] Backup current codebase (git branch)
- [ ] Review plan with team
- [ ] Ensure no pending critical features
- [ ] Allocate dedicated time (no interruptions)
- [ ] Prepare testing environment

---

## Post-Execution Checklist

After completion:
- [ ] Run full test suite
- [ ] Manual QA on all features
- [ ] Update documentation
- [ ] Code review with team
- [ ] Deploy to staging
- [ ] Monitor for errors

---

## Commands to Run

```bash
# Phase 0
npm install @tanstack/react-query @tanstack/react-query-devtools

# After each phase
npm run type-check
npm run lint
npm run build

# Final verification
npm run test
npm run build
```

---

## Notes

- Keep git commits atomic (1 commit per file move/refactor)
- Use `git mv` for renaming to preserve history
- Test each phase before proceeding to next
- If blocked, mark with TODO and move to next task
- Document any unexpected issues in MIGRATION_LOG.md
