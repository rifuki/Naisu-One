/**
 * Solana Service
 * Business logic for Solana operations:
 *   - SOL wallet balance
 */
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getSolanaConnection, isValidPublicKey } from '@lib/solana-client'
import { config } from '@config/env'
import { logger } from '@lib/logger'
import { AppError } from '@utils/validation'
import { ERROR_CODES } from '@config/constants'

// ============================================================================
// Types
// ============================================================================

export interface SolanaBalance {
  address: string
  solBalance: number
  solBalanceLamports: number
  network: string
}

// ============================================================================
// General
// ============================================================================

/**
 * Get SOL balance for a wallet address.
 */
export async function getSolBalance(address: string): Promise<SolanaBalance> {
  if (!isValidPublicKey(address)) {
    throw new AppError('Invalid Solana address', 400, ERROR_CODES.INVALID_ADDRESS)
  }

  const connection = getSolanaConnection()
  const pubkey = new PublicKey(address)

  logger.debug({ address }, 'Fetching SOL balance')

  const lamports = await connection.getBalance(pubkey, 'confirmed')

  return {
    address,
    solBalance: lamports / LAMPORTS_PER_SOL,
    solBalanceLamports: lamports,
    network: config.solana.network,
  }
}
