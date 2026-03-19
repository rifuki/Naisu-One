import { useState, useRef, useCallback, useEffect } from 'react';
import { useAccount, useSendTransaction, usePublicClient } from 'wagmi';
import { parseEther } from 'viem';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGlobalAgent } from '@/components/providers/agent-provider';
import { IntentChat } from '@/features/intent/components/intent-chat';
import { ChatSidebar } from '@/features/intent/components/chat-sidebar';
import { TransactionReviewCard, type PendingTx } from '@/features/intent/components/transaction-review-card';
import { GaslessIntentReviewCard } from '@/features/intent/components/gasless-intent-review-card';
import { SettingsModal } from '@/features/intent/components/settings-modal';
import { useSignIntent, type SignIntentParams } from '@/features/intent/hooks/use-sign-intent';
import { useOrderWatch } from '@/hooks/useOrderWatch';
import type { WidgetConfirmPayload } from '@/features/intent/components/widgets';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim() || 'http://localhost:3000';
const PENDING_INTENT_KEY = 'naisu_pending_signed_intent';

// Storage key for fulfilled intent state per session
const FULFILLED_STATE_KEY = (sessionId: string) => `naisu_fulfilled_${sessionId}`;

interface FulfilledState {
  intentFulfilled: boolean;
  fillPrice?: string;
  winnerSolver?: string;
  signedAt?: number;
  fulfilledAt?: number;
  signedIntentSnapshot?: SignIntentParams;
  intentProgress?: ProgressStep[];  // Persist progress steps
}

interface ProgressStep {
  key: string
  label: string
  detail?: string
  done: boolean
  active: boolean
}

