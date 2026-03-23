import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, CheckCircle2, AlertCircle } from 'lucide-react';
import { isAddress } from 'viem';
import { PublicKey } from '@solana/web3.js';

interface AddressPasteModalProps {
  isOpen: boolean;
  chain: 'evm' | 'solana' | null;
  onClose: () => void;
  onSave: (address: string) => void;
}

export function AddressPasteModal({ isOpen, chain, onClose, onSave }: AddressPasteModalProps) {
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');

  if (!isOpen || !chain) return null;

  const validateAndSave = () => {
    setError('');
    const trimmed = address.trim();
    if (!trimmed) {
      setError('Please enter an address');
      return;
    }

    if (chain === 'evm') {
      if (!isAddress(trimmed)) {
        setError('Invalid EVM address format');
        return;
      }
    } else {
      try {
        const pubkey = new PublicKey(trimmed);
        if (!PublicKey.isOnCurve(pubkey.toBytes())) {
           // Not technically required to be on curve for standard wallets, but basic throw handles base58 validation.
        }
      } catch (err) {
        setError('Invalid Solana address format');
        return;
      }
    }

    onSave(trimmed);
    setAddress('');
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-[#1C212B] w-full max-w-[380px] rounded-[24px] overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 flex flex-col p-5 relative border border-white/5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[16px] font-bold text-white">Paste {chain === 'evm' ? 'EVM' : 'Solana'} Address</h3>
          <button 
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={16} strokeWidth={2.5} />
          </button>
        </div>

        <div className="relative mb-5">
          <input
            type="text"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setError('');
            }}
            placeholder={chain === 'evm' ? '0x...' : 'Solana address...'}
            className={`w-full bg-[#11161d] border ${error ? 'border-rose-500/50' : 'border-white/5 focus:border-cyan-500/30'} rounded-[16px] px-4 py-3.5 text-[15px] font-medium font-mono text-white outline-none placeholder:text-slate-600 transition-colors`}
            autoFocus
          />
          {error && (
            <div className="absolute -bottom-5 left-1 text-rose-400 text-[11px] flex items-center gap-1 font-medium">
              <AlertCircle size={11} />
              {error}
            </div>
          )}
        </div>

        <Button 
          onClick={validateAndSave}
          className="w-full font-bold text-[15px] uppercase h-[44px] rounded-[16px] bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 text-black shadow-[0_0_20px_rgba(13,242,223,0.3)] transition-all flex items-center justify-center cursor-pointer"
        >
          Confirm Wallet
        </Button>
      </div>
    </div>
  );
}
