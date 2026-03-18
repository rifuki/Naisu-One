/**
 * Portfolio Service
 * Reads on-chain Solana token balances (mSOL, USDC, SOL) for a given wallet.
 * Also builds unsigned Marinade liquid-unstake transactions via script.
 */

import { Connection, PublicKey } from '@solana/web3.js'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { fileURLToPath } from 'url'

const execFileAsync = promisify(execFile)

// ── Constants ─────────────────────────────────────────────────────────────────

const SOLANA_RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

export const MSOL_MINT   = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'
export const USDC_MINT   = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' // devnet USDC
export const MSOL_DECIMALS = 9
export const USDC_DECIMALS = 6

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PortfolioBalances {
  wallet:       string
  sol:          string  // lamports (raw)
  msol:         string  // mSOL smallest unit (raw)
  usdc:         string  // USDC micro-units (raw)
  msolDecimals: number
  usdcDecimals: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scriptsDir(): string {
  // __filename = naisu-backend/src/services/portfolio.service.ts
  // Go up 3 levels → repo root, then into naisu-contracts
  const thisFile = fileURLToPath(import.meta.url)
  return path.resolve(path.dirname(thisFile), '../../../naisu-contracts/solana/scripts/dist')
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch SOL + SPL token balances (mSOL, USDC) for a Solana wallet.
 */
export async function getPortfolioBalances(wallet: string): Promise<PortfolioBalances> {
  const connection = new Connection(SOLANA_RPC, 'confirmed')
  const pubkey = new PublicKey(wallet)

  const [solLamports, tokenAccounts] = await Promise.all([
    connection.getBalance(pubkey, 'confirmed'),
    connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID }),
  ])

  let msol = '0'
  let usdc = '0'

  for (const { account } of tokenAccounts.value) {
    const info = (account.data as any).parsed?.info as
      | { mint: string; tokenAmount: { amount: string } }
      | undefined
    if (!info) continue
    if (info.mint === MSOL_MINT) msol = info.tokenAmount.amount
    if (info.mint === USDC_MINT) usdc = info.tokenAmount.amount
  }

  return {
    wallet,
    sol:          solLamports.toString(),
    msol,
    usdc,
    msolDecimals: MSOL_DECIMALS,
    usdcDecimals: USDC_DECIMALS,
  }
}

/**
 * Build an unsigned Marinade liquid-unstake transaction.
 * Returns base64-encoded serialized Transaction.
 * The frontend must sign with the user's Solana wallet and send.
 */
export async function buildMarinadeLiquidUnstakeTx(
  wallet:     string,
  msolAmount: string,  // raw mSOL units (e.g. "998650")
): Promise<string> {
  const scriptPath = path.join(scriptsDir(), 'marinade_liquid_unstake_tx.js')

  const { stdout, stderr } = await execFileAsync('node', [scriptPath, wallet, msolAmount, SOLANA_RPC], {
    timeout: 30_000,
  })

  if (stderr) {
    // stderr is progress logs — log them but don't fail
    console.info('[portfolio] marinade_liquid_unstake_tx stderr:', stderr.trim())
  }

  const base64 = stdout.trim()
  if (!base64) throw new Error('marinade_liquid_unstake_tx produced no output')
  return base64
}
