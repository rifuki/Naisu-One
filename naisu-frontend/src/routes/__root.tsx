import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import Navbar from "@/components/Navbar";
import ActiveIntents from "@/components/ActiveIntents";
import { QueryProvider } from "@/components/providers/query-provider";
import { AgentProvider } from "@/components/providers/agent-provider";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <QueryProvider>
      <AgentProvider>
        <RootContent />
      </AgentProvider>
    </QueryProvider>
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
      {!isIntentPage && (
        <footer className="w-full border-t border-white/5 bg-[#08100f] py-8 mt-auto relative z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2 text-slate-400">
              <div className="size-6 rounded bg-slate-800 flex items-center justify-center text-slate-500">
                <span className="material-symbols-outlined text-[14px]">diamond</span>
              </div>
              <span className="text-sm">© 2024 Naisu Labs</span>
            </div>
            <div className="flex gap-6">
              <a href="#" className="text-slate-500 hover:text-white transition-colors">
                <span className="material-symbols-outlined">flutter_dash</span>
              </a>
              <a href="#" className="text-slate-500 hover:text-white transition-colors">
                <span className="material-symbols-outlined">chat</span>
              </a>
              <a href="#" className="text-slate-500 hover:text-white transition-colors">
                <span className="material-symbols-outlined">code</span>
              </a>
            </div>
          </div>
        </footer>
      )}
      <ActiveIntents />
    </div>
  );
}
