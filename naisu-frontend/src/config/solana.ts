import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";

export const SOLANA_ENDPOINT = "https://api.devnet.solana.com";

export const wallets = [new PhantomWalletAdapter()];
