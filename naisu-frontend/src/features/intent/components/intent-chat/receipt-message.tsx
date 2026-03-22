import { ReactNode } from 'react';
import { useTimeAgo } from '@/hooks/use-time-ago';
import { Button } from '@/components/ui/button';
import { formatAbsoluteTime } from '@/lib/utils';

interface ReceiptMessageProps {
  children: ReactNode;
  timestamp?: number;
}

function CopyButton({ text }: { text: string }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
  };

  return (
    <Button
      onClick={handleCopy}
      className="text-slate-500 hover:text-primary transition-colors"
      title="Copy"
    >
      <span className="material-symbols-outlined text-[14px]">content_copy</span>
    </Button>
  );
}

export function ReceiptMessage({ children, timestamp }: ReceiptMessageProps) {
  const timeAgo = useTimeAgo(timestamp);
  const absoluteTime = formatAbsoluteTime(timestamp);

  return (
    <div className="group flex gap-3 opacity-0 animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
      <div className="flex-shrink-0 mt-1 hidden sm:block">
        <div className="size-8 rounded-full bg-gradient-to-br from-primary/80 to-teal-800 flex items-center justify-center shadow-[0_0_16px_rgba(13,242,223,0.25)] ring-1 ring-primary/20">
          <span className="material-symbols-outlined text-white text-[16px]">smart_toy</span>
        </div>
      </div>
      <div className="flex-1 max-w-2xl">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[12px] font-semibold text-white">Nesu</span>
          <span className="text-[10px] text-slate-500" title={absoluteTime}>{timeAgo}</span>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            <CopyButton text="Intent Receipt" />
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
