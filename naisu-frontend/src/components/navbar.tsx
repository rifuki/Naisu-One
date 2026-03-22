import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useRouterState } from "@tanstack/react-router";
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useSolanaAddress, setSkipSolanaAutoConnect } from '@/hooks/use-solana-address';
import { Button } from '@/components/ui/button';

// ── SVGs ─────────────────────────────────────────────────────────────────────

const SolanaLogo = () => (
  <svg width="13" height="13" viewBox="0 0 128 128" fill="none" className="flex-shrink-0">
    <path d="M21.1 94.5c.8-.8 1.9-1.3 3.1-1.3h89.5c2 0 3 2.4 1.6 3.8L98 114.3c-.8.8-1.9 1.3-3.1 1.3H5.4c-2 0-3-2.4-1.6-3.8L21.1 94.5z" fill="url(#s1)"/>
    <path d="M21.1 13.7C21.9 12.9 23 12.4 24.2 12.4h89.5c2 0 3 2.4 1.6 3.8L98 33.5c-.8.8-1.9 1.3-3.1 1.3H5.4c-2 0-3-2.4-1.6-3.8L21.1 13.7z" fill="url(#s2)"/>
    <path d="M98 53.9c-.8-.8-1.9-1.3-3.1-1.3H5.4c-2 0-3 2.4-1.6 3.8l17.3 17.3c.8.8 1.9 1.3 3.1 1.3h89.5c2 0 3-2.4 1.6-3.8L98 53.9z" fill="url(#s3)"/>
    <defs>
      <linearGradient id="s1" x1="0" y1="128" x2="128" y2="0" gradientUnits="userSpaceOnUse"><stop stopColor="#9945FF"/><stop offset="1" stopColor="#14F195"/></linearGradient>
      <linearGradient id="s2" x1="0" y1="128" x2="128" y2="0" gradientUnits="userSpaceOnUse"><stop stopColor="#9945FF"/><stop offset="1" stopColor="#14F195"/></linearGradient>
      <linearGradient id="s3" x1="0" y1="128" x2="128" y2="0" gradientUnits="userSpaceOnUse"><stop stopColor="#9945FF"/><stop offset="1" stopColor="#14F195"/></linearGradient>
    </defs>
  </svg>
);

const EthLogo = ({ className = '' }: { className?: string }) => (
  <svg width="13" height="13" viewBox="0 0 32 32" fill="none" className={`flex-shrink-0 ${className}`}>
    <path d="M16 2L6 16.5l10 6 10-6L16 2z" fill="currentColor" opacity=".6"/>
    <path d="M16 2L6 16.5l10 6V2z" fill="currentColor"/>
    <path d="M16 24.5L6 19l10 11 10-11-10 5.5z" fill="currentColor" opacity=".6"/>
    <path d="M16 24.5L6 19l10 11V24.5z" fill="currentColor"/>
  </svg>
);

// ── Compact chain label ───────────────────────────────────────────────────────
function chainLabel(name?: string): string {
  if (!name) return '';
  return name
    .replace('Base Sepolia Testnet', 'Base')
    .replace(' Sepolia Testnet', '')
    .replace(' Testnet', '')
    .replace(' Mainnet', '');
}

