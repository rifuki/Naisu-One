import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAccount, useSendTransaction } from 'wagmi';
import { parseEther } from 'viem';
import ReactMarkdown from 'react-markdown';
import { useAgent, AgentMessage as ChatMessage, TxData } from '../hooks/useAgent';
import { useSolanaAddress } from '../hooks/useSolanaAddress';
import { useOrderWatch, OrderUpdateEvent } from '../hooks/useOrderWatch';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim() || 'http://localhost:3000';

// Compact status monitor card shown after tx submit
interface OrderMonitorProps {
    txHash: string;
    chainId: number;
    userAddress: string;
}
const OrderMonitor: React.FC<OrderMonitorProps> = ({ txHash, chainId, userAddress }) => {
    const [status, setStatus] = useState<'indexing' | 'open' | 'fulfilled' | 'error'>('indexing');
    const [elapsed, setElapsed] = useState(0);
    const explorerBase = chainId === 84532 ? 'https://sepolia.basescan.org/tx/' : 'https://testnet.snowtrace.io/tx/';
    const chain = chainId === 84532 ? 'Base Sepolia' : 'Fuji';

    useEffect(() => {
        const startTime = Date.now();
        const ticker = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);

        let attempts = 0;
        // Dutch auction deadline = 5 min, give 10 min total to account for indexing delay
        const MAX_ATTEMPTS = 120; // 120 × 5s = 10 min
        const poll = setInterval(async () => {
            attempts++;
            if (attempts > MAX_ATTEMPTS) {
                clearInterval(poll);
                setStatus('error');
                return;
            }
            try {
                const chainParam = chainId === 84532 ? 'evm-base' : 'evm-fuji';
                const res = await fetch(`${BACKEND_URL}/api/v1/intent/orders?user=${userAddress}&chain=${chainParam}`);
                if (!res.ok) return;
                const data = await res.json();
                const orders: Array<{ status: string; orderId?: string }> = data.data ?? data.orders ?? [];
                // Match by tx hash or just check latest order status
                const latestOrder = orders[0];
                if (orders.some(o => o.status === 'FULFILLED')) {
                    setStatus('fulfilled');
                    clearInterval(poll);
                    clearInterval(ticker);
                } else if (latestOrder && latestOrder.status === 'OPEN') {
                    setStatus('open');
                } else if (orders.length > 0) {
                    setStatus('open');
                }
            } catch { /* ignore — backend may be warming up */ }
        }, 5000);

        return () => { clearInterval(poll); clearInterval(ticker); };
    }, [txHash, chainId, userAddress]);

    const statusConfig = {
        indexing:  { icon: 'sync',         color: 'text-slate-400', label: 'Indexing...',      spin: true,  dot: false },
        open:      { icon: 'schedule',     color: 'text-amber-400', label: 'Awaiting solver',  spin: false, dot: true  },
        fulfilled: { icon: 'check_circle', color: 'text-primary',   label: 'Fulfilled!',       spin: false, dot: false },
        error:     { icon: 'warning',      color: 'text-slate-500', label: 'Check Intents panel', spin: false, dot: false },
    }[status];

    return (
        <div className="mt-3 rounded-xl border border-white/8 bg-white/3 p-3 flex items-center gap-3">
            <div className={`shrink-0 ${statusConfig.color} ${statusConfig.spin ? 'animate-spin' : ''}`}>
                <span className="material-symbols-outlined text-[18px]">{statusConfig.icon}</span>
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    {statusConfig.dot && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    )}
                    <span className={`text-[12px] font-semibold ${statusConfig.color}`}>{statusConfig.label}</span>
                    {status !== 'fulfilled' && status !== 'error' && (
                        <span className="text-[10px] text-slate-600 tabular-nums">{elapsed}s</span>
                    )}
                    {status === 'fulfilled' && (
                        <span className="text-[10px] text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded-full">SOL delivered</span>
                    )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-slate-600 font-mono truncate">{chain} · {txHash.slice(0,10)}…{txHash.slice(-6)}</span>
                    <a href={`${explorerBase}${txHash}`} target="_blank" rel="noreferrer"
                       className="text-[10px] text-slate-600 hover:text-primary transition-colors shrink-0">
                        <span className="material-symbols-outlined text-[11px]">open_in_new</span>
                    </a>
                </div>
            </div>
        </div>
    );
};

