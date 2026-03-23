import React, { useState, useEffect } from 'react';
import { TokenInput } from './token-input';
import { QuoteInfo } from './quote-info';
import { TokenSelectorModal } from './token-selector-modal';
import type { IntentQuote } from '@/features/intent/api/get-intent-quote';
import { Button } from '@/components/ui/button';
import { ArrowDown, AlertTriangle, XCircle, X, Wallet, ChevronDown, Settings, Clipboard, RefreshCw } from 'lucide-react';
import { WalletMultiButton, useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AddressPasteModal } from './address-paste-modal';

export function getTokenIconSrc(symbol: string) {
  switch (symbol.toLowerCase()) {
    case 'usdc': return `/tokens/usdc.svg`;
    case 'eth': return `/tokens/eth.svg`;
    case 'sol': return `/tokens/sol.svg`;
    case 'base': return `/tokens/base.svg`;
    case 'msol': return 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png';
    case 'op': return 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/info/logo.png';
    case 'arb': return 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png';
    default: return `/tokens/${symbol.toLowerCase()}.svg`;
  }
}

interface SwapFormProps {
  sellAmount: string;
  onSellAmountChange: (value: string) => void;
  buyAmount: string;
  onBuyAmountChange: (value: string) => void;
  inputToken: 'eth' | 'usdc';
  onInputTokenChange: (value: 'eth' | 'usdc') => void;
  
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
  isQuoteFetching: boolean;
  quoteError: string | null;
  quoteAge: number | null;

  onConnectEvm: () => void;
  onDisconnectEvm?: () => void;
  onDisconnectSolana?: () => void;
  isConnectingEvm?: boolean;
  evmWalletIcon?: string;
  solanaWalletIcon?: string;
  evmWalletName?: string;
  solanaWalletName?: string;

  onSubmit: () => void;
  canSubmit: boolean;
  isSubmitting: boolean;
  submitLabel: string;
  hasNoSolvers: boolean;

  buildError: string | null;
  pastedDestinationAddress: string;
  setPastedDestinationAddress: (val: string) => void;
  isFlipped: boolean;
  onFlip: () => void;
}

