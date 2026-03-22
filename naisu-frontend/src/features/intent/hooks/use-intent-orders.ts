/**
 * useIntentOrders — canonical hook for intent order data.
 *
 * Strategy:
 *  1. Backend-first: GET /api/v1/intent/orders (fast, cached, 5s timeout)
 *  2. RPC fallback: direct chain reads if backend is down
 *
 * Returns { evmOrders, solanaOrders, evmLoading, solanaLoading, evmFetched, solanaFetched, backendUp, refresh }
 */
import { useState, useCallback, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { getIntentOrders, type IntentOrder } from '../api/get-intent-orders'
import { fetchEvmFromRpc, fetchSolanaFromRpc } from '../api/get-intent-orders-rpc'
import { useSolanaAddress } from '@/hooks/use-solana-address'
import { useOrderWatch } from '@/hooks/use-order-watch'
import type { IntentProgressEvent } from '@/hooks/use-order-watch'

export type { IntentOrder, IntentProgressEvent }

const POLL_INTERVAL_MS = 12_000

interface UseIntentOrdersOptions {
  onProgress?: (event: IntentProgressEvent) => void
}

export function useIntentOrders({ onProgress }: UseIntentOrdersOptions = {}) {
  const [evmOrders,     setEvmOrders]     = useState<IntentOrder[]>([])
  const [solanaOrders,  setSolanaOrders]  = useState<IntentOrder[]>([])
  const [evmLoading,    setEvmLoading]    = useState(false)
  const [solanaLoading, setSolanaLoading] = useState(false)
  const [evmFetched,    setEvmFetched]    = useState(false)
  const [solanaFetched, setSolanaFetched] = useState(false)
  const [backendUp,     setBackendUp]     = useState(true)

  const { address: evmAddress, isConnected }                    = useAccount()
  const { publicKey: solPublicKey, connected: solConnected }    = useWallet()
  const { connection: solanaConnection }                        = useConnection()
  const detectedSolAddress                                      = useSolanaAddress()

  const fetchEvm = useCallback(async () => {
    if (!evmAddress || !isConnected) { setEvmOrders([]); return }
    setEvmLoading(true)
    try {
      const backendRows = await getIntentOrders(evmAddress, undefined)
      if (backendRows !== null) {
        setBackendUp(true)
        setEvmOrders(backendRows.filter(o => o.chain === 'evm'))
        return
      }
      setBackendUp(false)
      setEvmOrders(await fetchEvmFromRpc(evmAddress))
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
      const addrStr     = detectedSolAddress ?? solPk.toBase58()
      const backendRows = await getIntentOrders(addrStr, 'solana')
      if (backendRows !== null) {
        setBackendUp(true)
        setSolanaOrders(backendRows.filter(o => o.chain === 'solana'))
        return
      }
      setBackendUp(false)
      setSolanaOrders(await fetchSolanaFromRpc(solPk, solanaConnection))
    } finally {
      setSolanaLoading(false)
      setSolanaFetched(true)
    }
  }, [solPublicKey, solConnected, solanaConnection, detectedSolAddress])

  const refresh = useCallback(() => {
    fetchEvm()
    fetchSolana()
  }, [fetchEvm, fetchSolana])

  // SSE push: instant status update when backend detects order change
  useOrderWatch({
    user:    evmAddress,
    enabled: !!evmAddress && isConnected,
    onOrderUpdate: useCallback((event) => {
      setEvmOrders(prev => prev.map(o =>
        o.id.toLowerCase() === event.orderId.toLowerCase()
          ? { ...o, status: event.status === 'FULFILLED' ? 'Fulfilled' : event.status === 'CANCELLED' ? 'Cancelled' : o.status }
          : o
      ))
    }, []),
    onOrderCreated: refresh,
    onProgress,
  })

  // Initial fetch + polling + window event
  useEffect(() => {
    refresh()
    const timer    = setInterval(refresh, POLL_INTERVAL_MS)
    const onForce  = () => refresh()
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
