import { X, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TokenSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'sell' | 'buy' | null;
  onSelect: (token: string) => void;
}

export function TokenSelectModal({ isOpen, onClose, type, onSelect }: TokenSelectModalProps) {
  if (!isOpen) return null;

  // Static mock data based on the requirements
  const tokens = type === 'sell' 
    ? [
        { id: 'eth', symbol: 'ETH', name: 'Ethereum', chain: 'Base', icon: '/tokens/eth.svg', chainIcon: '/tokens/base.svg' },
        { id: 'usdc', symbol: 'USDC', name: 'USDC', chain: 'Base', icon: '/tokens/usdc.svg', chainIcon: '/tokens/base.svg' },
      ]
    : [
        { id: 'sol', symbol: 'SOL', name: 'Solana', chain: 'Solana', icon: '/tokens/sol.svg', chainIcon: '/tokens/sol.svg' },
        { id: 'usdc', symbol: 'USDC', name: 'USDC', chain: 'Solana', icon: '/tokens/usdc.svg', chainIcon: '/tokens/sol.svg' },
      ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-[#131B24] border border-white/10 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-4 pb-2">
          <h2 className="text-lg font-bold text-white">Select Token</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="w-8 h-8 rounded-full text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
            <X size={18} />
          </Button>
        </div>

        <div className="px-4 pb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input 
              type="text" 
              placeholder="Search for a token or paste address" 
              className="w-full pl-10 pr-4 py-3 bg-[#0B0E14] border border-white/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-white placeholder:text-slate-500 font-medium"
            />
          </div>
        </div>

        {/* Token List */}
        <div className="max-h-[60vh] overflow-y-auto pb-4">
          <div className="px-5 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Available on {type === 'sell' ? 'Base Sepolia' : 'Solana Devnet'}
          </div>
          
          {tokens.map((token) => (
            <Button
              variant="ghost"
              key={token.id}
              onClick={() => { onSelect(token.id); onClose(); }}
              className="w-full justify-start h-auto flex items-center gap-3 px-5 py-3 hover:bg-white/5 hover:text-white transition-colors group"
            >
              <div className="relative w-10 h-10 shrink-0">
                <img src={token.icon} alt={token.symbol} className="w-full h-full rounded-full shadow-sm group-hover:scale-105 transition-transform" />
                {token.chainIcon && (
                  <div className="absolute -bottom-1 -right-1 w-[18px] h-[18px] border-[0.5px] border-white/20 rounded-full ring-2 ring-[#161B22] bg-[#161B22] flex items-center justify-center overflow-hidden group-hover:scale-105 transition-transform">
                    <img src={token.chainIcon} alt={token.chain} className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
              <div className="flex flex-col items-start leading-tight">
                <span className="font-bold text-white text-[15px]">{token.symbol}</span>
                <span className="text-[12px] font-medium text-slate-400">{token.name} · {token.chain}</span>
              </div>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
