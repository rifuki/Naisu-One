import React, { useState, useEffect } from 'react';
import { TokenInput } from './token-input';
import { QuoteInfo } from './quote-info';
import { TokenSelectModal } from './token-select-modal';
import type { IntentQuote } from '@/features/intent/api/get-intent-quote';
import { Button } from '@/components/ui/button';
import { ArrowDown, AlertTriangle, XCircle, Wallet, ChevronDown, Settings, Clipboard } from 'lucide-react';
import { WalletMultiButton, useWalletModal } from '@solana/wallet-adapter-react-ui';

interface SwapFormProps {
  sellAmount: string;
  onSellAmountChange: (value: string) => void;
  buyAmount: string;
  onBuyAmountChange: (value: string) => void;
  
  outputToken: 'sol' | 'msol';
  onOutputTokenChange: (value: 'sol' | 'msol') => void;

  ethBalance: string | null;
  ethBalanceRaw: string;
  solBalance: string | null;

  evmAddress?: string | null;
  evmConnected: boolean;
  solanaAddress?: string | null;

  quote: IntentQuote | null;
  isQuoteLoading: boolean;
  quoteError: string | null;
  quoteAge: number | null;

  onConnectEvm: () => void;
  isConnectingEvm?: boolean;

  onSubmit: () => void;
  canSubmit: boolean;
  isSubmitting: boolean;
  submitLabel: string;
  hasNoSolvers: boolean;

  buildError?: string | null;
}

