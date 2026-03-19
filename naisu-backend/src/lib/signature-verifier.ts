/**
 * EIP-712 Signature Verification for Gasless Intents
 * 
 * Verifies that a user signed an intent message off-chain before
 * allowing the backend to process it via the RFQ system.
 */

import { verifyTypedData, type Address, type Hex } from 'viem'
import { logger } from './logger'
import { config } from '@config/env'

// EIP-712 Domain for NaisuIntentBridge
// Must match the domain in the smart contract
export const INTENT_DOMAIN = {
  name: 'NaisuIntentBridge',
  version: '1',
  chainId: config.intent.evm.baseSepolia.chainId,
  verifyingContract: config.intent.evm.baseSepolia.contract,
} as const

// EIP-712 Types for Intent
export const INTENT_TYPES = {
  Intent: [
    { name: 'creator', type: 'address' },
    { name: 'recipient', type: 'bytes32' },
    { name: 'destinationChain', type: 'uint16' },
    { name: 'amount', type: 'uint256' },
    { name: 'startPrice', type: 'uint256' },
    { name: 'floorPrice', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'intentType', type: 'uint8' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const

export interface Intent {
  creator: Address
  recipient: Hex
  destinationChain: number
  amount: bigint
  startPrice: bigint
  floorPrice: bigint
  deadline: bigint
  intentType: number
  nonce: bigint
}

/**
 * Verify an EIP-712 signature for an intent
 * 
 * @param intent - The intent data that was signed
 * @param signature - The signature from the user (0x + 130 hex chars)
 * @returns true if signature is valid, false otherwise
 */
export async function verifyIntentSignature(
  intent: Intent,
  signature: Hex
): Promise<boolean> {
  try {
    const isValid = await verifyTypedData({
      address: intent.creator,
      domain: INTENT_DOMAIN,
      types: INTENT_TYPES,
      primaryType: 'Intent',
      message: intent,
      signature,
    })

    if (!isValid) {
      logger.warn({ creator: intent.creator, nonce: intent.nonce }, 'Invalid signature')
    }

    return isValid
  } catch (error) {
    logger.error({ error, intent }, 'Signature verification failed')
    return false
  }
}

/**
 * Recover the signer address from an EIP-712 signature
 * (Alternative verification method - verifyTypedData is preferred)
 */
export async function recoverIntentSigner(
  intent: Intent,
  signature: Hex
): Promise<Address | null> {
  try {
    // Viem's verifyTypedData already does recovery internally
    // This is just for debugging/logging purposes
    const isValid = await verifyTypedData({
      address: intent.creator,
      domain: INTENT_DOMAIN,
      types: INTENT_TYPES,
      primaryType: 'Intent',
      message: intent,
      signature,
    })

    return isValid ? intent.creator : null
  } catch (error) {
    logger.error({ error }, 'Signer recovery failed')
    return null
  }
}