export function SwapForm({
  sellAmount,
  onSellAmountChange,
  buyAmount,
  onBuyAmountChange,
  inputToken,
  onInputTokenChange,
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
  isQuoteFetching,
  quoteError,
  quoteAge,
  onConnectEvm,
  onDisconnectEvm,
  onDisconnectSolana,
  isConnectingEvm,
  evmWalletIcon,
  solanaWalletIcon,
  evmWalletName,
  solanaWalletName,
  onSubmit,
  canSubmit,
  isSubmitting,
  submitLabel,
  hasNoSolvers,
  buildError,
  isFlipped,
  onFlip,
  pastedDestinationAddress,
  setPastedDestinationAddress,
}: SwapFormProps) {
  const hasValidAmount = Boolean(sellAmount && parseFloat(sellAmount) > 0);
  const maxBalance = isFlipped ? (solBalance ?? '0') : ethBalanceRaw;
  const isInsufficient = hasValidAmount && !!maxBalance && parseFloat(sellAmount) > parseFloat(maxBalance);
  const activeSolvers = quote?.activeSolvers ?? 0;

  const [modalType, setModalType] = useState<'sell' | 'buy' | null>(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isPastingAddress, setIsPastingAddress] = useState<'evm' | 'solana' | null>(null);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [tokenSelectionDirection, setTokenSelectionDirection] = useState<'top' | 'bottom'>('top');

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

  const getFallbackIcon = (name?: string, fallbackIcon?: string, isEvm: boolean = true) => {
    let lower = (name || '').toLowerCase();

    // If using wagmi's generic injected connector, try to sniff the actual provider
    if (isEvm && typeof window !== 'undefined' && (window as any).ethereum) {
      const eth = (window as any).ethereum;
      if (!name || lower === 'injected' || lower === 'okx wallet' || eth.isOkxWallet) {
        if (eth.isOkxWallet || (window as any).okxwallet) lower += ' okx';
        if (eth.isMetaMask && !eth.isOkxWallet && !eth.isPhantom) lower += ' metamask';
      }
    }

    if (lower.includes('okx')) return "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgNDAwIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgcng9IjIwMCIgZmlsbD0iIzAwMCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkeT0iLjM1ZW0iIGZpbGw9IiNmZmYiIGZvbnQtZmFtaWx5PSJBcmlhbCxzYW5zLXNlcmlmIiBmb250LXNpemU9IjEyMCIgZm9udC13ZWlnaHQ9ImJvbGQiIHRleHQtYW5jaG9yPSJtaWRkbGUiPk9LWDwvdGV4dD48L3N2Zz4=";
    if (fallbackIcon) return fallbackIcon;
    if (lower.includes('metamask')) return 'https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg';
    return null;
  };

  // Custom Wallet renderer
  const renderWalletSection = (chain: 'evm' | 'solana', isSourceCard: boolean) => {
    const isEVM = chain === 'evm';
    const nativelyConnected = isEVM ? evmConnected : !!solanaAddress;
    const nativeAddress = isEVM ? evmAddress : solanaAddress;
    
    // Paste logic: Only the destination (Buy) card can use a pasted address override.
    // If we're rendering the component that corresponds to the destination, we check pastedDestinationAddress.
    // Note: The destination chain is always the opposite of isSourceCard.
    const hasPastedOverride = !isSourceCard && !!pastedDestinationAddress;
    const activeAddress = hasPastedOverride ? pastedDestinationAddress : nativeAddress;
    const isActuallyConnected = nativelyConnected || hasPastedOverride;

    const dropdownKey = chain;

    const activeIcon = isEVM ? getFallbackIcon(evmWalletName, evmWalletIcon, true) : getFallbackIcon(solanaWalletName, solanaWalletIcon, false);

    return (
      <div className="relative" onClick={stopProp}>
        <button 
          type="button"
          onClick={() => {
            if (!isActuallyConnected && isSourceCard) {
              setIsConnectModalOpen(true);
            } else {
              setOpenWalletDropdown(openWalletDropdown === dropdownKey as any ? null : dropdownKey as any);
            }
          }}
          className="h-auto p-0 flex items-center gap-1 text-[15px] font-semibold text-indigo-400 bg-transparent hover:text-indigo-300 transition-colors cursor-pointer outline-none border-none shadow-none focus:ring-0"
        >
          {isActuallyConnected ? (
             <span className="text-indigo-400 flex items-center gap-1.5">
               {activeIcon && !hasPastedOverride ? (
                 <img src={activeIcon} className="w-4 h-4 rounded-sm object-cover" />
               ) : null}
               {activeAddress?.slice(0, 6)}…{activeAddress?.slice(-4)}
             </span>
          ) : (
             <span>{isConnectingEvm && isEVM && isSourceCard ? 'Connecting...' : 'Select wallet'}</span>
          )}
          {(!isSourceCard || isActuallyConnected) ? <ChevronDown size={14} className="text-indigo-400/70" /> : null}
        </button>

        {openWalletDropdown === dropdownKey && (
          <div className="absolute right-0 top-full mt-2 w-max bg-[#11161d] border border-white/10 rounded-[12px] shadow-2xl z-50 animate-in fade-in zoom-in-95 p-1 flex flex-col gap-0.5">
            {isActuallyConnected ? (
              <>
                {isEVM ? (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); setIsConnectModalOpen(true); setOpenWalletDropdown(null); }} className="w-full text-left px-3 py-2 text-white hover:bg-white/10 rounded-lg transition-colors text-[14px] font-medium whitespace-nowrap cursor-pointer">Change wallet</button>
                    {!isSourceCard && (
                       <button onClick={(e) => { e.stopPropagation(); setIsPastingAddress('evm'); setOpenWalletDropdown(null); }} className="w-full text-left px-3 py-2 text-white hover:bg-white/10 rounded-lg transition-colors text-[14px] font-medium whitespace-nowrap cursor-pointer">Paste wallet address</button>
                    )}
                    {hasPastedOverride && !isSourceCard && (
                      <button onClick={(e) => { e.stopPropagation(); setPastedDestinationAddress(''); setOpenWalletDropdown(null); }} className="w-full text-left px-3 py-2 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors text-[14px] font-medium whitespace-nowrap cursor-pointer">Clear pasted address</button>
                    )}
                    {onDisconnectEvm && nativelyConnected && (
                      <button onClick={(e) => { e.stopPropagation(); onDisconnectEvm(); setOpenWalletDropdown(null); }} className="w-full text-left px-3 py-2 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors text-[14px] font-medium whitespace-nowrap cursor-pointer">Disconnect</button>
                    )}
                  </>
                ) : (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); setSolanaModalVisible(true); setOpenWalletDropdown(null); }} className="w-full text-left px-3 py-2 text-white hover:bg-white/10 rounded-lg transition-colors text-[14px] font-medium whitespace-nowrap cursor-pointer">Change wallet</button>
                    {!isSourceCard && (
                       <button onClick={(e) => { e.stopPropagation(); setIsPastingAddress('solana'); setOpenWalletDropdown(null); }} className="w-full text-left px-3 py-2 text-white hover:bg-white/10 rounded-lg transition-colors text-[14px] font-medium whitespace-nowrap cursor-pointer">Paste wallet address</button>
                    )}
                    {hasPastedOverride && !isSourceCard && (
                      <button onClick={(e) => { e.stopPropagation(); setPastedDestinationAddress(''); setOpenWalletDropdown(null); }} className="w-full text-left px-3 py-2 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors text-[14px] font-medium whitespace-nowrap cursor-pointer">Clear pasted address</button>
                    )}
                    {onDisconnectSolana && nativelyConnected && (
                      <button onClick={(e) => { e.stopPropagation(); onDisconnectSolana(); setOpenWalletDropdown(null); }} className="w-full text-left px-3 py-2 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors text-[14px] font-medium whitespace-nowrap cursor-pointer">Disconnect</button>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                {isEVM ? (
                  <button onClick={() => { onConnectEvm(); setOpenWalletDropdown(null); }} className="w-full text-left px-3 py-2 text-white hover:bg-white/10 rounded-lg transition-colors text-[14px] font-medium whitespace-nowrap cursor-pointer">Connect a new wallet</button>
                ) : (
                  <div className="w-full text-left relative hover:bg-white/10 rounded-lg transition-colors cursor-pointer flex items-center">
                    <div className="w-full opacity-0 absolute inset-0 z-20 cursor-pointer"><WalletMultiButton /></div>
                    <div className="w-full px-3 py-2 text-white text-[14px] font-medium whitespace-nowrap">Connect a new wallet</div>
                  </div>
                )}
                {!isSourceCard && (
                   <button onClick={() => { setIsPastingAddress(chain); setOpenWalletDropdown(null); }} className="w-full text-left px-3 py-2 text-white hover:bg-white/10 rounded-lg transition-colors text-[14px] font-medium whitespace-nowrap cursor-pointer">Paste wallet address</button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col w-full gap-1.5 relative">
      {/* Header Tabs & Settings */}
      <div className="flex items-center justify-between w-full relative z-20">
        {/* Tabs */}
        <div className="flex items-center gap-1">
          <button 
            className="rounded-[12px] h-[38px] px-5 text-[15px] font-bold transition-all bg-[#161B22] text-white shadow-sm border border-white/5 hover:bg-[#1D242E]"
          >
            Swap
          </button>
        </div>

        {/* Settings & Refresh Indicator */}
        <div className="flex items-center gap-2.5 relative z-30" onClick={stopProp}>
          {hasValidAmount && !quoteError && (
             <TooltipProvider delayDuration={100}>
               <Tooltip>
                 <TooltipTrigger asChild>
                   <div 
                     className="relative w-[28px] h-[28px] rounded-full overflow-hidden flex items-center justify-center cursor-help ring-1 ring-white/5 shadow-sm bg-[#11161d]" 
                   >
                     {isQuoteFetching ? (
                       <RefreshCw size={14} className="animate-spin text-[#0df2df]" />
                     ) : (
                       <>
                         <div 
                           className="absolute inset-0 transition-all duration-100 ease-linear" 
                           style={{
                             background: `conic-gradient(from 0deg, #0df2df ${((quoteAge || 0) / 5) * 360}deg, transparent 0deg)`
                           }} 
                         />
                         <div className="absolute inset-[3px] bg-[#161B22] rounded-full flex items-center justify-center pointer-events-none select-none">
                           <span className="text-[12px] font-bold text-[#0df2df] font-mono translate-y-[0.5px]">
                             {5 - Math.floor(quoteAge || 0)}
                           </span>
                         </div>
                       </>
                     )}
                   </div>
                 </TooltipTrigger>
                 <TooltipContent side="top" sideOffset={8} className="bg-[#1C212B] border-white/5 text-slate-300 text-[12px] font-medium px-3 py-2 shadow-2xl rounded-xl">
                   <div className="flex items-center gap-1.5">
                     <RefreshCw size={12} className={isQuoteFetching ? 'animate-spin text-[#0df2df]' : 'text-slate-500'} />
                     <span>Rates refresh in <span className="text-[#0df2df] font-mono mx-0.5">{5 - Math.floor(quoteAge || 0)}s</span></span>
                   </div>
                 </TooltipContent>
               </Tooltip>
             </TooltipProvider>
          )}

          <div className="relative">
            <Button 
              variant="ghost"
              size="icon"
              onClick={() => setIsSlippageOpen(!isSlippageOpen)}
              className="w-[38px] h-[38px] rounded-[13px] bg-[#161B22] border border-white/5 hover:bg-[#1D242E] text-slate-400 hover:text-white transition-all shadow-sm flex items-center justify-center p-0"
            >
              <Settings size={18} />
            </Button>

          {isSlippageOpen && (
            <div className="absolute right-0 top-full mt-2 w-[340px] bg-[#11161d] border border-white/10 rounded-2xl p-5 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[14px] font-bold text-white flex items-center gap-1.5">Auction Settings <span className="text-slate-500 text-[11px] bg-white/10 w-4 h-4 rounded-full flex items-center justify-center cursor-help">i</span></span>
              </div>
              
              <div className="mb-4">
                <div className="flex justify-between items-end mb-2 block">
                  <label className="text-xs text-slate-400 font-medium tracking-wide">Dutch Auction Duration</label>
                  <span className="text-[10px] text-indigo-400 font-medium bg-indigo-500/10 px-1.5 py-0.5 rounded text-center">More time = better prices</span>
                </div>
                <div className="flex gap-1.5 bg-[#0B0E14] p-1 rounded-[10px] border border-white/5">
                  <Button variant="ghost" onClick={() => setAuctionDuration(2)} className={`flex-1 h-8 rounded-lg text-[13px] font-semibold transition-all ${auctionDuration === 2 ? 'bg-[#1C232B] text-white shadow-sm' : 'text-slate-500 hover:text-white hover:bg-transparent'}`}>2 min</Button>
                  <Button variant="ghost" onClick={() => setAuctionDuration(5)} className={`flex-1 h-8 rounded-lg text-[13px] font-semibold transition-all ${auctionDuration === 5 ? 'bg-[#1C232B] text-white shadow-sm' : 'text-slate-500 hover:text-white hover:bg-transparent'}`}>5 min</Button>
                  <Button variant="ghost" onClick={() => setAuctionDuration(10)} className={`flex-1 h-8 rounded-lg text-[13px] font-semibold transition-all ${auctionDuration === 10 ? 'bg-[#1C232B] text-white shadow-sm' : 'text-slate-500 hover:text-white hover:bg-transparent'}`}>10 min</Button>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed font-medium mt-2">
                  Longer auction durations allow solvers more time to find optimal routes, resulting in better prices.
                </p>
              </div>

              <div className="mb-2">
                <div className="flex justify-between items-end mb-2 block">
                  <label className="text-xs text-slate-400 font-medium tracking-wide">Slippage Tolerance</label>
                  <span className="text-[10px] text-indigo-400 font-medium bg-indigo-500/10 px-1.5 py-0.5 rounded text-center">Higher = faster execution</span>
                </div>
                <div className="flex gap-1.5 bg-[#0B0E14] p-1 rounded-[10px] border border-white/5">
                  <Button variant="ghost" onClick={() => setAuctionSlippage(5)} className={`flex-1 h-8 rounded-lg text-[13px] font-semibold transition-all ${auctionSlippage === 5 ? 'bg-[#1C232B] text-white shadow-sm' : 'text-slate-500 hover:text-white hover:bg-transparent'}`}>5%</Button>
                  <Button variant="ghost" onClick={() => setAuctionSlippage(10)} className={`flex-1 h-8 rounded-lg text-[13px] font-semibold transition-all ${auctionSlippage === 10 ? 'bg-[#1C232B] text-white shadow-sm' : 'text-slate-500 hover:text-white hover:bg-transparent'}`}>10%</Button>
                  <Button variant="ghost" onClick={() => setAuctionSlippage(20)} className={`flex-1 h-8 rounded-lg text-[13px] font-bold transition-all ${auctionSlippage === 20 ? 'bg-[#1C232B] text-white shadow-sm' : 'text-slate-500 hover:text-white hover:bg-transparent'}`}>20%</Button>
                </div>
                <div className="flex justify-between px-2 pt-1.5 mb-2">
                  <span className="text-[10px] text-slate-500 font-medium">Slower fill</span>
                  <span className="text-[10px] text-slate-500 font-medium">Balanced</span>
                  <span className="text-[10px] text-slate-500 font-medium">Fastest fill</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                  Slippage sets the minimum acceptable amount you are willing to receive, ensuring your trade executes even if markets move slightly.
                </p>
              </div>


            </div>
          )}
        </div>
      </div>
    </div>

      {/* Swap Cards Group */}
      <div className="relative flex flex-col z-10 w-full mb-0">
        {/* Source Card */}
        <TokenInput
          label="Sell"
          amount={sellAmount}
          onChange={onSellAmountChange}
          balance={isFlipped ? (solanaAddress ? solBalance : null) : (evmConnected ? ethBalance : null)}
          rawBalance={isFlipped ? (solBalance ?? '0') : ethBalanceRaw}
          tokenSymbol={isFlipped ? outputToken.toUpperCase() : inputToken.toUpperCase()}
          chainName={isFlipped ? "Solana" : "Base"}
          tokenIcon={<img src={getTokenIconSrc(isFlipped ? outputToken : inputToken)} alt="Icon" className="w-full h-full object-cover" />}
          chainIcon={<img src={getTokenIconSrc(isFlipped ? "sol" : "base")} alt="Chain" className="w-[14px] h-[14px] object-cover" />}
          usdValue={isFlipped ? quote?.toUsd : quote?.fromUsd}
          onMaxClick={!isFlipped ? () => onSellAmountChange(ethBalanceRaw) : undefined}
          walletActionNode={renderWalletSection(isFlipped ? 'solana' : 'evm', true)}
          onTokenSelectorClick={() => {
            setTokenSelectionDirection('top');
            setIsTokenModalOpen(true);
          }}
        />

        {/* Divider arrow */}
        <div className="relative h-1 z-20 flex justify-center items-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={onFlip}
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
            tokenSymbol={isFlipped ? inputToken.toUpperCase() : outputToken.toUpperCase()}
            chainName={isFlipped ? "Base" : "Solana"}
            tokenIcon={<img src={getTokenIconSrc(isFlipped ? inputToken : outputToken)} alt="Icon" className="w-full h-full object-cover" />}
            chainIcon={<img src={getTokenIconSrc(isFlipped ? "base" : "sol")} alt="Chain" className="w-[14px] h-[14px] object-cover" />}
            usdValue={isFlipped ? quote?.fromUsd : quote?.toUsd}
            isLoading={isQuoteLoading && hasValidAmount}
            walletActionNode={renderWalletSection(isFlipped ? 'evm' : 'solana', false)}
            onTokenSelectorClick={() => {
              setTokenSelectionDirection('bottom');
              setIsTokenModalOpen(true);
            }}
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
        inputToken={inputToken}
        outputToken={outputToken}
        isFlipped={isFlipped}
        quoteAge={quoteAge}
        auctionDuration={auctionDuration}
        auctionSlippage={auctionSlippage}
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


      {/* Swap button */}
      <div className="pt-1">
        <Button
          variant="default"
          size="auto"
          onClick={() => {
            const hasDestination = isFlipped ? (evmConnected || pastedDestinationAddress) : (solanaAddress || pastedDestinationAddress);
            const hasSource = isFlipped ? solanaAddress : evmConnected;

            if (!hasSource) {
              setIsConnectModalOpen(true);
            } else if (!hasDestination) {
              setIsPastingAddress(isFlipped ? 'evm' : 'solana');
            } else {
              onSubmit();
            }
          }}
          disabled={( !canSubmit && !submitLabel.toLowerCase().includes('connect') && !submitLabel.toLowerCase().includes('destination')) || isSubmitting || isInsufficient}
          className={`w-full font-bold text-[16px] uppercase h-[44px] rounded-[12px] px-5 py-3 transition-all flex items-center justify-center gap-2 cursor-pointer
            ${
              hasNoSolvers || isInsufficient
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20'
                : canSubmit || !evmConnected
                ? 'bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 text-black shadow-[0_0_20px_rgba(13,242,223,0.3)]'
                : 'bg-white/5 text-slate-500 hover:bg-white/10'
            }`}
        >
          {isSubmitting && (
            <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
          )}
          {isInsufficient && !submitLabel.toLowerCase().includes('connect') && !submitLabel.toLowerCase().includes('destination') ? (
            `Insufficient ${isFlipped ? outputToken.toUpperCase() : inputToken.toUpperCase()} Balance`
          ) : submitLabel.toLowerCase().includes('connect') || submitLabel.toLowerCase().includes('destination') ? (
            submitLabel
          ) : (
            submitLabel
          )}
        </Button>
      </div>

      <AddressPasteModal 
        isOpen={!!isPastingAddress}
        chain={isPastingAddress}
        onClose={() => setIsPastingAddress(null)}
        onSave={(addr) => {
          setPastedDestinationAddress(addr);
          setIsPastingAddress(null);
        }}
      />

      {/* Universal Connect Modal */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setIsConnectModalOpen(false)}>
          <div className="w-full max-w-sm bg-[#11161d] border border-white/10 rounded-2xl shadow-2xl p-6 relative animate-in fade-in zoom-in-95" onClick={stopProp}>
            <button 
              onClick={() => setIsConnectModalOpen(false)}
              className="absolute right-4 top-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X size={18} strokeWidth={2.5} />
            </button>
            <h3 className="text-lg font-bold text-white mb-4">Connect Wallet</h3>
            <div className="flex flex-col gap-3">
              <Button 
                variant="outline" 
                onClick={() => {
                  if (isFlipped) onFlip();
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
                  if (!isFlipped) onFlip();
                  setSolanaModalVisible(true);
                  setIsConnectModalOpen(false);
                }}
                className="w-full h-14 justify-start px-4 bg-white/5 border-white/10 hover:bg-white/10 hover:text-white rounded-xl font-semibold text-[16px] transition-colors"
              >
                <div className="w-6 h-6 mr-3"><img src="/tokens/sol.svg" alt="Solana" className="w-full h-full object-contain" /></div>
                Solana Wallet
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Token Selector Modal */}
      <TokenSelectorModal 
        isOpen={isTokenModalOpen} 
        onClose={() => setIsTokenModalOpen(false)} 
        balances={{
          ETH: evmConnected ? ethBalance : null,
          SOL: solanaAddress ? solBalance : null,
          mSOL: null,
          USDC: null,
        }}
        onSelect={(token) => {
          setIsTokenModalOpen(false);
          const sym = token.symbol.toLowerCase();
          const isSol = sym === 'sol' || sym === 'msol';
          const isEvm = !isSol;
          
          if (tokenSelectionDirection === 'top') {
            if (isSol) {
              if (!isFlipped) onFlip();
              onOutputTokenChange(sym as 'sol' | 'msol');
            } else if (isEvm) {
              if (isFlipped) onFlip();
              onInputTokenChange(sym as 'eth' | 'usdc');
            }
          } else if (tokenSelectionDirection === 'bottom') {
            if (isSol) {
              if (isFlipped) onFlip();
              onOutputTokenChange(sym as 'sol' | 'msol');
            } else if (isEvm) {
              if (!isFlipped) onFlip();
              onInputTokenChange(sym as 'eth' | 'usdc');
            }
          }
        }} 
      />

    </div>
  );
}
