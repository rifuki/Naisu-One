import { createConfig, fallback, http } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

const BASE_SEPOLIA_RPC = import.meta.env.VITE_BASE_SEPOLIA_RPC_URL as string | undefined;

export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [injected()],
  transports: {
    [baseSepolia.id]: fallback([
      http(BASE_SEPOLIA_RPC || 'https://sepolia.base.org'),
      http('https://base-sepolia-rpc.publicnode.com'),
      http(),
    ]),
  },
});
