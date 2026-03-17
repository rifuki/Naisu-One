/**
 * useIntentOrders — fetch intent orders dengan backend-first strategy.
 *
 * 1. Coba GET /api/v1/intent/orders dari backend indexer (fast, cached)
 * 2. Kalau backend tidak respond / error → fallback ke RPC langsung
 *    (sama seperti implementasi lama di ActiveIntents.tsx)
 *
 * Returns { evmOrders, solanaOrders, loading, fetched, refresh }
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { useAccount } from 'wagmi'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useSolanaAddress } from './useSolanaAddress'
import {
  BASE_SEPOLIA_CONTRACT, FUJI_CONTRACT,
  BASE_SEPOLIA_RPC, AVALANCHE_FUJI_RPC,
  SOLANA_PROGRAM_ID,
  WORMHOLE_CHAIN_SOLANA,
} from '../lib/constants'
import { INTENT_BRIDGE_ABI } from '../lib/abi'
import { BorshAccountsCoder } from '@coral-xyz/anchor'
import IntentBridgeIDL from '../lib/idl/intent_bridge_solana.json'

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim() || 'http://localhost:3000'
const BACKEND_TIMEOUT_MS = 5_000
const POLL_INTERVAL_MS   = 12_000

// ─── Shared type (matches backend IntentOrder shape) ──────────────────────────
export interface IntentRow {
  id:               string
  txDigest:         string
  amount:           number
  startPrice:       number
  floorPrice:       number
  createdAt:        number
  deadline:         number
  destinationChain: number
  status:           'Open' | 'Fulfilled' | 'Cancelled'
  chain:            'evm' | 'solana'
  sourceChain?:     string
  fulfillTxHash?:   string
  recipient?:       string
  solanaPaymentTxHash?: string
  solverAddress?:   string
}

// ─── Backend response → IntentRow ────────────────────────────────────────────

function fromBackend(o: Record<string, unknown>): IntentRow {
  const statusMap: Record<string, IntentRow['status']> = {
    OPEN:      'Open',
    FULFILLED: 'Fulfilled',
    CANCELLED: 'Cancelled',
  }
  const chain     = (o['chain'] as string) === 'solana' ? 'solana' : 'evm'
  const srcChain  = (o['chain'] as string) === 'evm-base' ? 'Base' : (o['chain'] as string) === 'evm-fuji' ? 'Fuji' : undefined
  return {
    id:               o['orderId']  as string,
    txDigest:         o['explorerUrl'] as string,
    amount:           parseFloat(o['amount'] as string),
    startPrice:       parseFloat(o['startPrice'] as string),
    floorPrice:       parseFloat(o['floorPrice'] as string),
    createdAt:        o['createdAt']  as number,
    deadline:         o['deadline']   as number,
    destinationChain: o['destinationChain'] as number,
    status:           statusMap[o['status'] as string] ?? 'Open',
    chain,
    sourceChain: srcChain,
    recipient:   o['recipient'] as string | undefined,
  }
}

// ─── Backend fetch ────────────────────────────────────────────────────────────

async function fetchFromBackend(user: string, chain?: string): Promise<IntentRow[] | null> {
  try {
    const params = new URLSearchParams({ user })
    if (chain) params.set('chain', chain)
    const res = await fetch(`${BACKEND_URL}/api/v1/intent/orders?${params}`, {
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const json = await res.json() as { success: boolean; data?: unknown[] }
    if (!json.success || !Array.isArray(json.data)) return null
    return json.data.map(o => fromBackend(o as Record<string, unknown>))
  } catch {
    return null
  }
}

// ─── EVM RPC fallback ─────────────────────────────────────────────────────────

async function fetchEvmFromRpc(evmAddress: string): Promise<IntentRow[]> {
  const { createPublicClient, http } = await import('viem')
  const { baseSepolia, avalancheFuji } = await import('viem/chains')

  const chains = [
    { chain: baseSepolia,   label: 'Base', contract: BASE_SEPOLIA_CONTRACT, rpc: BASE_SEPOLIA_RPC },
    { chain: avalancheFuji, label: 'Fuji', contract: FUJI_CONTRACT,         rpc: AVALANCHE_FUJI_RPC },
  ] as const

  const allRows: IntentRow[] = []

  await Promise.allSettled(chains.map(async ({ chain, label, contract, rpc }) => {
    try {
      const client  = createPublicClient({ chain, transport: http(rpc) })
      const latest  = await client.getBlockNumber()
      const WINDOW  = 9_999n
      const MAX_W   = 5
      type EventType = Awaited<ReturnType<typeof client.getContractEvents>>[number]
      const myEvents:   EventType[] = []
      const fulfillMap = new Map<string, { txHash: string; solver: string }>()

      for (let i = 0; i < MAX_W; i++) {
        const to   = latest - BigInt(i) * WINDOW
        const from = to > WINDOW ? to - WINDOW : 0n
        await Promise.allSettled([
          client.getContractEvents({ address: contract, abi: INTENT_BRIDGE_ABI, eventName: 'OrderCreated',   args: { creator: evmAddress as `0x${string}` }, fromBlock: from, toBlock: to })
            .then(r => myEvents.push(...r)),
          client.getContractEvents({ address: contract, abi: INTENT_BRIDGE_ABI, eventName: 'OrderFulfilled', fromBlock: from, toBlock: to })
            .then(r => {
              for (const ev of r) {
                const t = ev as unknown as { args: { orderId: `0x${string}`; solver: string }; transactionHash: string }
                if (t.args?.orderId) fulfillMap.set(t.args.orderId.toLowerCase(), { txHash: t.transactionHash, solver: t.args.solver ?? '' })
              }
            }),
        ])
        if (myEvents.length > 0 && i >= 1) break
        if (from === 0n) break
      }

      const rows = await Promise.allSettled(myEvents.map(async (event) => {
        const t       = event as unknown as { args: { orderId: `0x${string}` }; transactionHash: `0x${string}` }
        const orderId = t.args.orderId
        const data    = await client.readContract({ address: contract, abi: INTENT_BRIDGE_ABI, functionName: 'orders', args: [orderId] } as never) as readonly [string, `0x${string}`, number, bigint, bigint, bigint, bigint, bigint, number]
        const statusMap: Record<number, IntentRow['status']> = { 0: 'Open', 1: 'Fulfilled', 2: 'Cancelled' }
        const fi = data[8] === 1 ? fulfillMap.get(orderId.toLowerCase()) : undefined

        let recipient: string | undefined
        if (data[2] === WORMHOLE_CHAIN_SOLANA) {
          try {
            const { PublicKey } = await import('@solana/web3.js')
            const hex   = (data[1] as string).replace('0x', '')
            const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)))
            recipient   = new PublicKey(bytes).toBase58()
          } catch { /* ignore */ }
        }
        return {
          id:               orderId,
          txDigest:         t.transactionHash,
          amount:           Number(data[3]) / 1e18,
          startPrice:       Number(data[4]),
          floorPrice:       Number(data[5]),
          createdAt:        Number(data[7]) * 1000,
          deadline:         Number(data[6]) * 1000,
          destinationChain: data[2],
          status:           statusMap[data[8]] ?? 'Open',
          chain:            'evm' as const,
          sourceChain:      label,
          fulfillTxHash:    fi?.txHash,
          solverAddress:    fi?.solver || undefined,
          recipient,
        } satisfies IntentRow
      }))
      allRows.push(...rows.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<IntentRow>).value))
    } catch { /* silent */ }
  }))

  return allRows.sort((a, b) => b.createdAt - a.createdAt)
}

