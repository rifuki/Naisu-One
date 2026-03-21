/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Backend
  readonly VITE_API_URL: string
  readonly VITE_BACKEND_URL: string

  // Agent (Nesu)
  readonly VITE_AGENT_URL: string
  readonly VITE_AGENT_PROJECT_ID: string

  // EVM Contracts
  readonly VITE_CONTRACT_BASE_SEPOLIA: string
  readonly VITE_CHAIN_ID_BASE_SEPOLIA: string

  // Solana
  readonly VITE_SOLANA_PROGRAM_ID: string

  // Sui
  readonly VITE_SUI_PACKAGE_ID: string
  readonly VITE_SUI_BRIDGE_STATE_ID: string

  // Optional
  readonly VITE_BASE_SEPOLIA_RPC_URL: string
  readonly VITE_GROQ_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
