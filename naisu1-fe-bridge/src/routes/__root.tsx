import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { WalletConnect } from "@/components/wallet-connect";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ArrowRightLeft, List, TrendingUp, Github, ExternalLink } from "lucide-react";

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2 font-bold text-lg cursor-pointer">
              <div className="p-1.5 bg-primary/10 rounded-md">
                <ArrowRightLeft className="h-5 w-5 text-primary" />
              </div>
              Intent Bridge
            </Link>
            <Separator orientation="vertical" className="h-6 hidden sm:block" />
            <nav className="hidden sm:flex items-center gap-1">
              <Link to="/" className="cursor-pointer">
                {({ isActive }) => (
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    size="sm"
                    className="gap-2 cursor-pointer"
                  >
                    <ArrowRightLeft className="h-4 w-4" />
                    Bridge
                  </Button>
                )}
              </Link>
              <Link to="/orders" className="cursor-pointer">
                {({ isActive }) => (
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    size="sm"
                    className="gap-2 cursor-pointer"
                  >
                    <List className="h-4 w-4" />
                    My Orders
                  </Button>
                )}
              </Link>
              <Link to="/stake" className="cursor-pointer">
                {({ isActive }) => (
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    size="sm"
                    className="gap-2 cursor-pointer"
                  >
                    <TrendingUp className="h-4 w-4" />
                    Stake
                  </Button>
                )}
              </Link>
            </nav>
          </div>
          
          <div className="flex items-center gap-3">
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <Github className="h-4 w-4" />
              GitHub
            </a>
            <WalletConnect />
          </div>
        </div>
      </header>

      {/* Mobile Navigation */}
      <nav className="sm:hidden border-b bg-background px-4 py-2 flex gap-2">
        <Link to="/" className="flex-1 cursor-pointer">
          {({ isActive }) => (
            <Button
              variant={isActive ? "secondary" : "ghost"}
              size="sm"
              className="w-full gap-2 cursor-pointer"
            >
              <ArrowRightLeft className="h-4 w-4" />
              Bridge
            </Button>
          )}
        </Link>
        <Link to="/orders" className="flex-1 cursor-pointer">
          {({ isActive }) => (
            <Button
              variant={isActive ? "secondary" : "ghost"}
              size="sm"
              className="w-full gap-2 cursor-pointer"
            >
              <List className="h-4 w-4" />
              Orders
            </Button>
          )}
        </Link>
        <Link to="/stake" className="flex-1 cursor-pointer">
          {({ isActive }) => (
            <Button
              variant={isActive ? "secondary" : "ghost"}
              size="sm"
              className="w-full gap-2 cursor-pointer"
            >
              <TrendingUp className="h-4 w-4" />
              Stake
            </Button>
          )}
        </Link>
      </nav>

      {/* Page content */}
      <main className="flex-1 mx-auto max-w-6xl w-full px-4 py-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
            <p>Cross-chain bridge powered by Wormhole</p>
            <div className="flex items-center gap-4">
              <a
                href="https://wormhole.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
              >
                Wormhole
                <ExternalLink className="h-3 w-3" />
              </a>
              <Separator orientation="vertical" className="h-4" />
              <a
                href="https://sui.io"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
              >
                Sui
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  ),
});
