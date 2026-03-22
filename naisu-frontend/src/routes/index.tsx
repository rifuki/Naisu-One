import React, { useState, KeyboardEvent, useRef, useEffect, useCallback } from 'react';
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Sparkles, Loader2, ArrowRight, Mic } from 'lucide-react';
import { useMic } from '@/hooks/use-mic';

export const Route = createFileRoute("/")({
  component: LandingPage,
});

const SUGGESTIONS = [
  'Bridge 0.001 ETH from Base Sepolia to Solana',
  'How much SOL will I get for 0.1 ETH?',
  'Check my SOL and ETH balances',
];

const LandingPage: React.FC = () => {
  const [inputValue, setInputValue] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const { isListening, isTranscribing, handleMic, micSupported } = useMic((text) => {
    setInputValue(text);
    inputRef.current?.focus();
  });

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 600);
    return () => clearTimeout(t);
  }, []);

  const handleSend = useCallback(() => {
    if (!inputValue.trim()) return;
    navigate({ to: "/intent", state: { initialIntent: inputValue } });
  }, [inputValue, navigate]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChipClick = (text: string) => {
    navigate({ to: "/intent", state: { initialIntent: text } });
  };

  const handleLucky = useCallback(() => {
    const pick = SUGGESTIONS[Math.floor(Math.random() * SUGGESTIONS.length)];
    navigate({ to: "/intent", state: { initialIntent: pick } });
  }, [navigate]);

  // Keyboard shortcut: Ctrl+Space → toggle mic
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.code === 'Space' && e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        handleMic();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleMic]);

  return (
    <TooltipProvider delayDuration={400}>
    <div className="relative flex flex-col items-center justify-center min-h-[calc(100dvh-64px)] px-4 overflow-hidden">

      {/* ── Ambient background glows ── */}
      <div
        className="pointer-events-none absolute"
        style={{
          top: '-15%',
          left: '-10%',
          width: 700,
          height: 700,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(13,242,223,0.07) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          bottom: '-10%',
          right: '-8%',
          width: 560,
          height: 560,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(79,70,229,0.08) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />

      {/* ── Content stack ── */}
      <div className="relative z-10 flex flex-col items-center w-full max-w-2xl gap-0">

        {/* Headline */}
        <div
          className="opacity-0 animate-fade-in-up text-center mb-6"
          style={{ animationDelay: '80ms', animationFillMode: 'forwards' }}
        >
          <h1
            className="font-extrabold tracking-tight leading-none"
            style={{ fontSize: 'clamp(52px, 8vw, 88px)', color: '#ffffff', letterSpacing: '-0.03em' }}
          >
            One Intent.
          </h1>
          <h1
            className="font-extrabold tracking-tight leading-none"
            style={{ fontSize: 'clamp(52px, 8vw, 88px)', color: 'rgba(255,255,255,0.12)', letterSpacing: '-0.03em' }}
          >
            Just Sign.
          </h1>
        </div>

        {/* Subtext */}
        <p
          className="opacity-0 animate-fade-in-up text-center text-slate-400 mb-10 leading-relaxed"
          style={{
            animationDelay: '160ms',
            animationFillMode: 'forwards',
            fontSize: '1.0625rem',
            maxWidth: 480,
          }}
        >
          Bridge ETH to Solana with one natural language intent. Gasless. Solver-executed. No complexity.
        </p>

        {/* Input */}
        <div
          className="opacity-0 animate-fade-in-up w-full mb-5"
          style={{ animationDelay: '240ms', animationFillMode: 'forwards' }}
        >
          <div
            className="relative"
            style={{
              borderRadius: 18,
              padding: 1,
              background: isListening
                ? 'linear-gradient(135deg, rgba(13,242,223,0.6) 0%, rgba(13,242,223,0.2) 100%)'
                : isTranscribing
                  ? 'linear-gradient(135deg, rgba(79,70,229,0.5) 0%, rgba(13,242,223,0.2) 100%)'
                  : focused
                    ? 'linear-gradient(135deg, rgba(13,242,223,0.35) 0%, rgba(79,70,229,0.2) 100%)'
                    : 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)',
              boxShadow: isListening
                ? '0 0 40px rgba(13,242,223,0.25), 0 0 80px rgba(13,242,223,0.1)'
                : isTranscribing
                  ? '0 0 40px rgba(79,70,229,0.2)'
                  : focused
                    ? '0 0 40px rgba(13,242,223,0.12), 0 0 80px rgba(13,242,223,0.06)'
                    : 'none',
              transition: 'background 0.35s ease, box-shadow 0.35s ease',
            }}
          >
            <div
              className="flex items-center w-full"
              style={{
                borderRadius: 17,
                background: 'rgba(10,16,15,0.85)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                height: 62,
                paddingLeft: 18,
                paddingRight: 10,
                gap: 10,
              }}
            >
              {/* I'm feeling lucky */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={handleLucky}
                    className="flex-shrink-0 flex items-center justify-center rounded-xl transition-all"
                    style={{ width: 38, height: 38, background: 'transparent', color: '#0df2df', cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(13,242,223,0.08)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Sparkles size={20} strokeWidth={1.5} className="animate-pulse-slow" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">I&apos;m feeling lucky</TooltipContent>
              </Tooltip>

              {/* Input field */}
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder={isTranscribing ? 'Transcribing...' : isListening ? 'Listening... (click mic to stop)' : 'What do you want to do across chains?'}
                className="flex-1 bg-transparent border-none outline-none font-medium"
                style={{
                  color: '#fff',
                  fontSize: '1rem',
                  caretColor: '#0df2df',
                }}
              />

              {/* Mic */}
              {micSupported && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={handleMic}
                      disabled={isTranscribing}
                      className="flex-shrink-0 flex items-center justify-center rounded-xl transition-all"
                      style={{
                        width: 38, height: 38,
                        background: isListening ? 'rgba(13,242,223,0.12)' : 'transparent',
                        color: isListening ? '#0df2df' : isTranscribing ? '#4f46e5' : '#3a4a47',
                        boxShadow: isListening ? '0 0 12px rgba(13,242,223,0.3)' : 'none',
                        cursor: isTranscribing ? 'default' : 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={e => { if (!isListening && !isTranscribing) e.currentTarget.style.color = '#fff'; }}
                      onMouseLeave={e => { if (!isListening && !isTranscribing) e.currentTarget.style.color = '#3a4a47'; }}
                    >
                      {isTranscribing
                        ? <Loader2 size={20} strokeWidth={1.5} className="animate-spin" />
                        : <Mic size={20} strokeWidth={1.5} className={isListening ? 'animate-pulse' : ''} />
                      }
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {isListening ? 'Stop recording' : 'Speak your intent (Ctrl+Space)'}
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Send */}
              <Button
                onClick={handleSend}
                disabled={!inputValue.trim()}
                className="flex-shrink-0 flex items-center justify-center rounded-xl transition-all active:scale-95"
                style={{
                  width: 40,
                  height: 40,
                  background: inputValue.trim() ? '#0df2df' : 'rgba(13,242,223,0.1)',
                  color: inputValue.trim() ? '#000' : '#1a4a45',
                  boxShadow: inputValue.trim() ? '0 0 20px rgba(13,242,223,0.4)' : 'none',
                  cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s ease',
                }}
              >
                <ArrowRight size={20} strokeWidth={1.5} />
              </Button>
            </div>
          </div>
        </div>

        {/* Suggestion chips */}
        <div
          className="opacity-0 animate-fade-in-up flex flex-wrap justify-center gap-2"
          style={{ animationDelay: '320ms', animationFillMode: 'forwards' }}
        >
          {SUGGESTIONS.map((text) => (
            <Button
              key={text}
              onClick={() => handleChipClick(text)}
              className="px-4 py-2 rounded-full text-sm font-medium text-slate-500 transition-all"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = '#fff';
                e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = '';
                e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)';
                e.currentTarget.style.transform = '';
              }}
            >
              {text}
            </Button>
          ))}
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
};
