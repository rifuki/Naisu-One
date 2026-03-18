import { useState, useRef, useCallback, useEffect } from 'react';
import { useAccount, useSendTransaction, usePublicClient } from 'wagmi';
import { parseEther } from 'viem';
import { useAgent } from '@/hooks/useAgent';
import { useChatSessions } from '@/hooks/useChatSessions';
import { useSolanaAddress } from '@/hooks/useSolanaAddress';
import { useLocation, useNavigate } from 'react-router-dom';
import { IntentChat } from '@/features/intent/components/intent-chat';
import { ChatSidebar } from '@/features/intent/components/chat-sidebar';
import { TransactionReviewCard, type PendingTx } from '@/features/intent/components/transaction-review-card';
import { SettingsModal } from '@/features/intent/components/settings-modal';
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

  const { address } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient();
  const solanaAddress = useSolanaAddress();

  // ── Session Management ────────────────────────────────────
  const { sessions, activeSessionId, activeSession, createSession, switchSession, updateActiveSession, deleteSession } =
    useChatSessions(address ?? 'guest');

  const currentMsgIdxRef = useRef(0);

  const { messages, isLoading, error, sendMessage, pendingTx, setPendingTx } = useAgent(
    address || 'anonymous',
    solanaAddress || '',
    {
      messages: activeSession?.messages ?? [],
      backendSessionId: activeSession?.backendSessionId,
      onMessagesChange: (msgs, backendSessionId) => {
        // Auto-generate title from first user message
        const title = msgs.find(m => m.role === 'user')?.content.slice(0, 40) ?? 'New Chat';
        updateActiveSession({ messages: msgs, backendSessionId, title });
      },
    }
  );

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
    currentMsgIdxRef.current = 0;
    createSession();
  }, [createSession, setPendingTx]);

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

        <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      </div>
    </div>
  );
}
