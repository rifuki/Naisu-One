/**
 * Solana Client
 * Singleton Connection instance for Solana devnet/mainnet
 */
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js'
import { config } from '@config/env'

// ============================================================================
// Connection
// ============================================================================

let _connection: Connection | null = null

export function getSolanaConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(config.solana.rpcUrl, {
      commitment: 'confirmed',
    })
  }
  return _connection
}

// ============================================================================
// Helpers
// ============================================================================

export function toPublicKey(address: string): PublicKey {
  return new PublicKey(address)
}

export function isValidPublicKey(address: string): boolean {
  try {
    new PublicKey(address)
    return true
  } catch {
    return false
  }
}
