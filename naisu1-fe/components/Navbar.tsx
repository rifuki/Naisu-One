import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const Navbar: React.FC = () => {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const isActive = (path: string) => {
    return location.pathname === path ? 'text-black bg-primary font-bold shadow-[0_0_15px_-3px_rgba(13,242,223,0.6)]' : 'text-slate-400 hover:text-white hover:bg-white/5';
  };

  const navLinks = [
    { name: 'Home', path: '/' },
    { name: 'Swap', path: '/swap' },
    { name: 'Agent', path: '/intent' },
  ];

  const handleConnect = () => {
    setIsConnected(!isConnected);
  };

  return (
    <>
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-[90%] md:max-w-4xl px-2">
        <header className="relative flex items-center justify-between h-14 bg-[#0c1211]/80 backdrop-blur-xl border border-white/10 rounded-full px-2 shadow-2xl transition-all duration-300">
          
          {/* Logo Section */}
          <Link to="/" className="flex items-center gap-2 pl-2 pr-4 group">
            <div className="size-8 rounded-full bg-primary flex items-center justify-center text-black shadow-[0_0_10px_rgba(13,242,223,0.4)] group-hover:scale-110 transition-transform duration-300">
              <span className="material-symbols-outlined text-[18px] font-bold">diamond</span>
            </div>
            <span className="text-sm font-bold tracking-tight text-white hidden sm:block">Naisu1</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`text-xs font-medium px-4 py-2 rounded-full transition-all duration-300 ${isActive(link.path)}`}
              >
                {link.name}
              </Link>
            ))}
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-2 pr-1">
            <button className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-white/5 hover:border-primary/30 transition-colors text-[10px] font-medium text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Sui
            </button>
            <button 
                onClick={handleConnect}
                className={`flex items-center justify-center rounded-full px-4 py-2 border text-xs font-bold transition-all hover:scale-105 active:scale-95 ${
                    isConnected 
                    ? 'bg-surface-light border-primary/50 text-primary shadow-[0_0_10px_rgba(13,242,223,0.2)]' 
                    : 'bg-white/5 hover:bg-white/10 border-white/5 text-white'
                }`}
            >
              {isConnected ? (
                  <span className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[14px]">account_balance_wallet</span>
                      0x84...2A
                  </span>
              ) : 'Connect'}
            </button>
            
            {/* Mobile Menu Button */}
            <button 
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="md:hidden size-9 flex items-center justify-center rounded-full bg-surface border border-white/10 text-slate-400 hover:text-white hover:border-primary/30 transition-colors ml-1"
            >
              <span className="material-symbols-outlined text-lg">{isMobileMenuOpen ? 'close' : 'menu'}</span>
            </button>
          </div>
        </header>

        {/* Mobile Menu Dropdown */}
        {isMobileMenuOpen && (
          <div className="absolute top-16 left-0 right-0 mx-2 p-2 bg-[#0c1211]/95 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl animate-fade-in-up origin-top">
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
                   <button className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-surface border border-white/5 text-xs font-medium text-slate-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      Mainnet
                    </button>
                    <button onClick={handleConnect} className="flex items-center justify-center rounded-xl px-3 py-2.5 bg-primary text-black text-xs font-bold">
                       {isConnected ? '0x84...2A' : 'Connect'}
                    </button>
              </div>
          </div>
        )}
      </div>
    </>
  );
};

export default Navbar;