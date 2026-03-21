import { apiClient } from '@/lib/api-client'

export interface IntentOrder {
  id: string
  txDigest: string
  amount: number
  startPrice: number
  floorPrice: number
  createdAt: number
  deadline: number
  destinationChain: number
  status: 'Open' | 'Fulfilled' | 'Cancelled'
  chain: 'evm' | 'solana'
  sourceChain?: string
  fulfillTxHash?: string
  recipient?: string
  solanaPaymentTxHash?: string
  solverAddress?: string
}

interface BackendOrder {
  orderId: string
  explorerUrl: string
  amount: string
  startPrice: string
  floorPrice: string
  createdAt: number
  deadline: number
  destinationChain: number
  status: 'OPEN' | 'FULFILLED' | 'CANCELLED'
  chain: string
  recipient?: string
}

function fromBackend(order: BackendOrder): IntentOrder {
  const statusMap: Record<string, IntentOrder['status']> = {
    OPEN: 'Open',
    FULFILLED: 'Fulfilled',
    CANCELLED: 'Cancelled',
  }

  const chain = order.chain === 'solana' ? 'solana' : 'evm'
  const sourceChain = order.chain === 'evm-base' ? 'Base' : undefined

  return {
    id: order.orderId,
    txDigest: order.explorerUrl,
    amount: parseFloat(order.amount),
    startPrice: parseFloat(order.startPrice),
    floorPrice: parseFloat(order.floorPrice),
    createdAt: order.createdAt,
    deadline: order.deadline,
    destinationChain: order.destinationChain,
    status: statusMap[order.status] ?? 'Open',
    chain,
    sourceChain,
    recipient: order.recipient,
  }
}

export interface GetIntentOrdersParams {
  user: string
  chain?: 'evm' | 'solana'
}

export async function getIntentOrders(params: GetIntentOrdersParams): Promise<IntentOrder[]> {
  const { user, chain } = params
  const queryParams: Record<string, string> = { user }
  if (chain) queryParams.chain = chain

  const orders = await apiClient.get<BackendOrder[]>('/intent/orders', queryParams)
  return orders.map(fromBackend)
}
