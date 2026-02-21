import React from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import LandingPage from './pages/LandingPage';
import DashboardPage from './pages/DashboardPage';
import SwapPage from './pages/SwapPage';
import IntentPage from './pages/IntentPage';
import AgentPage from './pages/AgentPage';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="min-h-screen flex flex-col font-sans mesh-gradient selection:bg-primary selection:text-black">
      <Navbar />
      {/* Increased top padding to accommodate the floating navbar (top-6 + h-14 + spacing) */}
      <div className="flex-grow pt-24 md:pt-28 pb-8">
        {children}
      </div>
      <footer className="w-full border-t border-white/5 bg-[#08100f] py-8 mt-auto relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2 text-slate-400">
                <div className="size-6 rounded bg-slate-800 flex items-center justify-center text-slate-500">
                    <span className="material-symbols-outlined text-[14px]">diamond</span>
                </div>
                <span className="text-sm">© 2024 Naisu1 Labs</span>
            </div>
            <div className="flex gap-6">
                <a href="#" className="text-slate-500 hover:text-white transition-colors"><span className="material-symbols-outlined">flutter_dash</span></a>
                <a href="#" className="text-slate-500 hover:text-white transition-colors"><span className="material-symbols-outlined">chat</span></a>
                <a href="#" className="text-slate-500 hover:text-white transition-colors"><span className="material-symbols-outlined">code</span></a>
            </div>
        </div>
      </footer>
    </div>
  );
};

const AppContent: React.FC = () => {
    const location = useLocation();
    
    return (
        <Layout>
            {/* Key on the container forces re-render and triggers animation on route change */}
            <div key={location.pathname} className="animate-fade-in-up">
                <Routes>
                    <Route path="/" element={<LandingPage />} />
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/swap" element={<SwapPage />} />
                    <Route path="/intent" element={<IntentPage />} />
                    <Route path="/agent" element={<AgentPage />} />
                </Routes>
            </div>
        </Layout>
    );
};

export default function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}