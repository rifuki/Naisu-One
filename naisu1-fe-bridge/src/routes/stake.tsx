import { createFileRoute } from "@tanstack/react-router";
import { MyStakes } from "@/components/my-stakes";
import { TrendingUp } from "lucide-react";

export const Route = createFileRoute("/stake")({
  component: StakePage,
});

function StakePage() {
  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center gap-2 mb-2">
        <TrendingUp className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-bold">My Stakes</h1>
      </div>
      <p className="text-muted-foreground mb-6">
        View and withdraw your staked SOL from the Mock Staking protocol
      </p>

      <MyStakes />
    </div>
  );
}
