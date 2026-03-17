import React from 'react';
import { Link } from 'react-router-dom';

const FeatureCard: React.FC<{
  icon: string;
  title: string;
  description: string;
  colorClass: string;
  bgClass: string;
  step: string;
}> = ({ icon, title, description, colorClass, bgClass, step }) => (
  <div className="relative flex flex-col items-center text-center">
    <div className={`relative flex items-center justify-center w-32 h-32 md:w-40 md:h-40 mb-8 rounded-full bg-surface-light border border-white/10 shadow-[0_0_40px_-10px_rgba(255,255,255,0.05)]`}>
      <div className={`absolute inset-0 rounded-full bg-gradient-to-b from-${colorClass}/10 to-transparent opacity-50`}></div>
      <span className={`material-symbols-outlined text-5xl md:text-6xl text-${colorClass} drop-shadow-[0_0_15px_${bgClass}]`}>
        {icon}
      </span>
      <div className="absolute -bottom-3 px-3 py-1 bg-[#0c0e0e] border border-white/10 rounded-full text-xs font-bold text-slate-300 uppercase tracking-widest">
        {step}
      </div>
    </div>
    <h3 className={`text-xl font-bold text-white mb-3`}>{title}</h3>
    <p className="text-slate-400 text-sm leading-relaxed px-4">
      {description}
    </p>
  </div>
);

const partners = [
  { name: 'Uniswap', icon: 'token' },
  { name: 'Arc', icon: 'architecture' },
  { name: 'LI.FI', icon: 'swap_horiz' },
  { name: 'OpenClaw', icon: 'pets' },
  { name: 'Chainlink', icon: 'link' },
  { name: 'Sui', icon: 'water_drop' },
  { name: 'Circle', icon: 'currency_bitcoin' },
  { name: 'Aave', icon: 'account_balance' },
  { name: 'Curve', icon: 'show_chart' },
];

const LandingPage: React.FC = () => {
  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden">
        {/* Background Effects */}
      <div className="absolute top-[20%] left-[10%] w-96 h-96 bg-primary/5 rounded-full blur-[100px] pointer-events-none z-0"></div>
      <div className="absolute bottom-[20%] right-[10%] w-[500px] h-[500px] bg-indigo-600/5 rounded-full blur-[120px] pointer-events-none z-0"></div>

      <section className="w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 flex flex-col items-center text-center z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold uppercase tracking-wider mb-8">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          Live on Mainnet
        </div>
        <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-slate-500">
          Powering the Future of <br className="hidden md:block" />Autonomous Finance
        </h1>
        <p className="text-lg md:text-xl text-slate-400 max-w-2xl mb-12">
          Built on the most robust infrastructure in Web3. Join an ecosystem designed for speed, security, and limitless scalability.
        </p>
        
        <div className="flex gap-4 mb-24">
             <Link to="/swap" className="px-8 py-3 rounded-xl bg-primary text-black font-bold text-lg hover:bg-primary/90 transition-all shadow-[0_0_20px_-5px_rgba(13,242,223,0.5)]">
                Launch App
             </Link>
             <Link to="/docs" className="px-8 py-3 rounded-xl bg-surface-light border border-white/10 text-white font-bold text-lg hover:bg-white/5 transition-all">
                Read Docs
             </Link>
        </div>

        {/* Partners Marquee */}
        <div className="w-full max-w-5xl mb-24 relative group">
          <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none"></div>
          <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none"></div>
          <div className="overflow-hidden flex">
               <div className="flex gap-16 animate-scroll whitespace-nowrap px-8">
                   {/* First set of partners */}
                   {partners.map((partner, i) => (
                       <div key={`p1-${i}`} className="flex items-center gap-3 opacity-40 grayscale hover:grayscale-0 hover:opacity-100 transition-all duration-300 cursor-pointer">
                           <span className="material-symbols-outlined text-4xl">{partner.icon}</span>
                           <span className="font-bold text-2xl">{partner.name}</span>
                       </div>
                   ))}
                   {/* Duplicate set for seamless scrolling */}
                   {partners.map((partner, i) => (
                       <div key={`p2-${i}`} className="flex items-center gap-3 opacity-40 grayscale hover:grayscale-0 hover:opacity-100 transition-all duration-300 cursor-pointer">
                           <span className="material-symbols-outlined text-4xl">{partner.icon}</span>
                           <span className="font-bold text-2xl">{partner.name}</span>
                       </div>
                   ))}
               </div>
          </div>
        </div>

        {/* How it works */}
        <div className="w-full max-w-6xl mt-12 mb-16 relative">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-4">How Naisu1 Works</h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">From intent to yield in three seamless autonomous steps.</p>
          </div>
          
          <div className="relative grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-4 z-10">
             {/* Connecting line */}
            <div className="hidden md:block absolute top-[80px] left-[15%] right-[15%] h-[2px] bg-white/5 -z-10 overflow-hidden rounded-full">
                <div className="absolute top-0 left-0 h-full w-1/2 bg-gradient-to-r from-transparent via-primary to-transparent animate-flow-right blur-[2px]"></div>
            </div>

            <FeatureCard 
                icon="mic" 
                title="Input Intent" 
                description="Describe your goal in natural language. Whether it's 'Max Yield on USDC' or 'Swap & Bridge,' our AI parses your intent instantly."
                colorClass="primary"
                bgClass="rgba(13,242,223,0.3)"
                step="Step 01"
            />
            <FeatureCard 
                icon="hub" 
                title="Agent Orchestration" 
                description="Autonomous agents analyze cross-chain liquidity paths, selecting the optimal route for speed and minimal slippage."
                colorClass="indigo-400"
                bgClass="rgba(129,140,248,0.3)"
                step="Step 02"
            />
             <FeatureCard 
                icon="savings" 
                title="Yield Settlement" 
                description="Funds are deployed, and yield is settled directly to your wallet. No manual bridging or complex transaction signing required."
                colorClass="emerald-400"
                bgClass="rgba(52,211,153,0.3)"
                step="Step 03"
            />
          </div>
        </div>
      </section>
    </div>
  );
};

export default LandingPage;