// ── Dropdown menu (click-outside aware) ──────────────────────────────────────
function WalletDropdown({
  items,
  onClose,
}: {
  items: { label: string; icon: string; onClick: () => void; danger?: boolean }[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute top-full mt-2 right-0 z-[100] min-w-[160px] bg-[#0c1211] border border-white/10 rounded-xl shadow-2xl py-1 overflow-hidden"
    >
      {items.map((item) => (
        <Button
          key={item.label}
          variant="ghost"
          onClick={() => { item.onClick(); onClose(); }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors
            ${item.danger
              ? 'text-red-400 hover:bg-red-500/10'
              : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
        >
          <span className="material-symbols-outlined text-sm">{item.icon}</span>
          {item.label}
        </Button>
      ))}
    </div>
  );
}

// ── Multi-Wallet Button ────────────────────────────────────────────────────────
function MultiWalletDropdown({
  evmAddress,
  solAddress,
  fullEvmAddress,
  fullSolAddress,
  onConnectEvm,
  onConnectSol,
  onDisconnectEvm,
  onDisconnectSol,
}: {
  evmAddress: string | null;
  solAddress: string | null;
  fullEvmAddress: string | null;
  fullSolAddress: string | null;
  onConnectEvm: () => void;
  onConnectSol: () => void;
  onDisconnectEvm: () => void;
  onDisconnectSol: () => void;
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowDropdown(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const connectedCount = [evmAddress, solAddress].filter(Boolean).length;

  let buttonContent = (
    <div className="flex items-center gap-2">
      <span className="material-symbols-outlined text-[16px]">account_balance_wallet</span>
      <span>Connect</span>
    </div>
  );

  if (connectedCount === 1) {
    if (evmAddress) {
      buttonContent = (
        <div className="flex items-center gap-2 text-primary font-mono">
          <EthLogo />
          {evmAddress}
        </div>
      );
    } else if (solAddress) {
      buttonContent = (
        <div className="flex items-center gap-2 text-purple-300 font-mono">
          <SolanaLogo />
          {solAddress}
        </div>
      );
    }
  } else if (connectedCount === 2) {
    buttonContent = (
      <div className="flex items-center gap-2 text-primary overflow-hidden">
        <EthLogo />
        <span className="font-mono">{evmAddress}</span>
        <div className="w-px h-3 bg-white/20 mx-1" />
        <SolanaLogo />
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        onClick={() => setShowDropdown((v) => !v)}
        className={`flex items-center gap-2 rounded-xl px-4 py-2 h-9 border text-xs font-semibold transition-all hover:scale-105 active:scale-95 ${
          connectedCount > 0
            ? 'bg-white/5 border-white/10 hover:bg-white/10'
            : 'bg-primary border-primary/50 text-black hover:bg-primary/90'
        }`}
      >
        {buttonContent}
      </Button>

      {showDropdown && (
        <div className="absolute top-full mt-2 right-0 z-[100] w-72 bg-[#070a09]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-2 overflow-hidden animate-fade-in-up origin-top-right">
          {/* EVM Section */}
          <div className="mb-2">
            <div className="px-2 py-1.5 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
              EVM Wallet
            </div>
            {fullEvmAddress ? (
              <div className="p-2 rounded-xl bg-primary/5 border border-primary/10 mb-1">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-start gap-2 text-primary select-all font-mono text-[10px] break-all leading-tight pr-2">
                    <EthLogo className="mt-0.5 shrink-0" />
                    <span>{fullEvmAddress}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      navigator.clipboard.writeText(fullEvmAddress);
                    }}
                    title="Copy full address"
                    className="text-primary hover:text-white transition-colors shrink-0 p-1"
                  >
                    <span className="material-symbols-outlined text-[14px]">content_copy</span>
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      window.open(`https://sepolia.basescan.org/address/${fullEvmAddress}`, '_blank');
                      setShowDropdown(false);
                    }}
                    className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[11px] text-slate-300 font-medium transition-colors"
                  >
                    Explorer
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      onDisconnectEvm();
                      setShowDropdown(false);
                    }}
                    className="flex-1 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-[11px] font-medium transition-colors"
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  onConnectEvm();
                  setShowDropdown(false);
                }}
                className="w-full flex items-center justify-between p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-semibold transition-colors"
              >
                <div className="flex items-center gap-2">
                  <EthLogo /> Connect EVM
                </div>
                <span className="material-symbols-outlined text-[16px]">chevron_right</span>
              </Button>
            )}
          </div>

          <div className="w-full h-px bg-white/5 my-2" />

          {/* Solana Section */}
          <div>
            <div className="px-2 py-1.5 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
              Solana Wallet
            </div>
            {fullSolAddress ? (
              <div className="p-2 rounded-xl bg-purple-500/5 border border-purple-500/10">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-start gap-2 text-purple-300 select-all font-mono text-[10px] break-all leading-tight pr-2">
                    <SolanaLogo />
                    <span className="mt-[1px]">{fullSolAddress}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      navigator.clipboard.writeText(fullSolAddress);
                    }}
                    title="Copy full address"
                    className="text-purple-400 hover:text-white transition-colors shrink-0 p-1"
                  >
                    <span className="material-symbols-outlined text-[14px]">content_copy</span>
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      window.open(`https://solscan.io/account/${fullSolAddress}?cluster=devnet`, '_blank');
                      setShowDropdown(false);
                    }}
                    className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[11px] text-slate-300 font-medium transition-colors"
                  >
                    Explorer
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      onDisconnectSol();
                      setShowDropdown(false);
                    }}
                    className="flex-1 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-[11px] font-medium transition-colors"
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  onConnectSol();
                  setShowDropdown(false);
                }}
                className="w-full flex items-center justify-between p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-semibold transition-colors"
              >
                <div className="flex items-center gap-2">
                  <SolanaLogo /> Connect Solana
                </div>
                <span className="material-symbols-outlined text-[16px]">chevron_right</span>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Navbar ────────────────────────────────────────────────────────────────────

