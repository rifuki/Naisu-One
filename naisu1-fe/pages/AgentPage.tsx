import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAccount, useConnect, useDisconnect, useSendTransaction } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { parseEther } from 'viem';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSolanaAddress } from '../hooks/useSolanaAddress';

const AGENT_URL = (import.meta.env.VITE_AGENT_URL as string | undefined)?.trim() || 'http://localhost:8787';
const PROJECT_ID = (import.meta.env.VITE_AGENT_PROJECT_ID as string | undefined)?.trim() || 'naisu1';

interface TxData {
  to: string;
  data: string;
  value: string;
  chainId: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  txData?: TxData;
}

const QUICK_PROMPTS = [
  'Bridge 0.1 ETH from Base Sepolia to Solana',
  'How much SOL will I get for 0.05 ETH?',
  'Show my open orders',
  'What chains do you support?',
];

function extractTxData(content: string): TxData | undefined {
  // Strategy 1: JSON block with to/data/chainId
  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?"to"\s*:[\s\S]*?\})\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.to && parsed.data && parsed.chainId) {
        const valueEth = parsed.value
          ? parsed.value.toString().startsWith('0x') || /^\d{15,}$/.test(parsed.value.toString())
            ? (Number(BigInt(parsed.value.toString())) / 1e18).toString()
            : parsed.value.toString()
          : '0';
        return { to: parsed.to, data: parsed.data, value: valueEth, chainId: Number(parsed.chainId) };
      }
    } catch { /* fall through */ }
  }

  // Strategy 2: regex fallback (handles Markdown tables, lists, and backticks)
  const toMatch = content.match(/(?:To|Contract|address)[^\w]*(0x[a-fA-F0-9]{40})/i) || content.match(/`(0x[a-fA-F0-9]{40})`/i);
  const chainMatch = content.match(/Chain ID[^\d]*(\d+)/i);
  const valueMatch = content.match(/(?:Value|Amount)[^\d]*(\d+\.?\d*)\s*(?:ETH|AVAX)/i) || content.match(/(\d+\.?\d*)\s*ETH/i);
  const dataMatch = content.match(/(?:Data|Calldata|data)[^\w]*(0x[a-fA-F0-9]{64,})/i) || content.match(/`(0x[a-fA-F0-9]{64,})`/i);

  if (toMatch && chainMatch && valueMatch && dataMatch) {
    return {
      to: toMatch[1],
      data: dataMatch[1],
      value: valueMatch[1],
      chainId: parseInt(chainMatch[1]),
    };
  }

  return undefined;
}

