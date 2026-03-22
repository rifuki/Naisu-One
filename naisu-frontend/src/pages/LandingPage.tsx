import React, { useState, KeyboardEvent, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from "@tanstack/react-router";
import { GROQ_API_KEY } from '@/lib/env'

const SUGGESTIONS = [
  'Bridge 0.001 ETH from Base Sepolia to Solana',
  'How much SUI will I get for 0.05 ETH?',
  'Check my SOL and ETH balances',
];

const WHISPER_PROMPT =
  'Ethereum ETH Solana SOL Sui SUI Base Sepolia mSOL USDC USDT Bridge swap stake gasless EIP-712 Wormhole VAA intent solver RFQ Marinade';

// Web Speech API types
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

const LandingPage: React.FC = () => {
  const [inputValue, setInputValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 600);
    return () => {
      clearTimeout(t);
      recognitionRef.current?.stop();
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    };
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

  const transcribeWithGroq = useCallback(async (audioBlob: Blob) => {
    if (!GROQ_API_KEY) return;
    setIsTranscribing(true);
    try {
      const file = new File([audioBlob], 'audio.webm', { type: audioBlob.type });
      const form = new FormData();
      form.append('file', file);
      form.append('model', 'whisper-large-v3-turbo');
      form.append('prompt', WHISPER_PROMPT);
      form.append('response_format', 'text');
      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
        body: form,
      });
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text) setInputValue(text);
      }
    } finally {
      setIsTranscribing(false);
      inputRef.current?.focus();
    }
  }, []);

  const stopMic = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsListening(false);
  }, []);

  const handleMic = useCallback(async () => {
    if (!GROQ_API_KEY) return;
    if (isListening) { stopMic(); return; }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // ── MediaRecorder: full audio for Groq ──
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        transcribeWithGroq(new Blob(chunksRef.current, { type: recorder.mimeType }));
      };
      recorder.start();
      mediaRecorderRef.current = recorder;

      // ── Accumulated final transcript across SR restarts ──
      let finalText = '';

      // ── Web Audio VAD: stop after 2.5s of real silence ──
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      const vadData = new Uint8Array(analyser.frequencyBinCount);
      let silenceStart = 0;
      const SILENCE_MS = 2500;
      const MIN_MS = 800;
      const startedAt = Date.now();
      let vadStopped = false;

      const vadLoop = () => {
        if (vadStopped) return;
        analyser.getByteTimeDomainData(vadData);
        const rms = Math.sqrt(vadData.reduce((s, v) => s + (v - 128) ** 2, 0) / vadData.length);
        const now = Date.now();
        if (rms < 8) {
          if (!silenceStart) silenceStart = now;
          if (now - silenceStart > SILENCE_MS && now - startedAt > MIN_MS) {
            vadStopped = true;
            audioCtx.close();
            stopMic();
            return;
          }
        } else {
          silenceStart = 0;
        }
        requestAnimationFrame(vadLoop);
      };
      requestAnimationFrame(vadLoop);

      // ── Web Speech API: real-time interim words ──
      const startRecognition = () => {
        if (vadStopped) return;
        const SR2 = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR2) return;
        const r = new SR2();
        r.lang = navigator.language || 'en-US';
        r.continuous = false;
        r.interimResults = true;

        r.onresult = (e: SpeechRecognitionEvent) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
            else interim = e.results[i][0].transcript;
          }
          setInputValue((finalText + interim).trim());
        };

        // Chrome stops SR after ~2s silence — restart immediately if still listening
        r.onend = () => { if (!vadStopped) startRecognition(); };
        r.onerror = (e: Event) => {
          const err = (e as ErrorEvent).message || '';
          // 'no-speech' is normal — just restart
          if (!vadStopped && err !== 'aborted') startRecognition();
        };

        recognitionRef.current = r;
        r.start();
      };

      startRecognition();
      setIsListening(true);
    } catch {
      // permission denied
    }
  }, [isListening, stopMic, transcribeWithGroq]);

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

  const micSupported = !!GROQ_API_KEY
    && !!navigator.mediaDevices
    && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  return (
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
          Bridge, swap, and stake across Base, Solana, and Sui — with one natural language intent. Gasless. Solver-executed. No complexity.
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
              {/* Sparkle */}
              <span
                className="material-symbols-outlined animate-pulse-slow flex-shrink-0"
                style={{
                  fontSize: 22,
                  color: '#0df2df',
                  fontVariationSettings: "'FILL' 1, 'wght' 300, 'GRAD' 0, 'opsz' 24",
                }}
              >
                auto_awesome
              </span>

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
                <button
                  onClick={handleMic}
                  disabled={isTranscribing}
                  className="flex-shrink-0 flex items-center justify-center rounded-xl transition-all"
                  title={isListening ? 'Stop recording' : isTranscribing ? 'Transcribing...' : 'Speak your intent (Ctrl+Space)'}
                  style={{
                    width: 38,
                    height: 38,
                    background: isListening ? 'rgba(13,242,223,0.12)' : 'transparent',
                    color: isListening ? '#0df2df' : isTranscribing ? '#4f46e5' : '#3a4a47',
                    boxShadow: isListening ? '0 0 12px rgba(13,242,223,0.3)' : 'none',
                    cursor: isTranscribing ? 'default' : 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={e => { if (!isListening && !isTranscribing) e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={e => { if (!isListening && !isTranscribing) e.currentTarget.style.color = '#3a4a47'; }}
                >
                  <span
                    className={isListening ? 'animate-pulse' : isTranscribing ? 'animate-spin' : ''}
                    style={{ fontSize: 20, fontFamily: 'Material Symbols Outlined' }}
                  >
                    {isTranscribing ? 'progress_activity' : 'mic'}
                  </span>
                </button>
              )}

              {/* Send */}
              <button
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
                <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'wght' 500" }}>
                  arrow_forward
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Suggestion chips */}
        <div
          className="opacity-0 animate-fade-in-up flex flex-wrap justify-center gap-2"
          style={{ animationDelay: '320ms', animationFillMode: 'forwards' }}
        >
          {SUGGESTIONS.map((text) => (
            <button
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
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LandingPage;
