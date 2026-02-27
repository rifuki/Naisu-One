import { createConfig, http } from "wagmi";
import { baseSepolia, avalancheFuji } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const wagmiConfig = createConfig({
  chains: [baseSepolia, avalancheFuji],
  connectors: [injected()],
  transports: {
    [baseSepolia.id]: http(),
    [avalancheFuji.id]: http(),
  },
});
