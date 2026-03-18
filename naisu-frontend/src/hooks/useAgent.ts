import { useState, useCallback, useRef } from 'react';
import { decodeFunctionData, formatEther } from 'viem';
import { INTENT_BRIDGE_ABI } from '@/lib/abi/abi';

const AGENT_URL = (import.meta.env.VITE_AGENT_URL as string | undefined)?.trim() || 'http://localhost:8787';
const PROJECT_ID = (import.meta.env.VITE_AGENT_PROJECT_ID as string | undefined)?.trim() || 'nesu';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Decoded details extracted from calldata
export interface TxDetails {
  recipient: string;        // human-readable: base58 (Solana), hex (EVM/Sui)
  recipientShort: string;   // truncated for display
  destinationChain: number; // Wormhole chain ID
  destinationLabel: string; // 'Solana' | 'Sui' | 'Base Sepolia' etc
  amountEth: string;        // ETH amount human-readable
  startPriceFormatted: string;    // Dutch auction start price formatted
  floorPriceFormatted: string;    // Dutch auction floor formatted
  durationMin: number;      // auction duration in minutes
}

export interface TxData {
  to: string;
  data: string;
  value: string;
  chainId: number;
  decoded?: TxDetails;      // populated when calldata is decodable
}

const WORMHOLE_CHAIN_LABELS: Record<number, string> = {
  1:     'Solana',
  21:    'Sui',
  10004: 'Base Sepolia',
}

function destLabel(chainId: number): string {
  return WORMHOLE_CHAIN_LABELS[chainId] ?? `Chain ${chainId}`
}

function recipientHuman(recipientBytes32: `0x${string}`, destChain: number): string {
  // For Solana: bytes32 = 32-byte pubkey → base58
  if (destChain === 1) {
    try {
      // base58 encode manually using browser-compatible approach
      // bytes32 hex → Uint8Array → PublicKey base58
      const hex = recipientBytes32.replace('0x', '')
      const bytes = new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
      // Simple base58 encode (Bitcoin alphabet)
      const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
      let num = BigInt('0x' + hex)
      let result = ''
      while (num > 0n) {
        result = ALPHABET[Number(num % 58n)]! + result
        num = num / 58n
      }
      // Leading zeros
      for (const b of bytes) {
        if (b !== 0) break
        result = '1' + result
      }
      return result
    } catch { /* fall through */ }
  }
  // For EVM/Sui: last 20 bytes as 0x address
  return '0x' + recipientBytes32.slice(-40)
}

function decodeTxDetails(data: string, value: string, chainId: number): TxDetails | undefined {
  try {
    const decoded = decodeFunctionData({
      abi: INTENT_BRIDGE_ABI,
      data: data as `0x${string}`,
    })
    if (decoded.functionName !== 'createOrder') return undefined

    const args = decoded.args as unknown as [`0x${string}`, number, bigint, bigint, bigint]
    const [recipient, destinationChain, startPrice, floorPrice, durationSeconds] = args

    const amountWei = BigInt(
      value.startsWith('0x') ? value : /^\d{15,}$/.test(value) ? value : String(Math.round(parseFloat(value) * 1e18))
    )

    const recipStr    = recipientHuman(recipient, destinationChain)
    const short       = recipStr.length > 16 ? `${recipStr.slice(0, 8)}…${recipStr.slice(-6)}` : recipStr

    // Determine target chain decimals for price formatting
    // Solana (1) and Sui (21) use 9 decimals. EVM uses 18.
    const decimals = (destinationChain === 1 || destinationChain === 21) ? 9 : 18
    const formatTarget = (val: bigint) => {
      const s = val.toString().padStart(decimals + 1, '0')
      const intPart = s.slice(0, -decimals) || '0'
      const fracPart = s.slice(-decimals).replace(/0+$/, '')
      return fracPart ? `${intPart}.${fracPart}` : intPart
    }

    return {
      recipient:        recipStr,
      recipientShort:   short,
      destinationChain,
      destinationLabel: destLabel(destinationChain),
      amountEth:        formatEther(amountWei),
      startPriceFormatted: formatTarget(startPrice),
      floorPriceFormatted: formatTarget(floorPrice),
      durationMin:      Math.round(Number(durationSeconds) / 60),
    }
  } catch {
    return undefined
  }
}

