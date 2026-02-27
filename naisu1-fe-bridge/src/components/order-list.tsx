import { useState, useEffect } from "react";
import {
  useCurrentAccount,
  useSuiClient,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  SUI_PACKAGE_ID,
  SUI_ALL_PACKAGE_IDS,
  BASE_SEPOLIA_CONTRACT_ADDRESS,
  AVALANCHE_FUJI_CONTRACT_ADDRESS,
  AVALANCHE_FUJI_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
} from "@/lib/constants";
import { INTENT_BRIDGE_ABI } from "@/lib/abi";
import {
  Clock,
  Wallet,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Timer,
  TrendingDown,
  Loader2,
  ArrowUpRight,
  Package,
} from "lucide-react";

type IntentStatus = "Open" | "Fulfilled" | "Cancelled";
type TabValue = "sui" | "evm";

interface SuiIntentRow {
  intentId: string;
  txDigest: string;
  amount: number;
  startPrice: number;
  floorPrice: number;
  createdAt: number;
  deadline: number;
  destinationChain: number;
  status: IntentStatus;
}

interface EvmOrderRow {
  orderId: `0x${string}`;
  txHash: `0x${string}`;
  amount: bigint;
  startPrice: bigint;
  floorPrice: bigint;
  deadline: bigint;
  createdAt: bigint;
  status: number;
  chainLabel: string;
  destinationChain: number;
}

function calcCurrentPrice(startPrice: number, floorPrice: number, createdAt: number, deadline: number, nowMs: number): number {
  if (nowMs >= deadline) return floorPrice;
  if (nowMs <= createdAt) return startPrice;
  const elapsed = nowMs - createdAt;
  const duration = deadline - createdAt;
  const range = startPrice - floorPrice;
  return startPrice - Math.floor((range * elapsed) / duration);
}

function getStatusBadge(status: IntentStatus | string | number, expired: boolean) {
  if (status === "Fulfilled" || status === 1) {
    return (
      <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20 border-green-500/20">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Fulfilled
      </Badge>
    );
  }
  if (status === "Cancelled" || status === 2) {
    return (
      <Badge variant="outline" className="text-muted-foreground border-muted">
        <XCircle className="h-3 w-3 mr-1" />
        Cancelled
      </Badge>
    );
  }
  if (expired) {
    return (
      <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/30">
        <Timer className="h-3 w-3 mr-1" />
        Expired
      </Badge>
    );
  }
  return (
    <Badge className="bg-primary/10 text-primary hover:bg-primary/20">
      <Clock className="h-3 w-3 mr-1" />
      Open
    </Badge>
  );
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "Ended";
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  return `${hours}h`;
}