export function SwapForm({
  sellAmount,
  onSellAmountChange,
  buyAmount,
  onBuyAmountChange,
  outputToken,
  onOutputTokenChange,
  ethBalance,
  ethBalanceRaw,
  solBalance,
  evmAddress,
  evmConnected,
  solanaAddress,
  quote,
  isQuoteLoading,
  quoteError,
  quoteAge,
  onConnectEvm,
  isConnectingEvm,
  onSubmit,
  canSubmit,
  isSubmitting,
  submitLabel,
  hasNoSolvers,
  buildError,
}: SwapFormProps) {
  const hasValidAmount = Boolean(sellAmount && parseFloat(sellAmount) > 0);
  const activeSolvers = quote?.activeSolvers ?? 0;

  const [modalType, setModalType] = useState<'sell' | 'buy' | null>(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const handleFlip = () => setIsFlipped(f => !f);

  try {
    const solanaModal = useWalletModal();
    var setSolanaModalVisible = solanaModal.setVisible;
  } catch (e) {
    var setSolanaModalVisible = (_open: boolean) => {};
  }

  // Headers UI state
  const [activeTab, setActiveTab] = useState<'swap' | 'buy'>('swap');
  const [isSlippageOpen, setIsSlippageOpen] = useState(false);
  const [auctionDuration, setAuctionDuration] = useState<number>(5);
  const [auctionSlippage, setAuctionSlippage] = useState<number>(10);

  const [openWalletDropdown, setOpenWalletDropdown] = useState<'evm' | 'solana' | null>(null);

  // Close popovers on outside click
  useEffect(() => {
    const handleClick = () => { setIsSlippageOpen(false); setOpenWalletDropdown(null); };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

  // Custom Wallet renderer
  const renderWalletSection = (chain: 'evm' | 'solana', isSourceCard: boolean) => {
    const isEVM = chain === 'evm';
    const isConnected = isEVM ? evmConnected : !!solanaAddress;
    const address = isEVM ? evmAddress : solanaAddress;
    const dropdownKey = chain;

    if (isSourceCard) {
      return (
        <div className="relative">
          <Button 
            variant="ghost"
            onClick={() => { if (!isConnected) setIsConnectModalOpen(true); }}
            className="h-auto p-0 flex items-center gap-1 text-[15px] font-semibold text-indigo-400 hover:bg-transparent hover:text-indigo-300 transition-colors cursor-pointer"
          >
            {isConnected ? <span className="text-indigo-400">{address?.slice(0, 6)}…{address?.slice(-4)}</span> : <span>Select wallet</span>}
          </Button>
        </div>
      );
    }
    
    return (
      <div className="relative" onClick={stopProp}>
        <Button 
          variant="ghost"
          onClick={() => setOpenWalletDropdown(openWalletDropdown === dropdownKey as any ? null : dropdownKey as any)}
          className="h-auto p-0 flex items-center gap-1 text-[15px] font-semibold text-indigo-400 hover:bg-transparent hover:text-indigo-300 transition-colors"
        >
          {isConnected ? (
             <span className="text-indigo-400">{address?.slice(0, 6)}…{address?.slice(-4)}</span>
          ) : (
             <span>{isConnectingEvm && isEVM ? 'Connecting...' : 'Select wallet'}</span>
          )}
          <ChevronDown size={14} className="text-indigo-400/70" />
        </Button>

        {openWalletDropdown === dropdownKey && (
          <div className="absolute right-0 top-full mt-2 w-[240px] bg-[#161B22] border border-white/5 rounded-[16px] shadow-[0_10px_40px_rgba(0,0,0,0.5)] overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100 p-1.5">
            <div className="flex flex-col text-[15px]">
              {isEVM ? (
                <Button variant="ghost" onClick={() => { onConnectEvm(); setOpenWalletDropdown(null); }} className="w-full justify-start h-auto px-3 py-2.5 text-white hover:bg-white/10 hover:text-white rounded-xl transition-colors font-medium flex items-center gap-3"><Wallet size={18} className="text-slate-400" /> Connect a new wallet</Button>
              ) : (
                <div className="w-full text-left relative hover:bg-white/10 rounded-xl transition-colors cursor-pointer flex items-center">
                  <div className="absolute left-3 pointer-events-none z-10 flex items-center text-slate-400"><Wallet size={18} /></div>
                  <div className="w-full opacity-0 absolute inset-0 z-20 cursor-pointer"><WalletMultiButton /></div>
                  <div className="w-full pl-11 pr-3 py-2.5 text-white font-medium">Connect a new wallet</div>
                </div>
              )}
              <Button variant="ghost" onClick={() => setOpenWalletDropdown(null)} className="w-full justify-start h-auto px-3 py-2.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors font-medium flex items-center gap-3"><Clipboard size={18} /> Paste wallet address</Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col w-full gap-2 relative">
      {/* Header Tabs & Settings */}
      <div className="flex items-center justify-between w-full px-2 mb-2 relative z-20">
        {/* Tabs */}
        <div className="flex items-center gap-1">
          <Button 
            variant="ghost"
            onClick={() => setActiveTab('swap')}
            className={`rounded-xl h-[36px] px-3 py-2 text-[16px] font-medium transition-all ${activeTab === 'swap' ? 'bg-[#1D242E] text-white shadow-sm' : 'text-slate-500 hover:text-slate-300 hover:bg-transparent'}`}
          >
            Swap
          </Button>
          <Button 
            variant="ghost"
            onClick={() => setActiveTab('buy')}
            className={`rounded-xl h-[36px] px-3 py-2 text-[16px] font-medium transition-all ${activeTab === 'buy' ? 'bg-[#1D242E] text-white shadow-sm' : 'text-slate-500 hover:text-slate-300 hover:bg-transparent'}`}
          >
            Buy
          </Button>
        </div>

        {/* Settings */}
        <div className="relative" onClick={stopProp}>
          <Button 
            variant="ghost"
            size="icon"
            onClick={() => setIsSlippageOpen(!isSlippageOpen)}
            className="w-9 h-9 rounded-full hover:bg-white/5 text-slate-400 hover:text-white transition-colors border border-transparent hover:border-white/5"
          >
            <Settings size={20} />
          </Button>

          {isSlippageOpen && (
            <div className="absolute right-0 top-full mt-2 w-[340px] bg-[#11161d] border border-white/10 rounded-2xl p-5 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[14px] font-bold text-white flex items-center gap-1.5">Auction Settings <span className="text-slate-500 text-[11px] bg-white/10 w-4 h-4 rounded-full flex items-center justify-center cursor-help">i</span></span>
              </div>
              
              <div className="mb-4">
                <div className="flex justify-between items-end mb-2 block">
                  <label className="text-xs text-slate-400 font-medium tracking-wide">Dutch Auction Duration</label>
                  <span className="text-[10px] text-slate-500 font-medium">Longer = better</span>
                </div>
                <div className="flex gap-1.5 bg-[#0B0E14] p-1 rounded-[10px] border border-white/5">
                  <Button variant="ghost" onClick={() => setAuctionDuration(2)} className={`flex-1 h-8 rounded-lg text-[13px] font-semibold transition-all ${auctionDuration === 2 ? 'bg-[#1C232B] text-white shadow-sm' : 'text-slate-500 hover:text-white hover:bg-transparent'}`}>2 min</Button>
                  <Button variant="ghost" onClick={() => setAuctionDuration(5)} className={`flex-1 h-8 rounded-lg text-[13px] font-semibold transition-all ${auctionDuration === 5 ? 'bg-[#1C232B] text-white shadow-sm' : 'text-slate-500 hover:text-white hover:bg-transparent'}`}>5 min</Button>
                  <Button variant="ghost" onClick={() => setAuctionDuration(10)} className={`flex-1 h-8 rounded-lg text-[13px] font-semibold transition-all ${auctionDuration === 10 ? 'bg-[#1C232B] text-white shadow-sm' : 'text-slate-500 hover:text-white hover:bg-transparent'}`}>10 min</Button>
                </div>
              </div>

              <div className="mb-5">
                <div className="flex justify-between items-end mb-2 block">
                  <label className="text-xs text-slate-400 font-medium tracking-wide">Slippage Tolerance</label>
                  <span className="text-[10px] text-slate-500 font-medium">Higher = faster fill</span>
                </div>
                <div className="flex gap-1.5 bg-[#0B0E14] p-1 rounded-[10px] border border-white/5">
                  <Button variant="ghost" onClick={() => setAuctionSlippage(5)} className={`flex-1 h-8 rounded-lg text-[13px] font-semibold transition-all ${auctionSlippage === 5 ? 'bg-[#1C232B] text-white shadow-sm' : 'text-slate-500 hover:text-white hover:bg-transparent'}`}>5%</Button>
                  <Button variant="ghost" onClick={() => setAuctionSlippage(10)} className={`flex-1 h-8 rounded-lg text-[13px] font-semibold transition-all ${auctionSlippage === 10 ? 'bg-[#1C232B] text-white shadow-sm' : 'text-slate-500 hover:text-white hover:bg-transparent'}`}>10%</Button>
                  <Button variant="ghost" onClick={() => setAuctionSlippage(20)} className={`flex-1 h-8 rounded-lg text-[13px] font-bold transition-all ${auctionSlippage === 20 ? 'bg-[#1C232B] text-white shadow-sm' : 'text-slate-500 hover:text-white hover:bg-transparent'}`}>20%</Button>
                </div>
                <div className="flex justify-between px-2 pt-1.5">
                  <span className="text-[10px] text-slate-500 font-medium">Slower fill</span>
                  <span className="text-[10px] text-slate-500 font-medium">Balanced</span>
                  <span className="text-[10px] text-slate-500 font-medium">Fastest fill</span>
                </div>
              </div>

              <p className="text-[12px] text-slate-400 leading-relaxed font-medium">
                Set how long solvers have to compete and the maximum slippage allowed for the floor price.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Swap Cards Group */}
      <div className="relative flex flex-col z-10 w-full mb-1">
        {/* Source Card */}
        <TokenInput
          label="Sell"
          amount={isFlipped ? buyAmount : sellAmount}
          onChange={isFlipped ? onBuyAmountChange : onSellAmountChange}
          balance={isFlipped ? (solanaAddress ? solBalance : null) : (evmConnected ? ethBalance : null)}
          rawBalance={isFlipped ? (solBalance ?? '0') : ethBalanceRaw}
          tokenSymbol={isFlipped ? outputToken.toUpperCase() : "ETH"}
          chainName={isFlipped ? "Solana" : "Base"}
          tokenIcon={<img src={isFlipped ? "/tokens/sol.svg" : "/tokens/eth.svg"} alt="Icon" className="w-full h-full object-cover" />}
          chainIcon={<img src={isFlipped ? "/tokens/sol.svg" : "/tokens/base.svg"} alt="Chain" className="w-[14px] h-[14px] object-cover" />}
          usdValue={isFlipped ? quote?.toUsd : quote?.fromUsd}
          onMaxClick={!isFlipped ? () => onSellAmountChange(ethBalanceRaw) : undefined}
          walletActionNode={renderWalletSection(isFlipped ? 'solana' : 'evm', true)}
          onTokenSelectorClick={() => setModalType(isFlipped ? 'buy' : 'sell')}
        />

        {/* Divider arrow */}
        <div className="relative h-1 z-20 flex justify-center items-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleFlip}
            className="absolute w-10 h-10 bg-[#161B22] border-[5px] border-[#0A0D11] hover:bg-[#1C232B] text-slate-300 hover:text-white rounded-[12px] flex items-center justify-center p-0 transition-all cursor-pointer shadow-sm group"
          >
            <ArrowDown size={18} strokeWidth={2.5} className={`transition-transform duration-300 ${isFlipped ? 'rotate-180' : ''}`} />
          </Button>
        </div>

        {/* Destination Card */}
        <div className="relative mt-1">
          <TokenInput
            label="Buy"
            amount={isFlipped ? sellAmount : buyAmount}
            onChange={isFlipped ? onSellAmountChange : onBuyAmountChange}
            balance={isFlipped ? (evmConnected ? ethBalance : null) : (solanaAddress ? solBalance : null)}
            rawBalance={isFlipped ? ethBalanceRaw : (solBalance ?? '0')}
            tokenSymbol={isFlipped ? "ETH" : outputToken.toUpperCase()}
            chainName={isFlipped ? "Base" : "Solana"}
            tokenIcon={<img src={isFlipped ? "/tokens/eth.svg" : "/tokens/sol.svg"} alt="Icon" className="w-full h-full object-cover" />}
            chainIcon={<img src={isFlipped ? "/tokens/base.svg" : "/tokens/sol.svg"} alt="Chain" className="w-[14px] h-[14px] object-cover" />}
            usdValue={isFlipped ? quote?.fromUsd : quote?.toUsd}
            isLoading={isQuoteLoading && hasValidAmount}
            walletActionNode={renderWalletSection(isFlipped ? 'evm' : 'solana', false)}
            onTokenSelectorClick={() => setModalType(isFlipped ? 'sell' : 'buy')}
          />
        </div>
      </div>

      {/* Quote info */}
      <QuoteInfo
        quote={quote}
        isLoading={isQuoteLoading}
        error={quoteError}
        hasValidAmount={hasValidAmount}
        activeSolvers={activeSolvers}
        outputToken={outputToken}
        quoteAge={quoteAge}
        auctionDuration={auctionDuration}
      />

      {/* No solvers warning */}
      {hasNoSolvers && (
        <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[13px] flex items-start gap-2 mx-1.5">
          <AlertTriangle size={16} strokeWidth={1.5} className="shrink-0 mt-0.5" />
          <span>
            No solver is currently active. Your ETH would be locked with no one to fill the order.
            Start a solver or try again later.
          </span>
        </div>
      )}

      {/* Build error */}
      {buildError && (
        <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[13px] flex items-start gap-2 mx-1.5">
          <XCircle size={16} strokeWidth={1.5} className="shrink-0 mt-0.5" />
          <span>{buildError}</span>
        </div>
      )}

      {/* Token Select Modal */}
      <TokenSelectModal 
        isOpen={modalType !== null} 
        onClose={() => setModalType(null)} 
        type={modalType}
        onSelect={(token) => {
          if (modalType === 'buy' && (token === 'sol' || token === 'msol')) {
            onOutputTokenChange(token as 'sol' | 'msol');
          }
        }}
      />

      {/* Swap button */}
      <div className="pt-2">
        <Button
          variant="default"
          size="auto"
          onClick={!evmConnected ? onConnectEvm : onSubmit}
          disabled={(evmConnected && !canSubmit) || isSubmitting}
          className={`w-full font-bold text-[16px] uppercase h-[44px] rounded-[12px] px-5 py-3 transition-all flex items-center justify-center gap-2 cursor-pointer
            ${
              hasNoSolvers
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20'
                : canSubmit || !evmConnected
                ? 'bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 text-black shadow-[0_0_20px_rgba(13,242,223,0.3)]'
                : 'bg-white/5 text-slate-500 hover:bg-white/10'
            }`}
        >
          {isSubmitting && (
            <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
          )}
          {submitLabel === 'Connect EVM Wallet' || submitLabel === 'Connect Solana Wallet' ? 'Connect wallet' : submitLabel}
        </Button>
      </div>

      {/* Universal Connect Modal */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setIsConnectModalOpen(false)}>
          <div className="w-full max-w-sm bg-[#11161d] border border-white/10 rounded-2xl shadow-2xl p-6 relative animate-in fade-in zoom-in-95" onClick={stopProp}>
            <button 
              onClick={() => setIsConnectModalOpen(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white transition-colors"
            >
              <XCircle size={20} />
            </button>
            <h3 className="text-lg font-bold text-white mb-4">Connect Wallet</h3>
            <div className="flex flex-col gap-3">
              <Button 
                variant="outline" 
                onClick={() => {
                  if (isFlipped) handleFlip();
                  onConnectEvm();
                  setIsConnectModalOpen(false);
                }}
                className="w-full h-14 justify-start px-4 bg-white/5 border-white/10 hover:bg-white/10 hover:text-white rounded-xl font-semibold text-[16px] transition-colors"
              >
                <div className="w-6 h-6 mr-3"><img src="/tokens/eth.svg" alt="EVM" className="w-full h-full object-contain" /></div>
                EVM Wallet
              </Button>

              <Button 
                variant="outline" 
                onClick={() => {
                  if (!isFlipped) handleFlip();
                  setSolanaModalVisible(true);
                  setIsConnectModalOpen(false);
                }}
                className="w-full h-14 justify-start px-4 bg-white/5 border-white/10 hover:bg-white/10 hover:text-white rounded-xl font-semibold text-[16px] transition-colors"
              >
                <div className="w-6 h-6 mr-3 flex items-center justify-center text-purple-400"><Wallet size={20} /></div>
                Solana Wallet
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
