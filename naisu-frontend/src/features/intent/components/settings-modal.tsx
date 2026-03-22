import { Button } from '@/components/ui/button';
import { X, Clock } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#1a1f1e] border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-fade-in-up">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-bold text-white">Intent Parameters</h3>
          <Button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={16} strokeWidth={1.5} />
          </Button>
        </div>

        <div className="space-y-6">
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 block">
              Slippage Tolerance
            </label>
            <div className="flex gap-2">
              <Button className="flex-1 py-2 rounded-lg bg-primary text-black text-sm font-bold">Auto</Button>
              <Button className="flex-1 py-2 rounded-lg bg-white/5 border border-white/5 text-slate-300 text-sm font-medium hover:bg-white/10">
                0.5%
              </Button>
              <Button className="flex-1 py-2 rounded-lg bg-white/5 border border-white/5 text-slate-300 text-sm font-medium hover:bg-white/10">
                1.0%
              </Button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 block">
              Execution Deadline
            </label>
            <div className="flex items-center gap-3 bg-white/5 border border-white/5 rounded-lg px-4 py-3">
              <Clock size={16} strokeWidth={1.5} className="text-slate-400" />
              <span className="text-sm text-white font-medium">5 minutes</span>
              <span className="text-xs text-slate-500 ml-auto">Default</span>
            </div>
          </div>

          <div className="pt-4 border-t border-white/5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Version</span>
              <span className="font-mono">v1.0.0</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
