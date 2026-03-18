import { useState, FormEvent, KeyboardEvent } from 'react';

interface IntentZeroStateProps {
  onSubmit: (input: string) => void;
}

const SUGGESTIONS = [
  'Bridge 0.1 ETH from Base Sepolia to Solana',
  'Bridge 0.001 ETH from Base Sepolia to Solana',
  'How much SOL will I get for 0.1 ETH?',
];

export function IntentZeroState({ onSubmit }: IntentZeroStateProps) {
  const [inputValue, setInputValue] = useState('');

  const handleSend = () => {
    if (!inputValue.trim()) return;
    onSubmit(inputValue);
    setInputValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChipClick = (text: string) => {
    setInputValue(text);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-140px)] px-4 relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute top-[10%] left-[-10%] w-[800px] h-[800px] bg-primary/5 rounded-full blur-[120px] animate-pulse-slow pointer-events-none" />
      <div className="absolute top-[40%] right-[-10%] w-[600px] h-[600px] bg-indigo-900/10 rounded-full blur-[150px] pointer-events-none" />

      {/* Main Content */}
      <div className="w-full max-w-4xl flex flex-col items-center z-10">
        {/* Badge */}
        <div
          className="mb-8 opacity-0 animate-fade-in-up"
          style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}
        >
          <span className="px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-[10px] font-bold tracking-[0.2em] text-slate-400 uppercase backdrop-blur-md shadow-lg">
            Powered by NesuClaw Agent
          </span>
        </div>

        {/* Typography */}
        <div
          className="text-center mb-8 opacity-0 animate-fade-in-up"
          style={{ animationDelay: '100ms', animationFillMode: 'forwards' }}
        >
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-0 leading-tight">
            One Intent.
          </h1>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-slate-600 leading-tight">
            Any Liquidity Outcome.
          </h1>
        </div>

        {/* Subheading */}
        <p
          className="text-lg md:text-xl text-slate-400 text-center max-w-2xl mb-12 opacity-0 animate-fade-in-up leading-relaxed"
          style={{ animationDelay: '200ms', animationFillMode: 'forwards' }}
        >
          Execute complex DeFi strategies across chains with simple natural language. Powered by
          intent-centric solvers.
        </p>

        {/* Input Box */}
        <div
          className="w-full max-w-2xl relative mb-12 opacity-0 animate-fade-in-up"
          style={{ animationDelay: '300ms', animationFillMode: 'forwards' }}
        >
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/30 to-indigo-500/30 rounded-2xl blur opacity-30 group-hover:opacity-60 transition duration-500" />
            <div className="relative bg-[#0e1211] border border-white/10 rounded-2xl flex items-center p-2 shadow-2xl transition-all focus-within:border-primary/50">
              <div className="pl-4 pr-3 text-primary animate-pulse-slow">
                <span className="material-symbols-outlined text-2xl">auto_awesome</span>
              </div>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Bridge 0.1 ETH from Base Sepolia to Solana..."
                className="flex-1 bg-transparent border-none text-white placeholder-slate-500 text-lg h-14 focus:ring-0 outline-none font-medium"
                autoFocus
              />
              <div className="flex items-center gap-2 pr-2">
                <button className="p-3 text-slate-500 hover:text-white transition-colors hover:bg-white/5 rounded-xl">
                  <span className="material-symbols-outlined">mic</span>
                </button>
                <button
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  className="p-3 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-black rounded-xl transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-[0_0_15px_-3px_rgba(13,242,223,0.4)]"
                >
                  <span className="material-symbols-outlined">arrow_forward</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Chips */}
        <div
          className="flex flex-wrap justify-center gap-3 opacity-0 animate-fade-in-up"
          style={{ animationDelay: '400ms', animationFillMode: 'forwards' }}
        >
          {SUGGESTIONS.map((text) => (
            <button
              key={text}
              onClick={() => handleChipClick(text)}
              className="px-5 py-2.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-slate-400 hover:text-white text-sm font-medium transition-all hover:-translate-y-0.5"
            >
              {text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
