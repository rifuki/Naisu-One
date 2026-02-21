import React, { useState, useRef, useEffect } from 'react';
import { useOpenClaw, ChatMessage } from '../hooks/useOpenClaw';

const IntentPage: React.FC = () => {
    const [inputValue, setInputValue] = useState("");
    const [hasInteracted, setHasInteracted] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const {
        messages,
        isLoading,
        error,
        streamingContent,
        sendMessage,
        reset,
    } = useOpenClaw();

    // Auto-scroll to bottom on new messages or streaming
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, streamingContent]);

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

    // Simple markdown-like renderer for assistant messages
    const renderContent = (content: string) => {
        // Split by code blocks first
        const parts = content.split(/(```[\s\S]*?```)/g);
        return parts.map((part, i) => {
            if (part.startsWith('```') && part.endsWith('```')) {
                const inner = part.slice(3, -3);
                const newlineIdx = inner.indexOf('\n');
                const code = newlineIdx > -1 ? inner.slice(newlineIdx + 1) : inner;
                return (
                    <pre key={i} className="bg-black/40 border border-white/10 rounded-lg p-4 overflow-x-auto text-sm my-3 font-mono text-slate-300">
                        <code>{code}</code>
                    </pre>
                );
            }
            // Process inline markdown
            return (
                <span key={i}>
                    {part.split('\n').map((line, li) => {
                        // Bold text
                        const formatted = line.replace(
                            /\*\*(.*?)\*\*/g,
                            '<strong class="text-white font-semibold">$1</strong>'
                        ).replace(
                            /`([^`]+)`/g,
                            '<code class="bg-white/10 px-1.5 py-0.5 rounded text-primary text-sm font-mono">$1</code>'
                        );

                        // Heading lines
                        if (line.startsWith('### ')) {
                            return (
                                <h4 key={li} className="text-white font-bold text-base mt-4 mb-2"
                                    dangerouslySetInnerHTML={{ __html: formatted.slice(4) }}
                                />
                            );
                        }
                        if (line.startsWith('## ')) {
                            return (
                                <h3 key={li} className="text-white font-bold text-lg mt-4 mb-2"
                                    dangerouslySetInnerHTML={{ __html: formatted.slice(3) }}
                                />
                            );
                        }
                        // Bullet points
                        if (line.startsWith('- ') || line.startsWith('* ')) {
                            return (
                                <div key={li} className="flex gap-2 ml-2 my-0.5">
                                    <span className="text-primary mt-1 text-xs">&#9679;</span>
                                    <span dangerouslySetInnerHTML={{ __html: formatted.slice(2) }} />
                                </div>
                            );
                        }
                        // Numbered list
                        const numMatch = line.match(/^(\d+)\.\s/);
                        if (numMatch) {
                            return (
                                <div key={li} className="flex gap-2 ml-2 my-0.5">
                                    <span className="text-primary font-mono text-sm min-w-[1.2em]">{numMatch[1]}.</span>
                                    <span dangerouslySetInnerHTML={{ __html: formatted.slice(numMatch[0].length) }} />
                                </div>
                            );
                        }

                        if (!line.trim()) return <br key={li} />;

                        return (
                            <span key={li}>
                                <span dangerouslySetInnerHTML={{ __html: formatted }} />
                                {li < part.split('\n').length - 1 && <br />}
                            </span>
                        );
                    })}
                </span>
            );
        });
    };

    // Get only user messages for display count
    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');

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
                                    placeholder="Swap 0.1 USDC from ETH Base, stake SUI on Scallop..."
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
                            'Swap 0.1 USDC from ETH Base',
                            'Bridge 100 USDC to Sui',
                            'Yield farm stablecoins on Optimism',
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
                className="flex-1 overflow-y-auto py-8 px-4 sm:px-8 space-y-8 flex flex-col items-center no-scrollbar relative z-10"
            >
                <div className="w-full max-w-3xl space-y-8">
                    
                    {/* Render all messages */}
                    {messages.map((msg, idx) => (
                        <MessageBubble 
                            key={idx} 
                            message={msg} 
                            renderContent={renderContent}
                        />
                    ))}

                    {/* Streaming response */}
                    {isLoading && streamingContent && (
                        <div className="flex gap-4 opacity-0 animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
                            <div className="flex-shrink-0 mt-2 hidden sm:block">
                                <div className="size-10 rounded-full bg-gradient-to-br from-primary to-teal-800 flex items-center justify-center shadow-[0_0_20px_rgba(13,242,223,0.3)] ring-2 ring-primary/20">
                                    <span className="material-symbols-outlined text-white text-xl">smart_toy</span>
                                </div>
                            </div>
                            <div className="flex-1 max-w-2xl">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-sm font-semibold text-white">NesuClaw Agent</span>
                                    <span className="text-xs text-slate-500">typing...</span>
                                </div>
                                <div className="p-5 rounded-2xl rounded-tl-none bg-surface-light border border-white/5 text-slate-300 text-base leading-relaxed shadow-lg">
                                    {renderContent(streamingContent)}
                                    <span className="inline-block w-2 h-5 bg-primary/80 ml-1 animate-pulse rounded-sm"></span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Loading indicator when no streaming content yet */}
                    {isLoading && !streamingContent && (
                        <div className="flex gap-4 opacity-0 animate-fade-in-up" style={{ animationDelay: '200ms', animationFillMode: 'forwards' }}>
                            <div className="flex-shrink-0 mt-2 hidden sm:block">
                                <div className="size-10 rounded-full bg-surface-light border border-white/10 flex items-center justify-center">
                                    <div className="size-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                                </div>
                            </div>
                            <div className="flex-1 pt-3">
                                <div className="flex items-center gap-3">
                                    <div className="flex gap-1.5">
                                        <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                        <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                        <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                    </div>
                                    <p className="text-slate-400 text-base">Analyzing your intent...</p>
                                </div>
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

            {/* Input Area */}
            <div className="w-full px-4 sm:px-8 pb-8 pt-4 relative z-20 bg-gradient-to-t from-background via-background to-transparent">
                <div className="max-w-3xl mx-auto">
                    {/* Quick suggestion chips */}
                    {messages.length <= 2 && (
                        <div className="flex flex-wrap gap-2 justify-center mb-4">
                            {[
                                'Swap 0.1 USDC from ETH Base',
                                'Bridge 100 USDC to Sui',
                                'Check SUI staking yields',
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
                                    <span className="text-white font-medium text-sm">openai-codex/gpt-5.2</span>
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
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, renderContent }) => {
    if (message.role === 'user') {
        return (
            <div className="flex flex-col items-end gap-3 opacity-0 animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
                <div className="max-w-2xl text-right">
                    <div className="inline-block p-4 rounded-2xl rounded-tr-none bg-indigo-500/10 border border-indigo-500/20 text-white text-base leading-relaxed text-left shadow-lg">
                        <p>{message.content}</p>
                    </div>
                    <div className="flex items-center justify-end gap-2 text-slate-500 text-xs mt-2">
                        <span className="material-symbols-outlined text-[14px]">account_circle</span>
                        You
                    </div>
                </div>
            </div>
        );
    }

    // Assistant message
    return (
        <div className="flex gap-4 opacity-0 animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
            <div className="flex-shrink-0 mt-2 hidden sm:block">
                <div className="size-10 rounded-full bg-gradient-to-br from-primary to-teal-800 flex items-center justify-center shadow-[0_0_20px_rgba(13,242,223,0.3)] ring-2 ring-primary/20">
                    <span className="material-symbols-outlined text-white text-xl">smart_toy</span>
                </div>
            </div>
            <div className="flex-1 max-w-2xl">
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-white">NesuClaw Agent</span>
                    <span className="text-xs text-slate-500">just now</span>
                </div>
                <div className="p-5 rounded-2xl rounded-tl-none bg-surface-light border border-white/5 text-slate-300 text-base leading-relaxed shadow-lg">
                    {renderContent(message.content)}
                </div>
            </div>
        </div>
    );
};

export default IntentPage;
