// Validate required env vars and throw if missing
function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Please check your .env file.`);
  }
  return value;
}

// Sui
export const SUI_PACKAGE_ID = requireEnv("VITE_SUI_PACKAGE_ID", import.meta.env.VITE_SUI_PACKAGE_ID);
export const SUI_BRIDGE_STATE_ID = requireEnv("VITE_SUI_BRIDGE_STATE_ID", import.meta.env.VITE_SUI_BRIDGE_STATE_ID);

// EVM Contracts
export const AVALANCHE_FUJI_CONTRACT_ADDRESS = requireEnv(
  "VITE_AVALANCHE_FUJI_CONTRACT_ADDRESS",
  import.meta.env.VITE_AVALANCHE_FUJI_CONTRACT_ADDRESS
);

export const BASE_SEPOLIA_CONTRACT_ADDRESS = requireEnv(
  "VITE_BASE_SEPOLIA_CONTRACT_ADDRESS",
  import.meta.env.VITE_BASE_SEPOLIA_CONTRACT_ADDRESS
);

// Active contract (defaults to Fuji for backward compat, but should be selected by user)
export const EVM_CONTRACT_ADDRESS = AVALANCHE_FUJI_CONTRACT_ADDRESS;

// Package IDs for event querying (fresh deployment = only current package)
export const SUI_ALL_PACKAGE_IDS: string[] = [SUI_PACKAGE_ID];

// Solana Program (loaded from VITE_SOLANA_PROGRAM_ID env — never hardcode dynamic addresses)
export const SOLANA_PROGRAM_ID = requireEnv("VITE_SOLANA_PROGRAM_ID", import.meta.env.VITE_SOLANA_PROGRAM_ID);

// Wormhole chain IDs
export const WORMHOLE_CHAIN_SOLANA = 1;
export const WORMHOLE_CHAIN_SUI = 21;
export const WORMHOLE_CHAIN_BASE = 10004;
export const WORMHOLE_CHAIN_FUJI = 6;

// EVM chain IDs
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const AVALANCHE_FUJI_CHAIN_ID = 43113;

// Mock Staking (Solana Devnet) — loaded from .env
export const MOCK_STAKING_PROGRAM_ID = requireEnv("VITE_MOCK_STAKING_PROGRAM_ID", import.meta.env.VITE_MOCK_STAKING_PROGRAM_ID);
export const MOCK_STAKING_POOL_ADDRESS = requireEnv("VITE_MOCK_STAKING_POOL_ADDRESS", import.meta.env.VITE_MOCK_STAKING_POOL_ADDRESS);
