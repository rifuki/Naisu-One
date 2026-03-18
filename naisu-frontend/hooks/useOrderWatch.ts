/**
 * useOrderWatch — SSE subscriber for real-time intent order status changes.
 *
 * Subscribes to GET /api/v1/intent/watch?user=...&chain=... and calls
 * `onOrderUpdate` whenever an order transitions to FULFILLED / CANCELLED / EXPIRED.
 *
 * The hook manages reconnection automatically (EventSource reconnects natively,
 * but we also force-reconnect when `user` changes or after server-sent `close`).
 */
import { useEffect, useRef } from 'react'

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim() || 'http://localhost:3000'

export type OrderStatus = 'FULFILLED' | 'CANCELLED' | 'EXPIRED' | 'OPEN'

export interface OrderUpdateEvent {
  orderId:          string
  status:           OrderStatus
  chain:            string
  amount:           string
  explorerUrl:      string
  destinationChain: number
  prevStatus:       string
}

interface UseOrderWatchOptions {
  user:           string | undefined
  chain?:         string
  enabled?:       boolean
  onOrderUpdate:  (event: OrderUpdateEvent) => void
  onOrderCreated?: () => void
}

export function useOrderWatch({ user, chain, enabled = true, onOrderUpdate, onOrderCreated }: UseOrderWatchOptions) {
  const onUpdateRef  = useRef(onOrderUpdate)
  const onCreatedRef = useRef(onOrderCreated)
  onUpdateRef.current  = onOrderUpdate
  onCreatedRef.current = onOrderCreated

  useEffect(() => {
    if (!user || !enabled) return

    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let destroyed = false

    const connect = () => {
      if (destroyed) return

      const params = new URLSearchParams({ user })
      if (chain) params.set('chain', chain)

      es = new EventSource(`${BACKEND_URL}/api/v1/intent/watch?${params}`)

      es.addEventListener('order_update', (e: MessageEvent) => {
        try {
          const data: OrderUpdateEvent = JSON.parse(e.data)
          onUpdateRef.current(data)
        } catch { /* ignore malformed */ }
      })

      es.addEventListener('order_created', () => {
        onCreatedRef.current?.()
      })

      es.addEventListener('close', () => {
        // Server sent explicit close — reconnect after 3 s
        es?.close()
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, 3_000)
        }
      })

      es.onerror = () => {
        es?.close()
        // Reconnect with exponential-ish backoff (5 s)
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, 5_000)
        }
      }
    }

    connect()

    return () => {
      destroyed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      es?.close()
    }
  }, [user, chain, enabled])
}
