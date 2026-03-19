/**
 * test-gasless.ts — Test gasless bridge flow tanpa FE / MetaMask
 *
 * Usage:
 *   bun run scripts/test-gasless.ts
 *
 * Apa yang dilakukan:
 *   1. Baca on-chain nonce untuk test signer
 *   2. Ambil quote dari backend (/build-gasless)
 *   3. Sign EIP-712 intent
 *   4. Submit ke backend (/submit-signature)
 *   5. Poll status sampai fulfilled / expired
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

// ─── Config ──────────────────────────────────────────────────────────────────

const BACKEND_URL      = 'http://localhost:3000'
const CONTRACT_ADDRESS = '0x26B7E5af3F1831ca938444c02CecFeBBb86F748e' as const
const BASE_SEPOLIA_RPC = process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org'

// Gunakan private key solver sebagai "test user" (dia punya ETH di Base Sepolia)
// Ganti dengan private key lain kalau mau test dengan account berbeda
const TEST_PRIVATE_KEY = (process.env.TEST_PRIVATE_KEY ?? process.env.EVM_PRIVATE_KEY ?? '').replace('0x', '')

// Solana recipient address (devnet) — ganti kalau perlu
const SOLANA_RECIPIENT = '7WkNZxoz6xTScAEYQY2nohJQibvxrxevkMmMLPJNBzDW'

// Bridge amount
const BRIDGE_AMOUNT_ETH = process.env.BRIDGE_AMOUNT_ETH ?? '0.0001'

// ─── Setup clients ────────────────────────────────────────────────────────────

if (!TEST_PRIVATE_KEY) {
  console.error('❌ Set TEST_PRIVATE_KEY or EVM_PRIVATE_KEY env var')
  process.exit(1)
}

const account = privateKeyToAccount(`0x${TEST_PRIVATE_KEY}` as `0x${string}`)
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC) })
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC) })

console.log(`\n🔑 Test signer: ${account.address}`)
console.log(`📍 Contract:    ${CONTRACT_ADDRESS}`)
console.log(`🌐 Backend:     ${BACKEND_URL}\n`)

// ─── ABI fragments ────────────────────────────────────────────────────────────

const NONCES_ABI = [{
  name: 'nonces',
  type: 'function',
  stateMutability: 'view',
  inputs:  [{ name: '', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
}] as const

const DOMAIN_ABI = [{
  name: 'eip712Domain',
  type: 'function',
  stateMutability: 'view',
  inputs:  [],
  outputs: [
    { name: 'fields', type: 'bytes1' },
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
    { name: 'salt', type: 'bytes32' },
    { name: 'extensions', type: 'uint256[]' },
  ],
}] as const

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOnchainNonce(address: string): Promise<number> {
  const nonce = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: NONCES_ABI,
    functionName: 'nonces',
    args: [address as `0x${string}`],
  })
  return Number(nonce)
}

function solanaAddressToBytes32(base58Address: string): `0x${string}` {
  const { PublicKey } = require('@solana/web3.js')
  const pubkey = new PublicKey(base58Address)
  const bytes = pubkey.toBytes()
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return `0x${hex}` as `0x${string}`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Check ETH balance
  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`💰 ETH balance: ${formatEther(balance)} ETH`)
  if (balance < parseEther(BRIDGE_AMOUNT_ETH)) {
    console.error(`❌ Insufficient balance. Need at least ${BRIDGE_AMOUNT_ETH} ETH`)
    process.exit(1)
  }

  // 2. Read on-chain nonce
  const nonce = await getOnchainNonce(account.address)
  console.log(`🔢 On-chain nonce: ${nonce}`)

  // 3. Get quote from backend
  console.log('\n📡 Fetching quote from backend...')
  const quoteRes = await fetch(`${BACKEND_URL}/api/v1/intent/build-gasless`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      senderAddress:    account.address,
      recipientAddress: SOLANA_RECIPIENT,
      destinationChain: 'solana',
      amount:           BRIDGE_AMOUNT_ETH,
      outputToken:      'sol',
    }),
  })
  const quoteJson = await quoteRes.json() as { success: boolean; data?: Record<string, unknown>; error?: string }
  if (!quoteJson.success) {
    console.error('❌ build-gasless failed:', quoteJson.error)
    process.exit(1)
  }
  const params = quoteJson.data!
  console.log(`✅ Quote received:`)
  console.log(`   startPrice: ${params.startPrice} lamports`)
  console.log(`   floorPrice: ${params.floorPrice} lamports`)
  console.log(`   duration:   ${params.durationSeconds}s`)

  // 4. Build the intent struct
  const deadline = Math.floor(Date.now() / 1000) + Number(params.durationSeconds ?? 300)
  const amountWei = parseEther(BRIDGE_AMOUNT_ETH)
  const recipientBytes32 = solanaAddressToBytes32(SOLANA_RECIPIENT)

  const intent = {
    creator:          account.address as `0x${string}`,
    recipient:        recipientBytes32,
    destinationChain: 1,   // Wormhole chain ID for Solana
    amount:           amountWei,
    startPrice:       BigInt(params.startPrice as string),
    floorPrice:       BigInt(params.floorPrice as string),
    deadline:         BigInt(deadline),
    intentType:       0,   // SOL
    nonce:            BigInt(nonce),
  }

  console.log(`\n📋 Intent to sign:`)
  console.log(`   creator:    ${intent.creator}`)
  console.log(`   recipient:  ${recipientBytes32}`)
  console.log(`   amount:     ${BRIDGE_AMOUNT_ETH} ETH (${amountWei} wei)`)
  console.log(`   deadline:   ${new Date(deadline * 1000).toLocaleTimeString()}`)
  console.log(`   nonce:      ${nonce}`)

  // 5. Sign EIP-712
  console.log('\n✍️  Signing EIP-712 intent...')
  const signature = await walletClient.signTypedData({
    domain: {
      name:              'NaisuIntentBridge',
      version:           '1',
      chainId:           84532,
      verifyingContract: CONTRACT_ADDRESS,
    },
    types: {
      Intent: [
        { name: 'creator',          type: 'address' },
        { name: 'recipient',        type: 'bytes32' },
        { name: 'destinationChain', type: 'uint16'  },
        { name: 'amount',           type: 'uint256' },
        { name: 'startPrice',       type: 'uint256' },
        { name: 'floorPrice',       type: 'uint256' },
        { name: 'deadline',         type: 'uint256' },
        { name: 'intentType',       type: 'uint8'   },
        { name: 'nonce',            type: 'uint256' },
      ],
    },
    primaryType: 'Intent',
    message:     intent,
  })
  console.log(`✅ Signature: ${signature.slice(0, 20)}...`)

  // 6. Submit to backend
  console.log('\n📤 Submitting to backend...')
  const submitRes = await fetch(`${BACKEND_URL}/api/v1/intent/submit-signature`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: {
        creator:          intent.creator,
        recipient:        intent.recipient,
        destinationChain: 1,
        amount:           amountWei.toString(),
        startPrice:       intent.startPrice.toString(),
        floorPrice:       intent.floorPrice.toString(),
        deadline,
        intentType:       0,
        nonce,
      },
      signature,
    }),
  })
  const submitJson = await submitRes.json() as { success: boolean; data?: { intentId: string; status: string }; error?: string }
  if (!submitJson.success) {
    console.error('❌ submit-signature failed:', submitJson.error)
    process.exit(1)
  }
  const { intentId } = submitJson.data!
  console.log(`✅ Intent submitted! intentId: ${intentId}`)
  console.log(`   Status: ${submitJson.data!.status}`)

  // 7. Poll orders until fulfilled or expired
  console.log('\n⏳ Polling for fulfillment...')
  const pollStart = Date.now()
  const POLL_TIMEOUT = (Number(params.durationSeconds ?? 300) + 60) * 1000

  while (Date.now() - pollStart < POLL_TIMEOUT) {
    await new Promise(r => setTimeout(r, 5000))

    const ordersRes = await fetch(`${BACKEND_URL}/api/v1/intent/orders?user=${account.address}`)
    const ordersJson = await ordersRes.json() as { success: boolean; data?: Array<{ orderId: string; status: string; fulfillTxHash?: string }> }

    if (!ordersJson.success || !ordersJson.data) continue

    // Match by orderId — the indexer uses the on-chain orderId (not intentId)
    // but also check all orders for our creator+nonce combo as fallback
    const thisOrder = ordersJson.data.find(o =>
      o.orderId.toLowerCase() === intentId.toLowerCase()
    ) ?? ordersJson.data.find(o => o.status === 'FULFILLED' || o.status === 'OPEN')

    if (thisOrder?.status === 'FULFILLED') {
      console.log(`\n🎉 ORDER FULFILLED! orderId: ${thisOrder.orderId}`)
      if (thisOrder.fulfillTxHash) console.log(`   ETH claimed: https://sepolia.basescan.org/tx/${thisOrder.fulfillTxHash}`)
      process.exit(0)
    }
    if (thisOrder?.status === 'CANCELLED') {
      console.log(`\n❌ Order cancelled`)
      process.exit(1)
    }

    const elapsed = Math.floor((Date.now() - pollStart) / 1000)
    const remaining = Math.max(0, deadline - Math.floor(Date.now() / 1000))
    process.stdout.write(`\r   [${elapsed}s] Status: OPEN | Time left: ${remaining}s   `)
  }

  console.log('\n⏰ Poll timeout — check Active Intents widget')
}

main().catch(e => { console.error(e); process.exit(1) })
