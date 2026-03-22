import type { IntentOrder } from './get-intent-orders'
import { INTENT_BRIDGE_ABI } from '@/lib/abi/intent-bridge'
import {
  BASE_SEPOLIA_CONTRACT,
  BASE_SEPOLIA_RPC,
  SOLANA_PROGRAM_ID,
  WORMHOLE_CHAIN_SOLANA,
} from '@/lib/constants'
import { BorshAccountsCoder } from '@coral-xyz/anchor'
import IntentBridgeIDL from '@/lib/idl/intent_bridge_solana.json'

// ─── Anchor IDL coder ─────────────────────────────────────────────────────────
const _intentAccountDef = IntentBridgeIDL.accounts.find(a => a.name === 'Intent')!
const INTENT_DISCRIMINATOR_BYTES = new Uint8Array(_intentAccountDef.discriminator)
const _intentCoder = new BorshAccountsCoder(IntentBridgeIDL as never)

// ─── EVM RPC fallback ─────────────────────────────────────────────────────────

export async function fetchEvmFromRpc(evmAddress: string): Promise<IntentOrder[]> {
  const { createPublicClient, http } = await import('viem')
  const { baseSepolia } = await import('viem/chains')

  const chains = [
    { chain: baseSepolia, label: 'Base', contract: BASE_SEPOLIA_CONTRACT, rpc: BASE_SEPOLIA_RPC },
  ] as const

  const allRows: IntentOrder[] = []

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
          client.getContractEvents({ address: contract, abi: INTENT_BRIDGE_ABI, eventName: 'OrderCreated', args: { creator: evmAddress as `0x${string}` }, fromBlock: from, toBlock: to })
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
        const statusMap: Record<number, IntentOrder['status']> = { 0: 'Open', 1: 'Fulfilled', 2: 'Cancelled' }
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
        } satisfies IntentOrder
      }))
      allRows.push(...rows.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<IntentOrder>).value))
    } catch (err) {
      console.error(`[getIntentOrders] EVM RPC fetch failed for chain=${label} address=${evmAddress}`, err)
    }
  }))

  return allRows.sort((a, b) => b.createdAt - a.createdAt)
}

// ─── Solana RPC fallback ──────────────────────────────────────────────────────

export async function fetchSolanaFromRpc(
  solPubkey: import('@solana/web3.js').PublicKey,
  connection: import('@solana/web3.js').Connection,
): Promise<IntentOrder[]> {
  try {
    const { PublicKey } = await import('@solana/web3.js')
    const programId = new PublicKey(SOLANA_PROGRAM_ID)
    const accounts  = await connection.getProgramAccounts(programId, {
      filters: [
        { memcmp: { offset: 0,  bytes: Buffer.from(INTENT_DISCRIMINATOR_BYTES).toString('base64'), encoding: 'base64' } },
        { memcmp: { offset: 40, bytes: solPubkey.toBase58() } },
      ],
    })
    const rows: IntentOrder[] = await Promise.all(accounts.map(async ({ pubkey, account }) => {
      const decoded          = _intentCoder.decode('intent', account.data)
      const intentId         = Buffer.from(decoded.intentId as number[]).toString('hex')
      const amount           = (decoded.amount as { toNumber(): number }).toNumber() / 1e9
      const startPrice       = (decoded.startPrice as { toNumber(): number }).toNumber()
      const floorPrice       = (decoded.floorPrice as { toNumber(): number }).toNumber()
      const deadline         = (decoded.deadline as { toNumber(): number }).toNumber() * 1000
      const createdAt        = (decoded.createdAt as { toNumber(): number }).toNumber() * 1000
      const statusByte       = decoded.status as number
      const destinationChain = decoded.destinationChain as number
      const statusMap: Record<number, IntentOrder['status']> = { 0: 'Open', 1: 'Fulfilled', 2: 'Cancelled' }

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
  } catch (err) {
    console.error(`[getIntentOrders] Solana RPC fetch failed for address=${solPubkey.toBase58()}`, err)
    return []
  }
}
