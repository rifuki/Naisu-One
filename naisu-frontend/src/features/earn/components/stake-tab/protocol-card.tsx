import type { YieldRate } from '../../api/get-yield-rates';
import { ProtocolIcon } from './protocol-icon';

interface ProtocolCardProps {
  rate: YieldRate;
  selected: boolean;
  onSelect: () => void;
}

function riskBadgeClass(riskLevel: string): string {
  switch (riskLevel) {
    case 'low':
      return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20';
    case 'medium':
      return 'bg-amber-500/15 text-amber-400 border border-amber-500/20';
    case 'high':
      return 'bg-red-500/15 text-red-400 border border-red-500/20';
    default:
      return 'bg-slate-500/15 text-slate-400 border border-slate-500/20';
  }
}

export function ProtocolCard({ rate, selected, onSelect }: ProtocolCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left flex items-center gap-4 p-4 rounded-xl border transition-all
        ${selected ? 'border-primary/40 bg-primary/5' : 'border-white/8 bg-white/2 hover:border-white/15'}`}
    >
      <ProtocolIcon id={rate.id} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-white text-sm">{rate.name}</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${riskBadgeClass(rate.riskLevel)}`}>
            {rate.riskLabel}
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{rate.description}</p>
      </div>
      <div className="text-right shrink-0">
        <div className="text-2xl font-bold text-emerald-400">
          {rate.apy > 0 ? `${rate.apy.toFixed(2)}%` : '— %'}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">APY</div>
      </div>
    </button>
  );
}
