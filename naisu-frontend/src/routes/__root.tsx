import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { EvmProvider } from "@/providers/wagmi";
import { SolanaProvider } from "@/providers/solana";
import { QueryProvider } from "@/providers/query";
import { AgentProvider } from "@/providers/agent";
import Navbar from "@/components/navbar";
import ActiveIntents from "@/components/active-intents";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <EvmProvider>
      <QueryProvider>
        <SolanaProvider>
          <AgentProvider>
            <RootContent />
          </AgentProvider>
        </SolanaProvider>
      </QueryProvider>
    </EvmProvider>
  );
}

function RootContent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isIntentPage = pathname === "/intent" || pathname === "/";

  return (
    <div
      className={`flex flex-col font-sans mesh-gradient selection:bg-primary selection:text-black ${
        isIntentPage ? "h-[100dvh] overflow-hidden" : "min-h-screen"
      }`}
    >
      <Navbar />
      <div
        className={`flex-1 flex flex-col w-full h-full ${
          isIntentPage ? "pt-[64px] min-h-0 overflow-hidden" : "pt-24 md:pt-28 pb-8"
        }`}
      >
        <div
          key={pathname}
          className={`animate-fade-in-up flex-1 flex flex-col w-full h-full ${
            isIntentPage ? "min-h-0" : ""
          }`}
        >
          <Outlet />
        </div>
      </div>
      <ActiveIntents />
    </div>
  );
}
