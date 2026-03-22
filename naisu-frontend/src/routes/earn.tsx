import { createFileRoute } from "@tanstack/react-router";
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSolanaAddress } from '@/hooks/use-solana-address';
import { StakeTab } from '@/features/earn/components/stake-tab';
import { PositionsTab } from '@/features/earn/components/positions-tab';

export const Route = createFileRoute("/earn")({
  component: EarnPage,
});

type Tab = 'stake' | 'positions';

function EarnPage() {
  const [activeTab, setActiveTab] = useState<Tab>('stake');
  const [selectedProtocol, setSelectedProtocol] = useState<'marinade' | 'jito' | 'jupsol' | 'kamino'>('marinade');

  const solanaAddress = useSolanaAddress();

  return (
    <div className="flex items-center justify-center min-h-[80vh] px-4">
      <div className="w-full max-w-md space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Earn Yield</h1>
          <p className="text-sm text-slate-500">Bridge ETH and earn yield on Solana</p>
        </div>

        <div className="flex gap-2 p-1 bg-white/5 rounded-xl">
          {(['stake', 'positions'] as Tab[]).map((tab) => (
            <Button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab ? 'bg-primary text-black' : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab === 'stake' ? 'Stake' : 'Positions'}
            </Button>
          ))}
        </div>

        <div className="glass-panel rounded-2xl p-4">
          {activeTab === 'stake' ? (
            <StakeTab selectedProtocol={selectedProtocol} onProtocolChange={setSelectedProtocol} />
          ) : (
            <PositionsTab solAddress={solanaAddress} />
          )}
        </div>
      </div>
    </div>
  );
}
