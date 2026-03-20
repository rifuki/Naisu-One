import { useState, FormEvent, KeyboardEvent } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading?: boolean;
  placeholder?: string;
}

export function MessageInput({
  value,
  onChange,
  onSubmit,
  isLoading = false,
  placeholder = 'Message Nesu...',
}: MessageInputProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !isLoading) {
        onSubmit();
      }
    }
  };

  return (
    <div className="relative group w-full">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/20 to-indigo-500/20 rounded-[24px] blur opacity-20 group-hover:opacity-40 transition duration-500" />
      <div className="relative bg-[#0A0A0A]/90 backdrop-blur-2xl border border-white/10 rounded-[28px] p-1.5 flex items-center shadow-2xl transition-all group-focus-within:border-primary/40 group-focus-within:bg-[#050505] group-focus-within:shadow-[0_0_30px_rgba(var(--primary),0.1)]">
        <input
          className="flex-1 bg-transparent border-none focus:ring-0 text-white placeholder-slate-500 text-[15px] px-4 py-3 outline-none font-normal"
          placeholder={isLoading ? 'Agent is thinking...' : placeholder}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
        />
        <button
          className="p-2.5 mx-1 flex-shrink-0 bg-white border border-white/5 hover:bg-slate-200 text-black rounded-full shadow-md disabled:bg-white/10 disabled:text-white/40 disabled:shadow-none disabled:cursor-not-allowed transition-all active:scale-95 flex items-center justify-center cursor-pointer"
          onClick={onSubmit}
          disabled={!value.trim() || isLoading}
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <ArrowUp className="w-5 h-5 stroke-[2.5px]" />
          )}
        </button>
      </div>
    </div>
  );
}