function SuiIntentsList() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute, isPending: isCancelling } = useSignAndExecuteTransaction();

  const [intents, setIntents] = useState<SuiIntentRow[]>([]);
  const [now, setNow] = useState(Date.now());
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!account) {
      setLoading(false);
      return;
    }

    async function fetchIntents() {
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

        const rows: SuiIntentRow[] = allEvents
          .filter((e) => {
            const j = e.parsedJson as Record<string, string>;
            return j.creator === account!.address;
          })
          .map((e) => {
            const j = e.parsedJson as Record<string, string | number>;
            const createdAt = Number(j.created_at);
            const deadline = Number(j.deadline);
            return {
              intentId: String(j.intent_id),
              txDigest: e.id.txDigest,
              amount: Number(j.amount) / 1e9,
              startPrice: Number(j.start_price),
              floorPrice: Number(j.floor_price),
              createdAt,
              deadline,
              destinationChain: Number(j.destination_chain),
              status: "Open" as IntentStatus,
            };
          });

        const withStatus = await Promise.all(
          rows.map(async (row) => {
            try {
              const obj = await suiClient.getObject({
                id: row.intentId,
                options: { showContent: true },
              });
              if (obj.error || !obj.data?.content) return row;
              const fields = (obj.data.content as { fields?: Record<string, unknown> }).fields;
              const statusNum = Number(fields?.status ?? 0);
              const statusMap: Record<number, IntentStatus> = {
                0: "Open",
                1: "Fulfilled",
                2: "Cancelled",
              };
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

    fetchIntents();
  }, [account, suiClient]);

  async function handleCancel(intentId: string) {
    if (!account) return;
    setCancellingId(intentId);
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${SUI_PACKAGE_ID}::intent_bridge::cancel_intent`,
        arguments: [tx.object(intentId), tx.object("0x6")],
      });
      await signAndExecute({ transaction: tx });
      setIntents((prev) => prev.map((i) => (i.intentId === intentId ? { ...i, status: "Cancelled" } : i)));
    } catch (err) {
      console.error("Cancel failed:", err);
    } finally {
      setCancellingId(null);
    }
  }

  if (!account) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Wallet className="h-12 w-12 mb-4 opacity-20" />
        <p>Connect your Sui wallet to view intents</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading intents...</p>
      </div>
    );
  }

  if (intents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Package className="h-12 w-12 mb-4 opacity-20" />
        <p>No intents found</p>
        <p className="text-sm mt-1">Create your first bridge intent to get started</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[500px]">
      <div className="space-y-3 pr-4">
        {intents.map((intent) => {
          const currentPrice = calcCurrentPrice(intent.startPrice, intent.floorPrice, intent.createdAt, intent.deadline, now);
          const progress = intent.deadline > intent.createdAt
            ? Math.min(100, ((now - intent.createdAt) / (intent.deadline - intent.createdAt)) * 100)
            : 100;
          const expired = now > intent.deadline;
          const isOpen = intent.status === "Open";
          const timeLeft = intent.deadline - now;

          return (
            <Card key={intent.intentId} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto py-0 px-1 font-mono text-xs text-muted-foreground cursor-pointer"
                          onClick={() => window.open(`https://suiscan.xyz/testnet/tx/${intent.txDigest}`, "_blank")}
                        >
                          {intent.intentId.slice(0, 8)}...{intent.intentId.slice(-4)}
                          <ExternalLink className="h-3 w-3 ml-1" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>View on Suiscan</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {getStatusBadge(intent.status, expired)}
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Amount Locked</p>
                    <p className="text-lg font-semibold">{intent.amount.toFixed(4)} SUI</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground mb-1">Destination</p>
                    <Badge variant="outline">Chain {intent.destinationChain}</Badge>
                  </div>
                </div>

                {isOpen && (
                  <>
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <TrendingDown className="h-3.5 w-3.5" />
                          Current Price
                        </span>
                        <span className="font-mono font-medium">
                          {(currentPrice / 1e9).toFixed(6)} ETH
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary to-primary/60 transition-all duration-1000"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Floor: {(intent.floorPrice / 1e9).toFixed(6)} ETH</span>
                        <span className={timeLeft < 60000 ? "text-red-500 font-medium" : "text-muted-foreground"}>
                          <Timer className="h-3 w-3 inline mr-1" />
                          {formatTimeRemaining(timeLeft)}
                        </span>
                      </div>
                    </div>

                    {!expired && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full cursor-pointer"
                        disabled={cancellingId === intent.intentId || isCancelling}
                        onClick={() => handleCancel(intent.intentId)}
                      >
                        {cancellingId === intent.intentId ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Cancelling...
                          </>
                        ) : (
                          <>
                            <XCircle className="mr-2 h-4 w-4" />
                            Cancel Intent
                          </>
                        )}
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function EvmOrdersList() {
  const { address, isConnected } = useAccount();
  const { sendTransactionAsync: sendTransaction, isPending: isCancelling } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const { chainId: currentChainId } = useAccount();

  const [orders, setOrders] = useState<EvmOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!address || !isConnected) {
      setLoading(false);
      return;
    }

    async function fetchOrders() {
      setLoading(true);
      try {
        const { createPublicClient, http } = await import("viem");
        const { baseSepolia, avalancheFuji } = await import("viem/chains");

        const chains = [
          {
            chain: baseSepolia,
            label: "Base Sepolia",
            contract: BASE_SEPOLIA_CONTRACT_ADDRESS,
            rpc: "https://sepolia.base.org",
          },
          {
            chain: avalancheFuji,
            label: "Avalanche Fuji",
            contract: AVALANCHE_FUJI_CONTRACT_ADDRESS,
            rpc: "https://avalanche-fuji-c-chain-rpc.publicnode.com",
          },
        ];

        const allRows: EvmOrderRow[] = [];

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
              for (let from = startBlock; from <= latest; from += chunkSize + 1n) {
                const to = from + chunkSize > latest ? latest : from + chunkSize;
                try {
                  const chunk = await client.getContractEvents({
                    address: contract as `0x${string}`,
                    abi: INTENT_BRIDGE_ABI,
                    eventName: "OrderCreated",
                    args: { creator: address },
                    fromBlock: from,
                    toBlock: to,
                  });
                  myEvents.push(...chunk);
                } catch (err) {
                  console.warn(`[${label}] EVM log chunk failed:`, err);
                }
              }

              const rows = await Promise.all(
                myEvents.map(async (event) => {
                  const orderId = ((event as unknown) as { args: { orderId: `0x${string}` }; transactionHash: `0x${string}` }).args.orderId;
                  const txHash = ((event as unknown) as { args: { orderId: `0x${string}` }; transactionHash: `0x${string}` }).transactionHash;
                  const data = (await client.readContract({
                    address: contract as `0x${string}`,
                    abi: INTENT_BRIDGE_ABI,
                    functionName: "orders",
                    args: [orderId],
                  })) as readonly [string, `0x${string}`, number, bigint, bigint, bigint, bigint, bigint, number];
                  return {
                    orderId,
                    txHash,
                    amount: data[3],
                    startPrice: data[4],
                    floorPrice: data[5],
                    deadline: data[6],
                    createdAt: data[7],
                    status: data[8],
                    chainLabel: label,
                    destinationChain: data[2] as number,
                  } as EvmOrderRow;
                })
              );

              allRows.push(...rows);
            } catch (err) {
              console.warn(`[${label}] Failed to fetch orders:`, err);
            }
          })
        );

        allRows.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
        setOrders(allRows);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }

    fetchOrders();
  }, [address, isConnected]);

  async function handleCancel(orderId: `0x${string}`, chainLabel: string) {
    if (!address) return;
    setCancellingId(orderId);
    try {
      const { encodeFunctionData } = await import("viem");

      const targetChainId = chainLabel === "Avalanche Fuji" ? AVALANCHE_FUJI_CHAIN_ID : BASE_SEPOLIA_CHAIN_ID;

      if (currentChainId !== targetChainId && switchChainAsync) {
        await switchChainAsync({ chainId: targetChainId });
      }

      const contractAddr = chainLabel === "Avalanche Fuji" ? AVALANCHE_FUJI_CONTRACT_ADDRESS : BASE_SEPOLIA_CONTRACT_ADDRESS;

      const data = encodeFunctionData({
        abi: INTENT_BRIDGE_ABI,
        functionName: "cancelOrder",
        args: [orderId],
      });

      await sendTransaction({
        to: contractAddr as `0x${string}`,
        data,
      });

      setOrders((prev) => prev.map((o) => (o.orderId === orderId ? { ...o, status: 2 } : o)));
    } catch (err) {
      console.error("Cancel failed:", err);
    } finally {
      setCancellingId(null);
    }
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Wallet className="h-12 w-12 mb-4 opacity-20" />
        <p>Connect your EVM wallet to view orders</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading orders...</p>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Package className="h-12 w-12 mb-4 opacity-20" />
        <p>No orders found</p>
        <p className="text-sm mt-1">Create your first bridge order to get started</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[500px]">
      <div className="space-y-3 pr-4">
        {orders.map((order) => {
          const deadlineMs = Number(order.deadline) * 1000;
          const createdMs = Number(order.createdAt) * 1000;
          const expired = now > deadlineMs;

          const startP = Number(order.startPrice);
          const floorP = Number(order.floorPrice);
          const elapsed = now - createdMs;
          const duration = deadlineMs - createdMs;
          const currentPrice = expired ? floorP : startP - Math.floor(((startP - floorP) * elapsed) / duration);

          const progress = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 100;

          const status =
            order.status === 1 ? "Fulfilled" : order.status === 2 ? "Cancelled" : expired ? "Expired" : "Open";

          const isOpen = status === "Open";
          const nativeToken = order.chainLabel === "Avalanche Fuji" ? "AVAX" : "ETH";
          const timeLeft = deadlineMs - now;

          return (
            <Card key={`${order.chainLabel}-${order.orderId}`} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto py-0 px-1 font-mono text-xs text-muted-foreground cursor-pointer"
                          onClick={() =>
                            window.open(
                              order.chainLabel === "Avalanche Fuji"
                                ? `https://testnet.snowtrace.io/tx/${order.txHash}`
                                : `https://sepolia.basescan.org/tx/${order.txHash}`,
                              "_blank"
                            )
                          }
                        >
                          {order.orderId.slice(0, 8)}...{order.orderId.slice(-4)}
                          <ExternalLink className="h-3 w-3 ml-1" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>View on Explorer</p>
                      </TooltipContent>
                    </Tooltip>
                    <Badge
                      variant="outline"
                      className={
                        order.chainLabel === "Avalanche Fuji"
                          ? "text-red-600 border-red-200 bg-red-50 dark:bg-red-950/30"
                          : "text-blue-600 border-blue-200 bg-blue-50 dark:bg-blue-950/30"
                      }
                    >
                      {order.chainLabel}
                    </Badge>
                  </div>
                  {getStatusBadge(status, expired)}
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Amount Locked</p>
                    <p className="text-lg font-semibold">
                      {(Number(order.amount) / 1e18).toFixed(6)} {nativeToken}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground mb-1">Destination</p>
                    <Badge variant="outline">
                      {order.destinationChain === 1 ? "Solana" : "Sui"}
                    </Badge>
                  </div>
                </div>

                {isOpen && (
                  <>
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <TrendingDown className="h-3.5 w-3.5" />
                          Solver Pays
                        </span>
                        <span className="font-mono font-medium">
                          {(currentPrice / 1e9).toFixed(4)} {order.destinationChain === 1 ? "SOL" : "SUI"}
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary to-primary/60 transition-all duration-1000"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          Floor: {(floorP / 1e9).toFixed(4)} {order.destinationChain === 1 ? "SOL" : "SUI"}
                        </span>
                        <span className={timeLeft < 60000 ? "text-red-500 font-medium" : "text-muted-foreground"}>
                          <Timer className="h-3 w-3 inline mr-1" />
                          {formatTimeRemaining(timeLeft)}
                        </span>
                      </div>
                    </div>

                    {order.status === 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full cursor-pointer"
                        disabled={cancellingId === order.orderId || isCancelling}
                        onClick={() => handleCancel(order.orderId, order.chainLabel)}
                      >
                        {cancellingId === order.orderId ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Processing...
                          </>
                        ) : expired ? (
                          <>
                            <ArrowUpRight className="mr-2 h-4 w-4" />
                            Reclaim {nativeToken}
                          </>
                        ) : (
                          <>
                            <XCircle className="mr-2 h-4 w-4" />
                            Cancel Order
                          </>
                        )}
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ScrollArea>
  );
}

export function OrderList() {
  const [activeTab, setActiveTab] = useState<TabValue>("sui");

  return (
    <TooltipProvider>
      <Card className="w-full">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">My Orders</CardTitle>
              <CardDescription>View and manage your bridge intents</CardDescription>
            </div>
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
                <TabsList className="cursor-pointer">
                  <TabsTrigger value="sui" className="gap-2 cursor-pointer">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    Sui
                  </TabsTrigger>
                  <TabsTrigger value="evm" className="gap-2 cursor-pointer">
                    <div className="w-2 h-2 rounded-full bg-purple-500" />
                    EVM
                  </TabsTrigger>
                </TabsList>
              </Tabs>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-6">
          {activeTab === "sui" ? <SuiIntentsList /> : <EvmOrdersList />}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