export default function IntentPage() {
  const [inputValue, setInputValue] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const initialIntentRef = useRef(location.state?.initialIntent as string | undefined);
  const initialSentRef = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isTxSent, setIsTxSent] = useState(false);
  const [isTxFailed, setIsTxFailed] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [submittedTxs, setSubmittedTxs] = useState<Array<{ hash: string; chainId: number; msgIdx: number; submittedAt: number }>>([]);
  
  // Gasless intent states
  const [gaslessStatus, setGaslessStatus] = useState<string | null>(null);
  const [isGaslessFailed, setIsGaslessFailed] = useState(false);
  const [isGaslessSuccess, setIsGaslessSuccess] = useState(false);

  // Progress tracking state (shown after successful sign)
  const [intentProgress, setIntentProgress] = useState<ProgressStep[] | null>(null);
  const [intentFulfilled, setIntentFulfilled] = useState(false);
  const trackedIntentIdRef = useRef<string | null>(null);
  // Snapshot of the signed intent — used to render the inline card in chat (stays permanently as receipt)
  const [signedIntentSnapshot, setSignedIntentSnapshot] = useState<SignIntentParams | undefined>(undefined);
  // Fulfillment details for receipt card
  const [fillPrice, setFillPrice] = useState<string | undefined>();
  const [winnerSolver, setWinnerSolver] = useState<string | undefined>();
  const [signedAt, setSignedAt] = useState<number | undefined>();
  const [fulfilledAt, setFulfilledAt] = useState<number | undefined>();

  const { address } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient();
  
  // Gasless signing hook
  const signIntent = useSignIntent();

  // ── Global Agent State ────────────────────────────────────

  const { 
    sessions, activeSessionId, activeSession, createSession, switchSession, deleteSession,
    exportSessions, importSessions, clearAllSessions, updateIntentCount,
    messages, isLoading, error, sendMessage, addMessage, pendingTx, setPendingTx,
    pendingGaslessIntent, setPendingGaslessIntent
  } = useGlobalAgent();

  // Load persisted fulfilled state when session changes
  useEffect(() => {
    if (!activeSessionId) return;
    try {
      const saved = localStorage.getItem(FULFILLED_STATE_KEY(activeSessionId));
      if (saved) {
        const state: FulfilledState = JSON.parse(saved);
        setIntentFulfilled(state.intentFulfilled);
        setFillPrice(state.fillPrice);
        setWinnerSolver(state.winnerSolver);
        setSignedAt(state.signedAt);
        setFulfilledAt(state.fulfilledAt);
        setSignedIntentSnapshot(state.signedIntentSnapshot);
        // Restore progress steps if available
        if (state.intentProgress) {
          setIntentProgress(state.intentProgress);
        }
      } else {
        // Reset state if no persisted data for this session
        setIntentFulfilled(false);
        setFillPrice(undefined);
        setWinnerSolver(undefined);
        setSignedAt(undefined);
        setFulfilledAt(undefined);
        setSignedIntentSnapshot(undefined);
        setIntentProgress(null);
      }
    } catch {
      // Ignore parse errors
    }
  }, [activeSessionId]);

  // Persist fulfilled state whenever it changes
  useEffect(() => {
    if (!activeSessionId) return;
    if (!intentFulfilled && !signedIntentSnapshot) {
      // Clean up storage if no state to save
      try { localStorage.removeItem(FULFILLED_STATE_KEY(activeSessionId)); } catch { /* ignore */ }
      return;
    }
    const state: FulfilledState = {
      intentFulfilled,
      fillPrice,
      winnerSolver,
      signedAt,
      fulfilledAt,
      signedIntentSnapshot,
      intentProgress,
    };
    try { localStorage.setItem(FULFILLED_STATE_KEY(activeSessionId), JSON.stringify(state)); } catch { /* quota */ }
  }, [activeSessionId, intentFulfilled, fillPrice, winnerSolver, signedAt, fulfilledAt, signedIntentSnapshot, intentProgress]);

  const currentMsgIdxRef = useRef(0);

  // SSE progress tracking for the active gasless intent
  useOrderWatch({
    user:    address,
    enabled: !!address && intentProgress !== null,
    onOrderUpdate: useCallback((event) => {
      console.log('[intent-page] onOrderUpdate received:', { 
        eventOrderId: event.orderId, 
        trackedId: trackedIntentIdRef.current, 
        status: event.status,
        match: event.orderId === trackedIntentIdRef.current 
      });
      if (event.orderId !== trackedIntentIdRef.current) {
        console.log('[intent-page] orderId mismatch, skipping. Expected:', trackedIntentIdRef.current, 'Got:', event.orderId);
        return;
      }
      if (event.status === 'FULFILLED') {
        console.log('[intent-page] Order FULFILLED, updating UI');
        // Clear persisted signed intent — it has been fulfilled on-chain
        try { localStorage.removeItem(PENDING_INTENT_KEY); } catch { /* ignore */ }
        
        // Update intent count for stats
        if (activeSessionId) {
          updateIntentCount(activeSessionId, true);
        }
        // Mark all steps done and set fulfilled flag — card stays permanently as receipt
        // Note: useEffect will auto-save to localStorage when these states change
        setIntentProgress(prev => prev
          ? prev.map(s => ({ ...s, done: true, active: false }))
          : prev
        );
        setIntentFulfilled(true);
        setFulfilledAt(Date.now());
        trackedIntentIdRef.current = null;
        setPendingGaslessIntent(undefined);
        setGaslessStatus(null);
        window.dispatchEvent(new CustomEvent('optimistic-intent-created'));
        sendMessage(`[System] Intent signed and submitted. ID: ${event.orderId}\nPlease provide a polite, concise confirmation that the intent was submitted gaslessly (FREE!) and solvers are now bidding to fill it.`);
      }
    }, [setPendingGaslessIntent, sendMessage]),
    onGaslessResolved: useCallback((intentId: string, contractOrderId: string) => {
      console.log('[intent-page] gasless_resolved:', { intentId, contractOrderId, currentTracked: trackedIntentIdRef.current });
      if (trackedIntentIdRef.current === intentId) {
        console.log('[intent-page] Updating trackedId from', intentId, 'to', contractOrderId);
        trackedIntentIdRef.current = contractOrderId;
      } else {
        console.log('[intent-page] gasless_resolved ignored - intentId mismatch');
      }
    }, []),
    onProgress: useCallback((evt) => {
      if (evt.orderId !== trackedIntentIdRef.current) return;
      if (evt.type === 'rfq_broadcast') {
        const count = (evt.data['solverCount'] as number | undefined) ?? 1;
        setIntentProgress(prev => prev ? prev.map(s =>
          s.key === 'rfq'
            ? { ...s, label: `Broadcasting RFQ to ${count} solver${count !== 1 ? 's' : ''}…`, active: true }
            : s
        ) : prev);
      } else if (evt.type === 'rfq_winner') {
        const winner  = evt.data['winner']      as string | undefined;
        const priceRaw = evt.data['quotedPrice'] as string | undefined;
        const eta      = evt.data['estimatedETA'] as number | undefined;
        const priceSol = priceRaw
          ? (Number(BigInt(priceRaw)) / 1e9).toFixed(4)
          : undefined;
        const detail = winner
          ? `${winner}${priceSol ? ` — ${priceSol} SOL` : ''}${eta ? ` (ETA ~${eta}s)` : ''}`
          : undefined;
        
        // Store winner and fill price for receipt card
        if (winner) setWinnerSolver(winner);
        if (priceSol) setFillPrice(priceSol);
        
        // Mark all steps up to and including winner as done; set executing active
        setIntentProgress(prev => prev ? prev.map(s => {
          if (s.key === 'rfq')       return { ...s, done: true, active: false };
          if (s.key === 'winner')    return { ...s, done: true, active: false, label: detail ? `Winner: ${detail}` : 'Winner selected', detail: undefined };
          if (s.key === 'executing') return { ...s, active: true };
          return s;
        }) : prev);
      } else if (evt.type === 'execute_sent') {
        // Mark all steps up to and including executing as done; set fulfilled active
        setIntentProgress(prev => prev ? prev.map(s => {
          if (s.key === 'rfq' || s.key === 'winner' || s.key === 'signed') return { ...s, done: true, active: false };
          if (s.key === 'executing') return { ...s, done: true, active: false };
          if (s.key === 'fulfilled') return { ...s, active: true };
          return s;
        }) : prev);
      }
    }, []),
  });

  const handleSend = useCallback(async (overrideText?: string | React.MouseEvent | React.FormEvent) => {
    const text = (typeof overrideText === 'string' ? overrideText : inputValue).trim();
    if (!text || isLoading) return;

    setInputValue('');
    currentMsgIdxRef.current = messages.length + 1;

    try {
      await sendMessage(text);
    } catch {
      // Error handled by useAgent
    }
  }, [inputValue, isLoading, messages.length, sendMessage]);

  // Auto-send initial intent from Landing Page
  useEffect(() => {
    if (initialIntentRef.current && !initialSentRef.current) {
      initialSentRef.current = true;
      // Force a pristine session for new intents from the home page
      createSession();
      // Delay slightly so the new session has time to become active
      // and useSolanaAddress has time to detect injected wallets
      setTimeout(() => {
        handleSend(initialIntentRef.current);
      }, 500);
      navigate('/intent', { replace: true, state: {} });
    }
  }, [handleSend, navigate, createSession]);

  const handleSendTx = useCallback(
    async (tx: PendingTx) => {
      if (!address || !sendTransactionAsync) return;

      setTxStatus('Confirm in wallet...');

      try {
        const hash = await sendTransactionAsync({
          to: tx.to as `0x${string}`,
          data: tx.data as `0x${string}`,
          value: parseEther(tx.value),
          chainId: tx.chainId,
        });

        if (hash) {
          setTxStatus('Confirming block...');
          let receipt;
          try {
            if (publicClient) {
              receipt = await publicClient.waitForTransactionReceipt({ hash });
            }
          } catch (e) {
            console.error('Error waiting for receipt:', e);
          }

          if (receipt?.status === 'reverted') {
            setTxStatus('Transaction failed on-chain');
            setIsTxFailed(true);
            setTimeout(() => {
              setIsTxFailed(false);
              setTxStatus(null);
            }, 3000);
          } else {
            setTxStatus('Transaction successful!');
            setSubmittedTxs((prev) => [
              ...prev,
              { hash, chainId: tx.chainId, msgIdx: currentMsgIdxRef.current, submittedAt: Date.now() },
            ]);
            setIsTxSent(true);
            setTimeout(() => {
              setPendingTx(undefined);
              setIsTxSent(false);
              window.dispatchEvent(new CustomEvent('optimistic-intent-created'));
              sendMessage(`[System] Transaction confirmed on-chain. Hash: ${hash}\nPlease provide a polite, concise confirmation message to the user that the bridge intent has been successfully created and the Dutch auction is actively seeking solvers. Keep it brief and enthusiastic.`);
            }, 800);
          }
        } else {
          setPendingTx(undefined);
          setTxStatus(null);
        }
      } catch (err) {
        setTxStatus(null);
      }
    },
    [address, sendTransactionAsync]
  );

  /** New Chat: create a new session, stay on /intent */
  const handleNewChat = useCallback(() => {
    // Check if current session has messages or fulfillment state
    const hasMessages = messages.length > 0;
    const hasFulfillmentState = intentFulfilled || signedIntentSnapshot;
    const isEffectivelyEmpty = !hasMessages && !hasFulfillmentState;
    
    // If session is effectively empty (no messages, no fulfillment), just reset without creating new session
    if (isEffectivelyEmpty && activeSession) {
      setInputValue('');
      setSubmittedTxs([]);
      setPendingTx(undefined);
      setPendingGaslessIntent(undefined);
      setGaslessStatus(null);
      setIsGaslessFailed(false);
      setIsGaslessSuccess(false);
      setIntentProgress(null);
      trackedIntentIdRef.current = null;
      currentMsgIdxRef.current = 0;
      return;
    }
    
    setInputValue('');
    setSubmittedTxs([]);
    setPendingTx(undefined);
    setPendingGaslessIntent(undefined);
    setGaslessStatus(null);
    setIsGaslessFailed(false);
    setIsGaslessSuccess(false);
    setIntentProgress(null);
    setIntentFulfilled(false);
    setSignedIntentSnapshot(undefined);
    setFillPrice(undefined);
    setWinnerSolver(undefined);
    setSignedAt(undefined);
    setFulfilledAt(undefined);
    trackedIntentIdRef.current = null;
    currentMsgIdxRef.current = 0;
    createSession();
  }, [createSession, setPendingTx, setPendingGaslessIntent, messages.length, intentFulfilled, signedIntentSnapshot, activeSession]);

  /** Handle widget confirm — agent sent a quote_review widget, user confirmed selections */
  const handleWidgetConfirm = useCallback((payload: WidgetConfirmPayload) => {
    if (payload.widgetType === 'quote_review') {
      const { outputToken, durationSeconds } = payload.selection as { outputToken: string; durationSeconds: number };
      sendMessage(`[Widget confirm] outputToken=${outputToken} duration=${durationSeconds}`);
    }
  }, [sendMessage]);

  /** Handle gasless intent signing */
  const handleSignGaslessIntent = useCallback(async () => {
    if (!pendingGaslessIntent || !address) return;

    setGaslessStatus('Connecting to backend...');

    try {
      // Verify backend is reachable and fetch fresh nonce before asking user to sign.
      // If backend is unreachable, signing is blocked — user cannot submit an intent that won't be processed.
      let nonce = pendingGaslessIntent.nonce;
      try {
        const nonceRes = await fetch(`${BACKEND_URL}/api/v1/intent/nonce?address=${address}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!nonceRes.ok) throw new Error('fetch failed');
        const nonceJson = await nonceRes.json() as { success: boolean; data?: { nonce: number } };
        if (nonceJson.success && nonceJson.data?.nonce !== undefined) {
          nonce = nonceJson.data.nonce;
        }
      } catch {
        throw new Error('fetch failed — backend unreachable');
      }

      setGaslessStatus('Sign message in wallet...');

      const result = await signIntent.mutateAsync({
        recipientAddress: pendingGaslessIntent.recipientAddress,
        destinationChain: pendingGaslessIntent.destinationChain,
        amount: pendingGaslessIntent.amount,
        outputToken: pendingGaslessIntent.outputToken,
        startPrice: pendingGaslessIntent.startPrice,
        floorPrice: pendingGaslessIntent.floorPrice,
        durationSeconds: pendingGaslessIntent.durationSeconds,
        nonce,
      });

      // Persist signed intent to localStorage — recoverable if backend goes down post-sign
      try {
        localStorage.setItem(PENDING_INTENT_KEY, JSON.stringify({
          intent: result.intent,
          signature: result.signature,
          submittedAt: Date.now(),
          intentId: result.submissionResult.intentId,
        }));
      } catch { /* storage unavailable — non-critical */ }

      // Sign succeeded — add receipt message to chat history and start progress tracking
      trackedIntentIdRef.current = result.submissionResult.intentId;
      setSignedIntentSnapshot(pendingGaslessIntent);
      setSignedAt(Date.now());
      
      // Update intent count (signed but not fulfilled yet)
      if (activeSessionId) {
        updateIntentCount(activeSessionId, false);
      }
      setPendingGaslessIntent(undefined);
      setGaslessStatus(null);
      setIsGaslessSuccess(false);
      setIntentProgress([
        { key: 'signed',    label: 'Signed & submitted',           detail: undefined, done: true,  active: false },
        { key: 'rfq',       label: 'Broadcasting RFQ to solvers…', detail: undefined, done: false, active: true  },
        { key: 'winner',    label: 'Waiting for winner…',          detail: undefined, done: false, active: false },
        { key: 'executing', label: 'Executing on-chain…',          detail: undefined, done: false, active: false },
        { key: 'fulfilled', label: 'Awaiting fulfillment…',        detail: undefined, done: false, active: false },
      ]);
      
      // Add receipt message to chat history
      const receiptContent = `[INTENT_RECEIPT]${JSON.stringify({
        intent: pendingGaslessIntent,
        progress: [
          { key: 'signed', label: 'Signed & submitted', done: true, active: false },
          { key: 'rfq', label: 'Broadcasting RFQ to solvers…', done: false, active: true },
          { key: 'winner', label: 'Waiting for winner…', done: false, active: false },
          { key: 'executing', label: 'Executing on-chain…', done: false, active: false },
          { key: 'fulfilled', label: 'Awaiting fulfillment…', done: false, active: false },
        ],
        fillPrice,
        winnerSolver,
        signedAt: Date.now(),
      })}`;
      addMessage(receiptContent, 'assistant');
      
      window.dispatchEvent(new CustomEvent('optimistic-intent-created'));
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Signing failed';
      console.error(`[intent-page] signing/submission failed`, {
        error: raw,
        stack: err instanceof Error ? err.stack : undefined,
        intent: pendingGaslessIntent ? {
          recipient: pendingGaslessIntent.recipientAddress,
          dest: pendingGaslessIntent.destinationChain,
          amount: pendingGaslessIntent.amount,
          outputToken: pendingGaslessIntent.outputToken,
        } : null,
        walletAddress: address,
      });
      const errorMsg = raw.includes('No solver') || raw.includes('503') || raw.includes('Service Unavailable')
        ? 'No solver online — intent submitted but may expire unfilled. Check Active Intents to claim a refund if needed.'
        : raw.includes('nonce') || raw.includes('Stale') || raw.includes('400')
        ? 'Session expired — start a new chat.'
        : raw.includes('fetch') || raw.includes('refused') || raw.includes('network') || raw.includes('Failed to fetch') || raw.includes('unreachable')
        ? 'Backend unreachable — intent NOT submitted. Check if backend is running.'
        : raw.includes('User rejected') || raw.includes('denied')
        ? 'Signature cancelled.'
        : raw;
      setGaslessStatus(errorMsg);
      setIsGaslessFailed(true);
      setTimeout(() => {
        setIsGaslessFailed(false);
        setGaslessStatus(null);
      }, 5000);
    }
  }, [pendingGaslessIntent, address, signIntent, setPendingGaslessIntent, addMessage, fillPrice, winnerSolver]);

  const handleRetry = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      sendMessage(lastUserMsg.content);
    }
  }, [messages, sendMessage]);

  return (
    <div className="flex-1 flex flex-row bg-[#070a09] overflow-hidden relative">
      <ChatSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        disabled={isLoading}
        onNewChat={handleNewChat}
        onSwitchSession={switchSession}
        onDeleteSession={deleteSession}
        onOpenSettings={() => setShowSettings(true)}
        onExport={exportSessions}
        onImport={importSessions}
        onClearAll={clearAllSessions}
      />

      <div className="flex-1 flex flex-col relative overflow-hidden">
        <IntentChat
          messages={messages}
          inputValue={inputValue}
          isLoading={isLoading}
          error={error}
          userAddress={address}
          submittedTxs={submittedTxs}
          onInputChange={setInputValue}
          onSend={handleSend}
          onRetry={handleRetry}
          onNewChat={handleNewChat}
          onOpenSettings={() => setShowSettings(true)}
          onWidgetConfirm={handleWidgetConfirm}
          pendingSignIntent={pendingGaslessIntent && !intentProgress ? pendingGaslessIntent : undefined}
          signIntentStatus={gaslessStatus}
          isSignIntentFailed={isGaslessFailed}
          isSignIntentSuccess={isGaslessSuccess}
          onSignIntentConfirm={handleSignGaslessIntent}
          onSignIntentDismiss={() => {
            setPendingGaslessIntent(undefined);
            setGaslessStatus(null);
            setIsGaslessFailed(false);
            setIsGaslessSuccess(false);
            setIntentProgress(null);
            trackedIntentIdRef.current = null;
          }}
        />

        {pendingTx && !isLoading && (
          <div className={`absolute bottom-32 left-0 right-0 z-30 transition-all ${isTxSent ? 'animate-magic-lamp pointer-events-none' : ''} ${isTxFailed ? 'animate-shake' : ''}`}>
            <TransactionReviewCard
              pendingTx={pendingTx}
              txStatus={txStatus}
              isFailed={isTxFailed}
              onConfirm={() => handleSendTx(pendingTx)}
              onDismiss={() => {
                setPendingTx(undefined);
                setTxStatus(null);
                setIsTxFailed(false);
              }}
            />
          </div>
        )}

        <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      </div>
    </div>
  );
}
