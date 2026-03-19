/**
 * Chain identifiers
 */
export const CHAINS = {
  EVM: 0,
  SOLANA: 1,
  SUI: 2,
} as const

export type ChainId = typeof CHAINS[keyof typeof CHAINS]

/**
 * Intent types
 */
export const INTENT_TYPES = {
  BRIDGE: 0,
  STAKE: 1,
  SWAP: 2,
} as const

export type IntentType = typeof INTENT_TYPES[keyof typeof INTENT_TYPES]

/**
 * Order status
 */
export const ORDER_STATUS = {
  PENDING: 'pending',
  FULFILLED: 'fulfilled',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const

export type OrderStatus = typeof ORDER_STATUS[keyof typeof ORDER_STATUS]

/**
 * Token info
 */
export interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  chainId: ChainId
  logoUrl?: string
}

/**
 * Chain configuration
 */
export interface ChainConfig {
  id: ChainId
  name: string
  nativeToken: string
  rpcUrl: string
  explorerUrl: string
}

/**
 * Intent quote
 */
export interface IntentQuote {
  sourceChain: ChainId
  destinationChain: ChainId
  sourceToken: string
  destinationToken: string
  amountIn: string
  amountOut: string
  price: number
  priceUsd: number
  expiresAt: number
  solverFee: string
  protocolFee: string
}

/**
 * Intent order
 */
export interface IntentOrder {
  id: string
  userAddress: string
  sourceChain: ChainId
  destinationChain: ChainId
  sourceToken: string
  destinationToken: string
  amountIn: string
  amountOut: string
  status: OrderStatus
  createdAt: number
  expiresAt: number
  fulfilledAt?: number
  txHash?: string
  solver?: string
  intentType: IntentType
}

/**
 * Protocol rate for yield
 */
export interface ProtocolRate {
  protocol: string
  apy: number
  tvl: number
  token: string
}

/**
 * Wallet state
 */
export interface WalletState {
  evmAddress: string | null
  solanaAddress: string | null
  suiAddress: string | null
  isConnecting: boolean
  isConnected: boolean
}

/**
 * API error response
 */
export interface ApiErrorResponse {
  message: string
  code: string
  status: number
}

/**
 * Pagination params
 */
export interface PaginationParams {
  page?: number
  limit?: number
  offset?: number
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}
