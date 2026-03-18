import { useState, useRef, useCallback } from 'react';
import { useAccount, useSendTransaction } from 'wagmi';
import { parseEther } from 'viem';
import { useAgent, type AgentMessage as ChatMessage, type TxData } from '@/hooks/useAgent';
import { useSolanaAddress } from '@/hooks/useSolanaAddress';
import { IntentZeroState } from '@/features/intent/components/intent-zero-state';
import { IntentChat } from '@/features/intent/components/intent-chat';
import { ChatSidebar } from '@/features/intent/components/chat-sidebar';
import { TransactionReviewCard, type PendingTx } from '@/features/intent/components/transaction-review-card';
import { SettingsModal } from '@/features/intent/components/settings-modal';

export default function IntentPage() {
  const [inputValue, setInputValue] = useState('');
  const [hasInteracted, setHasInteracted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [submittedTxs, setSubmittedTxs] = useState<Array<{ hash: string; chainId: number; msgIdx: number; submittedAt: number }>>([]);

  const { address } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const solanaAddress = useSolanaAddress();

  const { messages, isLoading, error, sendMessage, pendingTx, setPendingTx } = useAgent(
    address || 'anonymous',
    solanaAddress || ''
  );

  const currentMsgIdxRef = useRef(0);

  const handleSend = useCallback(async (overrideText?: string | React.MouseEvent | React.FormEvent) => {
    const text = (typeof overrideText === 'string' ? overrideText : inputValue).trim();
    if (!text || isLoading) return;

    setInputValue('');

    if (!hasInteracted) {
      setHasInteracted(true);
    }

    currentMsgIdxRef.current = messages.length + 1;

    try {
      await sendMessage(text);
    } catch {
      // Error handled by useAgent
    }
  }, [inputValue, isLoading, hasInteracted, messages.length, sendMessage]);

  const handleSendTx = useCallback(
    async (tx: PendingTx) => {
      if (!address || !sendTransactionAsync) return;

      setTxStatus('Signing...');

      try {
        const hash = await sendTransactionAsync({
          to: tx.to as `0x${string}`,
          data: tx.data as `0x${string}`,
          value: parseEther(tx.value),
          chainId: tx.chainId,
        });

        setPendingTx(undefined);
        setTxStatus(null);

        if (hash) {
          setSubmittedTxs((prev) => [
            ...prev,
            { hash, chainId: tx.chainId, msgIdx: currentMsgIdxRef.current, submittedAt: Date.now() },
          ]);
        }
      } catch (err) {
        setTxStatus(null);
      }
    },
    [address, sendTransactionAsync]
  );

  const handleNewChat = useCallback(() => {
    window.location.reload();
  }, []);

  const handleRetry = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      sendMessage(lastUserMsg.content);
    }
  }, [messages, sendMessage]);

  const handleZeroStateSubmit = useCallback(
    (input: string) => {
      handleSend(input);
    },
    [handleSend]
  );

  // Zero state
  if (!hasInteracted) {
    return <IntentZeroState onSubmit={handleZeroStateSubmit} />;
  }

  // Active chat state
  return (
    <div className="flex-1 flex flex-row bg-[#070a09] overflow-hidden relative">
      <ChatSidebar onNewChat={handleNewChat} onOpenSettings={() => setShowSettings(true)} />
      
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
          <div className="absolute bottom-32 left-0 right-0 z-30">
            <TransactionReviewCard
              pendingTx={pendingTx}
              txStatus={txStatus}
              onConfirm={() => handleSendTx(pendingTx)}
              onDismiss={() => setPendingTx(undefined)}
            />
          </div>
        )}

        <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      </div>
    </div>
  );
}
