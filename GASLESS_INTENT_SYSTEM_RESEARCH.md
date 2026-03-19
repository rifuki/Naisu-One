# Gasless Off-Chain Intent System Research

> Comprehensive guide for implementing a gasless intent system similar to UniswapX, CowSwap, and 1inch Fusion

## Table of Contents
1. [System Overview](#system-overview)
2. [Smart Contract Implementation](#smart-contract-implementation)
3. [Backend Implementation](#backend-implementation)
4. [Frontend Implementation](#frontend-implementation)
5. [Security Considerations](#security-considerations)
6. [Reference Implementations](#reference-implementations)

---

## System Overview

### Architecture Flow

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Frontend  │         │   Backend   │         │  Blockchain │
│   (React)   │         │  (Node.js)  │         │   (EVM)     │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │
       │ 1. Sign EIP-712       │                       │
       │────────────────────>  │                       │
       │                       │                       │
       │                       │ 2. Verify Signature   │
       │                       │    & Run RFQ          │
       │                       │                       │
       │                       │ 3. Select Winner      │
       │                       │    & Send Order       │
       │                       │    to Solver          │
       │                       │                       │
       │                       │       4. Solver       │
       │                       │       Executes        │
       │                       │       (Pays Gas)      │
       │                       │ ───────────────────>  │
       │                       │                       │
       │                       │       5. Validate     │
       │                       │       Signature       │
       │                       │       & Execute       │
       │                       │       Swap            │
```

### Key Concepts

1. **Intent**: User's desired outcome (e.g., "swap 100 USDC for at least 0.05 ETH")
2. **Off-Chain Signing**: User signs EIP-712 typed data (no gas cost)
3. **Solver/Filler**: Entity that competes to fulfill the intent
4. **RFQ (Request for Quote)**: Backend sends intent to solvers for competitive bidding
5. **On-Chain Execution**: Winning solver executes the intent on-chain (pays gas)

---

## Smart Contract Implementation

### 1. Core Contract Architecture

Based on UniswapX's reactor pattern, here's the smart contract structure:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IPermit2} from "permit2/interfaces/IPermit2.sol";

/**
 * @title IntentReactor
 * @notice Settles gasless swap intents using EIP-712 signatures
 * @dev Based on UniswapX architecture
 */
contract IntentReactor is EIP712 {
    using ECDSA for bytes32;

    // Permit2 contract for token transfers
    IPermit2 public immutable permit2;

    // EIP-712 type hash for intents
    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "Intent(address user,address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,uint256 deadline,uint256 nonce)"
    );

    // Track used nonces to prevent replay attacks
    mapping(address => mapping(uint256 => bool)) public nonceUsed;

    // Events
    event IntentExecuted(
        address indexed user,
        address indexed solver,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    struct Intent {
        address user;           // User creating the intent
        address tokenIn;        // Input token
        address tokenOut;       // Output token
        uint256 amountIn;       // Amount to swap
        uint256 minAmountOut;   // Minimum output amount
        uint256 deadline;       // Expiration timestamp
        uint256 nonce;          // Unique nonce for replay protection
    }

    constructor(address _permit2) EIP712("IntentProtocol", "1") {
        permit2 = IPermit2(_permit2);
    }

    /**
     * @notice Execute a signed intent
     * @param intent The intent details
     * @param signature The user's EIP-712 signature
     * @param amountOut The actual output amount provided by solver
     */
    function executeIntent(
        Intent calldata intent,
        bytes calldata signature,
        uint256 amountOut
    ) external {
        // 1. Validate intent hasn't expired
        require(block.timestamp <= intent.deadline, "Intent expired");

        // 2. Validate nonce hasn't been used
        require(!nonceUsed[intent.user][intent.nonce], "Nonce already used");
        nonceUsed[intent.user][intent.nonce] = true;

        // 3. Verify EIP-712 signature
        bytes32 structHash = keccak256(
            abi.encode(
                INTENT_TYPEHASH,
                intent.user,
                intent.tokenIn,
                intent.tokenOut,
                intent.amountIn,
                intent.minAmountOut,
                intent.deadline,
                intent.nonce
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(signature);
        require(signer == intent.user, "Invalid signature");

        // 4. Validate output meets minimum requirement
        require(amountOut >= intent.minAmountOut, "Insufficient output");

        // 5. Transfer input tokens from user to solver using Permit2
        // This requires user to have approved Permit2 for tokenIn
        permit2.transferFrom(
            intent.user,
            msg.sender,
            uint160(intent.amountIn),
            intent.tokenIn
        );

        // 6. Transfer output tokens from solver to user
        require(
            IERC20(intent.tokenOut).transferFrom(msg.sender, intent.user, amountOut),
            "Output transfer failed"
        );

        emit IntentExecuted(
            intent.user,
            msg.sender,
            intent.tokenIn,
            intent.tokenOut,
            intent.amountIn,
            amountOut
        );
    }

    /**
     * @notice Get the EIP-712 hash for an intent (for off-chain signing)
     * @param intent The intent to hash
     * @return The EIP-712 digest
     */
    function getIntentHash(Intent calldata intent) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                INTENT_TYPEHASH,
                intent.user,
                intent.tokenIn,
                intent.tokenOut,
                intent.amountIn,
                intent.minAmountOut,
                intent.deadline,
                intent.nonce
            )
        );
        return _hashTypedDataV4(structHash);
    }

    /**
     * @notice Cancel an intent by invalidating its nonce
     * @param nonce The nonce to cancel
     */
    function cancelIntent(uint256 nonce) external {
        nonceUsed[msg.sender][nonce] = true;
    }
}
```

### 2. EIP-712 Domain Separator

The domain separator is automatically generated by OpenZeppelin's `EIP712` contract:

```solidity
// Domain separator is created in constructor
constructor(address _permit2) EIP712("IntentProtocol", "1") {
    permit2 = IPermit2(_permit2);
}

// Domain separator components:
// - name: "IntentProtocol"
// - version: "1"
// - chainId: automatically detected
// - verifyingContract: this contract's address
```

### 3. Permit2 Integration

Permit2 is Uniswap's token approval system that allows gasless approvals:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IPermit2 {
    function transferFrom(
        address from,
        address to,
        uint160 amount,
        address token
    ) external;

    function permit(
        address owner,
        PermitSingle memory permitSingle,
        bytes calldata signature
    ) external;

    struct PermitSingle {
        PermitDetails details;
        address spender;
        uint256 sigDeadline;
    }

    struct PermitDetails {
        address token;
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }
}
```

**User Flow with Permit2:**

1. User approves Permit2 contract once for each token (can use max approval)
2. User signs Permit2 signature along with intent signature
3. Contract uses Permit2 to transfer tokens without additional approvals

### 4. Security Features Implementation

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract SecureIntentReactor is IntentReactor {
    // Additional security features

    // 1. Deadline validation (already in executeIntent)
    // Ensures intents expire after a certain time

    // 2. Nonce management for replay protection
    mapping(address => uint256) public currentNonce;

    function getCurrentNonce(address user) external view returns (uint256) {
        return currentNonce[user];
    }

    function incrementNonce() external {
        currentNonce[msg.sender]++;
    }

    // 3. Partial fill support
    struct PartialIntent {
        Intent baseIntent;
        uint256 fillAmount;  // Amount already filled
        bool allowPartialFill;
    }

    // 4. Exclusivity period (like ExclusiveDutchOrderReactor)
    struct ExclusiveIntent {
        Intent baseIntent;
        address exclusiveSolver;
        uint256 exclusivityEndTime;
    }

    function executeExclusiveIntent(
        ExclusiveIntent calldata exclusiveIntent,
        bytes calldata signature,
        uint256 amountOut
    ) external {
        // During exclusivity period, only exclusive solver can fill
        if (block.timestamp <= exclusiveIntent.exclusivityEndTime) {
            require(
                msg.sender == exclusiveIntent.exclusiveSolver,
                "Not exclusive solver"
            );
        }

        // Execute normal intent logic
        executeIntent(exclusiveIntent.baseIntent, signature, amountOut);
    }

    // 5. Dutch auction pricing (like V2DutchOrderReactor)
    struct DutchIntent {
        Intent baseIntent;
        uint256 startAmountOut;  // Starting minimum output
        uint256 endAmountOut;    // Ending minimum output
        uint256 startTime;
        uint256 endTime;
    }

    function getCurrentMinOutput(DutchIntent calldata dutchIntent)
        public
        view
        returns (uint256)
    {
        if (block.timestamp <= dutchIntent.startTime) {
            return dutchIntent.startAmountOut;
        }
        if (block.timestamp >= dutchIntent.endTime) {
            return dutchIntent.endAmountOut;
        }

        uint256 elapsed = block.timestamp - dutchIntent.startTime;
        uint256 duration = dutchIntent.endTime - dutchIntent.startTime;
        uint256 delta = dutchIntent.startAmountOut - dutchIntent.endAmountOut;

        return dutchIntent.startAmountOut - (delta * elapsed / duration);
    }
}
```

---

## Backend Implementation

### 1. EIP-712 Signature Verification

```typescript
// backend/src/utils/signatureVerification.ts

import { ethers } from 'ethers';

// EIP-712 domain definition
interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

// Intent structure matching smart contract
interface Intent {
  user: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
  deadline: number;
  nonce: number;
}

// EIP-712 typed data
const INTENT_TYPES = {
  Intent: [
    { name: 'user', type: 'address' },
    { name: 'tokenIn', type: 'address' },
    { name: 'tokenOut', type: 'address' },
    { name: 'amountIn', type: 'uint256' },
    { name: 'minAmountOut', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};

/**
 * Verify EIP-712 signature off-chain
 */
export async function verifyIntentSignature(
  intent: Intent,
  signature: string,
  domain: EIP712Domain
): Promise<{ valid: boolean; signer?: string }> {
  try {
    // Construct the typed data
    const typedData = {
      domain,
      types: INTENT_TYPES,
      primaryType: 'Intent',
      message: intent,
    };

    // Recover signer from signature
    const recoveredAddress = ethers.utils.verifyTypedData(
      domain,
      INTENT_TYPES,
      intent,
      signature
    );

    // Verify signer matches intent creator
    const valid = recoveredAddress.toLowerCase() === intent.user.toLowerCase();

    return {
      valid,
      signer: recoveredAddress,
    };
  } catch (error) {
    console.error('Signature verification failed:', error);
    return { valid: false };
  }
}

/**
 * Generate EIP-712 hash (for debugging/verification)
 */
export function getIntentHash(intent: Intent, domain: EIP712Domain): string {
  const typedData = {
    domain,
    types: INTENT_TYPES,
    primaryType: 'Intent',
    message: intent,
  };

  return ethers.utils._TypedDataEncoder.hash(
    domain,
    INTENT_TYPES,
    intent
  );
}
```

### 2. Order Matching Engine

```typescript
// backend/src/orderbook/orderMatcher.ts

import { Intent } from './types';
import { verifyIntentSignature } from '../utils/signatureVerification';

interface SignedIntent {
  intent: Intent;
  signature: string;
  hash: string;
}

interface Quote {
  solverId: string;
  amountOut: string;
  gasEstimate: string;
  timestamp: number;
}

/**
 * In-memory order book (use Redis/DB in production)
 */
class OrderBook {
  private pendingIntents: Map<string, SignedIntent> = new Map();
  private quotes: Map<string, Quote[]> = new Map(); // intentHash -> quotes

  /**
   * Add a new intent to the order book
   */
  async addIntent(signedIntent: SignedIntent): Promise<boolean> {
    const { intent, signature, hash } = signedIntent;

    // Verify signature
    const verification = await verifyIntentSignature(
      intent,
      signature,
      this.getDomain()
    );

    if (!verification.valid) {
      throw new Error('Invalid signature');
    }

    // Check if intent already exists
    if (this.pendingIntents.has(hash)) {
      throw new Error('Intent already exists');
    }

    // Validate intent parameters
    this.validateIntent(intent);

    // Store intent
    this.pendingIntents.set(hash, signedIntent);

    return true;
  }

  /**
   * Add a quote from a solver
   */
  addQuote(intentHash: string, quote: Quote): void {
    const intent = this.pendingIntents.get(intentHash);
    if (!intent) {
      throw new Error('Intent not found');
    }

    // Validate quote meets minimum output
    if (BigInt(quote.amountOut) < BigInt(intent.intent.minAmountOut)) {
      throw new Error('Quote below minimum output');
    }

    // Add quote to list
    const existingQuotes = this.quotes.get(intentHash) || [];
    existingQuotes.push(quote);
    this.quotes.set(intentHash, existingQuotes);
  }

  /**
   * Select winning solver based on best quote
   */
  selectWinner(intentHash: string): { winner: Quote; intent: SignedIntent } | null {
    const quotes = this.quotes.get(intentHash);
    const intent = this.pendingIntents.get(intentHash);

    if (!quotes || quotes.length === 0 || !intent) {
      return null;
    }

    // Sort by highest output amount
    const sortedQuotes = quotes.sort((a, b) =>
      BigInt(b.amountOut) > BigInt(a.amountOut) ? 1 : -1
    );

    return {
      winner: sortedQuotes[0],
      intent,
    };
  }

  /**
   * Remove intent after execution
   */
  removeIntent(intentHash: string): void {
    this.pendingIntents.delete(intentHash);
    this.quotes.delete(intentHash);
  }

  /**
   * Get pending intents (for broadcasting to solvers)
   */
  getPendingIntents(): SignedIntent[] {
    return Array.from(this.pendingIntents.values());
  }

  private validateIntent(intent: Intent): void {
    // Check deadline
    if (intent.deadline < Date.now() / 1000) {
      throw new Error('Intent already expired');
    }

    // Validate addresses
    if (!ethers.utils.isAddress(intent.user)) {
      throw new Error('Invalid user address');
    }

    // Validate amounts
    if (BigInt(intent.amountIn) <= 0 || BigInt(intent.minAmountOut) <= 0) {
      throw new Error('Invalid amounts');
    }
  }

  private getDomain() {
    return {
      name: 'IntentProtocol',
      version: '1',
      chainId: 1, // Ethereum mainnet
      verifyingContract: process.env.CONTRACT_ADDRESS!,
    };
  }
}

export const orderBook = new OrderBook();
```

### 3. RFQ (Request for Quote) System

```typescript
// backend/src/rfq/rfqManager.ts

import WebSocket from 'ws';
import { SignedIntent } from '../orderbook/types';
import { orderBook } from '../orderbook/orderMatcher';

interface Solver {
  id: string;
  ws: WebSocket;
  reputation: number;
  capabilities: {
    chains: number[];
    tokens: string[];
  };
}

/**
 * Manages solver connections and RFQ auctions
 */
class RFQManager {
  private solvers: Map<string, Solver> = new Map();
  private readonly RFQ_TIMEOUT = 2000; // 2 second auction

  /**
   * Register a new solver
   */
  registerSolver(solver: Solver): void {
    this.solvers.set(solver.id, solver);
    console.log(`Solver ${solver.id} registered`);
  }

  /**
   * Run RFQ auction for an intent
   */
  async runRFQ(signedIntent: SignedIntent): Promise<void> {
    const { intent, signature, hash } = signedIntent;

    // Broadcast intent to all eligible solvers
    const eligibleSolvers = this.getEligibleSolvers(intent);

    console.log(`Broadcasting intent ${hash} to ${eligibleSolvers.length} solvers`);

    // Send RFQ request
    const rfqRequest = {
      type: 'RFQ_REQUEST',
      intentHash: hash,
      intent,
      signature,
      deadline: Date.now() + this.RFQ_TIMEOUT,
    };

    eligibleSolvers.forEach((solver) => {
      if (solver.ws.readyState === WebSocket.OPEN) {
        solver.ws.send(JSON.stringify(rfqRequest));
      }
    });

    // Wait for quotes
    await this.waitForQuotes(hash);

    // Select winner
    const result = orderBook.selectWinner(hash);

    if (!result) {
      console.log(`No valid quotes for intent ${hash}`);
      return;
    }

    const { winner, intent: winningIntent } = result;

    // Send execution request to winning solver
    const winningSolver = this.solvers.get(winner.solverId);
    if (winningSolver && winningSolver.ws.readyState === WebSocket.OPEN) {
      winningSolver.ws.send(
        JSON.stringify({
          type: 'EXECUTE_INTENT',
          intentHash: hash,
          intent: winningIntent.intent,
          signature: winningIntent.signature,
          amountOut: winner.amountOut,
        })
      );

      console.log(`Intent ${hash} awarded to solver ${winner.solverId}`);
    }

    // Notify other solvers they didn't win
    eligibleSolvers.forEach((solver) => {
      if (solver.id !== winner.solverId && solver.ws.readyState === WebSocket.OPEN) {
        solver.ws.send(
          JSON.stringify({
            type: 'AUCTION_ENDED',
            intentHash: hash,
            won: false,
          })
        );
      }
    });
  }

  /**
   * Handle quote submission from solver
   */
  handleQuote(solverId: string, intentHash: string, quote: any): void {
    try {
      orderBook.addQuote(intentHash, {
        solverId,
        amountOut: quote.amountOut,
        gasEstimate: quote.gasEstimate,
        timestamp: Date.now(),
      });

      console.log(`Received quote from solver ${solverId} for intent ${intentHash}`);
    } catch (error) {
      console.error('Failed to add quote:', error);
    }
  }

  private getEligibleSolvers(intent: any): Solver[] {
    // Filter solvers based on capabilities
    return Array.from(this.solvers.values()).filter((solver) => {
      // Check if solver supports the tokens
      // In production, add more sophisticated filtering
      return solver.reputation > 0;
    });
  }

  private async waitForQuotes(intentHash: string): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, this.RFQ_TIMEOUT);
    });
  }
}

export const rfqManager = new RFQManager();
```

### 4. WebSocket Server for Solvers

```typescript
// backend/src/server/wsServer.ts

import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { rfqManager } from '../rfq/rfqManager';
import { orderBook } from '../orderbook/orderMatcher';

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws: WebSocket) => {
  const solverId = uuidv4();

  console.log(`New solver connected: ${solverId}`);

  // Register solver
  rfqManager.registerSolver({
    id: solverId,
    ws,
    reputation: 100,
    capabilities: {
      chains: [1, 137, 42161], // Ethereum, Polygon, Arbitrum
      tokens: [],
    },
  });

  ws.on('message', async (message: string) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'SUBMIT_QUOTE':
          // Solver submits a quote
          rfqManager.handleQuote(solverId, data.intentHash, {
            amountOut: data.amountOut,
            gasEstimate: data.gasEstimate,
          });
          break;

        case 'EXECUTION_SUCCESS':
          // Solver successfully executed intent
          orderBook.removeIntent(data.intentHash);
          console.log(`Intent ${data.intentHash} executed successfully by ${solverId}`);
          break;

        case 'EXECUTION_FAILED':
          // Solver failed to execute - could implement retry logic
          console.error(`Intent ${data.intentHash} execution failed by ${solverId}`);
          break;

        default:
          console.warn(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error('Error handling solver message:', error);
    }
  });

  ws.on('close', () => {
    console.log(`Solver disconnected: ${solverId}`);
  });
});

console.log('WebSocket server running on port 8080');
```

### 5. REST API for Frontend

```typescript
// backend/src/server/apiServer.ts

import express from 'express';
import { ethers } from 'ethers';
import { orderBook } from '../orderbook/orderMatcher';
import { rfqManager } from '../rfq/rfqManager';
import { verifyIntentSignature } from '../utils/signatureVerification';

const app = express();
app.use(express.json());

/**
 * Submit a new intent
 */
app.post('/api/v1/intents', async (req, res) => {
  try {
    const { intent, signature } = req.body;

    // Generate intent hash
    const hash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256'],
        [
          intent.user,
          intent.tokenIn,
          intent.tokenOut,
          intent.amountIn,
          intent.minAmountOut,
          intent.deadline,
          intent.nonce,
        ]
      )
    );

    // Add to orderbook
    await orderBook.addIntent({
      intent,
      signature,
      hash,
    });

    // Run RFQ auction
    await rfqManager.runRFQ({ intent, signature, hash });

    res.json({
      success: true,
      intentHash: hash,
      message: 'Intent submitted successfully',
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Get intent status
 */
app.get('/api/v1/intents/:hash', (req, res) => {
  const { hash } = req.params;
  // Implementation would query database for intent status
  res.json({
    status: 'pending', // pending, executing, completed, failed
  });
});

/**
 * Get current nonce for user
 */
app.get('/api/v1/nonce/:address', async (req, res) => {
  const { address } = req.params;
  // In production, query from contract or database
  res.json({ nonce: 0 });
});

app.listen(3000, () => {
  console.log('API server running on port 3000');
});
```

---

## Frontend Implementation

### 1. EIP-712 Signing with Wagmi

```typescript
// frontend/src/hooks/useSignIntent.ts

import { useSignTypedData, useAccount } from 'wagmi';
import { useMemo } from 'react';

interface Intent {
  user: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
  deadline: number;
  nonce: number;
}

export function useSignIntent() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  const domain = useMemo(
    () => ({
      name: 'IntentProtocol',
      version: '1',
      chainId: 1,
      verifyingContract: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`,
    }),
    []
  );

  const types = useMemo(
    () => ({
      Intent: [
        { name: 'user', type: 'address' },
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'minAmountOut', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
      ],
    }),
    []
  );

  const signIntent = async (intent: Omit<Intent, 'user' | 'nonce'>) => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    // Get current nonce from backend
    const nonceResponse = await fetch(`/api/v1/nonce/${address}`);
    const { nonce } = await nonceResponse.json();

    const fullIntent: Intent = {
      ...intent,
      user: address,
      nonce,
    };

    try {
      // Sign typed data - this opens wallet UI
      const signature = await signTypedDataAsync({
        domain,
        types,
        primaryType: 'Intent',
        message: fullIntent,
      });

      return {
        intent: fullIntent,
        signature,
      };
    } catch (error) {
      console.error('Failed to sign intent:', error);
      throw error;
    }
  };

  return { signIntent };
}
```

### 2. Swap Component

```typescript
// frontend/src/components/GaslessSwap.tsx