// ─── Anchor IDL coder (replaces hardcoded discriminator + manual buf parsing) ─
const _intentAccountDef = IntentBridgeIDL.accounts.find(a => a.name === 'Intent')!
const INTENT_DISCRIMINATOR_BYTES = new Uint8Array(_intentAccountDef.discriminator)
const _intentCoder = new BorshAccountsCoder(IntentBridgeIDL as Parameters<typeof BorshAccountsCoder>[0])

// ─── Solana RPC fallback ──────────────────────────────────────────────────────

async function fetchSolanaFromRpc(
  solPubkey: import('@solana/web3.js').PublicKey,
  connection: import('@solana/web3.js').Connection,
): Promise<IntentRow[]> {
  try {
    const { PublicKey } = await import('@solana/web3.js')
    const programId = new PublicKey(SOLANA_PROGRAM_ID)
    const accounts  = await connection.getProgramAccounts(programId, {
      filters: [
        { memcmp: { offset: 0,  bytes: Buffer.from(INTENT_DISCRIMINATOR_BYTES).toString('base64'), encoding: 'base64' } },
        { memcmp: { offset: 40, bytes: solPubkey.toBase58() } },
      ],
    })
    const rows: IntentRow[] = await Promise.all(accounts.map(async ({ pubkey, account }) => {
      const decoded = _intentCoder.decode('intent', account.data)
      const intentId         = Buffer.from(decoded.intentId as number[]).toString('hex')
      const amount           = (decoded.amount as { toNumber(): number }).toNumber() / 1e9
      const startPrice       = (decoded.startPrice as { toNumber(): number }).toNumber()
      const floorPrice       = (decoded.floorPrice as { toNumber(): number }).toNumber()
      const deadline         = (decoded.deadline as { toNumber(): number }).toNumber() * 1000
      const createdAt        = (decoded.createdAt as { toNumber(): number }).toNumber() * 1000
      const statusByte       = decoded.status as number
      const destinationChain = decoded.destinationChain as number
      const statusMap: Record<number, IntentRow['status']> = { 0: 'Open', 1: 'Fulfilled', 2: 'Cancelled' }

      let fulfillTxHash: string | undefined
      if (statusByte === 1) {
        try {
          const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 3 })
          if (sigs[0]) fulfillTxHash = sigs[0].signature
        } catch { /* ignore */ }
      }
      return {
        id: pubkey.toBase58(), txDigest: intentId, amount, startPrice, floorPrice,
        createdAt, deadline, destinationChain,
        status: statusMap[statusByte] ?? 'Open',
        chain: 'solana' as const, fulfillTxHash,
      }
    }))
    return rows.sort((a, b) => b.createdAt - a.createdAt)
  } catch { return [] }
}

