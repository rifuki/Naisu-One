import { useState, useRef, useCallback } from 'react';
import { useAccount, useSendTransaction } from 'wagmi';
import { parseEther } from 'viem';
import { useAgent, type AgentMessage as ChatMessage, type TxData } from '../../hooks/useAgent';
import { useSolanaAddress } from '../../hooks/useSolanaAddress';
import { IntentZeroState } from '@/features/intent/components/intent-zero-state';
import { IntentChat } from '@/features/intent/components/intent-chat';
import { TransactionReviewCard, type PendingTx } from '@/features/intent/components/transaction-review-card';
import { SettingsModal } from '@/features/intent/components/settings-modal';

export default function IntentPage() {
  const [inputValue, setInputValue] = useState('');
  const [hasInteracted, setHasInteracted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [pendingTx, setPendingTx] = useState<PendingTx | undefined>(undefined);
  const [submittedTxs, setSubmittedTxs] = useState<Array<{ hash: string; chainId: number; msgIdx: number }>>([]);

  const { address } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const solanaAddress = useSolanaAddress();

  const { messages, isLoading, error, sendMessage } = useAgent({
    userId: address || 'anonymous',
    solanaAddress: solanaAddress || '',
  });

  const currentMsgIdxRef = useRef(0);

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;

    const text = inputValue.trim();
    setInputValue('');

    if (!hasInteracted) {
      setHasInteracted(true);
    }

    currentMsgIdxRef.current = messages.length + 1;

    try {
      const result = await sendMessage(text);

      if (result?.tx) {
        const tx: TxData = result.tx;
        setPendingTx({
          to: tx.to,
          data: tx.data,
          value: tx.value,
          chainId: tx.chainId,
          decoded: tx.decoded,
        });
      }
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
            { hash, chainId: tx.chainId, msgIdx: currentMsgIdxRef.current },
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
      setInputValue(input);
      handleSend();
    },
    [handleSend]
  );

  // Zero state
  if (!hasInteracted) {
    return <IntentZeroState onSubmit={handleZeroStateSubmit} />;
  }

  // Active chat state
  return (
    <div className="h-screen flex flex-col bg-[#070a09]">
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
  );
}
