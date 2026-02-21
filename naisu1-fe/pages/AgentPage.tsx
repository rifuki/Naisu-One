import React from 'react';

const AgentPage: React.FC = () => {
    return (
        <div className="flex flex-col h-[calc(100vh-64px)] relative overflow-hidden bg-background">
            <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px] pointer-events-none -z-10"></div>
            <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none -z-10"></div>

            {/* Status Bar */}
            <div className="h-12 w-full flex items-center justify-center border-b border-white/5 bg-background/80 backdrop-blur-sm z-20">
                 <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/5 text-xs text-slate-400">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                    <span>Agent Online</span>
                </div>
            </div>

            {/* Chat Area */}
             <div className="flex-1 overflow-y-auto py-8 px-4 sm:px-8 space-y-8 flex flex-col items-center">
                 <div className="w-full max-w-3xl space-y-8">
                     
                     {/* Bot Message */}
                    <div className="flex gap-4">
                        <div className="flex-shrink-0 size-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mt-1">
                            <span className="material-symbols-outlined text-xl">smart_toy</span>
                        </div>
                        <div className="space-y-2">
                             <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-white">Naisu Agent</span>
                                <span className="text-xs text-slate-500">Just now</span>
                            </div>
                            <div className="p-4 rounded-2xl rounded-tl-none bg-surface-light border border-white/5 text-slate-300 text-base leading-relaxed shadow-lg max-w-lg">
                                <p>Hello! I'm your autonomous DeFi assistant on Sui. I can help you bridge assets, find yield, or execute complex swaps efficiently.</p>
                                <p className="mt-2">What would you like to do today?</p>
                            </div>
                        </div>
                    </div>

                    {/* User Message */}
                    <div className="flex flex-row-reverse gap-4">
                         <div className="flex-shrink-0 size-10 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 mt-1">
                             <span className="material-symbols-outlined text-xl">person</span>
                        </div>
                         <div className="space-y-2 text-right">
                             <div className="flex items-center justify-end gap-2">
                                <span className="text-xs text-slate-500">2 mins ago</span>
                                <span className="text-sm font-semibold text-white">You</span>
                            </div>
                             <div className="p-4 rounded-2xl rounded-tr-none bg-indigo-500/10 border border-indigo-500/20 text-white text-base leading-relaxed inline-block text-left shadow-lg">
                                <p>Check my current balance across all connected wallets.</p>
                            </div>
                        </div>
                    </div>

                    {/* Bot Response with Table */}
                     <div className="flex gap-4">
                        <div className="flex-shrink-0 size-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mt-1">
                            <span className="material-symbols-outlined text-xl">smart_toy</span>
                        </div>
                         <div className="space-y-2 w-full max-w-lg">
                             <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-white">Naisu Agent</span>
                                <span className="text-xs text-slate-500">1 min ago</span>
                            </div>
                            <div className="p-4 rounded-2xl rounded-tl-none bg-surface-light border border-white/5 text-slate-300 text-base leading-relaxed shadow-lg w-full">
                                <p className="mb-3">I found the following assets across your connected wallets:</p>
                                <div className="bg-black/20 rounded-lg border border-white/5 overflow-hidden">
                                     <div className="grid grid-cols-3 gap-4 p-3 border-b border-white/5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                                        <span>Asset</span>
                                        <span className="text-right">Balance</span>
                                        <span className="text-right">Value</span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4 p-3 hover:bg-white/5 transition-colors items-center border-b border-white/5 last:border-0">
                                        <div className="flex items-center gap-2">
                                            <div className="size-6 rounded-full bg-blue-500/20 flex items-center justify-center text-xs text-white">S</div>
                                            <span className="font-medium text-white">SUI</span>
                                        </div>
                                        <div className="text-right text-slate-300">1,450.23</div>
                                        <div className="text-right text-slate-300">$2,340.12</div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4 p-3 hover:bg-white/5 transition-colors items-center">
                                        <div className="flex items-center gap-2">
                                            <div className="size-6 rounded-full bg-green-500/20 flex items-center justify-center text-xs text-white">$</div>
                                            <span className="font-medium text-white">USDC</span>
                                        </div>
                                        <div className="text-right text-slate-300">540.00</div>
                                        <div className="text-right text-slate-300">$540.00</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                 </div>
             </div>

            {/* Input Footer */}
            <div className="mt-auto pb-8 pt-4 px-4 bg-gradient-to-t from-background via-background to-transparent z-20">
                <div className="max-w-3xl mx-auto w-full">
                     <div className="flex flex-wrap gap-3 justify-center mb-6">
                        <button className="px-4 py-2 rounded-full bg-surface-light border border-white/10 hover:border-primary/50 hover:bg-white/5 hover:text-primary transition-all text-xs sm:text-sm text-slate-400 font-medium cursor-pointer">
                            Bridge 1000 USDC to Sui
                        </button>
                        <button className="px-4 py-2 rounded-full bg-surface-light border border-white/10 hover:border-primary/50 hover:bg-white/5 hover:text-primary transition-all text-xs sm:text-sm text-slate-400 font-medium cursor-pointer">
                            Farm highest stable yield
                        </button>
                         <button className="px-4 py-2 rounded-full bg-surface-light border border-white/10 hover:border-primary/50 hover:bg-white/5 hover:text-primary transition-all text-xs sm:text-sm text-slate-400 font-medium cursor-pointer">
                            Swap SUI for CETUS
                        </button>
                    </div>

                    <div className="relative group">
                         <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/20 to-indigo-500/20 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
                         <div className="relative flex items-center bg-surface-light border border-white/10 rounded-2xl focus-within:border-primary/50 focus-within:shadow-[0_0_20px_-5px_rgba(13,242,223,0.3)] transition-all duration-300">
                             <input 
                                className="w-full bg-transparent border-0 text-white placeholder-slate-500 focus:ring-0 py-4 pl-4 pr-12 h-14" 
                                placeholder="Ask Naisu to execute an intent..."
                            />
                            <div className="absolute right-2 flex items-center gap-1">
                                <button className="p-2 text-slate-500 hover:text-white transition-colors rounded-lg hover:bg-white/5">
                                    <span className="material-symbols-outlined text-xl">attach_file</span>
                                </button>
                                <button className="p-2 bg-primary/10 text-primary hover:bg-primary hover:text-black transition-all rounded-lg flex items-center justify-center shadow-lg shadow-primary/10">
                                    <span className="material-symbols-outlined text-xl">arrow_upward</span>
                                </button>
                            </div>
                        </div>
                    </div>
                     <div className="mt-2 text-center">
                        <p className="text-[10px] text-slate-600">Naisu1 Agent can make mistakes. Verify critical transactions.</p>
                    </div>
                </div>
            </div>

        </div>
    );
};

export default AgentPage;