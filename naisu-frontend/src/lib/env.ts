function getRequiredEnv(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name]?.trim()
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\nPlease add it to your .env file:\n${name}=your_value_here`
    )
  }
  return value
}

function getOptionalEnv(name: keyof ImportMetaEnv, fallback: string): string {
  return import.meta.env[name]?.trim() || fallback
}

// ── Backend ───────────────────────────────────────────────────────────────────
export const API_URL     = getRequiredEnv('VITE_API_URL')
export const BACKEND_URL = getRequiredEnv('VITE_BACKEND_URL')

// ── Agent (Nesu) ──────────────────────────────────────────────────────────────
export const AGENT_URL        = getOptionalEnv('VITE_AGENT_URL', 'http://localhost:8787')
export const AGENT_PROJECT_ID = getOptionalEnv('VITE_AGENT_PROJECT_ID', 'nesu')

// ── EVM Contracts ─────────────────────────────────────────────────────────────
export const CONTRACT_BASE_SEPOLIA = getRequiredEnv('VITE_CONTRACT_BASE_SEPOLIA') as `0x${string}`
export const CHAIN_ID_BASE_SEPOLIA = Number(getOptionalEnv('VITE_CHAIN_ID_BASE_SEPOLIA', '84532'))

// ── Solana ────────────────────────────────────────────────────────────────────
export const SOLANA_PROGRAM_ID = getRequiredEnv('VITE_SOLANA_PROGRAM_ID')

// ── Sui ───────────────────────────────────────────────────────────────────────
export const SUI_PACKAGE_ID     = getRequiredEnv('VITE_SUI_PACKAGE_ID')
export const SUI_BRIDGE_STATE_ID = getRequiredEnv('VITE_SUI_BRIDGE_STATE_ID')

// ── Optional ──────────────────────────────────────────────────────────────────
export const BASE_SEPOLIA_RPC_URL = import.meta.env.VITE_BASE_SEPOLIA_RPC_URL?.trim() || undefined
export const GROQ_API_KEY         = import.meta.env.VITE_GROQ_API_KEY?.trim() || undefined