const Navbar: React.FC = () => {
  const pathname = useRouterState({ select: (s) => s.pathname });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // EVM
  const { address, isConnected, chain } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  // Solana
  const { disconnect: solDisconnect, connected: solAdapterConnected } = useWallet();
  const { setVisible } = useWalletModal();
  const detectedSolAddress = useSolanaAddress();

  // Clear skip flag saat wallet berhasil connect (user manual connect)
  useEffect(() => {
    if (solAdapterConnected || detectedSolAddress) {
      setSkipSolanaAutoConnect(false);
    }
  }, [solAdapterConnected, detectedSolAddress]);

  // Handle Solana disconnect untuk semua wallet types (adapter + window)
  const handleSolanaDisconnect = useCallback(async () => {
    // Set flag supaya tidak auto-reconnect lagi
    setSkipSolanaAutoConnect(true);
    // 1. Disconnect wallet-adapter jika connected
    if (solAdapterConnected) {
      try { await solDisconnect(); } catch { /* ignore */ }
    }
    // 2. Disconnect window.backpack jika ada
    if (window.backpack?.isConnected && window.backpack.disconnect) {
      try { await window.backpack.disconnect(); } catch { /* ignore */ }
    }
    // 3. Disconnect window.solana jika ada
    if (window.solana?.isConnected && window.solana.disconnect) {
      try { await window.solana.disconnect(); } catch { /* ignore */ }
    }
    // 4. Clear attempts supaya gak retry
    window.location.reload();
  }, [solDisconnect, solAdapterConnected]);

  const isActive = (path: string) =>
    pathname === path
      ? 'text-black bg-primary font-bold shadow-[0_0_15px_-3px_rgba(13,242,223,0.6)]'
      : 'text-slate-400 hover:text-white hover:bg-white/5';

  const navLinks = [
    { name: 'Home',  path: '/' },
    { name: 'Swap',  path: '/swap' },
    { name: 'Earn',  path: '/earn' },
    { name: 'Agent', path: '/intent' },
  ];

  const shortEvm = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null;
  const shortSol = detectedSolAddress
    ? `${detectedSolAddress.slice(0, 4)}...${detectedSolAddress.slice(-4)}`
    : null;

  const cLabel = chainLabel(chain?.name);

  // No longer returning individual dropdown maps here since MultiWalletDropdown handles its own logic.

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-50 w-full">
        <header className="flex items-center justify-between h-16 bg-[#070a09]/95 backdrop-blur-xl border-b border-white/5 px-4 sm:px-6 transition-all duration-300">

          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 group shrink-0">
            <img src="/logo.svg" alt="Naisu" className="w-8 h-8 group-hover:scale-110 transition-transform duration-300" />
            <span className="text-sm font-bold tracking-tight text-white hidden sm:block">Naisu</span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-2 absolute left-1/2 -translate-x-1/2">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`text-sm font-medium px-5 py-2 rounded-xl transition-all duration-300 ${isActive(link.path)}`}
              >
                {link.name}
              </Link>
            ))}
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-2 shrink-0">

            {/* Unified Wallet Management */}
            <MultiWalletDropdown
              evmAddress={shortEvm}
              solAddress={shortSol}
              fullEvmAddress={address || null}
              fullSolAddress={detectedSolAddress || null}
              onConnectEvm={() => connect({ connector: injected() })}
              onConnectSol={() => setVisible(true)}
              onDisconnectEvm={disconnect}
              onDisconnectSol={handleSolanaDisconnect}
            />

            {/* Mobile Menu toggle */}
            <Button
              variant="ghost"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden size-9 flex items-center justify-center rounded-full bg-surface border border-white/10 text-slate-400 hover:text-white hover:border-primary/30 transition-colors ml-1"
            >
              <span className="material-symbols-outlined text-lg">{isMobileMenuOpen ? 'close' : 'menu'}</span>
            </Button>
          </div>
        </header>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="absolute top-[64px] left-0 right-0 bg-[#0c1211]/95 backdrop-blur-xl border-b border-white/10 shadow-2xl animate-fade-in-up origin-top p-4">
            <nav className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`text-sm font-medium px-4 py-3 rounded-xl transition-colors flex items-center justify-between group ${
                    pathname === link.path ? 'bg-primary/10 text-primary' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {link.name}
                  {pathname === link.path && <span className="material-symbols-outlined text-sm">check</span>}
                </Link>
              ))}
            </nav>
            <div className="mt-2 pt-2 border-t border-white/5 grid grid-cols-2 gap-2">
              {shortSol ? (
                <Button variant="ghost" onClick={handleSolanaDisconnect} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-bold">
                  <SolanaLogo /> Disconnect
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setVisible(true)} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-surface border border-white/5 text-slate-400 text-xs font-medium">
                  <SolanaLogo /> Connect SOL
                </Button>
              )}
              {isConnected ? (
                <Button variant="ghost" onClick={() => disconnect()} className="flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold">
                  <EthLogo /> Disconnect
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => connect({ connector: injected() })} className="flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 bg-primary text-black text-xs font-bold">
                  <EthLogo className="text-black" /> Connect EVM
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default Navbar;
