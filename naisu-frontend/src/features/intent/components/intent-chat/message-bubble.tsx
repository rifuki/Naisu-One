import ReactMarkdown from 'react-markdown';
import { OrderMonitor } from '../order-monitor-widget';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface MessageBubbleProps {
  message: ChatMessage;
  renderContent: (content: string) => React.ReactNode;
  monitorTx?: { hash: string; chainId: number; userAddress: string } | null;
}

interface TxInfo {
  hash: string;
  explorerBase: string;
}

function extractTxHashFromSubmitMsg(content: string): TxInfo | null {
  const m = content.match(/Hash:\s*(0x[0-9a-fA-F]{64})/);
  const e = content.match(/Explorer:\s*(https?:\/\/\S+)/);
  if (m && e) {
    return { hash: m[1]!, explorerBase: e[1]!.replace(m[1]!, '') };
  }
  return null;
}

export function MessageBubble({ message, renderContent, monitorTx }: MessageBubbleProps) {
  if (message.role === 'user') {
    const txInfo = extractTxHashFromSubmitMsg(message.content);

    if (txInfo) {
      return (
        <div
          className="flex flex-col items-end gap-2 opacity-0 animate-fade-in-up"
          style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}
        >
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-500/8 border border-indigo-500/15 text-xs font-mono text-slate-400">
            <span className="material-symbols-outlined text-indigo-400 text-[14px]">send</span>
            <span>
              Tx submitted · {txInfo.hash.slice(0, 10)}…{txInfo.hash.slice(-6)}
            </span>
            <a
              href={`${txInfo.explorerBase}${txInfo.hash}`}
              target="_blank"
              rel="noreferrer"
              className="text-slate-600 hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-[12px]">open_in_new</span>
            </a>
          </div>
        </div>
      );
    }

    return (
      <div
        className="flex flex-col items-end gap-3 opacity-0 animate-fade-in-up"
        style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}
      >
        <div className="max-w-2xl text-right">
          <div className="inline-block p-4 rounded-2xl rounded-tr-none bg-indigo-500/10 border border-indigo-500/20 text-white text-sm leading-relaxed text-left shadow-lg">
            <p>{message.content}</p>
          </div>
          <div className="flex items-center justify-end gap-1.5 text-slate-500 text-[11px] mt-1.5">
            <span className="material-symbols-outlined text-[13px]">account_circle</span>
            You
          </div>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div
      className="flex gap-3 opacity-0 animate-fade-in-up"
      style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}
    >
      <div className="flex-shrink-0 mt-1 hidden sm:block">
        <div className="size-8 rounded-full bg-gradient-to-br from-primary/80 to-teal-800 flex items-center justify-center shadow-[0_0_16px_rgba(13,242,223,0.25)] ring-1 ring-primary/20">
          <span className="material-symbols-outlined text-white text-[16px]">smart_toy</span>
        </div>
      </div>
      <div className="flex-1 max-w-2xl">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[12px] font-semibold text-white">Nesu</span>
          <span className="text-[10px] text-slate-600">just now</span>
        </div>
        <div className="px-4 py-3.5 rounded-2xl rounded-tl-none bg-[#0d1614] border border-white/6 text-slate-300 text-sm leading-relaxed shadow-lg">
          {renderContent(message.content)}
          {monitorTx && (
            <OrderMonitor
              txHash={monitorTx.hash}
              chainId={monitorTx.chainId}
              userAddress={monitorTx.userAddress}
            />
          )}
        </div>
      </div>
    </div>
  );
}
