/**
 * Centralized query key factory.
 *
 * - Bare key (no params) → used for prefix-based invalidation
 * - Key with params      → used for specific query caching
 *
 * @example
 * // Query
 * queryKey: queryKeys.intent.ordersByParams(params)
 *
 * // Invalidate all intent orders regardless of params
 * queryClient.invalidateQueries({ queryKey: queryKeys.intent.orders() })
 */
export const queryKeys = {
  intent: {
    orders: () => ["intent", "orders"] as const,
    ordersByParams: (params: object) => ["intent", "orders", params] as const,
    quote: (params: object) => ["intent", "quote", params] as const,
    nonce: (address: string) => ["intent", "nonce", address] as const,
  },
  swap: {
    quote: (params: object) => ["swap", "quote", params] as const,
  },
  earn: {
    yieldRates: () => ["earn", "yield-rates"] as const,
    positions: (wallet: string | null) => ["earn", "positions", wallet] as const,
  },
  prices: {
    eth: () => ["prices", "eth"] as const,
  },
};
