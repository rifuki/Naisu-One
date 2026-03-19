import { useState, useEffect } from 'react';

interface OrderMonitorProps {
  txHash: string;
  chainId: number;
  userAddress: string;
}

interface FulfilledOrder {
  startPrice: string;
  destinationChain: number;
  intentType: number;
}

type OrderStatus = 'indexing' | 'open' | 'fulfilled' | 'error';

interface StatusConfig {
  icon: string;
  color: string;
  label: string;
  spin: boolean;
  dot: boolean;
}

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim() || 'http://localhost:3000';

export function OrderMonitor({ txHash, chainId, userAddress }: OrderMonitorProps) {
  const [status, setStatus] = useState<OrderStatus>('indexing');
  const [elapsed, setElapsed] = useState(0);
  const [fulfilledOrder, setFulfilledOrder] = useState<FulfilledOrder | null>(null);

  const explorerBase = 'https://sepolia.basescan.org/tx/';
  const chain = 'Base Sepolia';

  useEffect(() => {
    const startTime = Date.now();
    const ticker = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    let attempts = 0;
    const MAX_ATTEMPTS = 120; // 120 × 5s = 10 min

    const poll = setInterval(async () => {
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(poll);
        setStatus('error');
        return;
      }

      try {
        const chainParam = 'evm-base';
        const res = await fetch(
          `${BACKEND_URL}/api/v1/intent/orders?user=${userAddress}&chain=${chainParam}`
        );
        if (!res.ok) return;

        const data = await res.json();
        const orders: Array<{
          status: string;
          orderId?: string;
          startPrice?: string;
          destinationChain?: number;
          intentType?: number;
        }> = data.data ?? data.orders ?? [];

        const latestOrder = orders[0];

        if (latestOrder?.status === 'FULFILLED') {
          setFulfilledOrder({
            startPrice: latestOrder.startPrice ?? '0',
            destinationChain: latestOrder.destinationChain ?? 1,
            intentType: latestOrder.intentType ?? 0,
          });
          setStatus('fulfilled');
          clearInterval(poll);
          clearInterval(ticker);
        } else if (latestOrder?.status === 'OPEN' || orders.length > 0) {
          setStatus('open');
        }
      } catch {
        // Backend may be warming up, ignore
      }
    }, 5000);

    return () => {
      clearInterval(poll);
      clearInterval(ticker);
    };
  }, [txHash, chainId, userAddress]);

  const formatReceiveAmount = (): string | null => {
    if (!fulfilledOrder) return null;

    const { startPrice, destinationChain, intentType } = fulfilledOrder;

    try {
      const raw = BigInt(startPrice);
      const decimals = destinationChain === 1 || destinationChain === 21 ? 9 : 18;
      const s = raw.toString().padStart(decimals + 1, '0');
      const intPart = s.slice(0, -decimals) || '0';
      const fracPart = s.slice(-decimals).slice(0, 6).replace(/0+$/, '');

      const token =
        destinationChain === 1
          ? intentType === 1
            ? 'mSOL'
            : 'SOL'
          : destinationChain === 21
          ? 'SUI'
          : 'ETH';

      return `~${intPart}${fracPart ? `.${fracPart}` : ''} ${token}`;
    } catch {
      return null;
    }
  };

  const receiveLabel = formatReceiveAmount();

  const statusConfig: Record<OrderStatus, StatusConfig> = {
    indexing: {
      icon: 'sync',
      color: 'text-slate-400',
      label: 'Indexing order...',
      spin: true,
      dot: false,
    },
    open: {
      icon: 'schedule',
      color: 'text-amber-400',
      label: 'Awaiting solver',
      spin: false,
      dot: true,
    },
    fulfilled: {
      icon: 'check_circle',
      color: 'text-primary',
      label: 'Fulfilled!',
      spin: false,
      dot: false,
    },
    error: {
      icon: 'warning',
      color: 'text-slate-500',
      label: 'Check Intents panel',
      spin: false,
      dot: false,
    },
  };

  const config = statusConfig[status];
  const isLiquidStaked = fulfilledOrder?.intentType === 1 && fulfilledOrder?.destinationChain === 1;
  const verb = isLiquidStaked ? 'staked' : 'delivered';

  return (
    <div className="mt-3 rounded-xl border border-white/8 bg-white/3 p-3 flex items-center gap-3">
      <div className={`shrink-0 ${config.color} ${config.spin ? 'animate-spin' : ''}`}>
        <span className="material-symbols-outlined text-[18px]">{config.icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {config.dot && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          )}
          <span className={`text-[12px] font-semibold ${config.color}`}>{config.label}</span>
          {status !== 'fulfilled' && status !== 'error' && (
            <span className="text-[10px] text-slate-600 tabular-nums">{elapsed}s</span>
          )}
          {status === 'fulfilled' && receiveLabel && (
            <span className="text-[10px] text-primary font-mono bg-primary/10 px-1.5 py-0.5 rounded-full border border-primary/20">
              {receiveLabel} {verb}
            </span>
          )}
          {status === 'fulfilled' && !receiveLabel && (
            <span className="text-[10px] text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded-full">
              {verb}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-slate-600 font-mono truncate">
            {chain} · {txHash.slice(0, 10)}…{txHash.slice(-6)}
          </span>
          <a
            href={`${explorerBase}${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-slate-600 hover:text-primary transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-[11px]">open_in_new</span>
          </a>
        </div>
      </div>
    </div>
  );
}
