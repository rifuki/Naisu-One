import { useState } from "react";
import { BridgeFormCompact } from "@/components/bridge-form-compact";
import { ActiveIntentsSidebar } from "@/components/active-intents-sidebar";
import { MyStakes } from "@/components/my-stakes";
import { ArrowRightLeft, Shield, Clock, TrendingDown } from "lucide-react";

export function BridgePage() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleIntentCreated = () => {
    // Trigger refresh of the intents list
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-2xl mb-4">
          <ArrowRightLeft className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
          Base → Solana Bridge
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto">
          Bridge ETH from Base Sepolia to SOL on Solana Devnet with Dutch Auction pricing
        </p>
        
        <div className="flex flex-wrap items-center justify-center gap-4 mt-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Shield className="h-4 w-4" />
            <span>Wormhole Secured</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            <span>Fast Settlement</span>
          </div>
          <div className="flex items-center gap-1.5">
            <TrendingDown className="h-4 w-4" />
            <span>Dutch Auction</span>
          </div>
        </div>
      </div>

      {/* Main 2-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left: natural height */}
        <div className="rounded-2xl border bg-card p-6 shadow-sm flex flex-col gap-6">
          {/* Bridge Form */}
          <div>
            <div className="mb-6">
              <h2 className="text-xl font-semibold mb-1">Create Bridge Intent</h2>
              <p className="text-sm text-muted-foreground">
                Set your target price. Solvers will compete to give you the best rate!
              </p>
            </div>
            <BridgeFormCompact onIntentCreated={handleIntentCreated} />
          </div>

          {/* Info Cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border bg-muted/40 p-3 text-center">
              <p className="text-2xl font-bold">&lt; 2 min</p>
              <p className="text-xs text-muted-foreground">Avg settlement</p>
            </div>
            <div className="rounded-xl border bg-muted/40 p-3 text-center">
              <p className="text-2xl font-bold">2+</p>
              <p className="text-xs text-muted-foreground">EVM chains</p>
            </div>
            <div className="rounded-xl border bg-muted/40 p-3 text-center">
              <p className="text-2xl font-bold">0.1%</p>
              <p className="text-xs text-muted-foreground">Min solver fee</p>
            </div>
          </div>

          {/* My Stakes */}
          <MyStakes />
        </div>

        {/* Right: capped to same visual height as left, inner content scrolls */}
        <div
          className="rounded-2xl border bg-card p-6 shadow-sm flex flex-col overflow-hidden sticky top-24"
          style={{ maxHeight: "calc(100vh - 8rem)" }}
        >
          <ActiveIntentsSidebar refreshTrigger={refreshTrigger} />
        </div>
      </div>
    </div>
  );
}
