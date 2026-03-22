import { createFileRoute } from "@tanstack/react-router";
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
          <TabsList className="w-full bg-white/5 rounded-xl p-1">
            <TabsTrigger value="stake" className="flex-1 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-black text-slate-400">
              Stake
            </TabsTrigger>
            <TabsTrigger value="positions" className="flex-1 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-black text-slate-400">
              Positions
            </TabsTrigger>
          </TabsList>
        </Tabs>

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