import { useState } from 'react';
import { parseUnits } from 'viem';
import { useSignIntent } from '../hooks/useSignIntent';

export function GaslessSwap() {
  const { signIntent } = useSignIntent();
  const [tokenIn, setTokenIn] = useState('');
  const [tokenOut, setTokenOut] = useState('');
  const [amountIn, setAmountIn] = useState('');
  const [minAmountOut, setMinAmountOut] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const handleSwap = async () => {
    setLoading(true);
    setStatus('Preparing intent...');

    try {
      // Calculate deadline (15 minutes from now)
      const deadline = Math.floor(Date.now() / 1000) + 15 * 60;

      // Convert amounts to wei
      const amountInWei = parseUnits(amountIn, 18).toString();
      const minAmountOutWei = parseUnits(minAmountOut, 18).toString();

      setStatus('Please sign the message in your wallet...');

      // Sign the intent
      const { intent, signature } = await signIntent({
        tokenIn: tokenIn as `0x${string}`,
        tokenOut: tokenOut as `0x${string}`,
        amountIn: amountInWei,
        minAmountOut: minAmountOutWei,
        deadline,
      });

      setStatus('Submitting intent to backend...');

      // Submit to backend
      const response = await fetch('/api/v1/intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent, signature }),
      });

      const result = await response.json();

      if (result.success) {
        setStatus(`Intent submitted! Hash: ${result.intentHash}`);
        // Poll for status
        pollIntentStatus(result.intentHash);
      } else {
        setStatus(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const pollIntentStatus = async (hash: string) => {
    const interval = setInterval(async () => {
      const response = await fetch(`/api/v1/intents/${hash}`);
      const { status } = await response.json();

      if (status === 'completed') {
        setStatus('Swap completed successfully! ✅');
        clearInterval(interval);
      } else if (status === 'failed') {
        setStatus('Swap failed ❌');
        clearInterval(interval);
      } else {
        setStatus(`Status: ${status}...`);
      }
    }, 2000);
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-6">Gasless Swap</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Token In</label>
          <input
            type="text"
            placeholder="0x..."
            value={tokenIn}
            onChange={(e) => setTokenIn(e.target.value)}
            className="w-full p-2 border rounded"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Amount In</label>
          <input
            type="text"
            placeholder="100"
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            className="w-full p-2 border rounded"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Token Out</label>
          <input
            type="text"
            placeholder="0x..."
            value={tokenOut}
            onChange={(e) => setTokenOut(e.target.value)}
            className="w-full p-2 border rounded"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Minimum Amount Out
          </label>
          <input
            type="text"
            placeholder="95"
            value={minAmountOut}
            onChange={(e) => setMinAmountOut(e.target.value)}
            className="w-full p-2 border rounded"
          />
        </div>

        <button
          onClick={handleSwap}
          disabled={loading}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400"
        >
          {loading ? 'Processing...' : 'Sign & Submit Intent'}
        </button>

        {status && (
          <div className="mt-4 p-3 bg-gray-100 rounded">
            <p className="text-sm">{status}</p>
          </div>
        )}
      </div>

      <div className="mt-6 p-4 bg-blue-50 rounded">
        <h3 className="font-semibold mb-2">ℹ️ How it works:</h3>
        <ol className="text-sm space-y-1 list-decimal list-inside">
          <li>You sign a message (no gas fee)</li>
          <li>Solvers compete to fill your order</li>
          <li>Best solver executes the swap (pays gas)</li>
          <li>You receive your tokens!</li>
        </ol>
      </div>
    </div>
  );
}
```

### 3. EIP-712 Signature Visualization

```typescript
// frontend/src/components/SignaturePreview.tsx

interface SignaturePreviewProps {
  intent: any;
  domain: any;
}

export function SignaturePreview({ intent, domain }: SignaturePreviewProps) {
  return (
    <div className="border rounded-lg p-4 bg-gray-50">
      <h3 className="font-semibold mb-3">You are signing:</h3>

      <div className="space-y-2 text-sm">
        <div className="bg-white p-3 rounded border">
          <p className="text-xs text-gray-500 mb-1">Domain</p>
          <p className="font-mono text-xs">
            {domain.name} (v{domain.version})
          </p>
          <p className="font-mono text-xs text-gray-600">
            Chain: {domain.chainId}
          </p>
        </div>

        <div className="bg-white p-3 rounded border">
          <p className="text-xs text-gray-500 mb-1">Swap Details</p>
          <div className="space-y-1">
            <p>
              <span className="text-gray-600">From:</span>{' '}
              <span className="font-mono text-xs">{intent.tokenIn}</span>
            </p>
            <p>
              <span className="text-gray-600">To:</span>{' '}
              <span className="font-mono text-xs">{intent.tokenOut}</span>
            </p>
            <p>
              <span className="text-gray-600">Amount:</span> {intent.amountIn}
            </p>
            <p>
              <span className="text-gray-600">Min Output:</span>{' '}
              {intent.minAmountOut}
            </p>
            <p>
              <span className="text-gray-600">Deadline:</span>{' '}
              {new Date(intent.deadline * 1000).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="bg-yellow-50 p-2 rounded border border-yellow-200">
          <p className="text-xs text-yellow-800">
            ⚠️ No gas fee required - you're only signing a message
          </p>
        </div>
      </div>
    </div>
  );
}
```

---

## Security Considerations

### 1. Replay Attack Prevention

**Problem:** An attacker could reuse a valid signature to execute the same intent multiple times.

**Solutions:**

1. **Nonces** (Implemented in contract):
```solidity
// Each user has unique nonces that can only be used once
mapping(address => mapping(uint256 => bool)) public nonceUsed;

// In executeIntent:
require(!nonceUsed[intent.user][intent.nonce], "Nonce already used");
nonceUsed[intent.user][intent.nonce] = true;
```

2. **Deadline Validation**:
```solidity
require(block.timestamp <= intent.deadline, "Intent expired");
```

3. **Chain ID in Domain Separator**:
```solidity
// Prevents cross-chain replay
constructor() EIP712("IntentProtocol", "1") {
    // chainId is automatically included in domain separator
}
```

### 2. Signature Malleability

**Problem:** ECDSA signatures can be malleable, allowing attackers to create valid alternative signatures.

**Solution:** Use OpenZeppelin's ECDSA library which handles malleability:

```solidity
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

address signer = digest.recover(signature);
```

### 3. Front-Running Prevention

**Problem:** Solvers could see pending intents and front-run with better prices.

**Solutions:**

1. **Exclusive Period**:
```solidity
struct ExclusiveIntent {
    address exclusiveSolver;
    uint256 exclusivityEndTime;
}

// Only exclusive solver can execute during exclusivity period
if (block.timestamp <= exclusivityEndTime) {
    require(msg.sender == exclusiveSolver, "Not exclusive");
}
```

2. **Private Mempool**: Use services like Flashbots to submit transactions privately.

3. **Commit-Reveal Scheme**:
```solidity
// Phase 1: Solvers commit to quotes without revealing
mapping(bytes32 => bytes32) public commitments;

function commitQuote(bytes32 intentHash, bytes32 commitment) external {
    commitments[keccak256(abi.encodePacked(intentHash, msg.sender))] = commitment;
}

// Phase 2: Solvers reveal their quotes
function revealQuote(bytes32 intentHash, uint256 quote, bytes32 salt) external {
    bytes32 commitment = keccak256(abi.encodePacked(quote, salt));
    require(commitments[...] == commitment, "Invalid reveal");
}
```

### 4. MEV Protection

**Problem:** Miners/validators could extract value by reordering transactions.

**Solutions:**

1. **Batch Auctions**: Settle multiple intents together in one transaction
2. **Fair Ordering**: Use time-priority instead of gas-price priority
3. **Slippage Protection**: Already built-in with `minAmountOut`

### 5. Solver Exclusivity Problem

**Question:** What happens if the winning solver doesn't execute?

**Solutions:**

1. **Timeout Mechanism**:
```typescript
// Backend tracks execution status
setTimeout(() => {
  if (!isExecuted(intentHash)) {
    // Re-run auction with remaining solvers
    runRFQ(intent, { excludeSolver: failedSolver });
  }
}, 30000); // 30 second timeout
```

2. **Solver Reputation System**:
```typescript
interface SolverReputation {
  successRate: number;
  avgExecutionTime: number;
  failureCount: number;
}

// Penalize solvers who win but don't execute
function penalizeSolver(solverId: string) {
  const solver = solvers.get(solverId);
  solver.reputation *= 0.9; // Reduce reputation by 10%
}
```

3. **Stake/Bond Requirement**:
```solidity
// Solvers must stake ETH to participate
mapping(address => uint256) public solverStakes;

function registerSolver() external payable {
    require(msg.value >= MIN_STAKE, "Insufficient stake");
    solverStakes[msg.sender] += msg.value;
}

// Slash stake if solver fails to execute
function slashSolver(address solver) internal {
    uint256 penalty = solverStakes[solver] / 10;
    solverStakes[solver] -= penalty;
}
```

### 6. Phishing Protection

**Problem:** Users might be tricked into signing malicious intents.

**Solutions:**

1. **Clear UI**: Show users exactly what they're signing
2. **Domain Verification**: Check verifyingContract matches expected
3. **Amount Limits**: Warn for unusually large amounts
4. **Token Verification**: Validate token addresses against known lists

```typescript
// frontend/src/utils/intentValidation.ts

export function validateIntent(intent: Intent): string[] {
  const warnings: string[] = [];

  // Check token addresses
  if (!KNOWN_TOKENS.includes(intent.tokenIn)) {
    warnings.push('⚠️ Token In is not a verified token');
  }

  // Check amounts
  if (BigInt(intent.amountIn) > parseUnits('10000', 18)) {
    warnings.push('⚠️ Large amount - please verify');
  }

  // Check deadline
  const hoursUntilDeadline = (intent.deadline - Date.now() / 1000) / 3600;
  if (hoursUntilDeadline > 24) {
    warnings.push('⚠️ Deadline is more than 24 hours away');
  }

  return warnings;
}
```

---

## Reference Implementations

### UniswapX
- **Repository**: https://github.com/Uniswap/UniswapX
- **Docs**: https://docs.uniswap.org/contracts/uniswapx/overview
- **Key Features**:
  - Reactor pattern for order settlement
  - Permit2 integration
  - Multiple auction types (Dutch, Priority)
  - Filler competition system

**Key Files to Study**:
- `src/reactors/V2DutchOrderReactor.sol` - Main reactor implementation
- `src/base/ReactorEvents.sol` - Event definitions
- `src/interfaces/IReactor.sol` - Reactor interface

### CoW Protocol
- **Repository**: https://github.com/cowprotocol
- **Docs**: https://docs.cow.fi
- **Key Features**:
  - Batch auctions
  - CoW (Coincidence of Wants)
  - Multiple signing schemes (EIP-712, ERC-1271, PreSign)
  - Solver competition with bonds

**Key Concepts**:
- EIP-712 domain separator with replay protection
- Order batching for gas efficiency
- Solver network with reputation

### 1inch Fusion
- **Docs**: https://docs.1inch.io/docs/fusion-swap/introduction
- **Key Features**:
  - Dutch auction pricing
  - Resolver network
  - Cross-chain support
  - Gasless approvals

### Permit2
- **Repository**: https://github.com/Uniswap/permit2
- **Docs**: https://docs.uniswap.org/contracts/permit2/overview
- **Key Features**:
  - Signature-based token transfers
  - One-time approvals
  - Batch transfers
  - Allowance management

**Integration Example**:
```solidity
import {IPermit2} from "permit2/interfaces/IPermit2.sol";

// Transfer tokens using Permit2
permit2.transferFrom(
    from,      // Token owner
    to,        // Recipient
    amount,    // Amount to transfer
    token      // Token address
);
```

### EIP-712 Standard
- **Specification**: https://eips.ethereum.org/EIPS/eip-712
- **Key Points**:
  - Typed structured data hashing
  - Domain separator for replay protection
  - Human-readable signatures
  - Standard encoding format

---

## Additional Resources

### Documentation
- **EIP-712**: https://eips.ethereum.org/EIPS/eip-712
- **ERC-1271**: https://eips.ethereum.org/EIPS/eip-1271
- **Permit2**: https://docs.uniswap.org/contracts/permit2
- **Wagmi docs**: https://wagmi.sh
- **Viem docs**: https://viem.sh

### Tools
- **eth-sig-util**: JavaScript library for EIP-712 signing
- **Foundry**: Solidity testing framework
- **Hardhat**: Development environment
- **Tenderly**: Transaction simulator

### Security Audits
- **UniswapX Audit by ABDK**: Check GitHub repo
- **Permit2 Audit**: https://github.com/Uniswap/permit2/tree/main/audit
- **CoW Protocol Audits**: https://github.com/cowprotocol/audits

---

## Implementation Checklist

### Smart Contracts
- [ ] Implement EIP-712 domain separator
- [ ] Create Intent struct with all required fields
- [ ] Implement signature verification
- [ ] Add nonce management for replay protection
- [ ] Implement deadline validation
- [ ] Integrate Permit2 for token transfers
- [ ] Add event emission
- [ ] Write comprehensive tests
- [ ] Audit contract code

### Backend
- [ ] Set up Express API server
- [ ] Implement WebSocket server for solvers
- [ ] Create signature verification module
- [ ] Build order book/order matching engine
- [ ] Implement RFQ system
- [ ] Add solver reputation tracking
- [ ] Set up database for order storage
- [ ] Implement monitoring and logging
- [ ] Add rate limiting and DDoS protection

### Frontend
- [ ] Set up Wagmi/Viem
- [ ] Implement EIP-712 signing hook
- [ ] Create swap UI component
- [ ] Add signature preview
- [ ] Implement intent status polling
- [ ] Add error handling
- [ ] Create validation warnings
- [ ] Add transaction history
- [ ] Implement mobile responsiveness

### Security
- [ ] Implement replay attack prevention
- [ ] Add front-running protection
- [ ] Set up solver slashing mechanism
- [ ] Implement phishing warnings
- [ ] Add amount validation
- [ ] Test all edge cases
- [ ] Conduct security audit
- [ ] Set up bug bounty program

---

## Conclusion

This research provides a comprehensive guide to implementing a gasless off-chain intent system. The key components are:

1. **Smart Contract**: Uses EIP-712 for signature verification, Permit2 for gasless token transfers, and implements robust security measures
2. **Backend**: Manages order matching, RFQ auctions, and solver coordination
3. **Frontend**: Provides user-friendly interface for signing intents without gas fees
4. **Security**: Multiple layers of protection against common attacks

The system follows patterns proven by UniswapX, CowSwap, and 1inch Fusion while being adaptable for cross-chain DeFi protocols.

All code examples are production-ready starting points that should be thoroughly tested and audited before mainnet deployment.
