import { forwardRef, KeyboardEvent } from 'react';
import { ArrowUp, Loader2, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMic } from '@/hooks/use-mic';

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading?: boolean;
  placeholder?: string;
}

export const MessageInput = forwardRef<HTMLInputElement, MessageInputProps>(function MessageInput({
  value,
  onChange,
  onSubmit,
  isLoading = false,
  placeholder = 'Message Nesu...',
}, ref) {
  const { isListening, isTranscribing, handleMic, micSupported } = useMic((text) => {
    onChange(text);
  });

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !isLoading) {
        onSubmit();
      }
    }
  };

  const activePlaceholder = isTranscribing
    ? 'Transcribing...'
    : isListening
      ? 'Listening… (click mic to stop)'
      : isLoading
        ? 'Agent is thinking...'
        : placeholder;

  return (
    <div className="relative group w-full">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/20 to-indigo-500/20 rounded-[28px] blur-md opacity-20 group-hover:opacity-40 transition duration-500" />
      <div
        className="relative bg-white/5 backdrop-blur-2xl border rounded-[28px] p-1.5 flex items-center shadow-2xl transition-all"
        style={{
          borderColor: isListening ? 'rgba(13,242,223,0.5)' : undefined,
          boxShadow: isListening ? '0 0 20px rgba(13,242,223,0.15)' : undefined,
        }}
      >
        <input
          ref={ref}
          className="flex-1 bg-transparent border-none focus:ring-0 text-white placeholder-slate-500 text-[15px] px-4 py-3 outline-none font-normal"
          placeholder={activePlaceholder}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading || isTranscribing}
        />
        {micSupported && (
          <Button
            onClick={handleMic}
            disabled={isLoading}
            variant="ghost"
            size="auto"
            className="mx-1 w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full transition-all"
            style={{
              color: isListening ? '#0df2df' : isTranscribing ? '#4f46e5' : undefined,
              background: isListening ? 'rgba(13,242,223,0.1)' : undefined,
            }}
            title={isListening ? 'Stop recording' : 'Speak your message (Ctrl+Space)'}
          >
            {isTranscribing
              ? <Loader2 className="size-[18px] animate-spin" strokeWidth={1.5} />
              : <Mic className={`size-[18px] ${isListening ? 'animate-pulse' : ''}`} strokeWidth={1.5} />
            }
          </Button>
        )}
        <Button
          className="p-2.5 mx-1 flex-shrink-0 bg-white border border-white/5 hover:bg-slate-200 text-black rounded-full shadow-md disabled:bg-white/10 disabled:text-white/40 disabled:shadow-none disabled:cursor-not-allowed transition-all active:scale-95 flex items-center justify-center cursor-pointer"
          onClick={onSubmit}
          disabled={!value.trim() || isLoading}
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <ArrowUp className="w-5 h-5 stroke-[2.5px]" />
          )}
        </Button>
      </div>
    </div>
  );
});
