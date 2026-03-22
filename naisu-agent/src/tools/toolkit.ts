import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { MemoryProvider } from "../memory/provider.js";
import type { SessionProvider } from "../session/provider.js";
import type { ToolRegistry } from "./tool-registry.js";
import { httpJson } from "../utils/http.js";
import { env } from "../config/env.js";

// ─── API base URLs ───────────────────────────────────────────────────────────
const INTENT_API    = `${env.NAISU_BACKEND_URL}/api/v1/intent`;
const SOLANA_API    = `${env.NAISU_BACKEND_URL}/api/v1/solana`;
const PORTFOLIO_API = `${env.NAISU_BACKEND_URL}/api/v1/portfolio`;
const YIELD_API     = `${env.NAISU_BACKEND_URL}/api/v1/yield`;

export function buildToolkit(params: {
  projectId: string;
  userId: string;
  sessionId: string;
  memory: MemoryProvider;
  sessions: SessionProvider;
  toolRegistry?: ToolRegistry;
}) {
  const { projectId, userId, sessionId, memory, sessions, toolRegistry } = params;

  // ── Core tools ─────────────────────────────────────────────────────────────

  const memorySave = new DynamicStructuredTool({
    name: "memory_save",
    description: "Save long-term user memory such as preferences or facts.",
    schema: z.object({ text: z.string().min(2), tags: z.array(z.string()).default([]) }),
    func: async ({ text, tags }) => JSON.stringify(await memory.upsert(projectId, userId, text, tags))
  });

  const memorySearch = new DynamicStructuredTool({
    name: "memory_search",
    description: "Semantic search in long-term memory.",
    schema: z.object({ query: z.string().min(1), limit: z.number().int().positive().max(10).default(5) }),
    func: async ({ query, limit }) => JSON.stringify(await memory.semanticSearch(projectId, userId, query, limit))
  });

  const contextGet = new DynamicStructuredTool({
    name: "context_get",
    description: "Read recent session context.",
    schema: z.object({ limit: z.number().int().positive().max(20).default(10) }),
    func: async ({ limit }) => JSON.stringify(sessions.getRecentContext(sessionId, limit))
  });

  const now = new DynamicStructuredTool({
    name: "time_now",
    description: "Get current ISO datetime (UTC).",
    schema: z.object({}),
    func: async () => new Date().toISOString()
  });

  const tools: DynamicStructuredTool[] = [memorySave, memorySearch, contextGet, now];

  // ── Intent Bridge Tools ────────────────────────────────────────────────────
  // These tools let the agent understand and work with the Naisu One
  // cross-chain intent bridge (Dutch auction protocol via Wormhole).
  //
  // Supported chains: "sui" | "evm-fuji" | "evm-base" | "solana"

  /**
   * intent_quote — Get Dutch auction price params for a cross-chain swap/bridge.
   * Safe, read-only. Call this before build_tx to show the user what they'll receive.
   */
  const intentQuote = new DynamicStructuredTool({
    name: "intent_quote",
    description:
      "Get a cross-chain intent quote using the Naisu One Dutch auction bridge. " +
      "Returns: estimated receive amount, start/floor price, auction duration, and Wormhole chain IDs. " +
      "Does NOT create any transaction. Use this to answer 'how much will I receive?' questions. " +
      "Supported chains: sui, evm-fuji, evm-base, solana.",
    schema: z.object({
      fromChain: z
        .enum(["sui", "evm-fuji", "evm-base", "solana"])
        .describe("Source chain the user is bridging FROM"),
      toChain: z
        .enum(["sui", "evm-fuji", "evm-base", "solana"])
        .describe("Destination chain the user is bridging TO"),
      token: z
        .string()
        .default("native")
        .describe("Token symbol (e.g. ETH, SUI, SOL) — use 'native' if unsure"),
      amount: z
        .string()
        .describe("Amount to bridge as a human-readable string, e.g. '0.1' or '5.0'"),
    }),
    func: async ({ fromChain, toChain, token, amount }) => {
      const url = `${INTENT_API}/quote?fromChain=${fromChain}&toChain=${toChain}&token=${token}&amount=${amount}`;
      return JSON.stringify(await httpJson(url));
    },
  });

  /**
   * intent_price — Get current FX rate between two chain tokens.
   */
  const intentPrice = new DynamicStructuredTool({
    name: "intent_price",
    description:
      "Get the current estimated exchange rate between two chain tokens " +
      "(e.g. ETH/SUI, SOL/ETH). Uses CoinGecko market data. " +
      "Use this to answer 'what is the current price?' or 'how much ETH is 10 SUI?' questions.",
    schema: z.object({
      fromChain: z
        .enum(["sui", "evm-fuji", "evm-base", "solana"])
        .describe("Chain whose token you're pricing FROM"),
      toChain: z
        .enum(["sui", "evm-fuji", "evm-base", "solana"])
        .describe("Chain whose token you're pricing TO"),
    }),
    func: async ({ fromChain, toChain }) => {
      const url = `${INTENT_API}/price?fromChain=${fromChain}&toChain=${toChain}`;
      return JSON.stringify(await httpJson(url));
    },
  });

  /**
   * intent_orders — List a user's active/historical intent orders.
   */
  const intentOrders = new DynamicStructuredTool({
    name: "intent_orders",
    description:
      "List all intent bridge orders for a wallet address. " +
      "Returns order IDs, amounts, current Dutch auction prices, deadlines, and status (OPEN/FULFILLED/CANCELLED). " +
      "Use this to answer 'do I have any pending orders?' or 'what is the status of my bridge?'",
    schema: z.object({
      user: z
        .string()
        .describe("Wallet address to query (EVM 0x address, Sui address, or Solana base58 pubkey)"),
      chain: z
        .enum(["sui", "evm-fuji", "evm-base", "solana"])
        .optional()
        .describe("Filter by chain (optional — omit to query all chains)"),
    }),
    func: async ({ user, chain }) => {
      const chainParam = chain ? `&chain=${chain}` : "";
      const url = `${INTENT_API}/orders?user=${encodeURIComponent(user)}${chainParam}`;
      return JSON.stringify(await httpJson(url));
    },
  });

  /**
   * intent_build_gasless — Build a gasless EIP-712 intent for the user to sign.
   * NO gas required from the user. Solver pays all on-chain fees.
   * Use this for EVM → Solana/Sui. Never use intent_build_tx for EVM source.
   */
  const intentBuildGasless = new DynamicStructuredTool({
    name: "intent_build_gasless",
    description:
      "Build a gasless cross-chain intent for the user to sign (EIP-712 typed data). " +
      "The user signs a FREE message — zero ETH gas required. " +
      "The winning solver pays all on-chain gas fees. " +
      "ALWAYS use this for EVM → Solana or EVM → Sui bridge intents. " +
      "Do NOT use intent_build_tx for EVM source chain. " +
      "Always call intent_quote first to verify activeSolvers > 0.",
    schema: z.object({
      senderAddress: z.string().describe("User's EVM wallet address (0x...)"),
      recipientAddress: z.string().describe("Destination wallet address (Solana base58 or Sui 0x)"),
      destinationChain: z.enum(["solana", "sui"]).describe("Destination chain"),
      amount: z.string().describe("Amount to bridge as human-readable string, e.g. '0.1'"),
      durationSeconds: z.number().int().positive().max(86400).default(300).describe("Auction duration in seconds (default 300 = 5 min)"),
      outputToken: z.enum(["sol", "msol", "jito", "jupsol", "kamino"]).default("sol").describe("Output token: 'sol' (default), 'msol' (Marinade liquid staking), 'jito' (Jito liquid staking), 'jupsol' (Jupiter liquid staking), 'kamino' (Kamino lending)"),
    }),
    func: async ({ senderAddress, recipientAddress, destinationChain, amount, durationSeconds, outputToken }) => {
      const url = `${INTENT_API}/build-gasless`;
      const body = { senderAddress, recipientAddress, destinationChain, amount, durationSeconds, outputToken };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      // Return only the data object so agent outputs it directly in a ```json block
      if (json.success && json.data) return JSON.stringify(json.data);
      return JSON.stringify(json);
    },
  });

  /**
   * intent_build_tx — Construct an unsigned transaction for the user to sign.
   * Returns raw tx data; the frontend wallet signs and broadcasts.
   * Use only for Sui source chain intents.
   */
  const intentBuildTx = new DynamicStructuredTool({
    name: "intent_build_tx",
    description:
      "Build an unsigned Sui → EVM intent transaction (create_intent). " +
      "ONLY for Sui source chain. For EVM source, use intent_build_gasless instead. " +
      "Returns base64 txBytes for the user to sign in their Sui wallet.",
    schema: z.object({
      chain: z
        .enum(["sui"])
        .describe("Must be 'sui' — this tool is for Sui source only"),
      action: z
        .enum(["create_intent"])
        .describe("Always 'create_intent' for Sui source"),
      senderAddress: z
        .string()
        .describe("User's Sui wallet address"),
      recipientAddress: z
        .string()
        .describe("User's destination address on the target chain"),
      destinationChain: z
        .enum(["evm-base", "solana"])
        .describe("Chain to receive funds ON"),
      amount: z
        .string()
        .describe("Amount to bridge as a human-readable string, e.g. '0.1'"),
      durationSeconds: z
        .number()
        .int()
        .positive()
        .max(86400)
        .default(300)
        .describe("Dutch auction duration in seconds (default 300 = 5 minutes)"),
      outputToken: z
        .enum(["sol", "msol"])
        .default("sol")
        .describe("Output token on destination chain."),
    }),
    func: async ({ chain, action, senderAddress, recipientAddress, destinationChain, amount, durationSeconds, outputToken }) => {
      // Hard redirect: if senderAddress looks like EVM (0x...) this is NOT a Sui source intent.
      // Redirect to gasless regardless of what chain the LLM passed.
      const isEvmSender = /^0x[0-9a-fA-F]{40}$/i.test(senderAddress);
      if (isEvmSender) {
        const gaslessUrl = `${INTENT_API}/build-gasless`;
        const gaslessDest = (destinationChain === "evm-base") ? "solana" : destinationChain;
        const gaslessBody = { senderAddress, recipientAddress, destinationChain: gaslessDest, amount, durationSeconds, outputToken };
        const gaslessRes = await fetch(gaslessUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(gaslessBody),
        });
        const json = await gaslessRes.json();
        if (json.success && json.data) return JSON.stringify(json.data);
        return JSON.stringify(json);
      }
      const url = `${INTENT_API}/build-tx`;
      const body = { chain, action, senderAddress, recipientAddress, destinationChain, amount, durationSeconds, outputToken };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return JSON.stringify(await res.json());
    },
  });

  /**
   * solana_balance — Check a Solana wallet's SOL balance.
   */
  const solanaBalance = new DynamicStructuredTool({
    name: "solana_balance",
    description:
      "Get the SOL balance (in lamports and SOL) of any Solana wallet address on devnet. " +
      "Useful for checking if a user has enough SOL before bridging.",
    schema: z.object({
      address: z.string().min(32).max(44).describe("Solana wallet public key (base58)"),
    }),
    func: async ({ address }) =>
      JSON.stringify(await httpJson(`${SOLANA_API}/balance/${address}`)),
  });

  /**
   * evm_balance — Check an EVM wallet's native ETH balance on Base Sepolia or Fuji.
   * MUST call this before building any EVM transaction to verify the user has enough funds.
   */
  const evmBalance = new DynamicStructuredTool({
    name: "evm_balance",
    description:
      "Returns balanceEth, balanceWei, estimatedGasEth, and estimatedGasWei. " +
      "ALWAYS call this BEFORE calling intent_build_tx for any EVM source chain — " +
      "check the user has enough ETH to cover the bridge amount PLUS the dynamically estimated gas (estimatedGasEth). " +
      "If their balanceEth is less than (bridge amount + estimatedGasEth), inform the user they have insufficient funds and do NOT build the transaction.",
    schema: z.object({
      chain: z
        .enum(["evm-base", "evm-fuji"])
        .describe("EVM chain to query (evm-base = Base Sepolia, evm-fuji = Avalanche Fuji)"),
      address: z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/)
        .describe("EVM wallet address (0x...)"),
    }),
    func: async ({ chain, address }) =>
      JSON.stringify(await httpJson(`${INTENT_API}/evm-balance?chain=${chain}&address=${encodeURIComponent(address)}`)),
  });

  // ── Earn Tools ─────────────────────────────────────────────────────────────

  const earnYieldRates = new DynamicStructuredTool({
    name: "earn_yield_rates",
    description:
      "Get current APY rates for Marinade liquid staking (mSOL) and marginfi SOL lending on Solana. " +
      "Use to answer 'what is the APY?' or before recommending a yield strategy.",
    schema: z.object({}),
    func: async () => JSON.stringify(await httpJson(`${YIELD_API}/rates`)),
  });

  const earnPortfolioBalances = new DynamicStructuredTool({
    name: "earn_portfolio_balances",
    description:
      "Get a Solana wallet's earn positions: SOL balance, mSOL (Marinade liquid staking), " +
      "USDC balance, and marginfi SOL lending balance. " +
      "Always call this before suggesting unstake or withdraw. " +
      "Returns raw lamports — divide SOL/mSOL by 1e9, USDC by 1e6.",
    schema: z.object({
      wallet: z.string().min(32).max(44).describe("Solana wallet address (base58)"),
    }),
    func: async ({ wallet }) =>
      JSON.stringify(await httpJson(`${PORTFOLIO_API}/balances?wallet=${encodeURIComponent(wallet)}`)),
  });

  const earnUnstakeMsol = new DynamicStructuredTool({
    name: "earn_unstake_msol",
    description:
      "Build an unsigned Solana VersionedTransaction to liquid-unstake mSOL → SOL via Marinade Finance. " +
      "Returns { tx: '<base64>' } for the user to sign with their Solana wallet. " +
      "Always check earn_portfolio_balances first to confirm mSOL balance. " +
      "Amount is raw mSOL units (9 decimals) — 1 mSOL = '1000000000'. " +
      "After getting the tx, emit a solana_tx widget for the user to sign.",
    schema: z.object({
      wallet: z.string().min(32).max(44).describe("User's Solana wallet address (base58)"),
      amount: z.string().describe("Raw mSOL in smallest units. E.g. 1 mSOL = '1000000000'"),
    }),
    func: async ({ wallet, amount }) => {
      const res = await fetch(`${PORTFOLIO_API}/unstake-msol`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, amount }),
      });
      const json = await res.json();
      if (json.success && json.data) return JSON.stringify(json.data);
      return JSON.stringify(json);
    },
  });

  const earnUnstakeJito = new DynamicStructuredTool({
    name: "earn_unstake_jito",
    description:
      "Build an unsigned Solana VersionedTransaction to unstake jitoSOL → SOL (mock Jito). " +
      "Burns the user's jitoSOL and returns SOL 1:1 from the solver. " +
      "Returns { tx: '<base64>' } for the user to sign with their Solana wallet. " +
      "Always check earn_portfolio_balances first to confirm jitoSOL balance. " +
      "Amount is raw jitoSOL units (9 decimals) — 1 jitoSOL = '1000000000'. " +
      "After getting the tx, emit a solana_tx widget for the user to sign.",
    schema: z.object({
      wallet: z.string().min(32).max(44).describe("User's Solana wallet address (base58)"),
      amount: z.string().describe("Raw jitoSOL in smallest units. E.g. 1 jitoSOL = '1000000000'"),
    }),
    func: async ({ wallet, amount }) => {
      const res = await fetch(`${PORTFOLIO_API}/unstake-jito`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, amount }),
      });
      const json = await res.json();
      if (json.success && json.data) return JSON.stringify(json.data);
      return JSON.stringify(json);
    },
  });

  const earnUnstakeJupsol = new DynamicStructuredTool({
    name: "earn_unstake_jupsol",
    description:
      "Build an unsigned Solana VersionedTransaction to unstake jupSOL → SOL (mock Jupiter). " +
      "Burns the user's jupSOL and returns SOL 1:1 from the solver. " +
      "Returns { tx: '<base64>' } for the user to sign with their Solana wallet. " +
      "Always check earn_portfolio_balances first to confirm jupSOL balance. " +
      "Amount is raw jupSOL units (9 decimals) — 1 jupSOL = '1000000000'. " +
      "After getting the tx, emit a solana_tx widget for the user to sign.",
    schema: z.object({
      wallet: z.string().min(32).max(44).describe("User's Solana wallet address (base58)"),
      amount: z.string().describe("Raw jupSOL in smallest units. E.g. 1 jupSOL = '1000000000'"),
    }),
    func: async ({ wallet, amount }) => {
      const res = await fetch(`${PORTFOLIO_API}/unstake-jupsol`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, amount }),
      });
      const json = await res.json();
      if (json.success && json.data) return JSON.stringify(json.data);
      return JSON.stringify(json);
    },
  });

  const earnUnstakeKamino = new DynamicStructuredTool({
    name: "earn_unstake_kamino",
    description:
      "Build an unsigned Solana VersionedTransaction to unstake kSOL → SOL (mock Kamino). " +
      "Burns the user's kSOL and returns SOL 1:1 from the solver. " +
      "Returns { tx: '<base64>' } for the user to sign with their Solana wallet. " +
      "Always check earn_portfolio_balances first to confirm kSOL balance. " +
      "Amount is raw kSOL units (9 decimals) — 1 kSOL = '1000000000'. " +
      "After getting the tx, emit a solana_tx widget for the user to sign.",
    schema: z.object({
      wallet: z.string().min(32).max(44).describe("User's Solana wallet address (base58)"),
      amount: z.string().describe("Raw kSOL in smallest units. E.g. 1 kSOL = '1000000000'"),
    }),
    func: async ({ wallet, amount }) => {
      const res = await fetch(`${PORTFOLIO_API}/unstake-kamino`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, amount }),
      });
      const json = await res.json();
      if (json.success && json.data) return JSON.stringify(json.data);
      return JSON.stringify(json);
    },
  });

  tools.push(
    intentQuote,
    intentPrice,
    intentOrders,
    intentBuildGasless,
    intentBuildTx,
    solanaBalance,
    evmBalance,
    earnYieldRates,
    earnPortfolioBalances,
    earnUnstakeMsol,
    earnUnstakeJito,
    earnUnstakeJupsol,
    earnUnstakeKamino,
  );

  // ── Custom tools from registry ─────────────────────────────────────────────
  if (toolRegistry) {
    const { custom } = toolRegistry.getAllTools();
    for (const customTool of custom) {
      if (customTool.isActive) {
        try {
          const executableTool = toolRegistry.createExecutableTool(
            customTool,
            memory,
            sessions
          );
          tools.push(executableTool);
        } catch (error) {
          console.error(`Failed to load custom tool: ${customTool.name}`, error);
        }
      }
    }
  }

  return tools;
}
