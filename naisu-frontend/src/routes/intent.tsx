import { useState, useRef, useCallback, useEffect } from 'react';
import { createFileRoute, useLocation, useNavigate, useSearch, useRouterState } from "@tanstack/react-router";
import { useAccount, useSendTransaction, usePublicClient } from 'wagmi';
import { parseEther } from 'viem';
import { useGlobalAgent } from '@/providers/agent';
import { IntentChat } from '@/features/intent/components/intent-chat';
import { ChatSidebar } from '@/features/intent/components/chat-sidebar';
import { TransactionReviewCard, type PendingTx } from '@/features/intent/components/transaction-review-card';
import { GaslessIntentReviewCard } from '@/features/intent/components/gasless-intent-review-card';
import { PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSignIntent, type SignIntentParams } from '@/features/intent/hooks/use-sign-intent';
import { useOrderWatch, type OrderFulfilledEvent } from '@/hooks/use-order-watch';
import { useIntentStore, useChatStore, type ProgressStep } from '@/store';
import { BACKEND_URL } from '@/lib/env';

export const Route = createFileRoute("/intent")({
  validateSearch: (search: Record<string, unknown>) => ({
    chat: search.chat as string | undefined,
  }),
  component: IntentPage,
});

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

function IntentPage() {
  const [inputValue, setInputValue] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const navType = useRouterState({ select: (s) => s.historyAction });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const initialIntentRef = useRef((location.state as { initialIntent?: string })?.initialIntent);
  const initialSentRef = useRef(false);
  const searchParams = useSearch({ from: "/intent" });
  const isNavigatingRef = useRef(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isTxSent, setIsTxSent] = useState(false);
  const [isTxFailed, setIsTxFailed] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [submittedTxs, setSubmittedTxs] = useState<Array<{ hash: string; chainId: number; msgIdx: number; submittedAt: number }>>([]);

  // Gasless intent states
  const [gaslessStatus, setGaslessStatus] = useState<string | null>(null);
  const [isGaslessFailed, setIsGaslessFailed] = useState(false);
  const [isGaslessSuccess, setIsGaslessSuccess] = useState(false);

  // Zustand store for active intent
  const activeIntent = useIntentStore((state) => state.activeIntent);
  const setActiveIntent = useIntentStore((state) => state.setActiveIntent);
  const updateProgress = useIntentStore((state) => state.updateProgress);
  const updateIntentId = useIntentStore((state) => state.updateIntentId);
  const markFulfilled = useIntentStore((state) => state.markFulfilled);
  const setSourceTxHash = useIntentStore((state) => state.setSourceTxHash);
  const setDestinationTxHash = useIntentStore((state) => state.setDestinationTxHash);
  const setSettledTxHash = useIntentStore((state) => state.setSettledTxHash);
  const clearActiveIntent = useIntentStore((state) => state.clearActiveIntent);

  // Local refs for tracking (not state)
  const trackedIntentIdRef = useRef<string | null>(null);
  const previousIntentIdRef = useRef<string | null>(null);

  // Local state for UI feedback
  const [signedIntentSnapshot, setSignedIntentSnapshot] = useState<SignIntentParams | undefined>(undefined);
  const signedIntentSnapshotRef = useRef<SignIntentParams | undefined>(undefined);
  signedIntentSnapshotRef.current = signedIntentSnapshot;
  const [signedAt, setSignedAt] = useState<number | undefined>();

  // Derive from store
  const intentProgress = activeIntent?.progress || null;
  const intentFulfilled = activeIntent?.isFulfilled || false;
  const fillPrice = activeIntent?.fillPrice;
  const winnerSolver = activeIntent?.winnerSolver;
  const fulfilledAt = activeIntent?.fulfilledAt;

  // Contextual suggestion chips — generated from app state, not parsed from chat
  const contextSuggestions = intentFulfilled
    ? [
        'Bridge more ETH to Solana',
        fillPrice ? `Stake ${fillPrice} SOL for yield` : 'Stake my SOL for yield',
        'Check my balance',
      ]
    : undefined;

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

  // Load persisted fulfilled state when session changes (legacy migration)
  useEffect(() => {
    if (!activeSessionId) return;
    try {
      const saved = localStorage.getItem(FULFILLED_STATE_KEY(activeSessionId));
      if (saved) {
        const state: FulfilledState = JSON.parse(saved);
        // Migrate to Zustand store
        if (state.intentProgress) {
          setActiveIntent({
            intentId: 'migrated',
            progress: state.intentProgress,
            isFulfilled: state.intentFulfilled,
            fillPrice: state.fillPrice,
            winnerSolver: state.winnerSolver,
            signedAt: state.signedAt,
            fulfilledAt: state.fulfilledAt,
          });
        }
        setSignedIntentSnapshot(state.signedIntentSnapshot);
        setSignedAt(state.signedAt);
        // Clean up old format
        localStorage.removeItem(FULFILLED_STATE_KEY(activeSessionId));
      }
      // Do NOT clear activeIntent here. Zustand persist keeps intent state
      // across same-session page refreshes. Session-switch clearing is handled
      // explicitly in handleSwitchSession.
    } catch {
      // Ignore parse errors
    }
  }, [activeSessionId, setActiveIntent]);

  /** Switch to an existing session — clears active intent so the new session starts fresh */
  const handleSwitchSession = useCallback((id: string | null) => {
    isNavigatingRef.current = true;
    clearActiveIntent();
    setSignedIntentSnapshot(undefined);
    setSignedAt(undefined);
    switchSession(id);

    // Immediately sync the router synchronously to prevent race conditions in useEffect
    if (id) {
      navigate({ to: "/intent", search: { chat: id }, replace: true });
    } else {
      navigate({ to: "/intent", search: {}, replace: true });
    }
  }, [clearActiveIntent, switchSession, navigate]);

  const prevActiveSessionIdRef = useRef(activeSessionId);

  // Sync activeSessionId with URL search params
  useEffect(() => {
    const chatParam = searchParams.chat;
    // Normalize: treat missing param (undefined) and null session the same
    const chatParamNorm = chatParam ?? null;

    // If they match, clear the programmatic navigation lock
    if (chatParamNorm === activeSessionId) {
      isNavigatingRef.current = false;
      prevActiveSessionIdRef.current = activeSessionId;
      return;
    }

    // Ignore transient mismatch caused by our own React state changes prior to Router updates
    if (isNavigatingRef.current) {
      return;
    }

    // Only act if URL and local state mismatch
    if (chatParamNorm !== activeSessionId) {
      if (chatParam && sessions.some(s => s.id === chatParam)) {
        // URL says chat X, state says chat Y -> User navigated via Browser Back/Forward or direct link
        handleSwitchSession(chatParam);
      } else if (activeSessionId && !chatParam) {
        // State has an active session, but URL is empty.
        if (prevActiveSessionIdRef.current === null) {
          // We just implicitly created a session from a Virtual New Chat (null -> s_abc). Sync to URL!
          isNavigatingRef.current = true;
          navigate({ to: "/intent", search: { chat: activeSessionId! }, replace: true });
        } else {
          // The URL param vanished, but state hasn't changed.
          if (navType === 'POP') {
            // User pressed Browser Back to a Virtual New Chat `/intent`
            handleSwitchSession(null);
          } else if (pathname === '/intent') {
            // Only re-sync to active session if still on /intent (not navigating away to another route)
            isNavigatingRef.current = true;
            navigate({ to: "/intent", search: { chat: activeSessionId! }, replace: true });
          }
        }
      }
    }
    prevActiveSessionIdRef.current = activeSessionId;
  }, [activeSessionId, searchParams, sessions, handleSwitchSession, navigate, navType, pathname]);

  const currentMsgIdxRef = useRef(0);

  // SSE progress tracking for the active gasless intent
  useOrderWatch({
    user:    address,
    enabled: !!address,
    onOrderFulfilled: useCallback((data: OrderFulfilledEvent) => {
      const currentId = trackedIntentIdRef.current;
      const previousId = previousIntentIdRef.current;
      const matches = data.orderId === currentId || (previousId && data.orderId === previousId);
      console.log('[intent-page] onOrderFulfilled received:', { data, currentId, previousId, matches });
      if (!matches) {
        console.log('[intent-page] order_fulfilled mismatch, skipping');
        return;
      }
      if (intentFulfilled) {
        console.log('[intent-page] Already fulfilled, skipping');
        return;
      }
      // Set winner solver in Zustand store
      if (data.data?.solverName || data.data?.quotedPrice || data.data?.fillTimeMs) {
        useIntentStore.setState((state) => ({
          activeIntent: state.activeIntent ? {
            ...state.activeIntent,
            winnerSolver: data.data!.solverName || state.activeIntent.winnerSolver,
            fillPrice: data.data!.quotedPrice || state.activeIntent.fillPrice,
            fulfilledAt: data.data!.fillTimeMs && state.activeIntent.signedAt
                         ? state.activeIntent.signedAt + data.data!.fillTimeMs
                         : state.activeIntent.fulfilledAt || Date.now()
          } : null
        }));
      }
      // Trigger fulfillment via order_update handler which will set intentFulfilled=true
    }, [intentFulfilled]),
    onOrderUpdate: useCallback((event) => {
      const currentId = trackedIntentIdRef.current;
      const previousId = previousIntentIdRef.current;
      const matches = event.orderId === currentId || (previousId && event.orderId === previousId);
      console.log('[intent-page] onOrderUpdate received:', {
        eventOrderId: event.orderId,
        currentId,
        previousId,
        matches,
        status: event.status,
      });
      if (!matches) {
        console.log('[intent-page] orderId mismatch, skipping. Expected:', currentId, 'or', previousId, 'Got:', event.orderId);
        return;
      }
      if (event.status === 'FULFILLED') {
        // Guard against duplicate processing
        if (intentFulfilled) {
          console.log('[intent-page] Order already fulfilled, skipping duplicate event');
          return;
        }
        console.log('[intent-page] Order FULFILLED, updating UI');
        // Clear persisted signed intent — it has been fulfilled on-chain
        try { localStorage.removeItem(PENDING_INTENT_KEY); } catch { /* ignore */ }

        // Update intent count for stats
        if (activeSessionId) {
          updateIntentCount(activeSessionId, true);
        }
        // Mark all steps done and set fulfilled flag — card stays permanently as receipt
        // Mark as fulfilled in Zustand store — read fresh values from store (not stale closure)
        const { fillPrice: fp, winnerSolver: ws } = useIntentStore.getState().activeIntent ?? {};
        markFulfilled(fp, ws);
        // Do NOT clear trackedIntentIdRef here — late-arriving events (e.g. 'settled' with txHash)
        // must still match. Refs are cleared when the user starts a new intent.
        setPendingGaslessIntent(undefined);
        setGaslessStatus(null);
        window.dispatchEvent(new CustomEvent('optimistic-intent-created'));
        const recipientAddr = signedIntentSnapshotRef.current?.recipientAddress ?? '';
        const { fillPrice: fp2, winnerSolver: ws2 } = useIntentStore.getState().activeIntent ?? {};
        sendMessage(`[System] ✅ Intent fulfilled! ID: ${event.orderId}\nRecipient address: ${recipientAddr}${fp2 ? `\nReceived: ${fp2} SOL` : ''}${ws2 ? `\nSolver: ${ws2}` : ''}\nThe bridge has completed successfully. Always show wallet addresses in full — never truncate them.`);
      } else if (event.status === 'EXPIRED') {
        if (intentFulfilled) return;
        console.log('[intent-page] Order EXPIRED, updating UI');
        try { localStorage.removeItem(PENDING_INTENT_KEY); } catch { /* ignore */ }

        const currentProgress = useIntentStore.getState().activeIntent?.progress;
        if (currentProgress) {
          updateProgress(currentProgress.map(s => {
            if (s.active) {
              return { ...s, error: true, active: false, detail: 'Auction expired without receiving an acceptable quote' };
            }
            return s;
          }));
        }
        setPendingGaslessIntent(undefined);
        setGaslessStatus(null);
        sendMessage(`[System] ❌ Intent expired! No solver accepted the Dutch Auction before the deadline.`);
      }
    }, [intentFulfilled, setPendingGaslessIntent, sendMessage]),
    onGaslessResolved: useCallback((intentId: string, contractOrderId: string) => {
      const trackedLower = trackedIntentIdRef.current?.toLowerCase();
      const intentIdLower = intentId.toLowerCase();
      const contractOrderIdLower = contractOrderId.toLowerCase();
      console.log('[intent-page] gasless_resolved:', { intentId, contractOrderId, currentTracked: trackedIntentIdRef.current });
      if (trackedLower === intentIdLower) {
        console.log('[intent-page] Updating trackedId from', intentId, 'to', contractOrderId);
        previousIntentIdRef.current = intentId; // Store old ID
        trackedIntentIdRef.current = contractOrderId;
        updateIntentId(contractOrderId);
      } else if (trackedLower === contractOrderIdLower) {
        console.log('[intent-page] trackedId already set to contractOrderId');
      } else {
        console.log('[intent-page] gasless_resolved ignored - intentId mismatch. Expected:', trackedIntentIdRef.current, 'Got:', intentId);
      }
    }, [updateIntentId]),
    onProgress: useCallback((evt) => {
      const currentId = trackedIntentIdRef.current;
      const previousId = previousIntentIdRef.current;
      const matchesCurrent = evt.orderId === currentId;
      const matchesPrevious = previousId && evt.orderId === previousId;
      console.log('[intent-page] onProgress received:', {
        type: evt.type,
        orderId: evt.orderId,
        currentId,
        previousId,
        matchesCurrent,
        matchesPrevious
      });
      // Accept events matching current OR previous ID (during gasless transition)
      if (!matchesCurrent && !matchesPrevious) {
        console.log('[intent-page] onProgress skipped - orderId mismatch');
        return;
      }

      // Get fresh progress from store
      const currentProgress = useIntentStore.getState().activeIntent?.progress;
      if (!currentProgress) {
        console.log('[intent-page] onProgress skipped - no active intent');
        return;
      }

      if (evt.type === 'rfq_broadcast') {
        const count = (evt.data['solverCount'] as number | undefined) ?? 0;
        updateProgress(currentProgress.map(s =>
          s.key === 'rfq'
            ? {
                ...s,
                label: count > 0 ? `Broadcasting RFQ to ${count} solver${count !== 1 ? 's' : ''}` : 'Waiting for solvers...',
                detail: count > 0 ? `Requesting quotes from ${count} solver${count !== 1 ? 's' : ''}…` : 'No solvers online. Retrying...',
                active: true
              }
            : s
        ));
      } else if (evt.type === 'rfq_winner') {
        const winner   = evt.data['winner']       as string | undefined;
        const priceRaw = evt.data['quotedPrice']  as string | undefined;
        const eta      = evt.data['estimatedETA'] as number | undefined;
        const priceSol = priceRaw
          ? (Number(BigInt(priceRaw)) / 1e9).toFixed(4)
          : undefined;
        const winnerDetail = priceSol
          ? `${priceSol} SOL${eta ? ` · ~${eta}s` : ''}`
          : eta ? `~${eta}s ETA` : undefined;

        // Update Zustand store with winner info and progress
        const currentIntent = useIntentStore.getState().activeIntent;
        if (currentIntent && (winner || priceSol)) {
          useIntentStore.setState({
            activeIntent: {
              ...currentIntent,
              winnerSolver: winner || currentIntent.winnerSolver,
              fillPrice: priceSol || currentIntent.fillPrice,
            }
          });
        }

        // rfq done; winner ACTIVE — solver selected, waiting for execute signal
        updateProgress(currentProgress.map(s => {
          if (s.key === 'rfq')    return { ...s, done: true, active: false };
          if (s.key === 'winner') return { ...s, active: true, label: winner ? `Solver: ${winner}` : 'Solver selected', detail: winnerDetail };
          return s;
        }));
      } else if (evt.type === 'execute_sent') {
        // Capture EVM source tx hash (solver's executeIntent() call on Base Sepolia)
        const sourceTx = evt.data['txHash'] as string | null | undefined;
        if (sourceTx) setSourceTxHash(sourceTx);
        // winner DONE, evm_submitted ACTIVE + txHash
        updateProgress(currentProgress.map(s => {
          if (s.key === 'rfq' || s.key === 'winner') return { ...s, done: true, active: false };
          if (s.key === 'evm_submitted') return { ...s, active: true, txHash: sourceTx ?? undefined };
          return s;
        }));
      } else if (evt.type === 'sol_sent') {
        // Capture Solana destination tx hash
        const destTx = evt.data['txHash'] as string | null | undefined;
        if (destTx) setDestinationTxHash(destTx);
        // evm_submitted DONE, sol_sent ACTIVE + txHash — waiting for Wormhole VAA
        updateProgress(currentProgress.map(s => {
          if (s.key === 'signed' || s.key === 'rfq' || s.key === 'winner') return { ...s, done: true, active: false };
          if (s.key === 'evm_submitted') return { ...s, done: true, active: false, detail: 'Submitted on-chain' };
          if (s.key === 'sol_sent') return { ...s, active: true, txHash: destTx ?? undefined };
          return s;
        }));
      } else if (evt.type === 'vaa_ready') {
        // sol_sent DONE, vaa_ready DONE, settled ACTIVE — waiting for EVM settle tx
        // Attach the Solana tx hash to vaa_ready so the UI can link to Wormholescan
        const solTx = currentProgress.find(s => s.key === 'sol_sent')?.txHash
          ?? useIntentStore.getState().activeIntent?.destinationTxHash;
        updateProgress(currentProgress.map(s => {
          if (s.key === 'signed' || s.key === 'rfq' || s.key === 'winner') return { ...s, done: true, active: false };
          if (s.key === 'evm_submitted') return { ...s, done: true, active: false, detail: 'Submitted on-chain' };
          if (s.key === 'sol_sent') return { ...s, done: true, active: false, detail: 'Transfer complete' };
          if (s.key === 'vaa_ready') return { ...s, done: true, active: false, detail: 'VAA verified', txHash: solTx ?? undefined };
          if (s.key === 'settled') return { ...s, active: true };
          return s;
        }));
      } else if (evt.type === 'settled') {
        const settleTx = evt.data['txHash'] as string | null | undefined;
        if (settleTx) setSettledTxHash(settleTx);
        updateProgress(currentProgress.map(s => {
          if (s.key === 'settled') return { ...s, done: true, active: false, txHash: settleTx ?? undefined, detail: undefined };
          return s;
        }));
      }
    }, [setSourceTxHash, setDestinationTxHash, setSettledTxHash]),
  });

  const handleSend = useCallback(async (overrideText?: string | React.MouseEvent | React.FormEvent) => {
    // Ignore React event objects passed as overrideText (e.g. form submit)
    const raw = typeof overrideText === 'string' ? overrideText : inputValue;
    const text = raw.trim();
    if (!text || isLoading) return;

    setInputValue('');
    currentMsgIdxRef.current = messages.length + 1;

    try {
      await sendMessage(text);
    } catch {
      // Error handled by useAgent
    }
  }, [inputValue, isLoading, messages.length, sendMessage]);

  // Auto-send initial intent from Landing Page — always start a fresh session
  useEffect(() => {
    if (initialIntentRef.current && !initialSentRef.current) {
      initialSentRef.current = true;
      // Switch to a new empty session first, then send after wallets settle
      handleSwitchSession(null);
      const text = initialIntentRef.current;
      setTimeout(() => {
        handleSend(text);
      }, 600);
    }
  }, [handleSend, handleSwitchSession]);

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

  /** New Chat: show empty chat state. Session is only created when the user sends the first message.
   *  If already on an empty session (ChatGPT-style), just reset UI state without creating another session. */
  const handleNewChat = useCallback(() => {
    const hasMessages = messages.length > 0;
    const hasFulfillmentState = intentFulfilled || signedIntentSnapshot;
    const isEffectivelyEmpty = !hasMessages && !hasFulfillmentState;

    // Always reset UI state
    setInputValue('');
    setSubmittedTxs([]);
    setPendingTx(undefined);
    setPendingGaslessIntent(undefined);
    setGaslessStatus(null);
    setIsGaslessFailed(false);
    setIsGaslessSuccess(false);
    clearActiveIntent();
    setSignedIntentSnapshot(undefined);
    setSignedAt(undefined);
    trackedIntentIdRef.current = null;
    previousIntentIdRef.current = null;
    currentMsgIdxRef.current = 0;
    try { localStorage.removeItem(PENDING_INTENT_KEY); } catch { /* ignore */ }

    // Clean state for fresh start
    handleSwitchSession(null);
  }, [handleSwitchSession, setPendingTx, setPendingGaslessIntent, clearActiveIntent]);

  /** Handle widget confirm — agent sent a quote_review widget, user confirmed selections */
  const handleDutchPlanConfirm = useCallback((intentData: {
    type: 'gasless_intent';
    recipientAddress: string;
    destinationChain: string;
    amount: string;
    outputToken: string;
    startPrice: string;
    floorPrice: string;
    durationSeconds: number;
    nonce: number;
  }) => {
    // Set pending gasless intent with user-selected plan
    setPendingGaslessIntent({
      recipientAddress: intentData.recipientAddress,
      destinationChain: intentData.destinationChain as 'solana' | 'sui',
      amount: intentData.amount,
      outputToken: intentData.outputToken as 'sol' | 'msol' | 'marginfi',
      startPrice: intentData.startPrice,
      floorPrice: intentData.floorPrice,
      durationSeconds: intentData.durationSeconds,
      nonce: intentData.nonce,
    });
  }, [setPendingGaslessIntent]);

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

      // Set active intent in Zustand store with detailed progress steps
      const initialProgress = [
        { key: 'signed',        label: 'Signed & submitted',  detail: 'Intent broadcast to network',      done: true,  active: false },
        { key: 'rfq',           label: 'Broadcasting RFQ',    detail: 'Requesting quotes from solvers…',  done: false, active: true  },
        { key: 'winner',        label: 'Selecting solver',    detail: 'Evaluating solver quotes…',        done: false, active: false },
        { key: 'evm_submitted', label: 'EVM submitted',       detail: 'Solver calling executeIntent()…',  done: false, active: false },
        { key: 'sol_sent',      label: 'Sending to Solana',   detail: 'SOL transfer in progress…',        done: false, active: false },
        { key: 'vaa_ready',     label: 'Cross-chain proof',   detail: 'Fetching Wormhole VAA…',           done: false, active: false },
        { key: 'settled',       label: 'Bridge settled',      done: false, active: false },
      ];
      setActiveIntent({
        intentId: result.submissionResult.intentId,
        sessionId: activeSessionId ?? undefined,
        progress: initialProgress,
        isFulfilled: false,
        signedAt: Date.now(),
      });

      // Add receipt message to chat history
      const receiptContent = `[INTENT_RECEIPT]${JSON.stringify({
        intentId: result.submissionResult.intentId,
        intent: pendingGaslessIntent,
        progress: [
          { key: 'signed',        label: 'Signed & submitted', detail: 'Intent broadcast to network',     done: true,  active: false },
          { key: 'rfq',           label: 'Broadcasting RFQ',   detail: 'Requesting quotes from solvers…', done: false, active: true  },
          { key: 'winner',        label: 'Selecting winner',   detail: 'Evaluating solver quotes…',       done: false, active: false },
          { key: 'evm_submitted', label: 'EVM submitted',      detail: 'Solver calling executeIntent()…', done: false, active: false },
          { key: 'sol_sent',      label: 'Sending to Solana',  detail: 'SOL transfer in progress…',       done: false, active: false },
          { key: 'vaa_ready',     label: 'Cross-chain proof',  detail: 'Fetching Wormhole VAA…',          done: false, active: false },
          { key: 'settled',       label: 'Bridge settled',     detail: 'Waiting for confirmation…',       done: false, active: false },
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
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        onNewChat={handleNewChat}
        onSwitchSession={handleSwitchSession}
        onDeleteSession={deleteSession}
        onExport={exportSessions}
        onImport={importSessions}
        onClearAll={clearAllSessions}
      />

      <div className="flex-1 flex flex-col relative overflow-hidden">
        {!isSidebarOpen && (
          <Button
            onClick={() => setIsSidebarOpen(true)}
            className="absolute top-4 left-4 z-40 p-2.5 bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 text-slate-300 hover:text-white transition-all shadow-xl backdrop-blur-xl group"
            title="Open Sidebar"
          >
            <PanelLeftOpen strokeWidth={2} className="w-[18px] h-[18px] group-hover:scale-105 transition-transform" />
          </Button>
        )}
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
          onDutchPlanConfirm={handleDutchPlanConfirm}
          contextSuggestions={contextSuggestions}
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
            clearActiveIntent();
            trackedIntentIdRef.current = null;
            previousIntentIdRef.current = null;
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

      </div>
    </div>
  );
}
