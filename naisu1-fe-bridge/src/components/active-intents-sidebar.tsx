import { useState, useEffect, useMemo } from "react";
import {
  useCurrentAccount,
  useSuiClient,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { useAccount, useSendTransaction } from "wagmi";
import { encodeFunctionData } from "viem";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SUI_PACKAGE_ID,
  SUI_ALL_PACKAGE_IDS,
  BASE_SEPOLIA_CONTRACT_ADDRESS,
  AVALANCHE_FUJI_CONTRACT_ADDRESS,
  SOLANA_PROGRAM_ID,
} from "@/lib/constants";
import { INTENT_BRIDGE_ABI } from "@/lib/abi";
import {
  Clock,
  Wallet,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Timer,
  Loader2,
  Package,
  RefreshCw,
  Info,
} from "lucide-react";
import { toast } from "sonner";

type IntentStatus = "Open" | "Fulfilled" | "Cancelled";
type ChainType = "sui" | "evm" | "solana";

interface IntentRow {
  id: string;
  txDigest: string;
  amount: number;
  startPrice: number;
  floorPrice: number;
  createdAt: number;
  deadline: number;
  destinationChain: number;
  status: IntentStatus;
  chain: ChainType;
  sourceChain?: string;
  /** Tx hash of the solver's settlement transaction (shown when Fulfilled) */
  fulfillTxHash?: string;
  /** Human-readable recipient address (base58 for Solana, hex for Sui) */
  recipient?: string;
  /** Solana solve_and_prove tx signature (EVM→Solana fulfilled orders) */
  solanaPaymentTxHash?: string;
  /** Solver EVM address (from OrderFulfilled event) */
  solverAddress?: string;
}

interface ActiveIntentsSidebarProps {
  refreshTrigger?: number;
}

function calcCurrentPrice(startPrice: number, floorPrice: number, createdAt: number, deadline: number, nowMs: number): number {
  if (nowMs >= deadline) return floorPrice;
  if (nowMs <= createdAt) return startPrice;
  const elapsed = nowMs - createdAt;
  const duration = deadline - createdAt;
  const range = startPrice - floorPrice;
  return startPrice - Math.floor((range * elapsed) / duration);
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "Ended";
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.ceil(hours / 24);
  return `${days}d`;
}

// ─── Detail Dialog ────────────────────────────────────────────────────────────