const IntentPage: React.FC = () => {
    const [inputValue, setInputValue] = useState("");
    const [hasInteracted, setHasInteracted] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const { address } = useAccount();
    const { sendTransactionAsync } = useSendTransaction();
    const solAddress = useSolanaAddress();
    const [txStatus, setTxStatus] = useState<string | null>(null);
    // Track submitted tx hashes for inline monitoring
    const [submittedTxs, setSubmittedTxs] = useState<Array<{ hash: string; chainId: number; msgIdx: number }>>([]);

    useEffect(() => {
        console.log('[IntentPage Wallet Debug] EVM:', address, 'Solana:', solAddress);
    }, [address, solAddress]);

    const {
        messages,
        isLoading,
        error,
        pendingTx,
        setPendingTx,
        sendMessage,
        addMessage,
        reset,
    } = useAgent(address, solAddress);

    // ── Order status watcher via SSE ─────────────────────────────────────────
    // Only activate after user has submitted at least one tx in this session
    const hasSubmittedTx = submittedTxs.length > 0;

    const handleOrderUpdate = useCallback((event: OrderUpdateEvent) => {
        const { status, orderId, amount, chain, explorerUrl } = event;
        const shortId = orderId.slice(0, 8);
        const chainLabel = chain === 'evm-base' ? 'Base Sepolia' : chain === 'evm-fuji' ? 'Fuji' : chain;

        let message = '';
        if (status === 'FULFILLED') {
            message = `Order \`${shortId}\` fulfilled — **${amount} ETH** bridged successfully on ${chainLabel}. SOL is on its way to your wallet. [View tx](${explorerUrl})`;
        } else if (status === 'EXPIRED') {
            message = `Order \`${shortId}\` expired before a solver filled it. Your ETH is still locked — you can cancel and reclaim it via the Intents panel.`;
        } else if (status === 'CANCELLED') {
            message = `Order \`${shortId}\` cancelled. Funds have been returned.`;
        }

        if (message) addMessage(message);
    }, [addMessage]);

    useOrderWatch({
        user: address,
        enabled: hasSubmittedTx && hasInteracted,
        onOrderUpdate: handleOrderUpdate,
    });

    const handleSendTx = useCallback(async (tx: TxData) => {
        try {
            setTxStatus('Confirm in wallet...');
            const hash = await sendTransactionAsync({
                to: tx.to as `0x${string}`,
                data: tx.data as `0x${string}`,
                value: parseEther(tx.value),
                chainId: tx.chainId,
            });
            setTxStatus(null);
            setPendingTx(undefined);

            // Fire refresh event for ActiveIntents panel
            window.dispatchEvent(new Event('refresh_intents'));

            // Add compact submitted message (no agent round-trip needed)
            const explorerBase = tx.chainId === 84532
                ? 'https://sepolia.basescan.org/tx/'
                : 'https://testnet.snowtrace.io/tx/';

            // Inject system message directly into messages via sendMessage with tx info
            // We pass a special marker so the message bubble can render the monitor widget
            const msgContent = `__TX_SUBMITTED__${JSON.stringify({ hash, chainId: tx.chainId, explorerBase })}`;
            // Store for monitor widget
            setSubmittedTxs(prev => [...prev, { hash, chainId: tx.chainId, msgIdx: -1 }]);
            sendMessage(`Transaction submitted! Hash: ${hash}\n\nExplorer: ${explorerBase}${hash}`);
        } catch (err: unknown) {
            setTxStatus(null);
            const msg = err instanceof Error ? (err as any).shortMessage ?? err.message : 'Unknown error';
            sendMessage(`Transaction failed: ${msg}`);
        }
    }, [sendTransactionAsync, sendMessage, setPendingTx]);

    // Auto-scroll to bottom on new messages or streaming
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isLoading]);

    const handleSend = () => {
        if (!inputValue.trim() || isLoading) return;
        if (!hasInteracted) setHasInteracted(true);
        sendMessage(inputValue);
        setInputValue("");
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleChipClick = (text: string) => {
        setInputValue(text);
    };

    const handleNewChat = () => {
        reset();
        setHasInteracted(false);
        setInputValue("");
    };

    const renderContent = (content: string) => (
        <div className="prose prose-invert prose-sm max-w-none
            [&_table]:w-full [&_table]:text-xs [&_table]:border-collapse
            [&_td]:px-2 [&_td]:py-1.5 [&_td]:border [&_td]:border-white/10
            [&_th]:px-2 [&_th]:py-1.5 [&_th]:border [&_th]:border-white/10 [&_th]:bg-white/5 [&_th]:text-left
            [&_code]:bg-primary/10 [&_code]:px-1.5 [&_code]:rounded [&_code]:text-primary [&_code]:text-xs [&_code]:font-mono [&_code]:border [&_code]:border-primary/20
            [&_pre]:bg-slate-900/50 [&_pre]:border [&_pre]:border-white/10 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:text-xs
            [&_p]:my-2 [&_ul]:my-2 [&_li]:my-1 [&_strong]:text-white [&_a]:text-primary [&_a]:hover:underline
            [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-white [&_h1]:mb-2
            [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-white [&_h2]:mb-2
            [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-white [&_h3]:mb-1">
            <ReactMarkdown>{content}</ReactMarkdown>
        </div>
    );

    // ZERO STATE: Hero View
    if (!hasInteracted) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-140px)] px-4 relative overflow-hidden">
                {/* Background Effects */}
                <div className="absolute top-[10%] left-[-10%] w-[800px] h-[800px] bg-primary/5 rounded-full blur-[120px] animate-pulse-slow pointer-events-none"></div>
                <div className="absolute top-[40%] right-[-10%] w-[600px] h-[600px] bg-indigo-900/10 rounded-full blur-[150px] pointer-events-none"></div>

                {/* Main Content */}
                <div className="w-full max-w-4xl flex flex-col items-center z-10">
                    
                    {/* Badge */}
                    <div className="mb-8 opacity-0 animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
                        <span className="px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-[10px] font-bold tracking-[0.2em] text-slate-400 uppercase backdrop-blur-md shadow-lg">
                            Powered by NesuClaw Agent
                        </span>
                    </div>

                    {/* Typography */}
                    <div className="text-center mb-8 opacity-0 animate-fade-in-up" style={{ animationDelay: '100ms', animationFillMode: 'forwards' }}>
                        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-0 leading-tight">
                            One Intent.
                        </h1>
                        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-slate-600 leading-tight">
                            Any Liquidity Outcome.
                        </h1>
                    </div>

                    {/* Subheading */}
                    <p className="text-lg md:text-xl text-slate-400 text-center max-w-2xl mb-12 opacity-0 animate-fade-in-up leading-relaxed" style={{ animationDelay: '200ms', animationFillMode: 'forwards' }}>
                        Execute complex DeFi strategies across chains with simple natural language. Powered by intent-centric solvers.
                    </p>

                    {/* Input Box */}
                    <div className="w-full max-w-2xl relative mb-12 opacity-0 animate-fade-in-up" style={{ animationDelay: '300ms', animationFillMode: 'forwards' }}>
                        <div className="relative group">
                            <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/30 to-indigo-500/30 rounded-2xl blur opacity-30 group-hover:opacity-60 transition duration-500"></div>
                            <div className="relative bg-[#0e1211] border border-white/10 rounded-2xl flex items-center p-2 shadow-2xl transition-all focus-within:border-primary/50">
                                <div className="pl-4 pr-3 text-primary animate-pulse-slow">
                                    <span className="material-symbols-outlined text-2xl">auto_awesome</span>
                                </div>
                                <input 
                                    type="text" 
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Bridge 0.1 ETH from Base Sepolia to Solana..."
                                    className="flex-1 bg-transparent border-none text-white placeholder-slate-500 text-lg h-14 focus:ring-0 outline-none font-medium"
                                    autoFocus
                                />
                                <div className="flex items-center gap-2 pr-2">
                                    <button className="p-3 text-slate-500 hover:text-white transition-colors hover:bg-white/5 rounded-xl">
                                        <span className="material-symbols-outlined">mic</span>
                                    </button>
                                    <button 
                                        onClick={handleSend}
                                        disabled={!inputValue.trim()}
                                        className="p-3 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-black rounded-xl transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-[0_0_15px_-3px_rgba(13,242,223,0.4)]"
                                    >
                                        <span className="material-symbols-outlined">arrow_forward</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Chips */}
                    <div className="flex flex-wrap justify-center gap-3 opacity-0 animate-fade-in-up" style={{ animationDelay: '400ms', animationFillMode: 'forwards' }}>
                        {[
                            'Bridge 0.1 ETH from Base Sepolia to Solana',
                            'Bridge 0.05 ETH from Fuji to Solana',
                            'How much SOL will I get for 0.1 ETH?',
                        ].map((text) => (
                            <button 
                                key={text}
                                onClick={() => handleChipClick(text)}
                                className="px-5 py-2.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-slate-400 hover:text-white text-sm font-medium transition-all hover:-translate-y-0.5"
                            >
                                {text}
                            </button>
                        ))}
                    </div>

                </div>
            </div>
        );
    }

    // ACTIVE STATE: Conversation View
    return (
        <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden relative">
            {/* Background Animations */}
            <div className="absolute top-[10%] left-[-10%] w-[800px] h-[800px] bg-primary/5 rounded-full blur-[120px] animate-pulse-slow pointer-events-none"></div>
            <div className="absolute top-[40%] right-[-10%] w-[600px] h-[600px] bg-indigo-900/10 rounded-full blur-[150px] pointer-events-none"></div>

            {/* Top Bar */}
            <div className="h-12 w-full flex items-center justify-between px-4 sm:px-8 border-b border-white/5 bg-background/80 backdrop-blur-sm z-20">
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/5 text-xs text-slate-400">
                    <div className={`w-2 h-2 rounded-full ${isLoading ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`}></div>
                    <span>{isLoading ? 'Processing...' : 'Agent Online'}</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleNewChat}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/5 hover:border-primary/30 hover:bg-white/10 transition-all text-xs text-slate-400 hover:text-white"
                    >
                        <span className="material-symbols-outlined text-sm">add</span>
                        New Chat
                    </button>
                    <button 
                        onClick={() => setShowSettings(true)}
                        className="p-2 rounded-full bg-white/5 border border-white/5 hover:border-primary/30 hover:bg-white/10 transition-all text-slate-400 hover:text-white"
                    >
                        <span className="material-symbols-outlined text-sm">tune</span>
                    </button>
                </div>
            </div>

            {/* Main Content Area - Scrollable Messages */}
            <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto py-6 px-4 sm:px-8 space-y-6 flex flex-col items-center no-scrollbar relative z-10"
            >
                <div className="w-full max-w-3xl space-y-6">
                    
                    {/* Render all messages */}
                    {messages.map((msg, idx) => {
                        // Attach monitor widget to the LAST assistant message after a tx submit
                        let monitorTx: { hash: string; chainId: number; userAddress: string } | null = null;
                        if (
                            msg.role === 'assistant' &&
                            submittedTxs.length > 0 &&
                            idx === messages.length - 1 &&
                            !isLoading
                        ) {
                            const latest = submittedTxs[submittedTxs.length - 1];
                            if (latest && address) {
                                monitorTx = { hash: latest.hash, chainId: latest.chainId, userAddress: address };
                            }
                        }
                        return (
                            <MessageBubble
                                key={idx}
                                message={msg}
                                renderContent={renderContent}
                                monitorTx={monitorTx}
                            />
                        );
                    })}

                    {/* Loading indicator */}
                    {isLoading && (
                        <div className="flex gap-3 opacity-0 animate-fade-in-up" style={{ animationDelay: '100ms', animationFillMode: 'forwards' }}>
                            <div className="flex-shrink-0 mt-1 hidden sm:block">
                                <div className="size-8 rounded-full bg-[#0d1614] border border-white/8 flex items-center justify-center">
                                    <div className="size-4 border-2 border-primary/60 border-t-transparent rounded-full animate-spin"></div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl rounded-tl-none bg-[#0d1614] border border-white/6">
                                <div className="flex gap-1">
                                    <div className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                    <div className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                    <div className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                </div>
                                <p className="text-slate-500 text-[12px]">Thinking...</p>
                            </div>
                        </div>
                    )}

                    {/* Error display */}
                    {error && (
                        <div className="flex gap-4 opacity-0 animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
                            <div className="flex-shrink-0 mt-2 hidden sm:block">
                                <div className="size-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                                    <span className="material-symbols-outlined text-red-400 text-xl">error</span>
                                </div>
                            </div>
                            <div className="flex-1 max-w-2xl">
                                <div className="p-4 rounded-2xl rounded-tl-none bg-red-500/5 border border-red-500/20 text-red-300 text-sm leading-relaxed">
                                    <p className="font-medium mb-1">Failed to process intent</p>
                                    <p className="text-red-400/80 text-xs">{error}</p>
                                    <button 
                                        onClick={() => {
                                            const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
                                            if (lastUserMsg) sendMessage(lastUserMsg.content);
                                        }}
                                        className="mt-3 px-4 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-300 text-xs font-medium transition-colors"
                                    >
                                        Retry
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                </div>
            </div>

            {/* TX CONFIRM CARD */}
            {pendingTx && !isLoading && (
                <div className="w-full px-4 sm:px-8 relative z-30">
                    <div className="max-w-3xl mx-auto">
                        <div className="relative rounded-2xl overflow-hidden border border-primary/30 bg-[#070e0c] shadow-[0_0_40px_-8px_rgba(13,242,223,0.2)]">
                            {/* top glow line */}
                            <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/70 to-transparent" />

                            <div className="flex flex-col">
                                {/* Header */}
                                <div className="px-5 pt-4 pb-3 flex items-center gap-2 border-b border-white/5">
                                    <div className="size-6 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                                        <span className="material-symbols-outlined text-primary" style={{fontSize:'14px'}}>receipt_long</span>
                                    </div>
                                    <span className="text-[11px] font-bold text-primary uppercase tracking-[0.12em]">Review Transaction</span>
                                    <span className="ml-auto text-[10px] font-mono text-slate-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                                        {pendingTx.chainId === 84532 ? 'Base Sepolia' : pendingTx.chainId === 43113 ? 'Avalanche Fuji' : `Chain ${pendingTx.chainId}`}
                                    </span>
                                </div>

                                <div className="flex items-stretch">
                                    {/* Left: details */}
                                    <div className="flex-1 px-5 py-4 flex flex-col gap-2.5">

                                        {pendingTx.decoded ? (() => {
                                            const d = pendingTx.decoded;
                                            return (
                                                <>
                                                    {/* Amount row — big */}
                                                    <div className="flex items-baseline gap-2 mb-1">
                                                        <span className="text-[22px] font-bold text-white tabular-nums">{d.amountEth}</span>
                                                        <span className="text-[13px] text-slate-400 font-medium">ETH</span>
                                                        <span className="material-symbols-outlined text-slate-600 text-[16px]">arrow_forward</span>
                                                        <span className="text-[13px] font-semibold text-primary">~SOL</span>
                                                        <span className="text-[11px] text-slate-500">on {d.destinationLabel}</span>
                                                    </div>

                                                    {/* Recipient */}
                                                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/3 border border-white/6">
                                                        <div className="flex items-center gap-2">
                                                            <span className="material-symbols-outlined text-slate-500 text-[14px]">account_balance_wallet</span>
                                                            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Recipient</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-[12px] font-mono text-slate-200">{d.recipientShort}</span>
                                                            <button
                                                                onClick={() => navigator.clipboard.writeText(d.recipient)}
                                                                className="text-slate-600 hover:text-primary transition-colors"
                                                                title={d.recipient}
                                                            >
                                                                <span className="material-symbols-outlined text-[12px]">content_copy</span>
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Auction params */}
                                                    <div className="grid grid-cols-3 gap-2">
                                                        <div className="flex flex-col px-2.5 py-2 rounded-lg bg-white/3 border border-white/5">
                                                            <span className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Start price</span>
                                                            <span className="text-[11px] font-mono text-slate-300">{parseFloat(d.startPriceEth).toFixed(4)} ETH</span>
                                                        </div>
                                                        <div className="flex flex-col px-2.5 py-2 rounded-lg bg-white/3 border border-white/5">
                                                            <span className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Floor price</span>
                                                            <span className="text-[11px] font-mono text-slate-300">{parseFloat(d.floorPriceEth).toFixed(4)} ETH</span>
                                                        </div>
                                                        <div className="flex flex-col px-2.5 py-2 rounded-lg bg-white/3 border border-white/5">
                                                            <span className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Auction</span>
                                                            <span className="text-[11px] font-mono text-slate-300">{d.durationMin} min</span>
                                                        </div>
                                                    </div>

                                                    {/* Contract */}
                                                    <div className="flex items-center justify-between text-[10px] text-slate-600 pt-0.5">
                                                        <span>IntentBridge contract</span>
                                                        <span className="font-mono">{pendingTx.to.slice(0,8)}…{pendingTx.to.slice(-6)}</span>
                                                    </div>
                                                </>
                                            );
                                        })() : (
                                            // Fallback: raw fields jika decode gagal
                                            <div className="flex flex-col gap-1.5">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[11px] text-slate-500 w-12 shrink-0">To</span>
                                                    <span className="text-[12px] font-mono text-slate-300">{pendingTx.to.slice(0,10)}…{pendingTx.to.slice(-8)}</span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[11px] text-slate-500 w-12 shrink-0">Value</span>
                                                    <span className="text-[15px] font-bold text-white">{pendingTx.value} <span className="text-[11px] text-slate-400 font-normal">ETH</span></span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Divider */}
                                    <div className="w-px bg-white/5 self-stretch" />

                                    {/* Right: actions */}
                                    <div className="flex flex-col justify-center gap-2 px-4 py-4 shrink-0 w-[148px]">
                                        {txStatus ? (
                                            <div className="flex flex-col items-center gap-2 py-2">
                                                <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                                <span className="text-[11px] text-primary/80 text-center leading-tight">{txStatus}</span>
                                            </div>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => handleSendTx(pendingTx)}
                                                    className="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-primary text-black text-[12px] font-bold hover:bg-primary/90 active:scale-95 transition-all shadow-[0_0_20px_-4px_rgba(13,242,223,0.6)]"
                                                >
                                                    <span className="material-symbols-outlined text-[14px]">account_balance_wallet</span>
                                                    Sign & Send
                                                </button>
                                                <button
                                                    onClick={() => setPendingTx(undefined)}
                                                    className="w-full flex items-center justify-center gap-1 py-2 px-3 rounded-xl bg-white/4 border border-white/8 text-slate-500 text-[11px] hover:bg-white/8 hover:text-slate-300 transition-all"
                                                >
                                                    <span className="material-symbols-outlined text-[13px]">close</span>
                                                    Dismiss
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Input Area */}
            <div className="w-full px-4 sm:px-8 pb-8 pt-4 relative z-20 bg-gradient-to-t from-background via-background to-transparent">
                <div className="max-w-3xl mx-auto">
                    {/* Quick suggestion chips */}
                    {messages.length <= 2 && (
                        <div className="flex flex-wrap gap-2 justify-center mb-4">
                            {[
                                'Bridge 0.1 ETH from Base Sepolia to Solana',
                                'Bridge 0.05 ETH from Fuji to Solana',
                                'How much SOL will I get for 0.1 ETH?',
                            ].map((text) => (
                                <button
                                    key={text}
                                    onClick={() => handleChipClick(text)}
                                    className="px-4 py-2 rounded-full bg-surface-light border border-white/10 hover:border-primary/50 hover:bg-white/5 hover:text-primary transition-all text-xs sm:text-sm text-slate-400 font-medium"
                                >
                                    {text}
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="relative group">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/20 to-indigo-500/20 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
                        <div className="relative glass-panel rounded-2xl p-2 flex items-center gap-2 bg-background/60">
                            <button 
                                onClick={handleNewChat}
                                className="p-3 text-slate-400 hover:text-primary transition-colors rounded-xl hover:bg-white/5"
                                title="New chat"
                            >
                                <span className="material-symbols-outlined">add_circle</span>
                            </button>
                            <input 
                                className="w-full bg-transparent border-none focus:ring-0 text-white placeholder-slate-500 text-lg font-light h-12 outline-none" 
                                placeholder={isLoading ? "Agent is thinking..." : "Type a follow-up..."} 
                                type="text"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                disabled={isLoading}
                            />
                            <button 
                                className="p-3 bg-white/10 hover:bg-primary hover:text-black text-white transition-all rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed" 
                                onClick={handleSend}
                                disabled={!inputValue.trim() || isLoading}
                            >
                                <span className="material-symbols-outlined">
                                    {isLoading ? 'hourglass_top' : 'send'}
                                </span>
                            </button>
                        </div>
                    </div>
                    <div className="mt-2 text-center">
                        <p className="text-[10px] text-slate-600">Powered by NesuClaw Agent. Verify critical transactions before executing.</p>
                    </div>
                </div>
            </div>

            {/* Settings Modal */}
            {showSettings && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSettings(false)}></div>
                    <div className="relative bg-[#1a1f1e] border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-fade-in-up">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-white">Intent Parameters</h3>
                            <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        
                        <div className="space-y-6">
                            <div>
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 block">Slippage Tolerance</label>
                                <div className="flex gap-2">
                                    <button className="flex-1 py-2 rounded-lg bg-primary text-black text-sm font-bold">Auto</button>
                                    <button className="flex-1 py-2 rounded-lg bg-white/5 border border-white/5 text-slate-300 text-sm font-medium hover:bg-white/10">0.5%</button>
                                    <button className="flex-1 py-2 rounded-lg bg-white/5 border border-white/5 text-slate-300 text-sm font-medium hover:bg-white/10">1.0%</button>
                                </div>
                            </div>
                            
                            <div>
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 block">Execution Deadline</label>
                                <div className="flex items-center gap-3 bg-white/5 border border-white/5 rounded-lg px-4 py-3">
                                    <span className="material-symbols-outlined text-slate-400">timer</span>
                                    <span className="text-white font-medium">10 minutes</span>
                                    <span className="material-symbols-outlined text-slate-500 text-sm ml-auto">expand_more</span>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 block">Agent Model</label>
                                <div className="flex items-center gap-3 bg-white/5 border border-white/5 rounded-lg px-4 py-3">
                                    <span className="material-symbols-outlined text-slate-400">smart_toy</span>
                                    <span className="text-white font-medium text-sm">{import.meta.env.VITE_AGENT_MODEL ?? 'kimi-for-coding'}</span>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 block">Solver Preference</label>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-emerald-400 text-sm">check_circle</span>
                                            <span className="text-sm text-white">Best Return</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between p-3 rounded-lg border border-white/5 opacity-50">
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-slate-500 text-sm">radio_button_unchecked</span>
                                            <span className="text-sm text-slate-300">Fastest Route</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <button 
                            onClick={() => setShowSettings(false)}
                            className="w-full mt-6 bg-surface-light border border-white/10 hover:bg-white/5 text-white font-bold py-3 rounded-xl transition-colors"
                        >
                            Save Settings
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// ---------- Message Bubble Component ----------

interface MessageBubbleProps {
    message: ChatMessage;
    renderContent: (content: string) => React.ReactNode;
    monitorTx?: { hash: string; chainId: number; userAddress: string } | null;
}

// Detect if a user message is the post-tx submit message
function extractTxHashFromSubmitMsg(content: string): { hash: string; explorerBase: string } | null {
    const m = content.match(/Hash:\s*(0x[0-9a-fA-F]{64})/);
    const e = content.match(/Explorer:\s*(https?:\/\/\S+)/);
    if (m && e) return { hash: m[1]!, explorerBase: e[1]!.replace(m[1]!, '') };
    return null;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, renderContent, monitorTx }) => {
    if (message.role === 'user') {
        // If this is the tx-submitted message, show a compact chip instead
        const txInfo = extractTxHashFromSubmitMsg(message.content);
        if (txInfo) {
            return (
                <div className="flex flex-col items-end gap-2 opacity-0 animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-500/8 border border-indigo-500/15 text-xs font-mono text-slate-400">
                        <span className="material-symbols-outlined text-indigo-400 text-[14px]">send</span>
                        <span>Tx submitted · {txInfo.hash.slice(0, 10)}…{txInfo.hash.slice(-6)}</span>
                        <a href={`${txInfo.explorerBase}${txInfo.hash}`} target="_blank" rel="noreferrer"
                           className="text-slate-600 hover:text-primary transition-colors">
                            <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                        </a>
                    </div>
                </div>
            );
        }

        return (
            <div className="flex flex-col items-end gap-3 opacity-0 animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
                <div className="max-w-2xl text-right">
                    <div className="inline-block p-4 rounded-2xl rounded-tr-none bg-indigo-500/10 border border-indigo-500/20 text-white text-sm leading-relaxed text-left shadow-lg">
                        <p>{message.content}</p>
                    </div>
                    <div className="flex items-center justify-end gap-1.5 text-slate-500 text-[11px] mt-1.5">
                        <span className="material-symbols-outlined text-[13px]">account_circle</span>
                        You
                    </div>
                </div>
            </div>
        );
    }

    // Assistant message
    return (
        <div className="flex gap-3 opacity-0 animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
            <div className="flex-shrink-0 mt-1 hidden sm:block">
                <div className="size-8 rounded-full bg-gradient-to-br from-primary/80 to-teal-800 flex items-center justify-center shadow-[0_0_16px_rgba(13,242,223,0.25)] ring-1 ring-primary/20">
                    <span className="material-symbols-outlined text-white text-[16px]">smart_toy</span>
                </div>
            </div>
            <div className="flex-1 max-w-2xl">
                <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[12px] font-semibold text-white">Nesu</span>
                    <span className="text-[10px] text-slate-600">just now</span>
                </div>
                <div className="px-4 py-3.5 rounded-2xl rounded-tl-none bg-[#0d1614] border border-white/6 text-slate-300 text-sm leading-relaxed shadow-lg">
                    {renderContent(message.content)}
                    {/* Inline order monitor after post-tx agent response */}
                    {monitorTx && (
                        <OrderMonitor
                            txHash={monitorTx.hash}
                            chainId={monitorTx.chainId}
                            userAddress={monitorTx.userAddress}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default IntentPage;
