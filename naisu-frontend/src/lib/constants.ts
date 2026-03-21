import {
  CONTRACT_BASE_SEPOLIA,
  SOLANA_PROGRAM_ID as SOLANA_PROGRAM_ID_ENV,
  SUI_PACKAGE_ID as SUI_PACKAGE_ID_ENV,
  SUI_BRIDGE_STATE_ID as SUI_BRIDGE_STATE_ID_ENV,
} from '@/lib/env'

// ── EVM Contracts ─────────────────────────────────────────────────────────────
export const BASE_SEPOLIA_CONTRACT = CONTRACT_BASE_SEPOLIA

// ── Chain IDs ─────────────────────────────────────────────────────────────────
export const BASE_SEPOLIA_CHAIN_ID = 84532

// ── Wormhole Chain IDs ────────────────────────────────────────────────────────
export const WORMHOLE_CHAIN_SOLANA = 1
export const WORMHOLE_CHAIN_SUI    = 21
export const WORMHOLE_CHAIN_BASE   = 10004

// ── Solana ────────────────────────────────────────────────────────────────────
export const SOLANA_PROGRAM_ID = SOLANA_PROGRAM_ID_ENV

// ── Sui ───────────────────────────────────────────────────────────────────────
export const SUI_PACKAGE_ID      = SUI_PACKAGE_ID_ENV
export const SUI_BRIDGE_STATE_ID = SUI_BRIDGE_STATE_ID_ENV
export const SUI_ALL_PACKAGE_IDS: string[] = [SUI_PACKAGE_ID_ENV]

// ── EVM RPC URLs ──────────────────────────────────────────────────────────────
export const BASE_SEPOLIA_RPC = 'https://sepolia.base.org'

// ── Explorers ─────────────────────────────────────────────────────────────────
export const EXPLORERS = {
  baseSepolia: 'https://sepolia.basescan.org',
  solana:      'https://explorer.solana.com',
  sui:         'https://suiscan.xyz/testnet',
} as const
