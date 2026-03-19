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

export interface IntentProgressEvent {
  type:    'rfq_broadcast' | 'rfq_winner' | 'execute_sent'
  orderId: string
  data:    Record<string, unknown>
}

interface UseOrderWatchOptions {
  user:                 string | undefined
  chain?:               string
  enabled?:             boolean
  onOrderUpdate:        (event: OrderUpdateEvent) => void
  onOrderCreated?:      () => void
  onProgress?:          (event: IntentProgressEvent) => void
  onGaslessResolved?:   (intentId: string, contractOrderId: string) => void
}

export function useOrderWatch({ user, chain, enabled = true, onOrderUpdate, onOrderCreated, onProgress, onGaslessResolved }: UseOrderWatchOptions) {
  const onUpdateRef           = useRef(onOrderUpdate)
  const onCreatedRef          = useRef(onOrderCreated)
  const onProgressRef         = useRef(onProgress)
  const onGaslessResolvedRef  = useRef(onGaslessResolved)
  onUpdateRef.current          = onOrderUpdate
  onCreatedRef.current         = onOrderCreated
  onProgressRef.current        = onProgress
  onGaslessResolvedRef.current = onGaslessResolved

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
        } catch (err) {
          console.error(`[useOrderWatch] malformed order_update event`, { raw: e.data, error: err })
        }
      })

      es.addEventListener('order_created', () => {
        onCreatedRef.current?.()
      })

      for (const evtType of ['rfq_broadcast', 'rfq_winner', 'execute_sent'] as const) {
        es.addEventListener(evtType, (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data) as Record<string, unknown>
            onProgressRef.current?.({ type: evtType, orderId: data['orderId'] as string, data })
          } catch (err) {
            console.error(`[useOrderWatch] malformed ${evtType} event`, { raw: e.data, error: err })
          }
        })
      }

      es.addEventListener('gasless_resolved', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { intentId: string; contractOrderId: string }
          onGaslessResolvedRef.current?.(data.intentId, data.contractOrderId)
        } catch (err) {
          console.error(`[useOrderWatch] malformed gasless_resolved event`, { raw: e.data, error: err })
        }
      })

      es.addEventListener('close', () => {
        // Server sent explicit close — reconnect after 3 s
        es?.close()
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, 3_000)
        }
      })

      es.onerror = (event) => {
        const readyState = es?.readyState
        console.error(`[useOrderWatch] SSE error — readyState=${readyState} user=${user}`, event)
        es?.close()
        if (!destroyed) {
          console.info(`[useOrderWatch] reconnecting in 5s (user=${user})`)
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