function TxCard({ tx, onSend }: { tx: TxData; onSend: (tx: TxData) => void }) {
  const chainName = tx.chainId === 84532 ? 'Base Sepolia' : tx.chainId === 43113 ? 'Avalanche Fuji' : `Chain ${tx.chainId}`;
  const explorerBase = tx.chainId === 84532 ? 'https://sepolia.basescan.org' : 'https://testnet.snowtrace.io';

  return (
    <div className="mt-3 rounded-xl border border-primary/30 bg-gradient-to-b from-primary/5 to-black/20 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-primary/10 border-b border-primary/20 flex items-center gap-2">
        <span className="material-symbols-outlined text-sm text-primary">receipt</span>
        <span className="text-xs font-bold text-primary uppercase tracking-wider">Transaction Ready</span>
      </div>
      {/* Fields */}
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-slate-500 text-xs w-12 flex-shrink-0">To</span>
          <a
            href={`${explorerBase}/address/${tx.to}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-300 text-xs font-mono hover:text-primary transition-colors truncate ml-2 text-right"
          >
            {tx.to.slice(0, 10)}...{tx.to.slice(-8)}
          </a>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500 text-xs w-12 flex-shrink-0">Value</span>
          <span className="text-white text-sm font-bold ml-2">{tx.value} ETH</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500 text-xs w-12 flex-shrink-0">Chain</span>
          <span className="text-slate-300 text-xs ml-2">{chainName}</span>
        </div>
        <div className="flex items-start justify-between">
          <span className="text-slate-500 text-xs w-12 flex-shrink-0 mt-0.5">Data</span>
          <span className="text-slate-600 text-[10px] font-mono ml-2 truncate max-w-[180px]">
            {tx.data.slice(0, 18)}...
          </span>
        </div>
      </div>
      {/* Execute button */}
      <div className="px-3 pb-3">
        <button
          onClick={() => onSend(tx)}
          className="w-full py-2.5 rounded-xl bg-primary text-black text-sm font-bold
            hover:bg-primary/90 active:scale-[0.98] transition-all
            flex items-center justify-center gap-2 shadow-lg shadow-primary/20"
        >
          <span className="material-symbols-outlined text-base">send</span>
          Execute via MetaMask
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ msg, onSend }: { msg: Message; onSend: (tx: TxData) => void }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`flex-shrink-0 size-9 rounded-full flex items-center justify-center mt-1
        ${isUser
          ? 'bg-indigo-500/20 border border-indigo-500/30 text-indigo-300'
          : 'bg-primary/10 border border-primary/20 text-primary'}`}>
        <span className="material-symbols-outlined text-lg">{isUser ? 'person' : 'smart_toy'}</span>
      </div>
      <div className={`space-y-1 max-w-[78%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`flex items-center gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="text-xs font-semibold text-white">{isUser ? 'You' : 'Nesu'}</span>
          <span className="text-[10px] text-slate-600">
            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className={`p-3.5 rounded-2xl text-sm leading-relaxed shadow-lg w-full
          ${isUser
            ? 'rounded-tr-none bg-indigo-500/10 border border-indigo-500/20 text-white'
            : 'rounded-tl-none bg-surface-light border border-white/5 text-slate-300'}`}>
          {isUser ? (
            <p>{msg.content}</p>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none
              [&_table]:w-full [&_table]:text-xs [&_table]:border-collapse
              [&_td]:px-2 [&_td]:py-1.5 [&_td]:border [&_td]:border-white/10
              [&_th]:px-2 [&_th]:py-1.5 [&_th]:border [&_th]:border-white/10 [&_th]:bg-white/5 [&_th]:text-left
              [&_code]:bg-primary/10 [&_code]:px-1.5 [&_code]:rounded [&_code]:text-primary [&_code]:text-xs [&_code]:font-mono [&_code]:border [&_code]:border-primary/20
              [&_pre]:bg-slate-900/50 [&_pre]:border [&_pre]:border-white/10 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:text-xs
              [&_p]:my-2 [&_ul]:my-2 [&_li]:my-1 [&_strong]:text-white [&_a]:text-primary [&_a]:hover:underline">
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          )}
          {msg.txData && <TxCard tx={msg.txData} onSend={onSend} />}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 size-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mt-1">
        <span className="material-symbols-outlined text-lg">smart_toy</span>
      </div>
      <div className="p-3.5 rounded-2xl rounded-tl-none bg-surface-light border border-white/5 shadow-lg flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]"></span>
        <span className="size-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]"></span>
        <span className="size-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]"></span>
      </div>
    </div>
  );
}

export default function AgentPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: "Hey! I'm **Nesu**, your cross-chain DeFi agent.\n\nI can bridge assets across EVM, Sui, and Solana — just tell me what you want to do in plain English.\n\nConnect your wallet and I'll auto-fill your address!",
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [txStatus, setTxStatus] = useState<string | null>(null);
  // Manual Solana address fallback (user can type if wallet not detected)
  const [manualSolAddress, setManualSolAddress] = useState('');
  const [showSolInput, setShowSolInput] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { address, isConnected, chain } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { sendTransactionAsync } = useSendTransaction();
  const { publicKey: solPublicKey, connected: solConnected } = useWallet();

  // Robust Solana address: adapter (Phantom) OR window.backpack OR window.solana
  const detectedSolAddress = useSolanaAddress();
  // manualSolAddress: user-typed fallback if all else fails
  const solAddress = detectedSolAddress || manualSolAddress || undefined;

  // Use refs to always have latest values in callbacks (avoids stale closure)
  const solAddressRef = useRef(solAddress);
  const evmAddressRef = useRef(address);
  useEffect(() => { solAddressRef.current = solAddress; }, [solAddress]);
  useEffect(() => { evmAddressRef.current = address; }, [address]);

  // Debug log untuk melihat address detection
  useEffect(() => {
    console.log('[Wallet Debug] EVM:', address, 'Solana detected:', detectedSolAddress, 'Solana final:', solAddress);
  }, [address, detectedSolAddress, solAddress]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    // Always auto-inject wallet addresses — use refs to get latest values (no stale closure)
    let messageToSend = text.trim();
    const currentEvm = evmAddressRef.current;
    const currentSol = solAddressRef.current;
    const extras: string[] = [];
    if (currentEvm && !messageToSend.toLowerCase().includes(currentEvm.toLowerCase())) {
      extras.push(`My EVM wallet (sender): ${currentEvm}`);
    }
    if (currentSol && !messageToSend.includes(currentSol)) {
      extras.push(`My Solana wallet (recipient for SOL/SPL): ${currentSol}`);
    }
    if (extras.length) messageToSend += `\n\n[Wallet context]\n${extras.join('\n')}`;

    try {
      const res = await fetch(`${AGENT_URL}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: PROJECT_ID,
          userId: address ?? 'guest',
          sessionId,
          message: messageToSend,
        }),
      });

      const data = await res.json();

      if (data.ok) {
        setSessionId(data.sessionId);
        const txData = extractTxData(data.message);
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
          txData,
        }]);
      } else {
        throw new Error(data.error ?? 'Unknown error');
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Sorry, I ran into an issue: \`${err.message}\`\n\nMake sure the agent service is running on ${AGENT_URL}.`,
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [loading, sessionId]);

  const handleSendTx = useCallback(async (tx: TxData) => {
    if (!isConnected) {
      alert('Connect your wallet first!');
      return;
    }
    try {
      setTxStatus('Waiting for MetaMask...');
      const hash = await sendTransactionAsync({
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: parseEther(tx.value),
        chainId: tx.chainId,
      });
      setTxStatus(`Submitted!`);
      
      // Minta ActiveIntents untuk segera merefresh background datanya
      window.dispatchEvent(new Event('refresh_intents'));

      const explorerBase = tx.chainId === 84532
        ? 'https://sepolia.basescan.org/tx/'
        : 'https://testnet.snowtrace.io/tx/';
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `🎉 **Transaction submitted successfully!**\n\nHash: \`${hash}\`\n[View on Explorer](${explorerBase}${hash})\n\nSaya telah mendaftarkan intent Anda ke dalam Dutch Auction. Anda bisa melihat progres lelangnya secara real-time melalui tombol **Intents** di pojok kanan bawah yang sekarang berkedip! ✨`,
        timestamp: new Date(),
      }]);
      setTimeout(() => setTxStatus(null), 5000);
    } catch (err: any) {
      setTxStatus(null);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Transaction failed: \`${err.shortMessage ?? err.message}\``,
        timestamp: new Date(),
      }]);
    }
  }, [isConnected, sendTransactionAsync]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] max-w-3xl mx-auto px-4">
      {/* Header */}
      <div className="flex items-center justify-between py-3 mb-2 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <span className="material-symbols-outlined text-lg">smart_toy</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-white">Nesu Agent</div>
            <div className="flex items-center gap-1.5">
              <div className="size-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-[10px] text-slate-500">Online · kimi-for-coding</span>
            </div>
          </div>
        </div>

        {/* Wallet Connect */}
        <div className="flex items-center gap-2">
          {txStatus && (
            <span className="text-xs text-primary px-2 py-1 bg-primary/10 rounded-full animate-pulse">{txStatus}</span>
          )}
          {isConnected ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-light border border-white/10 text-xs">
              <div className="size-2 rounded-full bg-emerald-500"></div>
              <span className="text-slate-300 font-mono">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-500">{chain?.name}</span>
              <button onClick={() => disconnect()} className="text-slate-600 hover:text-red-400 transition-colors ml-1">
                <span className="material-symbols-outlined text-sm">logout</span>
              </button>
            </div>
          ) : (
            <button
              onClick={() => connect({ connector: injected() })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 text-primary text-xs font-semibold hover:bg-primary/20 transition-all"
            >
              <span className="material-symbols-outlined text-sm">account_balance_wallet</span>
              Connect Wallet
            </button>
          )}
        </div>
      </div>

      {/* Wallet status bar + Solana address input */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {/* EVM status */}
        {isConnected && address ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px]">
            <div className="size-1.5 rounded-full bg-emerald-500" />
            <span className="text-emerald-400 font-mono">{address.slice(0, 6)}...{address.slice(-4)}</span>
            <span className="text-emerald-700">EVM</span>
          </div>
        ) : null}

        {/* Solana status */}
        {detectedSolAddress ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-[11px]">
            <div className="size-1.5 rounded-full bg-purple-400 animate-pulse" />
            <span className="text-purple-300 font-mono">{detectedSolAddress.slice(0, 6)}...{detectedSolAddress.slice(-4)}</span>
            <span className="text-purple-700">SOL ✓</span>
          </div>
        ) : manualSolAddress ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-[11px]">
            <div className="size-1.5 rounded-full bg-purple-400" />
            <span className="text-purple-300 font-mono">{manualSolAddress.slice(0, 6)}...{manualSolAddress.slice(-4)}</span>
            <span className="text-purple-700">SOL (manual)</span>
            <button onClick={() => setManualSolAddress('')} className="text-purple-700 hover:text-red-400 ml-1">
              <span className="material-symbols-outlined text-xs">close</span>
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowSolInput(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 hover:border-purple-500/30 hover:text-purple-400 text-[11px] text-slate-500 transition-all"
          >
            <span className="material-symbols-outlined text-xs">add</span>
            Set Solana address
          </button>
        )}

        {/* Manual Solana input */}
        {showSolInput && !detectedSolAddress && (
          <div className="w-full flex gap-2 mt-1">
            <input
              type="text"
              placeholder="Paste your Solana address (e.g. AUJr5Xm...)"
              className="flex-1 bg-black/30 border border-purple-500/30 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/60"
              value={manualSolAddress}
              onChange={e => setManualSolAddress(e.target.value.trim())}
              onKeyDown={e => { if (e.key === 'Enter') setShowSolInput(false); }}
            />
            <button
              onClick={() => setShowSolInput(false)}
              className="px-3 py-1.5 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-semibold hover:bg-purple-500/30 transition-all"
            >
              Set
            </button>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-5 py-4 pr-1">
        {messages.map(msg => (
          <React.Fragment key={msg.id}>
            <MessageBubble msg={msg} onSend={handleSendTx} />
          </React.Fragment>
        ))}
        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Dynamic Contextual Prompts / Quick Prompts */}
      {!loading && (() => {
        const lastMsg = messages[messages.length - 1];
        let prompts = messages.length <= 1 ? QUICK_PROMPTS : [];
        
        if (lastMsg?.role === 'assistant') {
          const content = lastMsg.content.toLowerCase();
          if (content.includes('ready to build') || content.includes('want me to build') || content.includes('should i build') || content.includes('would you like to proceed')) {
            prompts = ['Yes, build the transaction', 'No, cancel'];
          } else if (content.includes('order status') && content.includes('want me to check')) {
            prompts = ['Check my order status', 'No need'];
          } else if (content.includes('minimum practical amount')) {
            prompts = ['Try 0.001 ETH instead', 'Cancel'];
          } else if (content.includes('what would you like to do') || content.includes('how can i help')) {
            prompts = ['Bridge 0.1 ETH to Solana', 'Check my open orders'];
          }
        }

        if (prompts.length === 0) return null;

        return (
          <div className="flex flex-wrap gap-2 pb-2">
            {prompts.map(p => (
              <button
                key={p}
                onClick={() => sendMessage(p)}
                className="px-4 py-1.5 rounded-full bg-[#0c1211] border border-white/10 hover:border-primary/50 hover:bg-primary/5 text-primary transition-all text-xs font-medium shadow-md"
              >
                {p}
              </button>
            ))}
          </div>
        );
      })()}

      {/* Input */}
      <div className="py-3">
        <div className="relative flex items-center bg-surface-light border border-white/10 rounded-2xl focus-within:border-primary/50 focus-within:shadow-[0_0_20px_-5px_rgba(13,242,223,0.2)] transition-all duration-300">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isConnected
                ? `Ask Nesu anything... (${address?.slice(0, 6)}... connected)`
                : 'Ask Nesu anything...'
            }
            className="w-full bg-transparent border-0 text-white placeholder-slate-600 focus:ring-0 py-3.5 pl-4 pr-14 text-sm"
            disabled={loading}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            className="absolute right-2 p-2 bg-primary/10 text-primary hover:bg-primary hover:text-black transition-all rounded-xl disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-lg">{loading ? 'hourglass_empty' : 'arrow_upward'}</span>
          </button>
        </div>
        <p className="text-[10px] text-slate-700 text-center mt-1.5">
          Nesu can make mistakes. Always verify transactions before signing.
        </p>
      </div>
    </div>
  );
}