function TxLink({ label, hash, href, className = "" }: { label: string; hash: string; href: string; className?: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center gap-1 text-xs font-mono hover:underline break-all ${className}`}
      >
        {hash.slice(0, 10)}...{hash.slice(-8)}
        <ExternalLink className="h-3 w-3 flex-shrink-0" />
      </a>
    </div>
  );
}

function IntentDetailDialog({
  intent,
  open,
  onClose,
  currency,
  destChainLabel,
  now,
}: {
  intent: IntentRow | null;
  open: boolean;
  onClose: () => void;
  currency: string;
  destChainLabel: string;
  now: number;
}) {
  if (!intent) return null;

  const currentPrice = calcCurrentPrice(intent.startPrice, intent.floorPrice, intent.createdAt, intent.deadline, now);
  const expired = now > intent.deadline;
  const isEvm = intent.chain === "evm";
  const isSolana = intent.chain === "solana";
  const isToSolana = intent.destinationChain === 1;

  const createdDate = new Date(intent.createdAt);
  const deadlineDate = new Date(intent.deadline);

  const evmExplorer = intent.sourceChain === "Base"
    ? "https://sepolia.basescan.org"
    : "https://testnet.snowtrace.io";

  const getStatusBadge = (status: IntentStatus) => {
    if (status === "Fulfilled") return <Badge className="bg-green-500/10 text-green-500 border-green-500/20"><CheckCircle2 className="h-3 w-3 mr-1" />Fulfilled</Badge>;
    if (status === "Cancelled") return <Badge variant="outline" className="text-muted-foreground"><XCircle className="h-3 w-3 mr-1" />Cancelled</Badge>;
    if (expired) return <Badge variant="outline" className="text-amber-500 border-amber-500/30"><Timer className="h-3 w-3 mr-1" />Expired</Badge>;
    return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20"><Clock className="h-3 w-3 mr-1" />Open</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Intent Details
            {getStatusBadge(intent.status)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">

          {/* ── Route ───────────────────────────────────── */}
          <div className="rounded-lg bg-muted/40 p-3">
            <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Route</div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <span>{intent.chain === "evm" ? (intent.sourceChain ?? "EVM") : intent.chain === "sui" ? "Sui" : "Solana"}</span>
              <span className="text-muted-foreground">→</span>
              <span>{destChainLabel}</span>
            </div>
          </div>

          {/* ── Order / Intent ID ────────────────────────── */}
          <div className="rounded-lg bg-muted/40 p-3">
            <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">
              {isEvm ? "Order ID (bytes32)" : "Intent Object ID"}
            </div>
            <p className="text-xs font-mono break-all text-foreground">{intent.id}</p>
          </div>

          {/* ── Create Intent TX ─────────────────────────── */}
          <div className="rounded-lg bg-muted/40 p-3">
            <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Create Intent TX</div>
            {isEvm ? (
              <TxLink
                label=""
                hash={intent.txDigest}
                href={`${evmExplorer}/tx/${intent.txDigest}`}
                className="text-blue-500"
              />
            ) : isSolana ? (
              <TxLink
                label=""
                hash={intent.txDigest}
                href={`https://explorer.solana.com/tx/${intent.txDigest}?cluster=devnet`}
                className="text-purple-500"
              />
            ) : (
              <TxLink
                label=""
                hash={intent.txDigest}
                href={`https://suiscan.xyz/testnet/tx/${intent.txDigest}`}
                className="text-blue-400"
              />
            )}
          </div>

          {/* ── Amount ───────────────────────────────────── */}
          <div className="rounded-lg bg-muted/40 p-3">
            <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Amount</div>
            <p className="text-lg font-bold">{intent.amount.toFixed(6)} <span className="text-sm font-normal text-muted-foreground">{currency}</span></p>
          </div>

          {/* ── Recipient ────────────────────────────────── */}
          {intent.recipient && (
            <div className="rounded-lg bg-muted/40 p-3">
              <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">
                Recipient {isToSolana ? "(Solana address)" : ""}
              </div>
              {isToSolana ? (
                <a
                  href={`https://explorer.solana.com/address/${intent.recipient}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-mono text-emerald-500 hover:underline break-all"
                >
                  {intent.recipient}
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                </a>
              ) : (
                <p className="text-xs font-mono break-all">{intent.recipient}</p>
              )}
            </div>
          )}

          {/* ── Auction Prices ───────────────────────────── */}
          <div className="rounded-lg bg-muted/40 p-3">
            <div className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wide">Auction Prices ({currency})</div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground mb-0.5">Start</div>
                <div className="font-mono font-medium">{(intent.startPrice / 1e9).toFixed(6)}</div>
              </div>
              <div>
                <div className="text-muted-foreground mb-0.5">Floor</div>
                <div className="font-mono font-medium">{(intent.floorPrice / 1e9).toFixed(6)}</div>
              </div>
              <div>
                <div className="text-muted-foreground mb-0.5">Current</div>
                <div className="font-mono font-medium text-blue-500">{(currentPrice / 1e9).toFixed(6)}</div>
              </div>
            </div>
          </div>

          {/* ── Timeline ─────────────────────────────────── */}
          <div className="rounded-lg bg-muted/40 p-3">
            <div className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wide">Timeline</div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground mb-0.5">Created At</div>
                <div>{createdDate.toLocaleDateString()} {createdDate.toLocaleTimeString()}</div>
              </div>
              <div>
                <div className="text-muted-foreground mb-0.5">Deadline</div>
                <div className={expired ? "text-amber-500" : ""}>{deadlineDate.toLocaleDateString()} {deadlineDate.toLocaleTimeString()}</div>
              </div>
            </div>
            {intent.status === "Open" && (
              <div className="mt-2">
                <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                  <span>Time remaining</span>
                  <span className={intent.deadline - now < 60000 ? "text-red-500 font-medium" : ""}>
                    {formatTimeRemaining(intent.deadline - now)}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all"
                    style={{
                      width: `${Math.min(100, ((now - intent.createdAt) / (intent.deadline - intent.createdAt)) * 100)}%`
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Fulfillment TXs ──────────────────────────── */}
          {intent.status === "Fulfilled" && (
            <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-3 space-y-3">
              <div className="text-[10px] text-green-600 dark:text-green-400 mb-1 uppercase tracking-wide font-medium">Fulfillment Transactions</div>

              {/* Solver address */}
              {intent.solverAddress && (
                <div>
                  <div className="text-[10px] text-muted-foreground mb-0.5">Solver Address (EVM)</div>
                  <a
                    href={`${evmExplorer}/address/${intent.solverAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs font-mono text-purple-500 hover:underline break-all"
                  >
                    {intent.solverAddress}
                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                  </a>
                </div>
              )}

              {/* [1] Solana payment (EVM→SOL) */}
              {isToSolana && intent.solanaPaymentTxHash && (
                <TxLink
                  label="[1] SOL sent to recipient (Solana)"
                  hash={intent.solanaPaymentTxHash}
                  href={`https://explorer.solana.com/tx/${intent.solanaPaymentTxHash}?cluster=devnet`}
                  className="text-purple-500"
                />
              )}

              {/* [2] EVM settle / [1] SOL claim */}
              {intent.fulfillTxHash && (
                isEvm ? (
                  <TxLink
                    label={isToSolana ? "[2] ETH claimed by solver (EVM)" : "Settled on EVM"}
                    hash={intent.fulfillTxHash}
                    href={`${evmExplorer}/tx/${intent.fulfillTxHash}`}
                    className="text-green-600 dark:text-green-400"
                  />
                ) : isSolana ? (
                  <TxLink
                    label="Claimed on Solana (claim_with_vaa)"
                    hash={intent.fulfillTxHash}
                    href={`https://explorer.solana.com/tx/${intent.fulfillTxHash}?cluster=devnet`}
                    className="text-green-600 dark:text-green-400"
                  />
                ) : (
                  <TxLink
                    label="Settled on Sui"
                    hash={intent.fulfillTxHash}
                    href={`https://suiscan.xyz/testnet/tx/${intent.fulfillTxHash}`}
                    className="text-green-600 dark:text-green-400"
                  />
                )
              )}
            </div>
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ActiveIntentsSidebar({ refreshTrigger = 0 }: ActiveIntentsSidebarProps) {
  // Focus: EVM only (Sui/SOL data still fetched but tabs hidden)
  const [activeTab, setActiveTab] = useState<ChainType>("evm");
  const [intents, setIntents] = useState<IntentRow[]>([]);
  const [evmOrders, setEvmOrders] = useState<IntentRow[]>([]);
  const [solanaOrders, setSolanaOrders] = useState<IntentRow[]>([]);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [evmLoading, setEvmLoading] = useState(false);
  const [solanaLoading, setSolanaLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [selectedIntent, setSelectedIntent] = useState<IntentRow | null>(null);

  const suiAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { address: evmAddress, isConnected } = useAccount();
  const { sendTransactionAsync: sendEvmTx } = useSendTransaction();
  const { publicKey: solanaPublicKey, connected: solanaConnected } = useWallet();
  const { connection: solanaConnection } = useConnection();

  // Tick every second
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch Sui intents (still fetched for stats, tab hidden)
  useEffect(() => {
    if (!suiAccount) {
      setIntents([]);
      setLoading(false);
      return;
    }

    async function fetchSuiIntents() {
      setLoading(true);
      try {
        const allResults = await Promise.all(
          SUI_ALL_PACKAGE_IDS.map((pkgId) =>
            suiClient
              .queryEvents({
                query: { MoveEventType: `${pkgId}::intent_bridge::IntentCreated` },
                limit: 50,
              })
              .catch(() => ({ data: [] }))
          )
        );
        const allEvents = allResults.flatMap((r) => r.data);

        const rows: IntentRow[] = allEvents
          .filter((e) => {
            const j = e.parsedJson as Record<string, string>;
            return j.creator === suiAccount!.address;
          })
          .map((e) => {
            const j = e.parsedJson as Record<string, string | number>;
            return {
              id: String(j.intent_id),
              txDigest: e.id.txDigest,
              amount: Number(j.amount) / 1e9,
              startPrice: Number(j.start_price),
              floorPrice: Number(j.floor_price),
              createdAt: Number(j.created_at),
              deadline: Number(j.deadline),
              destinationChain: Number(j.destination_chain),
              status: "Open" as IntentStatus,
              chain: "sui",
            };
          });

        const withStatus = await Promise.all(
          rows.map(async (row) => {
            try {
              const obj = await suiClient.getObject({
                id: row.id,
                options: { showContent: true },
              });
              if (obj.error || !obj.data?.content) return row;
              const fields = (obj.data.content as { fields?: Record<string, unknown> }).fields;
              const statusNum = Number(fields?.status ?? 0);
              const statusMap: Record<number, IntentStatus> = { 0: "Open", 1: "Fulfilled", 2: "Cancelled" };
              return { ...row, status: statusMap[statusNum] ?? "Open" };
            } catch {
              return row;
            }
          })
        );

        setIntents(withStatus.sort((a, b) => b.createdAt - a.createdAt));
      } finally {
        setLoading(false);
      }
    }

    fetchSuiIntents();
    const interval = setInterval(fetchSuiIntents, 5000);
    return () => clearInterval(interval);
  }, [suiAccount, suiClient, refreshTrigger]);

  // Fetch EVM orders
  useEffect(() => {
    if (!evmAddress || !isConnected) {
      setEvmOrders([]);
      return;
    }

    async function fetchEvmOrders() {
      setEvmLoading(true);
      try {
        const { createPublicClient, http } = await import("viem");
        const { baseSepolia, avalancheFuji } = await import("viem/chains");

        const chains = [
          { chain: baseSepolia, label: "Base", contract: BASE_SEPOLIA_CONTRACT_ADDRESS, rpc: "https://sepolia.base.org" },
          { chain: avalancheFuji, label: "Fuji", contract: AVALANCHE_FUJI_CONTRACT_ADDRESS, rpc: "https://avalanche-fuji-c-chain-rpc.publicnode.com" },
        ];

        const allRows: IntentRow[] = [];

        await Promise.all(
          chains.map(async ({ chain, label, contract, rpc }) => {
            try {
              const client = createPublicClient({ chain, transport: http(rpc) });
              const latest = await client.getBlockNumber();
              const totalRange = 50000n;
              const chunkSize = 9999n;
              const startBlock = latest > totalRange ? latest - totalRange : 0n;

              type EventType = Awaited<ReturnType<typeof client.getContractEvents>>[number];
              const myEvents: EventType[] = [];
              // fulfillMap: orderId (lowercase) → { txHash, solverAddress }
              const fulfillMap = new Map<string, { txHash: string; solver: string }>();

              for (let from = startBlock; from <= latest; from += chunkSize + 1n) {
                const to = from + chunkSize > latest ? latest : from + chunkSize;
                try {
                  const chunk = await client.getContractEvents({
                    address: contract as `0x${string}`,
                    abi: INTENT_BRIDGE_ABI,
                    eventName: "OrderCreated",
                    args: { creator: evmAddress },
                    fromBlock: from,
                    toBlock: to,
                  });
                  myEvents.push(...chunk);
                } catch {
                  // Silent fail for chunks
                }
                // Collect OrderFulfilled events — capture solver address too
                try {
                  const fulfillChunk = await client.getContractEvents({
                    address: contract as `0x${string}`,
                    abi: INTENT_BRIDGE_ABI,
                    eventName: "OrderFulfilled",
                    fromBlock: from,
                    toBlock: to,
                  });
                  for (const ev of fulfillChunk) {
                    const typed = ev as unknown as { args: { orderId: `0x${string}`; solver: string }; transactionHash: string };
                    if (typed.args?.orderId && typed.transactionHash) {
                      fulfillMap.set(typed.args.orderId.toLowerCase(), {
                        txHash: typed.transactionHash,
                        solver: typed.args.solver ?? "",
                      });
                    }
                  }
                } catch {
                  // Silent fail
                }
              }

              const rows = await Promise.all(
                myEvents.map(async (event) => {
                  const typedEvent = event as unknown as { args: { orderId: `0x${string}` }; transactionHash: `0x${string}` };
                  const orderId = typedEvent.args.orderId;
                  const txHash = typedEvent.transactionHash;
                  const data = (await client.readContract({
                    address: contract as `0x${string}`,
                    abi: INTENT_BRIDGE_ABI,
                    functionName: "orders",
                    args: [orderId],
                  })) as readonly [string, `0x${string}`, number, bigint, bigint, bigint, bigint, bigint, number];

                  const statusNum = data[8];
                  const statusMap: Record<number, IntentStatus> = { 0: "Open", 1: "Fulfilled", 2: "Cancelled" };
                  const destinationChain = data[2] as number;
                  const fulfillInfo = statusNum === 1 ? fulfillMap.get(orderId.toLowerCase()) : undefined;

                  // Decode recipient & find Solana proof tx for EVM→Solana orders
                  let recipient: string | undefined;
                  let solanaPaymentTxHash: string | undefined;

                  if (destinationChain === 1) {
                    // Decode bytes32 recipient → base58 Solana address
                    try {
                      const { PublicKey } = await import("@solana/web3.js");
                      const recipHex = (data[1] as string).slice(2);
                      const recipBytes = new Uint8Array(recipHex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)));
                      recipient = new PublicKey(recipBytes).toBase58();
                    } catch { /* ignore */ }

                    // For fulfilled orders: extract Solana tx from VAA inside the settleOrder calldata
                    if (fulfillInfo?.txHash) {
                      try {
                        const evmTx = await client.getTransaction({ hash: fulfillInfo.txHash as `0x${string}` });
                        const inputHex = (evmTx.input as string).replace(/^0x/, "");
                        if (inputHex.length > 136) {
                          const vaaLen = parseInt(inputHex.slice(72, 136), 16);
                          const vaaHex = inputHex.slice(136, 136 + vaaLen * 2);
                          const vaaBytes = new Uint8Array(vaaHex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)));
                          const sigCount = vaaBytes[5];
                          const bodyOff = 6 + sigCount * 65;
                          const body = vaaBytes.slice(bodyOff);
                          const emitterChain = (body[8] << 8) | body[9];
                          const emitterAddrBytes = body.slice(10, 42);
                          let seq = 0n;
                          for (let i = 42; i < 50; i++) seq = (seq << 8n) | BigInt(body[i]);
                          const { PublicKey } = await import("@solana/web3.js");
                          const emitterBase58 = new PublicKey(emitterAddrBytes).toBase58();
                          const whResp = await fetch(
                            `https://api.testnet.wormholescan.io/v1/vaas/${emitterChain}/${emitterBase58}/${seq}`
                          );
                          if (whResp.ok) {
                            const whData = await whResp.json();
                            solanaPaymentTxHash = whData?.data?.txHash;
                          }
                        }
                      } catch { /* ignore */ }
                    }
                  }

                  return {
                    id: orderId,
                    txDigest: txHash,
                    amount: Number(data[3]) / 1e18,
                    startPrice: Number(data[4]),
                    floorPrice: Number(data[5]),
                    createdAt: Number(data[7]) * 1000,
                    deadline: Number(data[6]) * 1000,
                    destinationChain,
                    status: statusMap[statusNum] ?? "Open",
                    chain: "evm" as ChainType,
                    sourceChain: label,
                    fulfillTxHash: fulfillInfo?.txHash,
                    solverAddress: fulfillInfo?.solver || undefined,
                    recipient,
                    solanaPaymentTxHash,
                  };
                })
              );

              allRows.push(...rows);
            } catch {
              // Silent fail
            }
          })
        );

        setEvmOrders(allRows.sort((a, b) => b.createdAt - a.createdAt));
      } catch {
        // Silent fail
      } finally {
        setEvmLoading(false);
      }
    }

    fetchEvmOrders();
    const interval = setInterval(fetchEvmOrders, 10000);
    return () => clearInterval(interval);
  }, [evmAddress, isConnected, refreshTrigger]);

  // Fetch Solana intents (still fetched for stats, tab hidden)
  useEffect(() => {
    if (!solanaPublicKey || !solanaConnected) {
      setSolanaOrders([]);
      return;
    }

    async function fetchSolanaIntents() {
      setSolanaLoading(true);
      try {
        const { PublicKey } = await import("@solana/web3.js");
        const programId = new PublicKey(SOLANA_PROGRAM_ID);

        const discriminator = Buffer.from([247, 162, 35, 165, 254, 111, 129, 109]);

        const accounts = await solanaConnection.getProgramAccounts(programId, {
          filters: [
            { memcmp: { offset: 0, bytes: discriminator.toString("base64"), encoding: "base64" } },
            { memcmp: { offset: 40, bytes: solanaPublicKey!.toBase58() } },
          ],
        });

        const rows: IntentRow[] = await Promise.all(accounts.map(async ({ pubkey, account }) => {
          const data = account.data;
          let offset = 8;
          const intentId = data.slice(offset, offset + 32).toString("hex"); offset += 32;
          offset += 32; // skip creator
          offset += 32; // skip recipient
          const destinationChain = data.readUInt16LE(offset); offset += 2;
          const amount = Number(data.readBigUInt64LE(offset)) / 1e9; offset += 8;
          const startPrice = Number(data.readBigUInt64LE(offset)); offset += 8;
          const floorPrice = Number(data.readBigUInt64LE(offset)); offset += 8;
          const deadline = Number(data.readBigInt64LE(offset)) * 1000; offset += 8;
          const createdAt = Number(data.readBigInt64LE(offset)) * 1000; offset += 8;
          const status = data[offset];
          const statusMap: Record<number, IntentStatus> = { 0: "Open", 1: "Fulfilled", 2: "Cancelled" };

          let fulfillTxHash: string | undefined;
          if (status === 1) {
            try {
              const sigs = await solanaConnection.getSignaturesForAddress(pubkey, { limit: 5 });
              if (sigs.length >= 1) fulfillTxHash = sigs[0].signature;
            } catch { /* ignore */ }
          }

          return {
            id: pubkey.toBase58(),
            txDigest: intentId,
            amount,
            startPrice,
            floorPrice,
            createdAt,
            deadline,
            destinationChain,
            status: statusMap[status] ?? "Open",
            chain: "solana" as ChainType,
            fulfillTxHash,
          };
        }));

        setSolanaOrders(rows.sort((a, b) => b.createdAt - a.createdAt));
      } catch {
        // Silent fail
      } finally {
        setSolanaLoading(false);
      }
    }

    fetchSolanaIntents();
    const interval = setInterval(fetchSolanaIntents, 10000);
    return () => clearInterval(interval);
  }, [solanaPublicKey, solanaConnected, solanaConnection, refreshTrigger]);

  async function handleCancel(intent: IntentRow) {
    setCancellingId(intent.id);
    try {
      if (intent.chain === "sui") {
        if (!suiAccount) return;
        const tx = new Transaction();
        tx.moveCall({
          target: `${SUI_PACKAGE_ID}::intent_bridge::cancel_intent`,
          arguments: [tx.object(intent.id), tx.object("0x6")],
        });
        await signAndExecute({ transaction: tx });
        setIntents((prev) => prev.map((i) => (i.id === intent.id ? { ...i, status: "Cancelled" } : i)));
        toast.success("Sui intent cancelled!");
      } else if (intent.chain === "evm") {
        if (!evmAddress || !sendEvmTx) {
          toast.error("Please connect EVM wallet");
          return;
        }
        const contractAddress = intent.sourceChain === "Base"
          ? BASE_SEPOLIA_CONTRACT_ADDRESS
          : AVALANCHE_FUJI_CONTRACT_ADDRESS;
        const data = encodeFunctionData({
          abi: INTENT_BRIDGE_ABI,
          functionName: "cancelOrder",
          args: [intent.id as `0x${string}`],
        });
        await sendEvmTx({
          to: contractAddress as `0x${string}`,
          data,
        });
        setEvmOrders((prev) => prev.map((o) => (o.id === intent.id ? { ...o, status: "Cancelled" } : o)));
        toast.success("EVM order cancelled!");
      } else if (intent.chain === "solana") {
        toast.info("Solana intent cancellation coming soon!");
      }
    } catch (e) {
      toast.error("Failed to cancel: " + (e instanceof Error ? e.message : "Unknown error"));
    } finally {
      setCancellingId(null);
    }
  }

  // Computed stats (across all chains)
  const allIntents = [...intents, ...evmOrders, ...solanaOrders];
  const stats = useMemo(() => {
    const nowMs = Date.now();
    const open = allIntents.filter((i) => i.status === "Open" && i.deadline > nowMs).length;
    const fulfilled = allIntents.filter((i) => i.status === "Fulfilled").length;
    const expired = allIntents.filter((i) => i.status === "Open" && i.deadline <= nowMs).length;
    return { open, fulfilled, expired };
  }, [allIntents]);

  // Filtered intents by active tab
  const filteredIntents = activeTab === "evm" ? evmOrders : activeTab === "solana" ? solanaOrders : intents;

  const getStatusBadge = (status: IntentStatus, expired: boolean) => {
    if (status === "Fulfilled") return <Badge className="bg-green-500/10 text-green-500 border-green-500/20"><CheckCircle2 className="h-3 w-3 mr-1" />Fulfilled</Badge>;
    if (status === "Cancelled") return <Badge variant="outline" className="text-muted-foreground"><XCircle className="h-3 w-3 mr-1" />Cancelled</Badge>;
    if (expired) return <Badge variant="outline" className="text-amber-500 border-amber-500/30"><Timer className="h-3 w-3 mr-1" />Expired</Badge>;
    return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20"><Clock className="h-3 w-3 mr-1" />Open</Badge>;
  };

  // Helpers for selected intent dialog
  const getIntentCurrency = (intent: IntentRow) =>
    intent.chain === "sui" ? "SUI"
    : intent.chain === "solana" ? "SOL"
    : intent.sourceChain === "Base" ? "ETH" : "AVAX";

  const getDestChainLabel = (intent: IntentRow) =>
    intent.chain === "sui"
      ? intent.destinationChain === 10004 ? "Base Sepolia" : "Avalanche Fuji"
      : intent.chain === "solana"
      ? intent.destinationChain === 10004 ? "Base Sepolia" : "Avalanche Fuji"
      : intent.destinationChain === 1 ? "Solana" : "Sui";

  return (
    <TooltipProvider>
      <div className="flex flex-col flex-1 gap-4 min-h-0">
        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="bg-blue-500/5 border-blue-500/10">
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-blue-500">{stats.open}</div>
              <div className="text-xs text-muted-foreground">Open</div>
            </CardContent>
          </Card>
          <Card className="bg-green-500/5 border-green-500/10">
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-green-500">{stats.fulfilled}</div>
              <div className="text-xs text-muted-foreground">Fulfilled</div>
            </CardContent>
          </Card>
          <Card className="bg-amber-500/5 border-amber-500/10">
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-amber-500">{stats.expired}</div>
              <div className="text-xs text-muted-foreground">Expired</div>
            </CardContent>
          </Card>
        </div>

        {/* Tab Switcher — EVM only (Sui/SOL tabs hidden, focus: EVM→SOL) */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ChainType)}>
          <TabsList className="grid w-full grid-cols-1 cursor-pointer">
            <TabsTrigger value="evm" className="gap-2 cursor-pointer">
              <div className="w-2 h-2 rounded-full bg-purple-500" />
              EVM ({evmOrders.length})
              {evmLoading && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Section Title */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
            Active Intents
            <span className="text-muted-foreground">(Waiting for Solvers)</span>
          </h3>
          {(loading || evmLoading || solanaLoading) && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {/* Intents List */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="space-y-3 pr-1">
            {!isConnected && activeTab === "evm" ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Wallet className="h-12 w-12 mb-4 opacity-20" />
                <p className="text-sm">Connect EVM wallet</p>
              </div>
            ) : filteredIntents.length === 0 && !evmLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mb-4 opacity-20" />
                <p className="text-sm">No active intents</p>
                <p className="text-xs mt-1">Create one to get started</p>
              </div>
            ) : (
              filteredIntents.map((intent) => {
                const currentPrice = calcCurrentPrice(intent.startPrice, intent.floorPrice, intent.createdAt, intent.deadline, now);
                const progress = intent.deadline > intent.createdAt
                  ? Math.min(100, ((now - intent.createdAt) / (intent.deadline - intent.createdAt)) * 100)
                  : 100;
                const expired = now > intent.deadline;
                const isOpen = intent.status === "Open";
                const timeLeft = intent.deadline - now;
                const currency = getIntentCurrency(intent);
                const destChainLabel = getDestChainLabel(intent);
                const isToSolana = intent.destinationChain === 1;

                const deadlineDate = new Date(intent.deadline);
                const createdDate = new Date(intent.createdAt);

                const evmExplorer = intent.sourceChain === "Base"
                  ? "sepolia.basescan.org"
                  : "testnet.snowtrace.io";

                return (
                  <Card key={intent.id} className="overflow-hidden border-border/50 hover:border-border transition-colors">
                    <CardContent className="p-4">
                      {/* Header row */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-auto py-0 px-1 font-mono text-xs text-muted-foreground cursor-pointer"
                                onClick={() => {
                                  const explorer = intent.sourceChain === "Base"
                                    ? "sepolia.basescan.org"
                                    : "testnet.snowtrace.io";
                                  window.open(`https://${explorer}/tx/${intent.txDigest}`, "_blank");
                                }}
                              >
                                {intent.txDigest.slice(0, 6)}...{intent.txDigest.slice(-4)}
                                <ExternalLink className="h-3 w-3 ml-1" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-[10px] text-muted-foreground mb-0.5">Order ID</p>
                              <p className="font-mono text-xs break-all max-w-xs">{intent.id}</p>
                            </TooltipContent>
                          </Tooltip>

                          {intent.sourceChain && (
                            <Badge variant="outline" className="text-[10px] px-1.5">{intent.sourceChain}</Badge>
                          )}
                          <Badge variant="outline" className="text-[10px] px-1.5 text-muted-foreground">
                            → {destChainLabel}
                          </Badge>
                        </div>
                        {getStatusBadge(intent.status, expired)}
                      </div>

                      {/* Amount & price */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1">
                          <span className="text-lg font-bold">{intent.amount.toFixed(4)}</span>
                          <span className="text-sm text-muted-foreground">{currency}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Current Price</div>
                          <div className="font-mono text-sm">{(currentPrice / 1e9).toFixed(6)} {currency}</div>
                        </div>
                      </div>

                      {/* Times */}
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                        <span>Created: {createdDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        <span>Deadline: {deadlineDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>

                      {/* Progress bar (open orders) */}
                      {isOpen && (
                        <div className="space-y-1 mb-3">
                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-1000"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                              Floor: {(intent.floorPrice / 1e9).toFixed(6)} {currency}
                            </span>
                            <span className={timeLeft < 60000 ? "text-red-500 font-medium" : "text-muted-foreground"}>
                              <Timer className="h-3 w-3 inline mr-1" />
                              {formatTimeRemaining(timeLeft)}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Compact fulfilled proof (inline) */}
                      {intent.status === "Fulfilled" && intent.chain === "evm" && (
                        <div className="mb-3 pt-2 border-t border-green-500/20 space-y-1.5">
                          {isToSolana && intent.recipient && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span>Recipient:</span>
                              <a
                                href={`https://explorer.solana.com/address/${intent.recipient}?cluster=devnet`}
                                target="_blank" rel="noopener noreferrer"
                                className="font-mono text-emerald-500 hover:underline"
                              >
                                {intent.recipient.slice(0, 6)}...{intent.recipient.slice(-4)}
                                <ExternalLink className="h-3 w-3 inline ml-0.5" />
                              </a>
                            </div>
                          )}
                          {isToSolana && intent.solanaPaymentTxHash && (
                            <div className="text-xs text-muted-foreground">
                              <span>[1] SOL: </span>
                              <a
                                href={`https://explorer.solana.com/tx/${intent.solanaPaymentTxHash}?cluster=devnet`}
                                target="_blank" rel="noopener noreferrer"
                                className="font-mono text-purple-500 hover:underline"
                              >
                                {intent.solanaPaymentTxHash.slice(0, 8)}...{intent.solanaPaymentTxHash.slice(-6)}
                                <ExternalLink className="h-3 w-3 inline ml-0.5" />
                              </a>
                            </div>
                          )}
                          {intent.fulfillTxHash && (
                            <div className="text-xs text-muted-foreground">
                              <span>{isToSolana ? "[2] ETH: " : "Settled: "}</span>
                              <a
                                href={`https://${evmExplorer}/tx/${intent.fulfillTxHash}`}
                                target="_blank" rel="noopener noreferrer"
                                className="font-mono text-green-600 dark:text-green-400 hover:underline"
                              >
                                {intent.fulfillTxHash.slice(0, 8)}...{intent.fulfillTxHash.slice(-6)}
                                <ExternalLink className="h-3 w-3 inline ml-0.5" />
                              </a>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex gap-2">
                        {/* Cancel button */}
                        {isOpen && !expired && (intent.chain === "sui" || intent.chain === "evm") && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 text-xs cursor-pointer"
                            disabled={cancellingId === intent.id}
                            onClick={() => handleCancel(intent)}
                          >
                            {cancellingId === intent.id ? (
                              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                            ) : (
                              <XCircle className="mr-2 h-3 w-3" />
                            )}
                            Cancel
                          </Button>
                        )}

                        {/* Details button */}
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-xs cursor-pointer"
                          onClick={() => setSelectedIntent(intent)}
                        >
                          <Info className="mr-2 h-3 w-3" />
                          Details
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </div>

        {/* Intent Detail Dialog */}
        <IntentDetailDialog
          intent={selectedIntent}
          open={!!selectedIntent}
          onClose={() => setSelectedIntent(null)}
          currency={selectedIntent ? getIntentCurrency(selectedIntent) : ""}
          destChainLabel={selectedIntent ? getDestChainLabel(selectedIntent) : ""}
          now={now}
        />
      </div>
    </TooltipProvider>
  );
}
