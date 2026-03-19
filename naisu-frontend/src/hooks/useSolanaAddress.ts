/**
 * useSolanaAddress — robust Solana public key detection with auto-connect.
 *
 * Priority:
 *   1. @solana/wallet-adapter-react (Phantom, etc.)
 *   2. window.backpack.publicKey  (Backpack extension)
 *   3. window.solana.publicKey    (any Solana-injected wallet)
 *   4. window.xnft?.solana        (xNFT / Backpack xNFT context)
 *
 * Features:
 *   - Auto-detect wallet injection (wallet mungkin terlambat inject)
 *   - Auto-connect dengan { onlyIfTrusted: true } saat wallet terdeteksi
 *   - Listen ke wallet events (accountChanged, connect) untuk real-time update
 *   - Bisa skip auto-connect dengan localStorage flag (misal abis manual disconnect)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

declare global {
  interface Window {
    backpack?: {
      publicKey?: { toBase58(): string } | null;
      isConnected?: boolean;
      connect?: (options?: { onlyIfTrusted: boolean }) => Promise<{ publicKey: { toBase58(): string } }>;
      disconnect?: () => Promise<void>;
      on?: (event: string, handler: (...args: any[]) => void) => void;
      off?: (event: string, handler: (...args: any[]) => void) => void;
    };
    solana?: {
      publicKey?: { toBase58(): string } | null;
      isConnected?: boolean;
      connect?: (options?: { onlyIfTrusted: boolean }) => Promise<{ publicKey: { toBase58(): string } }>;
      disconnect?: () => Promise<void>;
      on?: (event: string, handler: (...args: any[]) => void) => void;
      off?: (event: string, handler: (...args: any[]) => void) => void;
    };
    xnft?: {
      solana?: {
        publicKey?: { toBase58(): string } | null;
      };
    };
  }
}

const SKIP_AUTOCONNECT_KEY = 'naisu1_skip_solana_autoconnect';

function readWindowSolanaAddress(): string | undefined {
  try {
    // Backpack-specific
    const bp = window.backpack?.publicKey?.toBase58();
    if (bp) return bp;

    // Generic Solana injected provider (Phantom, Backpack, etc.)
    const sol = window.solana?.publicKey?.toBase58();
    if (sol) return sol;

    // xNFT context
    const xnft = window.xnft?.solana?.publicKey?.toBase58();
    if (xnft) return xnft;
  } catch {
    // ignore
  }
  return undefined;
}

// Helper untuk check localStorage
function shouldSkipAutoConnect(): boolean {
  try {
    return localStorage.getItem(SKIP_AUTOCONNECT_KEY) === 'true';
  } catch {
    return false;
  }
}

// Helper untuk set localStorage
export function setSkipSolanaAutoConnect(skip: boolean): void {
  try {
    if (skip) {
      localStorage.setItem(SKIP_AUTOCONNECT_KEY, 'true');
    } else {
      localStorage.removeItem(SKIP_AUTOCONNECT_KEY);
    }
  } catch {
    // ignore
  }
}

export function useSolanaAddress(): string | undefined {
  const { publicKey, connected } = useWallet();
  const [windowAddress, setWindowAddress] = useState<string | undefined>();
  const [isWalletAvailable, setIsWalletAvailable] = useState(false);
  const connectAttemptRef = useRef<Set<string>>(new Set());
  const eventHandlersRef = useRef<{ wallet: any; handler: () => void }[]>([]);

  // Adapter-based address (Phantom wallet-adapter)
  const adapterAddress = connected && publicKey ? publicKey.toBase58() : undefined;

  // Check wallet availability and attempt auto-connect
  const checkAndConnect = useCallback(() => {
    const hasBackpack = !!window.backpack;
    const hasSolana = !!window.solana;
    const hasXnft = !!window.xnft?.solana;
    const hasAnyWallet = hasBackpack || hasSolana || hasXnft;

    setIsWalletAvailable(hasAnyWallet);

    // Read current address
    const currentAddr = readWindowSolanaAddress();
    setWindowAddress(currentAddr);

    // Skip auto-connect jika user udah manual disconnect (dari localStorage)
    if (shouldSkipAutoConnect()) return;

    // Attempt auto-connect for each wallet type if not already attempted
    if (hasBackpack && window.backpack?.connect && !window.backpack?.publicKey) {
      if (!connectAttemptRef.current.has('backpack')) {
        connectAttemptRef.current.add('backpack');
        window.backpack.connect({ onlyIfTrusted: true }).catch(() => {
          // Silent fail - user hasn't trusted this site yet
        });
      }
    }

    if (hasSolana && window.solana?.connect && !window.solana?.publicKey) {
      if (!connectAttemptRef.current.has('solana')) {
        connectAttemptRef.current.add('solana');
        window.solana.connect({ onlyIfTrusted: true }).catch(() => {
          // Silent fail - user hasn't trusted this site yet
        });
      }
    }
  }, []);

  // Initial check + polling
  useEffect(() => {
    // Immediate check
    checkAndConnect();

    // Poll every 300ms for faster detection (wallet bisa terlambat inject)
    const interval = setInterval(() => {
      checkAndConnect();
    }, 300);

    return () => clearInterval(interval);
  }, [checkAndConnect]);

  // Listen to wallet events for real-time updates
  useEffect(() => {
    const handlers: { wallet: any; handler: () => void }[] = [];

    const handleAccountChange = () => {
      const newAddr = readWindowSolanaAddress();
      setWindowAddress(newAddr);
    };

    // Subscribe to wallet events
    if (window.solana?.on) {
      window.solana.on('connect', handleAccountChange);
      window.solana.on('accountChanged', handleAccountChange);
      window.solana.on('disconnect', handleAccountChange);
      handlers.push({ wallet: window.solana, handler: handleAccountChange });
    }

    if (window.backpack?.on) {
      window.backpack.on('connect', handleAccountChange);
      window.backpack.on('accountChanged', handleAccountChange);
      window.backpack.on('disconnect', handleAccountChange);
      handlers.push({ wallet: window.backpack, handler: handleAccountChange });
    }

    eventHandlersRef.current = handlers;

    return () => {
      // Cleanup event listeners
      if (window.solana?.off) {
        window.solana.off('connect', handleAccountChange);
        window.solana.off('accountChanged', handleAccountChange);
        window.solana.off('disconnect', handleAccountChange);
      }
      if (window.backpack?.off) {
        window.backpack.off('connect', handleAccountChange);
        window.backpack.off('accountChanged', handleAccountChange);
        window.backpack.off('disconnect', handleAccountChange);
      }
    };
  }, []);

  // Re-check saat window focus (user mungkin switch tab dan connect wallet)
  useEffect(() => {
    const handleFocus = () => {
      checkAndConnect();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [checkAndConnect]);

  // Prefer adapter (wallet-adapter), fall back to window-based detection
  return adapterAddress || windowAddress || undefined;
}
