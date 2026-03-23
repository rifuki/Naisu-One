import { useState } from 'react';
import { Search, X, Star, Globe, CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Token {
  id: string;
  symbol: string;
  chain: string;
  address: string;
  logo: string;
  chainLogo: string;
  isPopular?: boolean;
}

interface Chain {
  id: string;
  name: string;
  icon: string;
}

const MOCK_CHAINS: Chain[] = [
  { id: 'all', name: 'All Chains', icon: 'globe' },
  { id: 'base', name: 'Base', icon: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png' },
  { id: 'solana', name: 'Solana', icon: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png' },
];

const MOCK_TOKENS: Token[] = [
  { id: 'eth-base', symbol: 'ETH', chain: 'Base', address: '0x42...0006', logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png', chainLogo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png', isPopular: true },
  { id: 'usdc-base', symbol: 'USDC', chain: 'Base', address: '0x83...362C', logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png', chainLogo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png', isPopular: true },
  { id: 'sol-sol', symbol: 'SOL', chain: 'Solana', address: '1111...1111', logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png', chainLogo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png', isPopular: true },
  { id: 'msol-sol', symbol: 'mSOL', chain: 'Solana', address: 'mSoL...fqcJ', logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png', chainLogo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png', isPopular: true },
];

interface TokenSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (token: Token) => void;
  balances?: Record<string, string | null>;
  restrictChain?: 'base' | 'solana' | null;
}

export function TokenSelectorModal({ isOpen, onClose, onSelect, balances, restrictChain }: TokenSelectorModalProps) {
  const [selectedChainId, setSelectedChainId] = useState<string>('all');
  const [chainSearch, setChainSearch] = useState('');
  const [tokenSearch, setTokenSearch] = useState('');

  if (!isOpen) return null;

  const availableChains = MOCK_CHAINS.filter(c => restrictChain ? (c.id === 'all' || c.id === restrictChain) : true);
  
  const filteredChains = availableChains.filter(c => 
    c.id !== 'all' && c.name.toLowerCase().includes(chainSearch.toLowerCase())
  );

  const filteredTokens = MOCK_TOKENS.filter(t => {
    const isAllowedChain = restrictChain ? t.chain.toLowerCase() === restrictChain : true;
    const matchChain = selectedChainId === 'all' || t.chain.toLowerCase() === selectedChainId.toLowerCase();
    const matchSearch = t.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) || 
                       t.address.toLowerCase().includes(tokenSearch.toLowerCase());
    return matchChain && matchSearch && isAllowedChain;
  });

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div 
        className="bg-[#1C212B] w-full max-w-[640px] h-[580px] rounded-[24px] overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-white/5">
          <h2 className="text-white font-semibold text-[16px]">Select Token</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-white/10 text-slate-400 hover:text-white" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>

        {/* Two Columns */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Column: Chains */}
          <div className="w-[220px] bg-[#161B22] flex flex-col border-r border-white/5">
            <div className="p-4">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input 
                  type="text" 
                  placeholder="Search chains"
                  value={chainSearch}
                  onChange={(e) => setChainSearch(e.target.value)}
                  className="w-full bg-[#1C212B] border border-white/5 rounded-xl py-2 pl-9 pr-3 text-[13px] text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50 transition-colors"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-4 custom-scrollbar">
              <div className="space-y-0.5">
                <button 
                  onClick={() => setSelectedChainId('all')}
                  className={`cursor-pointer w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${selectedChainId === 'all' ? 'bg-indigo-500/10 text-indigo-400' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
                >
                  <div className={`w-6 h-6 rounded flex items-center justify-center ${selectedChainId === 'all' ? 'bg-indigo-500/20' : 'bg-[#1C212B]'}`}>
                    <Globe size={14} className={selectedChainId === 'all' ? 'text-indigo-400' : 'text-slate-400'} />
                  </div>
                  <span className="text-[14px] font-medium">All Chains</span>
                </button>
              </div>

              <div className="space-y-1">
                <div className="px-3 pb-1 flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <Star size={10} className="fill-slate-500" /> Starred Chains
                </div>
                {availableChains.filter(c => c.id === 'base' || c.id === 'solana').map(chain => (
                  <button 
                    key={`star-${chain.id}`}
                    onClick={() => setSelectedChainId(chain.id)}
                    className={`cursor-pointer w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${selectedChainId === chain.id ? 'bg-indigo-500/10 text-indigo-400' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
                  >
                    <img src={chain.icon} alt={chain.name} className="w-6 h-6 rounded-full" />
                    <span className="text-[14px] font-medium">{chain.name}</span>
                  </button>
                ))}
              </div>

              <div className="space-y-1">
                <div className="px-3 pb-1 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Chains A-Z
                </div>
                {filteredChains.map(chain => (
                  <button 
                    key={chain.id}
                    onClick={() => setSelectedChainId(chain.id)}
                    className={`cursor-pointer w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${selectedChainId === chain.id ? 'bg-indigo-500/10 text-indigo-400' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
                  >
                    <img src={chain.icon} alt={chain.name} className="w-6 h-6 rounded-full" />
                    <span className="text-[14px] font-medium">{chain.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Tokens */}
          <div className="flex-1 flex flex-col bg-[#1C212B]">
            <div className="p-4 border-b border-white/5">
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input 
                  type="text" 
                  placeholder="Search for a token or paste address"
                  value={tokenSearch}
                  onChange={(e) => setTokenSearch(e.target.value)}
                  className="w-full bg-[#161B22] border border-white/5 rounded-xl py-3 pl-10 pr-4 text-[14px] text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50 transition-colors"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
              <div className="px-3 py-2 text-[12px] text-slate-500">
                Global 24H Volume
              </div>
              
              <div className="flex flex-col gap-1">
                {filteredTokens.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-[14px]">
                    No tokens found matching this criteria.
                  </div>
                ) : (
                  filteredTokens.map(token => (
                    <button 
                      key={token.id}
                      onClick={() => onSelect(token)}
                      className="cursor-pointer w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors group"
                    >
                      <div className="flex items-center gap-3.5">
                        <div className="relative">
                          <img src={token.logo} alt={token.symbol} className="w-10 h-10 rounded-full" />
                          <div className="absolute -bottom-1 -right-1 bg-[#1C212B] rounded-full p-[2px]">
                            <img src={token.chainLogo} alt={token.chain} className="w-4 h-4 rounded-full" />
                          </div>
                        </div>
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="text-[16px] font-bold text-white leading-none">{token.symbol}</span>
                          <div className="flex items-center gap-1">
                            <span className="text-[12px] text-slate-400 leading-none">{token.chain}</span>
                            <span className="text-[12px] text-slate-500 leading-none">{token.address}</span>
                            {!token.isPopular && <CircleAlert size={12} className="text-slate-500" />}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[15px] font-semibold text-white">{balances?.[token.symbol] ?? '0'}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.1);
          border-radius: 20px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
}
