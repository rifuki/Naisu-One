interface TokenSelectorProps {
  value: 'sol' | 'msol';
  onChange: (value: 'sol' | 'msol') => void;
}

export function TokenSelector({ value, onChange }: TokenSelectorProps) {
  return (
    <div className="mt-3 px-1">
      <p className="text-xs text-slate-500 mb-2">Receive as</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange('sol')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-semibold transition-all
            ${
              value === 'sol'
                ? 'bg-primary/15 border-primary/40 text-primary'
                : 'bg-white/3 border-white/8 text-slate-400 hover:border-white/15 hover:text-slate-300'
            }`}
        >
          <span
            className={`font-bold w-5 h-5 rounded-full flex items-center justify-center text-xs ${
              value === 'sol' ? 'text-primary bg-primary/10' : 'text-purple-300 bg-purple-500/20'
            }`}
          >
            ◎
          </span>
          SOL
        </button>
      </div>
    </div>
  );
}
