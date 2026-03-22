import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/config/wagmi";

export function EvmProvider({ children }: { children: React.ReactNode }) {
  return <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>;
}
