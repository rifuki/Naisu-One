/**
 * Application Constants
 * Uniswap V4 Backend
 */

// ============================================================================
// Server
// ============================================================================

export const SERVER = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  HOST: process.env.HOST || '0.0.0.0',
  NODE_ENV: process.env.NODE_ENV || 'development',
  REQUEST_TIMEOUT: 30000,
} as const

// ============================================================================
// Pagination
// ============================================================================

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const

// ============================================================================
// EVM Chains
// ============================================================================

export const CHAINS = {
  BASE: {
    id: 'base',
    name: 'Base',
    nativeCurrency: 'ETH',
    decimals: 18,
    explorerUrl: 'https://basescan.org',
  },
  BASE_SEPOLIA: {
    id: 'base-sepolia',
    name: 'Base Sepolia',
    nativeCurrency: 'ETH',
    decimals: 18,
    explorerUrl: 'https://sepolia.basescan.org',
  },
} as const

// ============================================================================
// Uniswap V4 Constants
// ============================================================================

export const UNISWAP_V4 = {
  // Base Sepolia deployed contracts
  BASE_SEPOLIA: {
    SWAP_CONTRACT: '0xd102861878FF7d241c50fc6Ca2f599710E69ddFf' as `0x${string}`,
    REWARDS_CONTRACT: '0x0FB3da1B4133EcCAE050aBFA76998fE4768ae287' as `0x${string}`,
    POOL_MANAGER: '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408' as `0x${string}`,
  },
  // Base Mainnet (TODO: Update with actual mainnet addresses)
  BASE_MAINNET: {
    SWAP_CONTRACT: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    REWARDS_CONTRACT: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    POOL_MANAGER: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  },
  // Default fee (0.1%)
  DEFAULT_FEE: 1000,
  // Default tick spacing
  DEFAULT_TICK_SPACING: 60,
  // Q96 constant for price calculations
  Q96: BigInt(2) ** BigInt(96),
} as const

// ============================================================================
// Solana
// ============================================================================

export const SOLANA = {
  DEVNET: {
    RPC_URL: 'https://api.devnet.solana.com',
    EXPLORER_URL: 'https://explorer.solana.com/?cluster=devnet',
  },
  MAINNET: {
    RPC_URL: 'https://api.mainnet-beta.solana.com',
    EXPLORER_URL: 'https://explorer.solana.com',
  },
  // Lamports per SOL
  LAMPORTS_PER_SOL: 1_000_000_000,
  // Default commitment level
  COMMITMENT: 'confirmed' as const,
} as const

// ============================================================================
// Intent Bridge
// ============================================================================

export const INTENT_BRIDGE = {
  // Solana intent bridge program (Anchor, devnet)
  SOLANA_PROGRAM_ID: 'FSHrXSKTZtLisVCssJx5pyUmiL9U3VJL58zSRysBja4k',

  // Sui intent bridge (testnet)
  SUI_PACKAGE_ID: '0x920f52f8b6734e5333330d50b8b6925d38b39c6d0498dd0053b76e889365cecb',
  SUI_BRIDGE_STATE_ID: '0x7aac5f895e7071fc33a65fe4325365bb287c64d229d1af1d03e613c8153b3703',

  // EVM — Avalanche Fuji (testnet)
  FUJI_CONTRACT: '0x274768b4B16841d23B8248d1311fBDC760803E65' as `0x${string}`,
  FUJI_CHAIN_ID: 43113,

  // Wormhole chain IDs
  WORMHOLE: {
    SOLANA: 1,
    SUI: 21,
    BASE_SEPOLIA: 10004,
    FUJI: 6,
  },

  // Intent status codes
  STATUS: {
    OPEN: 0,
    FULFILLED: 1,
    CANCELLED: 2,
  },

  // Dutch auction default params
  AUCTION: {
    DEFAULT_DURATION_MS: 5 * 60 * 1000, // 5 minutes
    DEFAULT_FLOOR_RATIO: 0.95,           // floor = 95% of start price
  },
} as const

// ============================================================================
// API Rate Limits
// ============================================================================

export const RATE_LIMITS = {
  DEFAULT_WINDOW_MS: 60000, // 1 minute
  DEFAULT_MAX_REQUESTS: 1000,
} as const

// ============================================================================
// Cache Settings
// ============================================================================

export const CACHE = {
  POOL_STATE_TTL_SECONDS: 30, // 30 seconds for pool state
  PRICE_TTL_SECONDS: 10, // 10 seconds for prices
} as const

// ============================================================================
// Error Codes
// ============================================================================

export const ERROR_CODES = {
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_ADDRESS: 'INVALID_ADDRESS',
  INVALID_POOL_ID: 'INVALID_POOL_ID',

  // Blockchain errors
  CONTRACT_ERROR: 'CONTRACT_ERROR',
  RPC_ERROR: 'RPC_ERROR',

  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',

  // General
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
} as const

// ============================================================================
// Time Formatting
// ============================================================================

export const TIME = {
  ONE_SECOND: 1000,
  ONE_MINUTE: 60 * 1000,
  ONE_HOUR: 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
} as const