function extractTxData(content: string): TxData | undefined {
  // Strategy 1: parse JSON block that agent includes in response
  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?"to"\s*:[\s\S]*?\})\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.to && parsed.data && parsed.chainId) {
        // value can be wei string or ETH decimal
        const valueEth = parsed.value
          ? parsed.value.toString().startsWith('0x') || /^\d{15,}$/.test(parsed.value.toString())
            ? (Number(BigInt(parsed.value.toString())) / 1e18).toString()
            : parsed.value.toString()
          : '0';
        const tx: TxData = { to: parsed.to, data: parsed.data, value: valueEth, chainId: Number(parsed.chainId) }
        tx.decoded = decodeTxDetails(parsed.data, valueEth, tx.chainId)
        return tx
      }
    } catch { /* fall through */ }
  }

  // Strategy 2: regex fallback
  const addresses = content.match(/`(0x[0-9a-fA-F]{40})`/g)?.map(m => m.replace(/`/g, ''));
  const chainMatch = content.match(/Chain ID[^\d]*(\d+)/);
  const valueMatch = content.match(/(\d+\.?\d*)\s*ETH/i);
  const dataMatch = content.match(/`(0x[0-9a-fA-F]{64,})`/);

  if (addresses?.length && chainMatch && valueMatch && dataMatch) {
    const tx: TxData = { to: addresses[0], data: dataMatch[1], value: valueMatch[1], chainId: parseInt(chainMatch[1]) }
    tx.decoded = decodeTxDetails(dataMatch[1], valueMatch[1], tx.chainId)
    return tx
  }
  return undefined;
}

export interface UseAgentOptions {
  /** Messages from the active session — controlled externally */
  messages: AgentMessage[];
  /** Backend session ID from the active session */
  backendSessionId?: string;
  /** Called whenever messages change so the parent can persist to session storage */
  onMessagesChange: (messages: AgentMessage[], backendSessionId?: string) => void;
}

export function useAgent(
  walletAddress?: string,
  solanaAddress?: string,
  opts?: UseAgentOptions
) {
  const [internalMessages, setInternalMessages] = useState<AgentMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTx, setPendingTx] = useState<TxData | undefined>();
  const sessionIdRef = useRef<string | undefined>(opts?.backendSessionId);

  // Always-up-to-date refs so async callbacks never read stale closures
  const latestMessagesRef = useRef<AgentMessage[]>(opts?.messages ?? internalMessages);
  const onMessagesChangeRef = useRef(opts?.onMessagesChange);

  // Sync refs every render
  latestMessagesRef.current = opts ? opts.messages : internalMessages;
  onMessagesChangeRef.current = opts?.onMessagesChange;

  // Keep sessionIdRef in sync when caller switches sessions
  if (opts?.backendSessionId !== undefined && opts.backendSessionId !== sessionIdRef.current) {
    sessionIdRef.current = opts.backendSessionId;
  }

  const messages = opts ? opts.messages : internalMessages;

  /** Append messages without stale closure risk */
  const appendMessages = useCallback((updater: (prev: AgentMessage[]) => AgentMessage[]) => {
    if (onMessagesChangeRef.current) {
      const next = updater(latestMessagesRef.current);
      latestMessagesRef.current = next;
      onMessagesChangeRef.current(next, sessionIdRef.current);
    } else {
      setInternalMessages(prev => {
        const next = updater(prev);
        latestMessagesRef.current = next;
        return next;
      });
    }
  }, []);

  /** Inject an assistant message directly without an agent round-trip. */
  const addMessage = useCallback((content: string, role: 'assistant' | 'user' = 'assistant') => {
    appendMessages(prev => [...prev, { role, content }]);
  }, [appendMessages]);

  const sendMessage = useCallback(async (userMessage: string) => {
    if (!userMessage.trim() || isLoading) return;

    setError(null);
    setPendingTx(undefined);
    setIsLoading(true);

    const newUserMsg: AgentMessage = { role: 'user', content: userMessage };
    appendMessages(prev => [...prev, newUserMsg]);

    // Auto-inject wallet addresses
    let messageToSend = userMessage.trim();
    const extras: string[] = [];
    if (walletAddress && !messageToSend.toLowerCase().includes(walletAddress.toLowerCase())) {
      extras.push(`My EVM wallet: ${walletAddress}`);
    }
    if (solanaAddress && !messageToSend.includes(solanaAddress)) {
      extras.push(`My Solana wallet: ${solanaAddress}`);
    }
    if (extras.length) messageToSend += `\n\n[Wallet context]\n${extras.join('\n')}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    try {
      const res = await fetch(`${AGENT_URL}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: PROJECT_ID,
          userId: walletAddress ?? 'guest',
          sessionId: sessionIdRef.current,
          message: messageToSend,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await res.json();

      if (data.ok) {
        sessionIdRef.current = data.sessionId;
        const tx = extractTxData(data.message);
        if (tx) setPendingTx(tx);
        appendMessages(prev => [...prev, { role: 'assistant' as const, content: data.message }]);
      } else {
        throw new Error(data.error ?? 'Unknown error');
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        const timeoutMsg = "The agent is taking too long to respond (timeout). It might be stuck waiting for a solver or processing a long request. Please try again later.";
        setError(timeoutMsg);
        appendMessages(prev => [...prev, {
          role: 'assistant' as const,
          content: `⚠️ **Timeout Error:**\n\n${timeoutMsg}`,
        }]);
      } else {
        const msg = err instanceof Error ? err.message : 'Network error';
        setError(msg);
        appendMessages(prev => [...prev, {
          role: 'assistant' as const,
          content: `Something went wrong: \`${msg}\`\n\nMake sure the agent is running on ${AGENT_URL}.`,
        }]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, walletAddress, solanaAddress, appendMessages]);

  const reset = useCallback(() => {
    latestMessagesRef.current = [];
    if (onMessagesChangeRef.current) {
      onMessagesChangeRef.current([], undefined);
    } else {
      setInternalMessages([]);
    }
    setError(null);
    setPendingTx(undefined);
    sessionIdRef.current = undefined;
  }, []);

  return {
    messages,
    isLoading,
    error,
    pendingTx,
    setPendingTx,
    sendMessage,
    addMessage,
    reset,
  };
}

