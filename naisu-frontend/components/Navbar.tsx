import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useSolanaAddress, setSkipSolanaAutoConnect } from '../hooks/useSolanaAddress';

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
        <button
          key={item.label}
          onClick={() => { item.onClick(); onClose(); }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors
            ${item.danger
              ? 'text-red-400 hover:bg-red-500/10'
              : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
        >
          <span className="material-symbols-outlined text-sm">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ── Wallet Button with dropdown ───────────────────────────────────────────────
function WalletButton({
  logo,
  address,
  badge,
  badgeColor,
  borderColor,
  bgColor,
  textColor,
  dropdownItems,
  onConnectClick,
  connectLabel,
}: {
  logo: React.ReactNode;
  address: string | null;
  badge?: string;
  badgeColor: string;
  borderColor: string;
  bgColor: string;
  textColor: string;
  dropdownItems: { label: string; icon: string; onClick: () => void; danger?: boolean }[];
  onConnectClick: () => void;
  connectLabel: string;
}) {
  const [showDropdown, setShowDropdown] = useState(false);

  if (!address) {
    return (
      <button
        onClick={onConnectClick}
        className="flex items-center gap-2 rounded-xl px-3.5 py-2 h-9 border bg-white/5 hover:bg-white/10 border-white/10 text-white text-xs font-semibold transition-all hover:scale-105 active:scale-95"
      >
        {logo}
        <span>{connectLabel}</span>
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(v => !v)}
        className={`flex items-center gap-2 rounded-xl px-3.5 py-2 h-9 border ${borderColor} ${bgColor} ${textColor} text-xs font-semibold transition-all hover:scale-105 active:scale-95`}
      >
        {logo}
        <span className="font-mono">{address}</span>
        {badge && (
          <span className={`text-[10px] font-normal ${badgeColor} leading-none`}>{badge}</span>
        )}
        <span className="material-symbols-outlined text-xs opacity-50">expand_more</span>
      </button>

      {showDropdown && (
        <WalletDropdown
          items={dropdownItems}
          onClose={() => setShowDropdown(false)}
        />
      )}
    </div>
  );
}

// ── Navbar ────────────────────────────────────────────────────────────────────

const Navbar: React.FC = () => {
  const location = useLocation();
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
    location.pathname === path
      ? 'text-black bg-primary font-bold shadow-[0_0_15px_-3px_rgba(13,242,223,0.6)]'
      : 'text-slate-400 hover:text-white hover:bg-white/5';

  const navLinks = [
    { name: 'Home', path: '/' },
    { name: 'Swap', path: '/swap' },
    { name: 'Agent', path: '/intent' },
  ];

  const shortEvm = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null;
  const shortSol = detectedSolAddress
    ? `${detectedSolAddress.slice(0, 4)}...${detectedSolAddress.slice(-4)}`
    : null;

  const cLabel = chainLabel(chain?.name);

  // EVM dropdown items
  const evmDropdownItems = [
    {
      label: 'Copy address',
      icon: 'content_copy',
      onClick: () => address && navigator.clipboard.writeText(address),
    },
    {
      label: 'View on explorer',
      icon: 'open_in_new',
      onClick: () => {
        const base = chain?.id === 84532
          ? 'https://sepolia.basescan.org'
          : 'https://etherscan.io';
        window.open(`${base}/address/${address}`, '_blank');
      },
    },
    {
      label: 'Disconnect',
      icon: 'logout',
      onClick: disconnect,
      danger: true,
    },
  ];

  // Solana dropdown items
  const solDropdownItems = [
    {
      label: 'Copy address',
      icon: 'content_copy',
      onClick: () => detectedSolAddress && navigator.clipboard.writeText(detectedSolAddress),
    },
    {
      label: 'View on explorer',
      icon: 'open_in_new',
      onClick: () => {
        window.open(`https://explorer.solana.com/address/${detectedSolAddress}?cluster=devnet`, '_blank');
      },
    },
    {
      label: 'Disconnect',
      icon: 'logout',
      onClick: handleSolanaDisconnect,
      danger: true,
    },
  ];

  return (
    <>
      <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 w-full max-w-[95%] md:max-w-5xl px-2">
        <header className="relative flex items-center justify-between h-16 bg-[#0c1211]/80 backdrop-blur-xl border border-white/10 rounded-2xl px-5 shadow-2xl transition-all duration-300">

          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 group shrink-0">
            <div className="size-9 rounded-xl bg-primary flex items-center justify-center text-black shadow-[0_0_15px_rgba(13,242,223,0.4)] group-hover:scale-110 transition-transform duration-300">
              <span className="material-symbols-outlined text-[18px] font-bold">diamond</span>
            </div>
            <span className="text-sm font-bold tracking-tight text-white hidden sm:block">Naisu1</span>
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

            {/* Solana Wallet */}
            <WalletButton
              logo={<SolanaLogo />}
              address={shortSol}
              badgeColor="text-purple-400/60"
              borderColor="border-purple-500/40"
              bgColor="bg-purple-500/10"
              textColor="text-purple-300"
              dropdownItems={solDropdownItems}
              onConnectClick={() => setVisible(true)}
              connectLabel="Connect"
            />

            {/* EVM Wallet */}
            <WalletButton
              logo={<EthLogo />}
              address={shortEvm}
              badgeColor="text-primary/50"
              borderColor="border-primary/50"
              bgColor="bg-primary/10"
              textColor="text-primary"
              dropdownItems={evmDropdownItems}
              onConnectClick={() => connect({ connector: injected() })}
              connectLabel="Connect"
            />

            {/* Mobile Menu toggle */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden size-9 flex items-center justify-center rounded-full bg-surface border border-white/10 text-slate-400 hover:text-white hover:border-primary/30 transition-colors ml-1"
            >
              <span className="material-symbols-outlined text-lg">{isMobileMenuOpen ? 'close' : 'menu'}</span>
            </button>
          </div>
        </header>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="absolute top-[68px] left-0 right-0 mx-2 p-2 bg-[#0c1211]/95 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl animate-fade-in-up origin-top">
            <nav className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`text-sm font-medium px-4 py-3 rounded-xl transition-colors flex items-center justify-between group ${
                    location.pathname === link.path ? 'bg-primary/10 text-primary' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {link.name}
                  {location.pathname === link.path && <span className="material-symbols-outlined text-sm">check</span>}
                </Link>
              ))}
            </nav>
            <div className="mt-2 pt-2 border-t border-white/5 grid grid-cols-2 gap-2">
              {shortSol ? (
                <button onClick={handleSolanaDisconnect} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-bold">
                  <SolanaLogo /> Disconnect
                </button>
              ) : (
                <button onClick={() => setVisible(true)} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-surface border border-white/5 text-slate-400 text-xs font-medium">
                  <SolanaLogo /> Connect SOL
                </button>
              )}
              {isConnected ? (
                <button onClick={() => disconnect()} className="flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold">
                  <EthLogo /> Disconnect
                </button>
              ) : (
                <button onClick={() => connect({ connector: injected() })} className="flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 bg-primary text-black text-xs font-bold">
                  <EthLogo className="text-black" /> Connect EVM
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default Navbar;
