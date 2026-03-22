/**
 * ActiveIntents — Floating panel untuk monitor, detail, dan cancel/refund intent orders.
 *
 * Data strategy:
 *  Primary  → GET /api/v1/intent/orders dari backend indexer (instant, cached)
 *  Fallback → RPC langsung (Base Sepolia getLogs, Solana getProgramAccounts)
 *             dipakai otomatis kalau backend tidak respond dalam 5 detik.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAccount, useSendTransaction } from 'wagmi';
import { Button } from '@/components/ui/button';
import { encodeFunctionData } from 'viem';
import { useWallet } from '@solana/wallet-adapter-react';
import { INTENT_BRIDGE_ABI } from '@/lib/abi/intent-bridge';
import { useIntentOrders, type IntentOrder as IntentRow } from '@/features/intent/hooks/use-intent-orders';
import {
  BASE_SEPOLIA_CONTRACT,
  BASE_SEPOLIA_CHAIN_ID,
  WORMHOLE_CHAIN_SOLANA,
  EXPLORERS,
} from '@/lib/constants';
import { BACKEND_URL } from '@/lib/env'

// ─── Types ────────────────────────────────────────────────────────────────────

type IntentStatus = 'Open' | 'Fulfilled' | 'Cancelled';
type ChainType = 'evm' | 'solana';

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function calcCurrentPrice(sp: number, fp: number, ca: number, dl: number, now: number): number {
  if (now >= dl) return fp;
  if (now <= ca) return sp;
  const elapsed = now - ca;
  const duration = dl - ca;
  return sp - Math.floor(((sp - fp) * elapsed) / duration);
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return 'Ended';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.ceil(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.ceil(h / 24)}d`;
}

function shortHash(h: string, pre = 8, suf = 6): string {
  return `${h.slice(0, pre)}...${h.slice(-suf)}`;
}

function getEvmExplorer(_sourceChain?: string): string {
  return EXPLORERS.baseSepolia;
}

function destChainLabel(wormholeId: number): string {
  if (wormholeId === 1)     return 'Solana';
  if (wormholeId === 21)    return 'Sui';
  if (wormholeId === 10004) return 'Base Sepolia';
  return `Chain ${wormholeId}`;
}

// ─── Detail Dialog ────────────────────────────────────────────────────────────

function TxLink({ label, hash, href }: { label: string; hash: string; href: string }) {
  if (!hash) {
    return (
      <div>
        {label && <div className="text-[10px] text-slate-500 mb-0.5">{label}</div>}
        <span className="text-xs font-mono text-slate-600 italic">Gasless — no on-chain tx from user</span>
      </div>
    );
  }
  return (
    <div>
      {label && <div className="text-[10px] text-slate-500 mb-0.5">{label}</div>}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-xs font-mono text-primary hover:underline break-all"
      >
        {shortHash(hash)}
        <span className="material-symbols-outlined text-xs">open_in_new</span>
      </a>
    </div>
  );
}

function StatusBadge({ status, expired }: { status: IntentStatus; expired: boolean }) {
  if (status === 'Fulfilled')
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Filled</span>;
  if (status === 'Cancelled')
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-500/20 text-slate-400 border border-slate-500/30">Cancelled</span>;
  if (expired)
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/20 text-orange-400 border border-orange-500/30">Expired</span>;
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30 animate-pulse">Open</span>;
}

function IntentDetailDialog({
  intent, open, onClose, now,
}: {
  intent: IntentRow | null;
  open: boolean;
  onClose: () => void;
  now: number;
}) {
  if (!intent || !open) return null;

  const expired = now > intent.deadline;
  const isToSolana = intent.destinationChain === WORMHOLE_CHAIN_SOLANA;
  const evmExp = getEvmExplorer(intent.sourceChain);
  const currency = intent.chain === 'solana' ? 'SOL' : 'ETH';
  const dstCurrency = intent.destinationChain === WORMHOLE_CHAIN_SOLANA ? 'SOL' : intent.destinationChain === 21 ? 'SUI' : 'ETH';
  const srcLabel = intent.chain === 'evm' ? (intent.sourceChain ?? 'EVM') : 'Solana';
  const dstLabel = destChainLabel(intent.destinationChain);
  const currentPrice = calcCurrentPrice(intent.startPrice, intent.floorPrice, intent.createdAt, intent.deadline, now);
  const progress = intent.deadline > intent.createdAt
    ? Math.min(100, ((now - intent.createdAt) / (intent.deadline - intent.createdAt)) * 100)
    : 100;
  const timeLeft = intent.deadline - now;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-[#0f1117] border border-white/10 rounded-2xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#0f1117] flex items-center justify-between px-5 py-4 border-b border-white/5 z-10">
          <div className="flex items-center gap-2.5">
            <span className="text-base font-semibold text-white">Intent Details</span>
            <StatusBadge status={intent.status} expired={expired} />
          </div>
          <Button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <span className="material-symbols-outlined">close</span>
          </Button>
        </div>

        <div className="p-5 space-y-3">
          {/* Route */}
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-3">
            <div className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Route</div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <span>{srcLabel}</span>
              <span className="text-slate-500">→</span>
              <span>{dstLabel}</span>
            </div>
          </div>

          {/* Order ID */}
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-3">
            <div className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider">
              {intent.chain === 'evm' ? 'Order ID (bytes32)' : 'Account Pubkey'}
            </div>
            <p className="text-xs font-mono break-all text-slate-300">{intent.id}</p>
          </div>

          {/* Create / Execute TX */}
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-3">
            <div className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider">
              {intent.isGasless ? 'Execute TX (by Solver)' : 'Create Intent TX'}
            </div>
            {intent.chain === 'evm' ? (
              <TxLink label="" hash={intent.txDigest} href={`${evmExp}/tx/${intent.txDigest}`} />
            ) : (
              <TxLink label="" hash={intent.txDigest} href={`${EXPLORERS.solana}/tx/${intent.txDigest}?cluster=devnet`} />
            )}
          </div>

          {/* Amount */}
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-3">
            <div className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Amount</div>
            <p className="text-xl font-bold text-white">
              {intent.amount.toFixed(6)} <span className="text-sm font-normal text-slate-400">{currency}</span>
            </p>
          </div>

          {/* Recipient */}
          {intent.recipient && (
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-3">
              <div className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider">
                Recipient {isToSolana ? '(Solana)' : ''}
              </div>
              {isToSolana ? (
                <a
                  href={`${EXPLORERS.solana}/address/${intent.recipient}?cluster=devnet`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-mono text-emerald-400 hover:underline break-all"
                >
                  {intent.recipient}
                  <span className="material-symbols-outlined text-xs">open_in_new</span>
                </a>
              ) : (
                <p className="text-xs font-mono break-all text-slate-300">{intent.recipient}</p>
              )}
            </div>
          )}

          {/* Auction Prices */}
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-3">
            <div className="text-[10px] text-slate-500 mb-2 uppercase tracking-wider">Auction Prices ({dstCurrency})</div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-slate-500 mb-0.5">Start</div>
                <div className="font-mono font-medium text-slate-300">{(intent.startPrice / 1e9).toFixed(6)}</div>
              </div>
              <div>
                <div className="text-slate-500 mb-0.5">Floor</div>
                <div className="font-mono font-medium text-slate-300">{(intent.floorPrice / 1e9).toFixed(6)}</div>
              </div>
              <div>
                <div className="text-slate-500 mb-0.5">Current</div>
                <div className="font-mono font-medium text-primary">{(currentPrice / 1e9).toFixed(6)}</div>
              </div>
            </div>
          </div>

          {/* Timeline + Progress */}
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-3">
            <div className="text-[10px] text-slate-500 mb-2 uppercase tracking-wider">Timeline</div>
            <div className="grid grid-cols-2 gap-3 text-xs mb-2">
              <div>
                <div className="text-slate-500 mb-0.5">Created</div>
                <div className="text-slate-300">{new Date(intent.createdAt).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-slate-500 mb-0.5">Deadline</div>
                <div className={expired ? 'text-orange-400' : 'text-slate-300'}>
                  {new Date(intent.deadline).toLocaleString()}
                </div>
              </div>
            </div>
            {intent.status === 'Open' && (
              <div>
                <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                  <span>Time remaining</span>
                  <span className={timeLeft < 60000 ? 'text-red-400 font-semibold' : ''}>
                    {formatTimeRemaining(timeLeft)}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-primary transition-all duration-1000"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Fulfillment */}
          {intent.status === 'Fulfilled' && (
            <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3 space-y-2.5">
              <div className="text-[10px] text-emerald-400 mb-1 uppercase tracking-wider font-semibold">Fulfillment</div>
              {intent.solverAddress && (
                <div>
                  <div className="text-[10px] text-slate-500 mb-0.5">Solver (EVM)</div>
                  <a href={`${evmExp}/address/${intent.solverAddress}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs font-mono text-purple-400 hover:underline break-all">
                    {intent.solverAddress}
                    <span className="material-symbols-outlined text-xs">open_in_new</span>
                  </a>
                </div>
              )}
              {isToSolana && intent.solanaPaymentTxHash && (
                <TxLink
                  label="[1] SOL sent to recipient (Solana)"
                  hash={intent.solanaPaymentTxHash}
                  href={`${EXPLORERS.solana}/tx/${intent.solanaPaymentTxHash}?cluster=devnet`}
                />
              )}
              {intent.fulfillTxHash && (
                <TxLink
                  label={isToSolana ? '[2] ETH claimed by solver (EVM)' : 'Settled on EVM'}
                  hash={intent.fulfillTxHash}
                  href={`${evmExp}/tx/${intent.fulfillTxHash}`}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Order Card ───────────────────────────────────────────────────────────────

function OrderCard({
  intent, now, cancellingId, onCancel, onDetail,
}: {
  intent: IntentRow;
  now: number;
  cancellingId: string | null;
  onCancel: (i: IntentRow) => void;
  onDetail: (i: IntentRow) => void;
}) {
  const expired = intent.status === 'Open' && now > intent.deadline;
  const isOpen = intent.status === 'Open';
  const currentPrice = calcCurrentPrice(intent.startPrice, intent.floorPrice, intent.createdAt, intent.deadline, now);
  const progress = intent.deadline > intent.createdAt
    ? Math.min(100, ((now - intent.createdAt) / (intent.deadline - intent.createdAt)) * 100)
    : 100;
  const timeLeft = intent.deadline - now;
  const currency = intent.chain === 'solana' ? 'SOL' : 'ETH';
  const dstCurrency = intent.destinationChain === WORMHOLE_CHAIN_SOLANA ? 'SOL' : intent.destinationChain === 21 ? 'SUI' : 'ETH';
  const dstLabel = destChainLabel(intent.destinationChain);
  const evmExp = getEvmExplorer(intent.sourceChain);
  const isToSolana = intent.destinationChain === WORMHOLE_CHAIN_SOLANA;
  const cancelling = cancellingId === intent.id;

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] hover:border-white/10 transition-colors overflow-hidden">
      <div className="p-3">
        {/* Header */}
        <div className="flex items-start justify-between mb-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            {intent.txDigest ? (
              <a
                href={intent.chain === 'evm'
                  ? `${evmExp}/tx/${intent.txDigest}`
                  : `${EXPLORERS.solana}/tx/${intent.txDigest}?cluster=devnet`}
                target="_blank" rel="noopener noreferrer"
                className="text-[10px] font-mono text-slate-500 hover:text-primary transition-colors flex items-center gap-0.5"
              >
                {shortHash(intent.txDigest, 6, 4)}
                <span className="material-symbols-outlined text-[10px]">open_in_new</span>
              </a>
            ) : (
              <span className="text-[10px] font-mono text-slate-600 flex items-center gap-0.5">
                <span className="material-symbols-outlined text-[10px]">lock_open</span>
                Gasless
              </span>
            )}
            {intent.sourceChain && (
              <span className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-slate-400 border border-white/[0.07]">
                {intent.sourceChain}
              </span>
            )}
            <span className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-slate-500 border border-white/[0.07]">
              → {dstLabel}
            </span>
          </div>
          <StatusBadge status={intent.status} expired={expired} />
        </div>

        {/* Amount + Current Price */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-baseline gap-1">
            <span className="text-base font-bold text-white">{intent.amount.toFixed(4)}</span>
            <span className="text-xs text-slate-400">{currency}</span>
          </div>
          {isOpen && (
            <div className="text-right">
              <div className="text-[10px] text-slate-500">Current price</div>
              <div className="text-xs font-mono text-slate-300">{(currentPrice / 1e9).toFixed(6)} {dstCurrency}</div>
            </div>
          )}
        </div>

        {/* Times */}
        <div className="flex items-center justify-between text-[10px] text-slate-600 mb-2">
          <span>Created {new Date(intent.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span>Deadline {new Date(intent.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>

        {/* Dutch auction progress bar */}
        {isOpen && (
          <div className="mb-3">
            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden mb-1">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-primary transition-all duration-1000"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-600">Floor: {(intent.floorPrice / 1e9).toFixed(6)} {dstCurrency}</span>
              <span className={timeLeft < 60000 ? 'text-red-400 font-semibold' : 'text-slate-500'}>
                <span className="material-symbols-outlined text-[10px] align-middle mr-0.5">timer</span>
                {formatTimeRemaining(timeLeft)}
              </span>
            </div>
          </div>
        )}

        {/* Fulfilled: compact proof links */}
        {intent.status === 'Fulfilled' && intent.chain === 'evm' && (
          <div className="mb-2.5 pt-2 border-t border-emerald-500/20 space-y-1.5 text-[10px]">
            {isToSolana && intent.recipient && (
              <div className="flex items-center gap-1 text-slate-500">
                <span>Recipient:</span>
                <a href={`${EXPLORERS.solana}/address/${intent.recipient}?cluster=devnet`}
                  target="_blank" rel="noopener noreferrer"
                  className="font-mono text-emerald-400 hover:underline">
                  {intent.recipient.slice(0, 6)}...{intent.recipient.slice(-4)}
                  <span className="material-symbols-outlined text-[10px] align-middle ml-0.5">open_in_new</span>
                </a>
              </div>
            )}
            {isToSolana && intent.solanaPaymentTxHash && (
              <div className="text-slate-500">
                <span>[1] SOL: </span>
                <a href={`${EXPLORERS.solana}/tx/${intent.solanaPaymentTxHash}?cluster=devnet`}
                  target="_blank" rel="noopener noreferrer"
                  className="font-mono text-purple-400 hover:underline">
                  {shortHash(intent.solanaPaymentTxHash)}
                </a>
              </div>
            )}
            {intent.fulfillTxHash && (
              <div className="text-slate-500">
                <span>{isToSolana ? '[2] ETH: ' : 'Settled: '}</span>
                <a href={`${evmExp}/tx/${intent.fulfillTxHash}`}
                  target="_blank" rel="noopener noreferrer"
                  className="font-mono text-emerald-400 hover:underline">
                  {shortHash(intent.fulfillTxHash)}
                </a>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {isOpen && intent.chain === 'evm' && (
            <Button
              onClick={() => onCancel(intent)}
              disabled={cancelling}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all
                ${expired
                  ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30'
                  : 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {cancelling
                ? <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                : <span className="material-symbols-outlined text-sm">{expired ? 'savings' : 'cancel'}</span>
              }
              {expired ? 'Refund' : 'Cancel'}
            </Button>
          )}
          <Button
            onClick={() => onDetail(intent)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold
              bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 transition-all"
          >
            <span className="material-symbols-outlined text-sm">info</span>
            Details
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ActiveIntents() {
  const [open, setOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [selectedIntent, setSelectedIntent] = useState<IntentRow | null>(null);
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [activeTab, setActiveTab] = useState<ChainType>('evm');

  const [optimisticCount, setOptimisticCount] = useState(0);
  const [bounceBadge, setBounceBadge] = useState(false);

  const { address: evmAddress } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const { connected: solConnected } = useWallet();

  const {
    evmOrders, solanaOrders,
    evmLoading, solanaLoading,
    evmFetched, solanaFetched,
    backendUp, refresh,
  } = useIntentOrders();

  // 1-second ticker for auction countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  // ── Optimistic Orders Sync ──────────────────────────────────────────────────
  const prevOrderIdsRef = React.useRef(new Set<string>());
  useEffect(() => {
    const currentIds = new Set([...evmOrders, ...solanaOrders].map(o => o.id));
    const hasNew = [...currentIds].some(id => !prevOrderIdsRef.current.has(id));
    if (hasNew) setOptimisticCount(0);
    prevOrderIdsRef.current = currentIds;
  }, [evmOrders, solanaOrders]);

  useEffect(() => {
    const handleOptimistic = () => {
      setOptimisticCount(c => c + 1);
      setBounceBadge(true);
      setTimeout(() => setBounceBadge(false), 1000);
    };
    window.addEventListener('optimistic-intent-created', handleOptimistic);
    return () => window.removeEventListener('optimistic-intent-created', handleOptimistic);
  }, []);

  // ticker untuk auction countdown — tetap di sini
  // (useIntentOrders handle fetch + polling)

  // ── Cancel / Refund ────────────────────────────────────────────────────────
  const handleCancel = useCallback(async (intent: IntentRow) => {
    if (intent.chain !== 'evm') {
      showToast('Solana intent cancellation coming soon', 'error');
      return;
    }
    if (!evmAddress) { showToast('Connect EVM wallet first', 'error'); return; }

    setCancellingId(intent.id);
    try {
      // Gasless pre-execute: cancel off-chain (no gas needed, no on-chain order yet)
      if (intent.isGasless && !intent.txDigest) {
        const res = await fetch(`${BACKEND_URL}/api/v1/intent/orders/${intent.id}/cancel`, { method: 'PATCH' });
        const json = await res.json() as { success: boolean; error?: string };
        if (!json.success) throw new Error(json.error ?? 'Cancel failed');
        showToast('Intent cancelled!', 'success');
        setTimeout(refresh, 1000);
        return;
      }

      // On-chain cancel (old-style lock-funds, or gasless already executed)
      const contractAddress = BASE_SEPOLIA_CONTRACT;
      const data = encodeFunctionData({
        abi: INTENT_BRIDGE_ABI,
        functionName: 'cancelOrder',
        args: [intent.id as `0x${string}`],
      });
      await sendTransactionAsync({ to: contractAddress, data, chainId: BASE_SEPOLIA_CHAIN_ID });
      showToast('Order cancelled — ETH refunded!', 'success');
      setTimeout(refresh, 2000);
    } catch (e: any) {
      showToast(e.shortMessage ?? e.message ?? 'Cancel failed', 'error');
    } finally {
      setCancellingId(null);
    }
  }, [evmAddress, sendTransactionAsync, refresh]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const allOrders = useMemo(() => [...evmOrders, ...solanaOrders], [evmOrders, solanaOrders]);
  const stats = useMemo(() => {
    const nowMs = Date.now();
    return {
      open:      allOrders.filter(i => i.status === 'Open' && i.deadline > nowMs).length,
      fulfilled: allOrders.filter(i => i.status === 'Fulfilled').length,
      expired:   allOrders.filter(i => i.status === 'Open' && i.deadline <= nowMs).length,
    };
  }, [allOrders]);

  const filteredOrders = activeTab === 'evm' ? evmOrders : solanaOrders;
  const realTotalActive = stats.open + stats.expired;
  const displayCount = realTotalActive + optimisticCount;
  const isLoading = evmLoading || solanaLoading;

  if (!evmAddress && !solConnected) return null;

  return (
    <>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[200] px-4 py-3 rounded-xl border shadow-2xl text-sm font-medium max-w-xs
          ${toast.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
          {toast.msg}
        </div>
      )}

      {/* Detail dialog */}
      <IntentDetailDialog
        intent={selectedIntent}
        open={!!selectedIntent}
        onClose={() => setSelectedIntent(null)}
        now={now}
      />

      {/* Floating trigger button */}
      <Button
        onClick={() => setOpen(v => !v)}
        className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl
          bg-[#0f1117] border border-white/10 shadow-2xl hover:border-primary/40 
          transition-all duration-300 group
          ${displayCount > 0 ? 'ring-2 ring-primary/50 ring-offset-2 ring-offset-[#0c1211] shadow-[0_0_20px_rgba(13,242,223,0.4)] animate-pulse' : ''}
        `}
      >
        <span className={`material-symbols-outlined text-xl text-primary transition-transform ${displayCount > 0 ? 'group-hover:-translate-y-1' : ''}`}>
          receipt_long
        </span>
        <span className="text-sm font-semibold text-white hidden sm:block">Intents</span>
        {displayCount > 0 && (
          <span className={`flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold transition-all
            ${stats.expired > 0 ? 'bg-orange-500 text-black' : 'bg-primary text-black'}
            ${bounceBadge ? 'scale-150 shadow-lg !bg-white' : ''}
          `}>
            {displayCount}
          </span>
        )}
      </Button>

      {/* Side panel */}
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="fixed bottom-20 right-6 z-50 w-[360px] max-h-[600px] flex flex-col
            bg-[#0f1117] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">

            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-base text-primary">receipt_long</span>
                <span className="text-sm font-semibold text-white">Active Intents</span>
                {!backendUp && (
                  <span className="text-[9px] text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded-full">RPC fallback</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {/* Stats */}
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="text-blue-400">{stats.open} open</span>
                  <span className="text-emerald-400">{stats.fulfilled} filled</span>
                  {stats.expired > 0 && <span className="text-orange-400">{stats.expired} expired</span>}
                </div>
                <Button
                  onClick={refresh}
                  disabled={isLoading}
                  className="text-slate-500 hover:text-white transition-colors disabled:opacity-40"
                  title="Refresh"
                >
                  {/* Spin hanya saat background refresh (sudah ada data), bukan saat first-load */}
                  <span className={`material-symbols-outlined text-base ${isLoading && allOrders.length > 0 ? 'animate-spin' : ''}`}>refresh</span>
                </Button>
                <Button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white transition-colors">
                  <span className="material-symbols-outlined text-base">close</span>
                </Button>
              </div>
            </div>

            {/* Chain tabs */}
            <div className="flex border-b border-white/5 flex-shrink-0">
              {(['evm', 'solana'] as ChainType[]).map(tab => (
                <Button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-2 text-xs font-semibold transition-all
                    ${activeTab === tab
                      ? 'text-primary border-b-2 border-primary bg-primary/5'
                      : 'text-slate-500 hover:text-white'}`}
                >
                  {tab === 'evm' ? `EVM (${evmOrders.length})` : `Solana (${solanaOrders.length})`}
                </Button>
              ))}
            </div>

            {/* Expired refund notice */}
            {stats.expired > 0 && (
              <div className="px-4 py-2 bg-orange-500/5 border-b border-orange-500/10 flex-shrink-0">
                <p className="text-[10px] text-orange-400">
                  <span className="material-symbols-outlined text-xs align-middle mr-0.5">warning</span>
                  {stats.expired} order{stats.expired > 1 ? 's' : ''} expired — click Refund to recover ETH
                </p>
              </div>
            )}

            {/* Orders list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {/* First-load spinner: hanya saat belum pernah fetch */}
              {((activeTab === 'evm' && !evmFetched) || (activeTab === 'solana' && !solanaFetched)) ? (
                <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
                  <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
                  Scanning chain...
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <span className="material-symbols-outlined text-4xl text-slate-700 mb-2">inbox</span>
                  <p className="text-slate-500 text-sm">No intents found</p>
                  {activeTab === 'evm' && !evmAddress && (
                    <p className="text-slate-700 text-xs mt-1">Connect EVM wallet to see orders</p>
                  )}
                  {activeTab === 'solana' && !solConnected && (
                    <p className="text-slate-700 text-xs mt-1">Connect Solana wallet to see intents</p>
                  )}
                </div>
              ) : (
                filteredOrders.map(intent => (
                  <React.Fragment key={intent.id}>
                    <OrderCard
                      intent={intent}
                      now={now}
                      cancellingId={cancellingId}
                      onCancel={handleCancel}
                      onDetail={setSelectedIntent}
                    />
                  </React.Fragment>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
