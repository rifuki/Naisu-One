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
import { useSignIntent } from '@/features/intent/hooks/use-sign-intent';
import type { TxData } from '@/hooks/useAgent';

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

  const { address } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient();
  
  // Gasless signing hook
  const signIntent = useSignIntent();

  // ── Global Agent State ────────────────────────────────────
  const { 
    sessions, activeSessionId, activeSession, createSession, switchSession, deleteSession,
    messages, isLoading, error, sendMessage, pendingTx, setPendingTx,
    pendingGaslessIntent, setPendingGaslessIntent
  } = useGlobalAgent();

  const currentMsgIdxRef = useRef(0);

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
    setInputValue('');
    setSubmittedTxs([]);
    setPendingTx(undefined);
    setPendingGaslessIntent(undefined);
    setGaslessStatus(null);
    setIsGaslessFailed(false);
    setIsGaslessSuccess(false);
    currentMsgIdxRef.current = 0;
    createSession();
  }, [createSession, setPendingTx, setPendingGaslessIntent]);

  /** Handle gasless intent signing */
  const handleSignGaslessIntent = useCallback(async () => {
    if (!pendingGaslessIntent) return;

    setGaslessStatus('Sign message in wallet...');

    try {
      const result = await signIntent.mutateAsync({
        recipientAddress: pendingGaslessIntent.recipientAddress,
        destinationChain: pendingGaslessIntent.destinationChain,
        amount: pendingGaslessIntent.amount,
        outputToken: pendingGaslessIntent.outputToken,
        startPrice: pendingGaslessIntent.startPrice,
        floorPrice: pendingGaslessIntent.floorPrice,
        durationSeconds: pendingGaslessIntent.durationSeconds,
        nonce: pendingGaslessIntent.nonce,
      });

      setGaslessStatus('Intent submitted!');
      setIsGaslessSuccess(true);
      
      setTimeout(() => {
        setPendingGaslessIntent(undefined);
        setGaslessStatus(null);
        setIsGaslessSuccess(false);
        window.dispatchEvent(new CustomEvent('optimistic-intent-created'));
        sendMessage(`[System] Intent signed and submitted. ID: ${result.submissionResult.intentId}\nPlease provide a polite, concise confirmation that the intent was submitted gaslessly (FREE!) and solvers are now bidding to fill it.`);
      }, 1200);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Signing failed';
      setGaslessStatus(errorMsg);
      setIsGaslessFailed(true);
      setTimeout(() => {
        setIsGaslessFailed(false);
        setGaslessStatus(null);
      }, 3000);
    }
  }, [pendingGaslessIntent, signIntent, setPendingGaslessIntent, sendMessage]);

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

        {/* Gasless Intent Review Card */}
        {pendingGaslessIntent && !isLoading && (
          <div className={`absolute bottom-32 left-0 right-0 z-30 transition-all ${isGaslessSuccess ? 'animate-magic-lamp pointer-events-none' : ''} ${isGaslessFailed ? 'animate-shake' : ''}`}>
            <GaslessIntentReviewCard
              intent={pendingGaslessIntent}
              status={gaslessStatus}
              isFailed={isGaslessFailed}
              isSuccess={isGaslessSuccess}
              onConfirm={handleSignGaslessIntent}
              onDismiss={() => {
                setPendingGaslessIntent(undefined);
                setGaslessStatus(null);
                setIsGaslessFailed(false);
                setIsGaslessSuccess(false);
              }}
            />
          </div>
        )}

        <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      </div>
    </div>
  );
}