// ─── Main hook ────────────────────────────────────────────────────────────────

export function useIntentOrders() {
  const [evmOrders,    setEvmOrders]    = useState<IntentRow[]>([])
  const [solanaOrders, setSolanaOrders] = useState<IntentRow[]>([])
  const [evmLoading,   setEvmLoading]   = useState(false)
  const [solanaLoading,setSolanaLoading]= useState(false)
  const [evmFetched,   setEvmFetched]   = useState(false)
  const [solanaFetched,setSolanaFetched]= useState(false)
  const [backendUp,    setBackendUp]    = useState(true)

  const { address: evmAddress, isConnected }          = useAccount()
  const { publicKey: solPublicKey, connected: solConnected } = useWallet()
  const { connection: solanaConnection }               = useConnection()
  const detectedSolAddress = useSolanaAddress()

  const fetchEvm = useCallback(async () => {
    if (!evmAddress || !isConnected) { setEvmOrders([]); return }
    setEvmLoading(true)
    try {
      // Backend-first
      const backendRows = await fetchFromBackend(evmAddress, undefined)
      if (backendRows !== null) {
        setBackendUp(true)
        setEvmOrders(backendRows.filter(o => o.chain === 'evm'))
        return
      }
      // Fallback
      setBackendUp(false)
      const rows = await fetchEvmFromRpc(evmAddress)
      setEvmOrders(rows)
    } finally {
      setEvmLoading(false)
      setEvmFetched(true)
    }
  }, [evmAddress, isConnected])

  const fetchSolana = useCallback(async () => {
    const solPk = solPublicKey
    if (!solPk || !solConnected) { setSolanaOrders([]); return }
    setSolanaLoading(true)
    try {
      // Backend-first (use detected base58 address)
      const addrStr = detectedSolAddress ?? solPk.toBase58()
      const backendRows = await fetchFromBackend(addrStr, 'solana')
      if (backendRows !== null) {
        setBackendUp(true)
        setSolanaOrders(backendRows.filter(o => o.chain === 'solana'))
        return
      }
      // Fallback
      setBackendUp(false)
      const rows = await fetchSolanaFromRpc(solPk, solanaConnection)
      setSolanaOrders(rows)
    } finally {
      setSolanaLoading(false)
      setSolanaFetched(true)
    }
  }, [solPublicKey, solConnected, solanaConnection, detectedSolAddress])

  const refresh = useCallback(() => {
    fetchEvm()
    fetchSolana()
  }, [fetchEvm, fetchSolana])

  // Initial fetch + polling
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, POLL_INTERVAL_MS)
    const onForce = () => refresh()
    window.addEventListener('refresh_intents', onForce)
    return () => {
      clearInterval(timer)
      window.removeEventListener('refresh_intents', onForce)
    }
  }, [refresh])

  return {
    evmOrders, solanaOrders,
    evmLoading, solanaLoading,
    evmFetched, solanaFetched,
    backendUp, refresh,
  }
}
