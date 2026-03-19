import { useRef } from 'react';
import { fmtUsd } from '@/lib/utils/format';

interface TokenInputProps {
  label: string;
  amount: string;
  onChange: (value: string) => void;
  balance: string | null;
  rawBalance: string;
  tokenSymbol: string;
  chainName: string;
  address?: string | null;
  tokenIcon: React.ReactNode;
  usdValue?: number | null;
  isLoading?: boolean;
  placeholder?: string;
  readOnly?: boolean;
  onMaxClick?: () => void;
}

export function TokenInput({
  label,
  amount,
  onChange,
  balance,
  rawBalance,
  tokenSymbol,
  chainName,
  address,
  tokenIcon,
  usdValue,
  isLoading,
  placeholder = '0',
  readOnly = false,
  onMaxClick,
}: TokenInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/[^0-9.]/g, '');
    if ((v.match(/\./g) ?? []).length <= 1) {
      onChange(v);
    }
  };

  const displayValue = isLoading ? (
    <span className="text-slate-600 text-2xl animate-pulse">…</span>
  ) : amount ? (
    <span className="text-white">{amount}</span>
  ) : (
    <span className="text-slate-600">0</span>
  );

  return (
    <div className="bg-surface-light/50 rounded-xl p-4 border border-white/5 focus-within:border-primary/30 transition-all">
      {/* Row 1: label + address */}
      <div className="flex justify-between items-center mb-3">
        <label className="text-xs font-medium text-slate-400">{label}</label>
        {address ? (
          <span className="text-xs text-slate-500 font-mono">
            {address.slice(0, 6)}…{address.slice(-5)}
          </span>
        ) : (
          <span className="text-xs text-amber-500/80">wallet not connected</span>
        )}
      </div>

      {/* Row 2: amount input + token pill */}
      <div className="flex items-center gap-3">
        {readOnly ? (
          <div className="text-3xl font-medium w-full">{displayValue}</div>
        ) : (
          <input
            ref={inputRef}
            className="bg-transparent border-none p-0 text-3xl font-medium text-white placeholder-slate-600 focus:ring-0 w-full outline-none"
            placeholder={placeholder}
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={handleChange}
            autoFocus
          />
        )}

        <div className="flex items-center gap-2.5 bg-surface border border-white/10 rounded-xl py-2 pl-2.5 pr-3 shrink-0">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0">{tokenIcon}</div>
          <div className="flex flex-col leading-tight">
            <span className="font-bold text-white text-sm">{tokenSymbol}</span>
            <span className="text-[10px] text-slate-500">{chainName}</span>
          </div>
        </div>
      </div>

      {/* Row 3: USD value + balance */}
      <div className="flex justify-between items-center mt-2">
        <span className="text-xs text-slate-600">
          {usdValue && parseFloat(amount || '0') > 0
            ? fmtUsd(usdValue * parseFloat(amount || '0'))
            : '\u00a0'}
        </span>

        {balance !== null ? (
          <span className="text-xs text-slate-500 flex items-center gap-1.5">
            Balance: {balance}
            {onMaxClick && (
              <button
                type="button"
                onClick={onMaxClick}
                className="text-[10px] font-bold text-primary hover:text-primary/70 uppercase transition-colors"
              >
                Max
              </button>
            )}
          </span>
        ) : (
          <span className="text-xs text-slate-600">Balance: —</span>
        )}
      </div>
    </div>
  );
}
