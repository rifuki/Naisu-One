import type { BalanceDisplayWidget as BalanceDisplayWidgetData } from './types';

function shortenAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

interface Props {
  widget: BalanceDisplayWidgetData;
}

export function BalanceDisplayWidget({ widget }: Props) {
  const hasEvm = widget.evmBalance !== undefined && widget.evmAddress;
  const hasSol = widget.solBalance !== undefined && widget.solAddress;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-white/5">
        <span className="material-symbols-outlined text-slate-400 text-[15px]">account_balance_wallet</span>
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.1em]">Wallet Balances</span>
      </div>
      <div className="px-4 py-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {hasEvm && (
          <div className="flex flex-col gap-1 py-2 px-3 rounded-lg bg-indigo-500/5 border border-indigo-500/15">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="size-2 rounded-full bg-indigo-400" />
              <span className="text-[10px] text-indigo-400 font-semibold">Base Sepolia</span>
            </div>
            <span className="text-base font-bold text-white tabular-nums">{parseFloat(widget.evmBalance!).toFixed(4)} ETH</span>
            <span className="text-[10px] font-mono text-slate-600">{shortenAddress(widget.evmAddress!)}</span>
          </div>
        )}
        {hasSol && (
          <div className="flex flex-col gap-1 py-2 px-3 rounded-lg bg-purple-500/5 border border-purple-500/15">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="size-2 rounded-full bg-purple-400" />
              <span className="text-[10px] text-purple-400 font-semibold">Solana Devnet</span>
            </div>
            <span className="text-base font-bold text-white tabular-nums">{parseFloat(widget.solBalance!).toFixed(4)} SOL</span>
            <span className="text-[10px] font-mono text-slate-600">{shortenAddress(widget.solAddress!)}</span>
          </div>
        )}
        {!hasEvm && !hasSol && (
          <p className="text-slate-600 text-xs col-span-2 py-2">No balance data available.</p>
        )}
      </div>
    </div>
  );
}
