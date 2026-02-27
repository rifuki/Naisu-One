import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { MemoryProvider } from "../memory/provider.js";
import type { SessionProvider } from "../session/provider.js";
import type { ToolRegistry } from "./tool-registry.js";
import { httpJson } from "../utils/http.js";
import { env } from "../config/env.js";

// ─── API base URLs ───────────────────────────────────────────────────────────
const INTENT_API = `${env.NAISU_BACKEND_URL}/api/v1/intent`;
const SOLANA_API = `${env.NAISU_BACKEND_URL}/api/v1/solana`;

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
   * intent_build_tx — Construct an unsigned transaction for the user to sign.
   * Returns raw tx data; the frontend wallet signs and broadcasts.
   */
  const intentBuildTx = new DynamicStructuredTool({
    name: "intent_build_tx",
    description:
      "Build an unsigned cross-chain intent transaction for the user to sign in their wallet. " +
      "For Sui: returns base64 txBytes. For EVM: returns { to, data, value, chainId }. " +
      "The backend NEVER signs or broadcasts — the user signs in their own wallet. " +
      "Use this when the user says 'bridge X from Y to Z' or 'create an intent to swap'. " +
      "Always call intent_quote first to confirm the user understands the terms.",
    schema: z.object({
      chain: z
        .enum(["sui", "evm-fuji", "evm-base", "solana"])
        .describe("Chain to send FROM (where the user's funds are locked)"),
      action: z
        .enum(["create_intent", "create_order"])
        .describe("'create_intent' for Sui source, 'create_order' for EVM source"),
      senderAddress: z
        .string()
        .describe("User's wallet address on the source chain"),
      recipientAddress: z
        .string()
        .describe("User's destination address on the target chain (EVM 0x, Solana base58, or Sui address)"),
      destinationChain: z
        .enum(["sui", "evm-fuji", "evm-base", "solana"])
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
    }),
    func: async ({ chain, action, senderAddress, recipientAddress, destinationChain, amount, durationSeconds }) => {
      const url = `${INTENT_API}/build-tx`;
      const body = { chain, action, senderAddress, recipientAddress, destinationChain, amount, durationSeconds };
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

  tools.push(
    intentQuote,
    intentPrice,
    intentOrders,
    intentBuildTx,
    solanaBalance,
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
