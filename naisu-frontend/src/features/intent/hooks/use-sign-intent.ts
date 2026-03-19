import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSignTypedData, useAccount, useChainId } from 'wagmi'
import { parseEther, type Address, type Hex } from 'viem'
import { submitIntentSignature, type GaslessIntent, type SubmitSignatureResponse } from '../api/submit-intent-signature'

// Contract address from environment variable
const INTENT_BRIDGE_CONTRACT = (import.meta.env.VITE_CONTRACT_BASE_SEPOLIA ?? '') as Address

// Chain ID from environment variable
const BASE_SEPOLIA_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID_BASE_SEPOLIA ?? 84532)

// Validate contract address at module load time
if (!INTENT_BRIDGE_CONTRACT || !/^0x[a-fA-F0-9]{40}$/.test(INTENT_BRIDGE_CONTRACT)) {
  console.error('[use-sign-intent] Invalid or missing VITE_CONTRACT_BASE_SEPOLIA:', INTENT_BRIDGE_CONTRACT)
}

// EIP-712 Domain - must match smart contract
const INTENT_DOMAIN = {
  name: 'NaisuIntentBridge',
  version: '1',
  chainId: BASE_SEPOLIA_CHAIN_ID,
  verifyingContract: INTENT_BRIDGE_CONTRACT,
} as const

// EIP-712 Types - must match smart contract
const INTENT_TYPES = {
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

export interface SignIntentParams {
  recipientAddress: string
  destinationChain: 'solana' | 'sui'
  amount: string // ETH amount as string (e.g., "0.1")
  outputToken: 'sol' | 'msol' | 'marginfi'
  startPrice: string // in lamports
  floorPrice: string // in lamports
  durationSeconds: number
  nonce: number
}

export interface SignIntentResult {
  signature: Hex
  intent: GaslessIntent
  submissionResult: SubmitSignatureResponse
}

/**
 * Hook for signing and submitting gasless intents.
 * 
 * Flow:
 * 1. User signs EIP-712 typed data (no gas cost)
 * 2. Signature is sent to backend
 * 3. Backend runs RFQ with solvers
 * 4. Winning solver executes on-chain (solver pays gas)
 */
export function useSignIntent() {
  const queryClient = useQueryClient()
  const { address } = useAccount()
  const chainId = useChainId()
  const { signTypedDataAsync } = useSignTypedData()

  return useMutation<SignIntentResult, Error, SignIntentParams>({
    mutationFn: async (params) => {
      if (!address) {
        throw new Error('Wallet not connected')
      }

      if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
        throw new Error(`Please switch to Base Sepolia network (chain ID: ${BASE_SEPOLIA_CHAIN_ID})`)
      }

      if (!INTENT_BRIDGE_CONTRACT || !/^0x[a-fA-F0-9]{40}$/.test(INTENT_BRIDGE_CONTRACT)) {
        throw new Error('Contract address not configured. Check VITE_CONTRACT_BASE_SEPOLIA env var.')
      }

      // Convert destination chain to uint16
      const destChainId = params.destinationChain === 'solana' ? 1 : 21

      // Convert output token to intentType
      const intentType = params.outputToken === 'sol' ? 0 : 
                         params.outputToken === 'msol' ? 1 : 2

      // Calculate deadline
      const deadline = Math.floor(Date.now() / 1000) + params.durationSeconds

      // Convert amount to wei
      const amountWei = parseEther(params.amount).toString()

      // Pad recipient address to bytes32
      const recipientPadded = params.recipientAddress.startsWith('0x') 
        ? params.recipientAddress.padEnd(66, '0') as Hex
        : `0x${params.recipientAddress.padStart(64, '0')}` as Hex

      // Build the intent object
      const intent: GaslessIntent = {
        creator: address,
        recipient: recipientPadded,
        destinationChain: destChainId,
        amount: amountWei,
        startPrice: params.startPrice,
        floorPrice: params.floorPrice,
        deadline,
        intentType,
        nonce: params.nonce,
      }

      // Sign the EIP-712 typed data
      const signature = await signTypedDataAsync({
        account: address,
        domain: INTENT_DOMAIN,
        types: INTENT_TYPES,
        primaryType: 'Intent',
        message: {
          creator: address,
          recipient: recipientPadded,
          destinationChain: destChainId,
          amount: BigInt(amountWei),
          startPrice: BigInt(params.startPrice),
          floorPrice: BigInt(params.floorPrice),
          deadline: BigInt(deadline),
          intentType,
          nonce: BigInt(params.nonce),
        },
      })

      // Submit to backend
      const submissionResult = await submitIntentSignature({
        intent,
        signature,
      })

      return {
        signature,
        intent,
        submissionResult,
      }
    },
    onSuccess: () => {
      // Invalidate intent orders query
      queryClient.invalidateQueries({ queryKey: ['intent', 'orders'] })
    },
  })
}
