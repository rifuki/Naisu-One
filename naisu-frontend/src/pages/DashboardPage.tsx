import React, { useState, useEffect } from 'react';

const NETWORKS = [
  { id: 'eth', name: 'Ethereum', icon: 'token', color: 'bg-slate-200 text-black', balance: '24.50 ETH' },
  { id: 'sui', name: 'Sui', icon: 'water_drop', color: 'bg-blue-600 text-white', balance: '1,420.50 SUI' },
  { id: 'arc', name: 'Arc', icon: 'architecture', color: 'bg-amber-600 text-white', balance: '540.00 ARC' },
  { id: 'arb', name: 'Arbitrum', icon: 'layers', color: 'bg-blue-500 text-white', balance: '4.20 ETH' },
];

const DashboardPage: React.FC = () => {
  const [fromNetwork, setFromNetwork] = useState(NETWORKS[0]);
  const [toNetwork, setToNetwork] = useState(NETWORKS[1]);
  const [amount, setAmount] = useState<string>('');
  const [calculatedAmount, setCalculatedAmount] = useState<string>('');
  const [showNetworkSelector, setShowNetworkSelector] = useState<'from' | 'to' | null>(null);
  
  // Modal States
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [processStatus, setProcessStatus] = useState<'idle' | 'processing' | 'success'>('idle');

  // Simple mock calculation logic
  useEffect(() => {
      if(!amount) {
          setCalculatedAmount('');
          return;
      }
      const val = parseFloat(amount);
      if(isNaN(val)) return;
      
      // Mock exchange rate variance
      const rate = fromNetwork.id === 'eth' ? 2800 : (fromNetwork.id === 'sui' ? 1.5 : 1);
      const toRate = toNetwork.id === 'eth' ? 2800 : (toNetwork.id === 'sui' ? 1.5 : 1);
      
      const converted = (val * rate) / toRate;
      // Subtract "fee"
      const afterFee = converted * 0.995; 
      
      setCalculatedAmount(afterFee.toFixed(4));
  }, [amount, fromNetwork, toNetwork]);

  const handleSwapNetworks = () => {
    setFromNetwork(toNetwork);
    setToNetwork(fromNetwork);
    // Swap amounts logically for user convenience
    setAmount(calculatedAmount);
  };

  const handleNetworkSelect = (network: typeof NETWORKS[0]) => {
      if (showNetworkSelector === 'from') {
          if (network.id === toNetwork.id) {
              setToNetwork(fromNetwork);
          }
          setFromNetwork(network);
      } else {
           if (network.id === fromNetwork.id) {
              setFromNetwork(toNetwork);
          }
          setToNetwork(network);
      }
      setShowNetworkSelector(null);
  };

  const handleReview = () => {
      if (!amount || parseFloat(amount) <= 0) return;
      setIsReviewOpen(true);
      setProcessStatus('idle');
  };

  const handleConfirm = () => {
      setProcessStatus('processing');
      setTimeout(() => {
          setProcessStatus('success');
          setTimeout(() => {
              setIsReviewOpen(false);
              setProcessStatus('idle');
              setAmount('');
          }, 2000);
      }, 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 relative z-10">
      <div className="flex flex-col items-center mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold uppercase tracking-wider mb-4">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          Live on Mainnet
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-center text-white mb-2">Cross-Chain Hub</h1>
        <p className="text-slate-400 text-center max-w-xl">Seamlessly bridge and swap assets across Sui, Arc, and Ethereum with institutional-grade security.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
        {/* Left Column: Bridge Card */}
        <div className="lg:col-span-7 xl:col-span-6 xl:col-start-2">
          <div className="glass-panel rounded-2xl shadow-2xl overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>
            <div className="p-6 md:p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold text-white">Bridge & Swap</h3>
                <button className="text-slate-400 hover:text-white transition-colors">
                  <span className="material-symbols-outlined">settings</span>
                </button>
              </div>

              {/* From Input */}
              <div className="bg-black/20 rounded-xl p-4 border border-white/5 mb-2 hover:border-white/10 transition-colors relative z-20">
                <div className="flex justify-between mb-2">
                  <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">From Network</span>
                  <span className="text-xs text-slate-400">Balance: <span className="text-white">{fromNetwork.balance}</span></span>
                </div>
                <div className="flex gap-4 items-center">
                  <div className="relative">
                      <button 
                        onClick={() => setShowNetworkSelector(showNetworkSelector === 'from' ? null : 'from')}
                        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 transition-colors rounded-lg px-3 py-2 min-w-[140px] border border-white/5"
                      >
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${fromNetwork.color}`}>
                          <span className="material-symbols-outlined text-sm">{fromNetwork.icon}</span>
                        </div>
                        <span className="text-sm font-bold text-white">{fromNetwork.name}</span>
                        <span className="material-symbols-outlined text-slate-400 text-sm ml-auto">expand_more</span>
                      </button>
                      
                      {/* Dropdown */}
                      {showNetworkSelector === 'from' && (
                          <div className="absolute top-full left-0 mt-2 w-48 bg-[#1a1f1e] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 animate-fade-in-up">
                              {NETWORKS.map(net => (
                                  <button 
                                    key={net.id}
                                    onClick={() => handleNetworkSelect(net)}
                                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
                                  >
                                      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${net.color}`}>
                                          <span className="material-symbols-outlined text-xs">{net.icon}</span>
                                      </div>
                                      <span className={`text-sm font-medium ${net.id === fromNetwork.id ? 'text-primary' : 'text-slate-300'}`}>{net.name}</span>
                                  </button>
                              ))}
                          </div>
                      )}
                  </div>

                  <div className="flex-1 text-right">
                    <input 
                        className="w-full bg-transparent border-none text-right text-3xl font-medium text-white placeholder-slate-600 focus:ring-0 p-0" 
                        placeholder="0.0" 
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-between mt-3 items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400">
                      <span className="material-symbols-outlined text-[12px]">currency_bitcoin</span>
                    </div>
                    <span className="text-sm text-slate-300">USDC</span>
                  </div>
                  <span className="text-xs text-slate-500">≈ ${(parseFloat(amount || '0') * 2800).toFixed(2)}</span>
                </div>
              </div>

              {/* Arrow Switch */}
              <div className="relative h-8 flex items-center justify-center my-[-12px] z-10">
                <button 
                    onClick={handleSwapNetworks}
                    className="bg-surface border border-white/10 rounded-lg p-2 hover:border-primary/50 hover:text-primary text-slate-400 transition-all shadow-lg hover:rotate-180 duration-300"
                >
                  <span className="material-symbols-outlined text-lg">arrow_downward</span>
                </button>
              </div>

              {/* To Input */}
              <div className="bg-black/20 rounded-xl p-4 border border-white/5 mt-2 hover:border-white/10 transition-colors relative z-10">
                <div className="flex justify-between mb-2">
                  <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">To Network</span>
                  <span className="text-xs text-slate-400">Balance: <span className="text-white">{toNetwork.balance}</span></span>
                </div>
                <div className="flex gap-4 items-center">
                  <div className="relative">
                      <button 
                         onClick={() => setShowNetworkSelector(showNetworkSelector === 'to' ? null : 'to')}
                        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 transition-colors rounded-lg px-3 py-2 min-w-[140px] border border-white/5"
                      >
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${toNetwork.color}`}>
                            <span className="material-symbols-outlined text-sm">{toNetwork.icon}</span>
                        </div>
                        <span className="text-sm font-bold text-white">{toNetwork.name}</span>
                        <span className="material-symbols-outlined text-slate-400 text-sm ml-auto">expand_more</span>
                      </button>

                       {/* Dropdown */}
                       {showNetworkSelector === 'to' && (
                          <div className="absolute top-full left-0 mt-2 w-48 bg-[#1a1f1e] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 animate-fade-in-up">
                              {NETWORKS.map(net => (
                                  <button 
                                    key={net.id}
                                    onClick={() => handleNetworkSelect(net)}
                                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
                                  >
                                      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${net.color}`}>
                                          <span className="material-symbols-outlined text-xs">{net.icon}</span>
                                      </div>
                                      <span className={`text-sm font-medium ${net.id === toNetwork.id ? 'text-primary' : 'text-slate-300'}`}>{net.name}</span>
                                  </button>
                              ))}
                          </div>
                      )}
                  </div>
                  <div className="flex-1 text-right">
                    <input 
                        className="w-full bg-transparent border-none text-right text-3xl font-medium text-slate-500 placeholder-slate-600 focus:ring-0 p-0 cursor-not-allowed" 
                        disabled 
                        placeholder="0.0" 
                        type="number" 
                        value={calculatedAmount}
                    />
                  </div>
                </div>
                 <div className="flex justify-between mt-3 items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400">
                      <span className="material-symbols-outlined text-[12px]">currency_bitcoin</span>
                    </div>
                    <span className="text-sm text-slate-300">USDC ({toNetwork.name})</span>
                  </div>
                  <span className="text-xs text-slate-500">≈ ${(parseFloat(amount || '0') * 2800 * 0.995).toFixed(2)}</span>
                </div>
              </div>

              {/* Info */}
              <div className="mt-6 p-4 rounded-lg bg-white/[0.02] border border-white/5 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400 flex items-center gap-1">Rate <span className="material-symbols-outlined text-[14px] text-slate-600">info</span></span>
                  <span className="text-slate-200">1 USDC ({fromNetwork.name}) ≈ 0.995 USDC ({toNetwork.name})</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400 flex items-center gap-1">Network Cost <span className="material-symbols-outlined text-[14px] text-slate-600">local_gas_station</span></span>
                  <span className="text-slate-200">~$4.25</span>
                </div>
                 <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Route</span>
                  <div className="flex items-center gap-1 text-slate-300 text-xs font-medium">
                    <span className="bg-white/10 px-1.5 py-0.5 rounded">{fromNetwork.name}</span>
                    <span className="material-symbols-outlined text-[10px] text-slate-500">arrow_forward</span>
                    <span className="bg-white/10 px-1.5 py-0.5 rounded">Wormhole</span>
                    <span className="material-symbols-outlined text-[10px] text-slate-500">arrow_forward</span>
                    <span className="bg-white/10 px-1.5 py-0.5 rounded">{toNetwork.name}</span>
                  </div>
                </div>
              </div>

              <button 
                onClick={handleReview}
                className="w-full mt-6 bg-primary text-black font-bold text-lg py-4 rounded-xl hover:bg-primary/90 transition-all shadow-[0_0_20px_rgba(13,242,223,0.3)] hover:shadow-[0_0_30px_rgba(13,242,223,0.5)] transform active:scale-[0.99]"
              >
                {amount ? 'Review Swap' : 'Enter Amount'}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Activity */}
        <div className="lg:col-span-5 xl:col-span-4 space-y-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-primary">Recent Activity</h3>
            <a href="#" className="text-xs text-slate-500 hover:text-white transition-colors">View All</a>
          </div>

          <div className="group relative overflow-hidden rounded-xl bg-white/5 p-5 backdrop-blur-md border border-white/10 hover:border-primary/30 transition-all duration-300">
            <div className="absolute top-0 right-0 p-3 opacity-20">
              <span className="material-symbols-outlined text-4xl text-emerald-400">check_circle</span>
            </div>
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-3">
                 <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border border-white/10">
                   <span className="material-symbols-outlined text-white text-sm">water_drop</span>
                </div>
                <span className="material-symbols-outlined text-slate-600 text-sm">arrow_forward</span>
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border border-white/10">
                   <span className="material-symbols-outlined text-lg text-white">architecture</span>
                </div>
                <span className="text-xs text-slate-400 ml-auto">2 mins ago</span>
              </div>
              <div className="flex flex-col">
                <span className="text-white font-medium">Bridged 500 USDC</span>
                <span className="text-xs text-emerald-400 flex items-center gap-1 mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  Completed
                </span>
              </div>
            </div>
          </div>

          <div className="group relative overflow-hidden rounded-xl bg-white/5 p-5 backdrop-blur-md border border-white/10 hover:border-primary/30 transition-all duration-300">
            <div className="absolute top-0 right-0 p-3 opacity-20">
              <span className="material-symbols-outlined text-4xl text-blue-400">pending</span>
            </div>
             <div className="relative z-10">
              <div className="flex items-center gap-3 mb-3">
                 <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border border-white/10">
                   <span className="material-symbols-outlined text-lg text-white">token</span>
                </div>
                <span className="material-symbols-outlined text-slate-600 text-sm">arrow_forward</span>
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border border-white/10">
                   <span className="material-symbols-outlined text-white text-sm">water_drop</span>
                </div>
                <span className="text-xs text-slate-400 ml-auto">5 mins ago</span>
              </div>
              <div className="flex flex-col">
                <span className="text-white font-medium">Swapping 2.4 ETH to SUI</span>
                <span className="text-xs text-blue-400 flex items-center gap-1 mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                  Processing (Arc Bridge)
                </span>
              </div>
            </div>
             <div className="absolute bottom-0 left-0 h-0.5 bg-blue-500/30 w-full">
                <div className="h-full bg-blue-500 w-2/3 shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-white/5">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Network Status</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span className="text-slate-300">Ethereum</span>
                </div>
                <span className="text-emerald-500 text-xs bg-emerald-500/10 px-2 py-0.5 rounded">Operational</span>
              </div>
               <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span className="text-slate-300">Sui Mainnet</span>
                </div>
                <span className="text-emerald-500 text-xs bg-emerald-500/10 px-2 py-0.5 rounded">Operational</span>
              </div>
               <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                  <span className="text-slate-300">Arc Network</span>
                </div>
                <span className="text-yellow-500 text-xs bg-yellow-500/10 px-2 py-0.5 rounded">High Traffic</span>
              </div>
            </div>
          </div>
        </div>
      </div>

        {/* Review Modal */}
        {isReviewOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsReviewOpen(false)}></div>
                <div className="relative bg-[#1a1f1e] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-fade-in-up">
                    {processStatus === 'idle' && (
                        <>
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-lg font-bold text-white">Review Transaction</h3>
                                <button onClick={() => setIsReviewOpen(false)} className="text-slate-400 hover:text-white">
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>
                            <div className="space-y-4 mb-6">
                                <div className="bg-white/5 rounded-xl p-4 flex justify-between items-center">
                                    <div className="text-sm text-slate-400">You Pay</div>
                                    <div className="text-xl font-bold text-white flex items-center gap-2">
                                        {amount} <span className="text-sm text-slate-400">USDC</span>
                                    </div>
                                </div>
                                <div className="flex justify-center -my-2">
                                    <span className="material-symbols-outlined text-slate-500 bg-[#1a1f1e] rounded-full p-1">arrow_downward</span>
                                </div>
                                 <div className="bg-white/5 rounded-xl p-4 flex justify-between items-center">
                                    <div className="text-sm text-slate-400">You Receive</div>
                                    <div className="text-xl font-bold text-primary flex items-center gap-2">
                                        {calculatedAmount} <span className="text-sm text-slate-400">USDC</span>
                                    </div>
                                </div>
                                <div className="p-3 border border-white/5 rounded-lg space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-400">Bridge</span>
                                        <span className="text-white">Wormhole</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-400">Est. Time</span>
                                        <span className="text-white">~2 mins</span>
                                    </div>
                                </div>
                            </div>
                            <button 
                                onClick={handleConfirm}
                                className="w-full bg-primary text-black font-bold text-lg py-3 rounded-xl hover:bg-primary/90 transition-all"
                            >
                                Confirm Bridge
                            </button>
                        </>
                    )}

                    {processStatus === 'processing' && (
                        <div className="flex flex-col items-center py-8">
                            <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-6"></div>
                            <h3 className="text-xl font-bold text-white mb-2">Processing...</h3>
                            <p className="text-slate-400 text-center">Your transaction is being routed via Wormhole.</p>
                        </div>
                    )}

                    {processStatus === 'success' && (
                        <div className="flex flex-col items-center py-8">
                            <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mb-6 animate-pulse">
                                <span className="material-symbols-outlined text-4xl text-emerald-500">check</span>
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">Transaction Submitted</h3>
                            <p className="text-slate-400 text-center">Funds should arrive in ~2 minutes.</p>
                        </div>
                    )}
                </div>
            </div>
        )}

    </div>
  );
};

export default DashboardPage;