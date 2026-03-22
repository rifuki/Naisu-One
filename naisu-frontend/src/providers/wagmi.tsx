import { createConfig, fallback, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { WagmiProvider } from "wagmi";
import { BASE_SEPOLIA_RPC_URL } from "@/lib/env";

const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [injected()],
  transports: {
    [baseSepolia.id]: fallback([
      http(BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"),
      http("https://base-sepolia-rpc.publicnode.com"),
      http(),
    ]),
  },
});

export function EvmProvider({ children }: { children: React.ReactNode }) {
  return <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>;
}
