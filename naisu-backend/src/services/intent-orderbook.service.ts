/**
 * In-Memory Order Book for Gasless Intents
 * 
 * Stores pending intents that have been submitted off-chain but not yet
 * executed on-chain by a solver. This is the core of the RFQ matching engine.
 */

import { EventEmitter } from 'events'
import type { Address, Hex } from 'viem'
import { logger } from '@lib/logger'

export type IntentStatus = 
  | 'pending_rfq'      // Just received, broadcasting to solvers
  | 'rfq_active'       // Solvers are bidding
  | 'winner_selected'  // Winner chosen, signature sent
  | 'executing'        // Solver is executing on-chain
  | 'fulfilled'        // Successfully executed on-chain
  | 'expired'          // Deadline passed without execution
  | 'cancelled'        // User cancelled

export interface PendingIntent {
  intentId: string
  intent: {
    creator: Address
    recipient: Hex
    destinationChain: number
    amount: string
    startPrice: string
    floorPrice: string
    deadline: number
    intentType: number
    nonce: number
  }
  signature: Hex
  status: IntentStatus
  submittedAt: number
  winningSolver?: Address
  quotes: SolverQuote[]
}

export interface SolverQuote {
  solver: Address
  solverName: string
  price: string  // How much destination token solver will send
  gasEstimate: string
  estimatedFillTime: number // milliseconds
  quotedAt: number
}

// In-memory storage
const pendingIntents = new Map<string, PendingIntent>()
const userNonces = new Map<Address, number>()

// Event emitter for RFQ events
export const orderbookEvents = new EventEmitter()

/**
 * Add a new intent to the order book
 */
export function addIntent(
  intentId: string,
  intent: PendingIntent['intent'],
  signature: Hex
): PendingIntent {
  const pendingIntent: PendingIntent = {
    intentId,
    intent,
    signature,
    status: 'pending_rfq',
    submittedAt: Date.now(),
    quotes: [],
  }

  pendingIntents.set(intentId, pendingIntent)

  // Update user nonce tracking
  userNonces.set(intent.creator, intent.nonce + 1)

  logger.info({ intentId, creator: intent.creator, nonce: intent.nonce }, 'Intent added to orderbook')

  // Emit event for RFQ system
  orderbookEvents.emit('intent_added', pendingIntent)

  return pendingIntent
}

/**
 * Get an intent by ID
 */
export function getIntent(intentId: string): PendingIntent | undefined {
  return pendingIntents.get(intentId)
}

/**
 * Get all intents for a user
 */
export function getUserIntents(userAddress: Address): PendingIntent[] {
  return Array.from(pendingIntents.values()).filter(
    (intent) => intent.intent.creator.toLowerCase() === userAddress.toLowerCase()
  )
}

/**
 * Get expected nonce for a user
 */
export function getUserNonce(userAddress: Address): number {
  return userNonces.get(userAddress) ?? 0
}

/**
 * Add a solver quote to an intent
 */
export function addQuote(intentId: string, quote: SolverQuote): boolean {
  const intent = pendingIntents.get(intentId)
  if (!intent || intent.status !== 'rfq_active') {
    logger.warn({ intentId }, 'Cannot add quote: intent not in rfq_active state')
    return false
  }

  intent.quotes.push(quote)
  logger.info({ intentId, solver: quote.solver, price: quote.price }, 'Solver quote received')

  // Emit event
  orderbookEvents.emit('quote_received', { intentId, quote })

  return true
}

/**
 * Update intent status
 */
export function updateIntentStatus(intentId: string, status: IntentStatus): boolean {
  const intent = pendingIntents.get(intentId)
  if (!intent) {
    logger.warn({ intentId }, 'Cannot update status: intent not found')
    return false
  }

  const prevStatus = intent.status
  intent.status = status

  logger.info({ intentId, prevStatus, newStatus: status }, 'Intent status updated')

  // Emit event
  orderbookEvents.emit('status_changed', { intentId, status, prevStatus })

  return true
}

/**
 * Select winning solver for an intent
 */
export function selectWinner(intentId: string, solver: Address): boolean {
  const intent = pendingIntents.get(intentId)
  if (!intent) {
    logger.warn({ intentId }, 'Cannot select winner: intent not found')
    return false
  }

  intent.winningSolver = solver
  intent.status = 'winner_selected'

  logger.info({ intentId, solver }, 'Winning solver selected')

  // Emit event
  orderbookEvents.emit('winner_selected', { intentId, solver, signature: intent.signature })

  return true
}

/**
 * Mark intent as fulfilled (executed on-chain)
 */
export function markFulfilled(intentId: string): boolean {
  const intent = pendingIntents.get(intentId)
  if (!intent) {
    logger.warn({ intentId }, 'Cannot mark fulfilled: intent not found')
    return false
  }

  intent.status = 'fulfilled'

  logger.info({ intentId, solver: intent.winningSolver }, 'Intent fulfilled on-chain')

  // Emit event
  orderbookEvents.emit('intent_fulfilled', { intentId })

  // Clean up after 1 hour
  setTimeout(() => {
    pendingIntents.delete(intentId)
    logger.debug({ intentId }, 'Intent cleaned up from orderbook')
  }, 60 * 60 * 1000)

  return true
}

/**
 * Clean up expired intents (deadline passed)
 */
export function cleanupExpiredIntents(): number {
  const now = Date.now() / 1000 // unix timestamp
  let cleaned = 0

  for (const [intentId, intent] of pendingIntents.entries()) {
    if (intent.intent.deadline < now && intent.status !== 'fulfilled') {
      intent.status = 'expired'
      logger.info({ intentId, deadline: intent.intent.deadline }, 'Intent expired')
      orderbookEvents.emit('intent_expired', { intentId })

      // Delete after marking expired
      setTimeout(() => pendingIntents.delete(intentId), 5000)
      cleaned++
    }
  }

  return cleaned
}

/**
 * Get orderbook statistics
 */
export function getOrderbookStats() {
  const intents = Array.from(pendingIntents.values())

  return {
    total: intents.length,
    byStatus: {
      pending_rfq: intents.filter((i) => i.status === 'pending_rfq').length,
      rfq_active: intents.filter((i) => i.status === 'rfq_active').length,
      winner_selected: intents.filter((i) => i.status === 'winner_selected').length,
      executing: intents.filter((i) => i.status === 'executing').length,
      fulfilled: intents.filter((i) => i.status === 'fulfilled').length,
      expired: intents.filter((i) => i.status === 'expired').length,
    },
    averageQuotes: intents.length > 0 
      ? intents.reduce((sum, i) => sum + i.quotes.length, 0) / intents.length 
      : 0,
  }
}

// Start cleanup interval (every 30 seconds)
setInterval(() => {
  const cleaned = cleanupExpiredIntents()
  if (cleaned > 0) {
    logger.info({ cleaned }, 'Cleaned up expired intents')
  }
}, 30_000)
