// Validate required env vars at startup — throw immediately if missing
function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing env var: ${name}. Check .env`);
  return value;
}

// ── EVM Contracts ────────────────────────────────────────────────────────────
export const BASE_SEPOLIA_CONTRACT = requireEnv(
  "VITE_CONTRACT_BASE_SEPOLIA",
  import.meta.env.VITE_CONTRACT_BASE_SEPOLIA,
) as `0x${string}`;

// ── Chain IDs ─────────────────────────────────────────────────────────────────
export const BASE_SEPOLIA_CHAIN_ID = 84532;

// ── Wormhole Chain IDs ────────────────────────────────────────────────────────
export const WORMHOLE_CHAIN_SOLANA = 1;
export const WORMHOLE_CHAIN_SUI    = 21;
export const WORMHOLE_CHAIN_BASE   = 10004;

// ── Solana ───────────────────────────────────────────────────────────────────
export const SOLANA_PROGRAM_ID = requireEnv(
  "VITE_SOLANA_PROGRAM_ID",
  import.meta.env.VITE_SOLANA_PROGRAM_ID,
);

// ── Sui ──────────────────────────────────────────────────────────────────────
export const SUI_PACKAGE_ID = requireEnv(
  "VITE_SUI_PACKAGE_ID",
  import.meta.env.VITE_SUI_PACKAGE_ID,
);
export const SUI_BRIDGE_STATE_ID = requireEnv(
  "VITE_SUI_BRIDGE_STATE_ID",
  import.meta.env.VITE_SUI_BRIDGE_STATE_ID,
);
export const SUI_ALL_PACKAGE_IDS: string[] = [SUI_PACKAGE_ID];

// ── EVM RPC URLs ──────────────────────────────────────────────────────────────
export const BASE_SEPOLIA_RPC  = "https://sepolia.base.org";

// ── Explorers ─────────────────────────────────────────────────────────────────
export const EXPLORERS = {
  baseSepolia: "https://sepolia.basescan.org",
  solana:      "https://explorer.solana.com",
  sui:         "https://suiscan.xyz/testnet",
} as const;
