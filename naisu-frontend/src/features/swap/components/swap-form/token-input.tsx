import { useRef } from 'react';
import { fmtUsd } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ChevronRight } from 'lucide-react';

interface TokenInputProps {
  label: string;
  amount: string;
  onChange: (value: string) => void;
  balance: string | null;
  rawBalance: string;
  tokenSymbol: string;
  chainName: string;
  tokenIcon: React.ReactNode;
  chainIcon?: React.ReactNode;
  usdValue?: number | null;
  isLoading?: boolean;
  placeholder?: string;
  readOnly?: boolean;
  onMaxClick?: () => void;
  walletActionNode?: React.ReactNode;
  onTokenSelectorClick?: () => void;
}

export function TokenInput({
  label,
  amount,
  onChange,
  balance,
  rawBalance,
  tokenSymbol,
  chainName,
  tokenIcon,
  usdValue,
  placeholder = '0',
  onMaxClick,
  walletActionNode,
  onTokenSelectorClick,
  isLoading,
  readOnly = false,
  chainIcon,
}: TokenInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      onChange(val);
    }
  };

  const displayValue = isLoading ? (
    <span className="text-slate-600 text-4xl animate-pulse">…</span>
  ) : amount ? (
    <span className="text-white">{amount}</span>
  ) : (
    <span className="text-slate-600 mr-2">{placeholder}</span>
  );

  return (
    <div className="bg-white/[0.04] backdrop-blur-2xl rounded-[16px] px-4 pt-4 pb-3 border border-white/5 shadow-lg transition-all relative group focus-within:bg-white/[0.06] focus-within:border-white/10">
      {/* Row 1: Sell/Buy Label + Wallet Action */}
      <div className="flex justify-between items-center mb-1">
        <label className="text-[14px] font-medium text-slate-400">{label}</label>
        <div className="flex items-center">
          {walletActionNode}
        </div>
      </div>

      {/* Row 2: Amount Input + Token Selector */}
      <div className="flex items-center justify-between gap-2 mt-4">
        {readOnly ? (
          <div className="font-bold text-[32px] leading-[36px] w-full truncate pt-1 select-none text-white tracking-tight">
            {displayValue}
          </div>
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={amount}
            onChange={handleChange}
            readOnly={readOnly}
            placeholder={placeholder}
            className={`w-full bg-transparent outline-none font-bold text-[32px] leading-[36px] !p-0 tracking-tight transition-colors ${
              readOnly ? 'text-white' : 'text-white hover:text-white focus:text-white'
            } ${!amount ? 'text-slate-600' : ''}`}
          />
        )}

        <Button
          variant="outline"
          type="button"
          onClick={onTokenSelectorClick}
          className="flex items-center gap-2.5 bg-white/5 hover:bg-white/10 hover:text-white border-white/5 rounded-full h-[50px] pl-[9px] pr-4 shrink-0 transition-colors shadow-sm"
        >
          <div className="relative w-8 h-8 shrink-0 flex items-center justify-center">
            <div className="w-full h-full rounded-full flex items-center justify-center overflow-hidden">
              {tokenIcon}
            </div>
            {chainIcon && (
              <div className="absolute -bottom-0.5 -right-0.5 w-[14px] h-[14px] border-[0.5px] border-white/20 rounded-full ring-2 ring-[#0A0D11] bg-[#0A0D11] flex items-center justify-center overflow-hidden">
                {chainIcon}
              </div>
            )}
          </div>
          <div className="flex flex-col items-start leading-tight mr-1 justify-center">
            <span className="font-bold text-white text-[16px]">{tokenSymbol}</span>
            <span className="text-[12px] font-medium text-[#64748b]">{chainName}</span>
          </div>
          <ChevronRight size={18} strokeWidth={2.5} className="text-[#64748b] shrink-0" />
        </Button>
      </div>

      {/* Row 3: USD Value + Balance */}
      <div className="flex justify-between items-center mt-3">
        <span className="text-[14px] font-medium text-slate-500">
          {usdValue && parseFloat(amount || '0') > 0
            ? fmtUsd(usdValue * parseFloat(amount || '0'))
            : '$0.00'}
        </span>

        {balance !== null ? (
          <div className="text-[13px] font-medium text-slate-500 flex items-center gap-1.5">
            Balance: {balance}
            {onMaxClick && (
              <Button
                variant="ghost"
                type="button"
                onClick={onMaxClick}
                className="p-0 h-auto leading-none text-[12px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                Max
              </Button>
            )}
          </div>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}
