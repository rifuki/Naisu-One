import React from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import ActiveIntents from '@/components/ActiveIntents';
import LandingPage from '@/pages/LandingPage';
import DashboardPage from '@/pages/DashboardPage';
import SwapPage from '@/pages/swap-page';
import EarnPage from '@/pages/earn-page';
import PortfolioPage from '@/pages/portfolio-page';
import IntentPage from '@/pages/intent-page';
import { QueryProvider } from '@/components/providers/query-provider';

const AppContent: React.FC = () => {
  const location = useLocation();
  const isIntentPage = location.pathname === '/intent' || location.pathname === '/';

  return (
    <div className={`flex flex-col font-sans mesh-gradient selection:bg-primary selection:text-black ${isIntentPage ? 'h-[100dvh] overflow-hidden' : 'min-h-screen'}`}>
      <Navbar />
      <div className={`flex-1 flex flex-col w-full h-full ${isIntentPage ? 'pt-[64px] min-h-0 overflow-hidden' : 'pt-24 md:pt-28 pb-8'}`}>
        <div key={location.pathname} className={`animate-fade-in-up flex-1 flex flex-col w-full h-full ${isIntentPage ? 'min-h-0' : ''}`}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/swap" element={<SwapPage />} />
            <Route path="/earn" element={<EarnPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/intent" element={<IntentPage />} />
          </Routes>
        </div>
      </div>
      {!isIntentPage && (
        <footer className="w-full border-t border-white/5 bg-[#08100f] py-8 mt-auto relative z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2 text-slate-400">
              <div className="size-6 rounded bg-slate-800 flex items-center justify-center text-slate-500">
                <span className="material-symbols-outlined text-[14px]">diamond</span>
              </div>
              <span className="text-sm">© 2024 Naisu1 Labs</span>
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
};

export default function App() {
  return (
    <QueryProvider>
      <HashRouter>
        <AppContent />
      </HashRouter>
    </QueryProvider>
  );
}
