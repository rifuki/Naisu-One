import { useState, useRef, useCallback, useEffect } from 'react';
import { GROQ_API_KEY } from '@/lib/env';

const WHISPER_PROMPT =
  'Ethereum ETH Solana SOL Base Sepolia mSOL USDC USDT Bridge swap stake gasless EIP-712 Wormhole VAA intent solver RFQ Marinade';

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

export function useMic(onResult: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    };
  }, []);

  const micSupported =
    !!GROQ_API_KEY &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const stopMic = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    setIsListening(false);
  }, []);

  const transcribe = useCallback(async (audioBlob: Blob) => {
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
        if (text) onResultRef.current(text);
      }
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  const handleMic = useCallback(async () => {
    if (!GROQ_API_KEY) return;
    if (isListening) { stopMic(); return; }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        transcribe(new Blob(chunksRef.current, { type: recorder.mimeType }));
      };
      recorder.start();
      mediaRecorderRef.current = recorder;

      let finalText = '';

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
          onResultRef.current((finalText + interim).trim());
        };
        r.onend = () => { if (!vadStopped) startRecognition(); };
        r.onerror = (e: Event) => {
          const err = (e as ErrorEvent).message || '';
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
  }, [isListening, stopMic, transcribe]);

  return { isListening, isTranscribing, handleMic, stopMic, micSupported };
}
