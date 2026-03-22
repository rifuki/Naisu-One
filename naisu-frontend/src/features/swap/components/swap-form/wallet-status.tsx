import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Button } from '@/components/ui/button';

interface WalletStatusProps {
  evmAddress?: string | null;
  evmConnected: boolean;
  solanaAddress?: string | null;
  onConnectEvm: () => void;
  isConnectingEvm?: boolean;
}

export function WalletStatus({
  evmAddress,
  evmConnected,
  solanaAddress,
  onConnectEvm,
  isConnectingEvm,
}: WalletStatusProps) {
  const { disconnect: disconnectEvm } = useDisconnect();

  return (
    <div className="mt-3 space-y-1.5 px-1">
      {/* EVM wallet */}
      {evmConnected ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
          <span>
            EVM: {evmAddress?.slice(0, 8)}…{evmAddress?.slice(-6)}
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            <span>EVM wallet not connected</span>
          </div>
          <Button
            type="button"
            onClick={onConnectEvm}
            disabled={isConnectingEvm}
            className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            {isConnectingEvm ? 'Connecting...' : 'Connect'}
          </Button>
        </div>
      )}

      {/* Solana wallet */}
      {solanaAddress ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
          <span>
            Solana: {solanaAddress.slice(0, 8)}…{solanaAddress.slice(-6)}
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            <span>Solana wallet not connected</span>
          </div>
          <div className="wallet-adapter-button-override">
            <WalletMultiButton />
          </div>
        </div>
      )}
    </div>
  );
}
