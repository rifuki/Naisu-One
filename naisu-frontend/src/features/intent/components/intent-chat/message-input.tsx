import { useState, FormEvent, KeyboardEvent } from 'react';

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
  placeholder = 'Type a message...',
}: MessageInputProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/20 to-indigo-500/20 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500" />
      <div className="relative glass-panel rounded-2xl p-2 flex items-center gap-2 bg-background/60">
        <input
          className="w-full bg-transparent border-none focus:ring-0 text-white placeholder-slate-500 text-lg font-light h-12 outline-none"
          placeholder={isLoading ? 'Agent is thinking...' : placeholder}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
        />
        <button
          className="p-3 bg-white/10 hover:bg-primary hover:text-black text-white transition-all rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onSubmit}
          disabled={!value.trim() || isLoading}
        >
          <span className="material-symbols-outlined">{isLoading ? 'hourglass_top' : 'send'}</span>
        </button>
      </div>
    </div>
  );
}
