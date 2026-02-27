import { useState, useEffect } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
  useSuiClientQuery,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { useAccount, useSendTransaction, useBalance, useSwitchChain } from "wagmi";
import { parseEther, encodeFunctionData, formatEther } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowRightLeft,
  Wallet,
  TrendingUp,
  Clock,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ArrowUpRight,
  Info,
} from "lucide-react";
import {
  SUI_PACKAGE_ID,
  BASE_SEPOLIA_CONTRACT_ADDRESS,
  AVALANCHE_FUJI_CONTRACT_ADDRESS,
  WORMHOLE_CHAIN_BASE,
  WORMHOLE_CHAIN_FUJI,
  WORMHOLE_CHAIN_SUI,
  BASE_SEPOLIA_CHAIN_ID,
  AVALANCHE_FUJI_CHAIN_ID,
} from "@/lib/constants";
import { INTENT_BRIDGE_ABI } from "@/lib/abi";

type Direction = "sui-to-evm" | "evm-to-sui";
type EvmChain = "base-sepolia" | "avalanche-fuji";
type StatusType = "idle" | "loading" | "success" | "error";

interface TransactionStatus {
  type: StatusType;
  message: string;
  txHash?: string;
}

export function BridgeForm() {
  const [direction, setDirection] = useState<Direction>("sui-to-evm");
  const [evmChain, setEvmChain] = useState<EvmChain>("avalanche-fuji");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [startPrice, setStartPrice] = useState("");
  const [floorPrice, setFloorPrice] = useState("");
  const [duration, setDuration] = useState("3600");
  const [status, setStatus] = useState<TransactionStatus>({ type: "idle", message: "" });
  const [suiEthRate, setSuiEthRate] = useState<number | null>(null);

  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=eth")
      .then((r) => r.json())
      .then((d) => setSuiEthRate(d?.sui?.eth ?? null))
      .catch(() => {});
  }, []);

  // Sui
  const suiAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute, isPending: isSuiPending } = useSignAndExecuteTransaction();

  const { data: suiBalanceData } = useSuiClientQuery(
    "getBalance",
    {
      owner: suiAccount?.address || "",
      coinType: "0x2::sui::SUI",
    },
    {
      enabled: !!suiAccount,
      refetchInterval: 10000,
    }
  );

  const suiBalance = suiBalanceData ? Number(suiBalanceData.totalBalance) / 1e9 : 0;

  // EVM
  const { address: evmAddress, chainId: currentChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync: sendTransaction, isPending: isEvmPending } = useSendTransaction();

  const selectedChainId = evmChain === "base-sepolia" ? BASE_SEPOLIA_CHAIN_ID : AVALANCHE_FUJI_CHAIN_ID;
  const { data: evmBalanceData } = useBalance({
    address: evmAddress,
    chainId: selectedChainId,
    query: {
      enabled: !!evmAddress,
      refetchInterval: 10000,
    },
  });

  const evmBalance = evmBalanceData ? Number(formatEther(evmBalanceData.value)) : 0;

  // Balance checks
  const activeBalance = direction === "sui-to-evm" ? suiBalance : evmBalance;
  const parsedAmount = parseFloat(amount || "0");
  const isInsufficientBalance = parsedAmount > 0 && parsedAmount > activeBalance;
  const isLoading = isSuiPending || isEvmPending;

  const handleMaxClick = () => {
    const buffer = direction === "sui-to-evm" ? 0.01 : 0.005;
    const max = Math.max(0, activeBalance - buffer);
    setAmount(max > 0 ? max.toFixed(6) : "0");
  };

  const canSubmit =
    (direction === "sui-to-evm" ? !!suiAccount : !!evmAddress) &&
    !isInsufficientBalance &&
    parsedAmount > 0 &&
    recipient &&
    startPrice &&
    floorPrice;

  const getChainBadge = (chain: EvmChain) => {
    return chain === "base-sepolia" ? (
      <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/20">
        Base Sepolia
      </Badge>
    ) : (
      <Badge variant="secondary" className="bg-red-500/10 text-red-600 hover:bg-red-500/20">
        Avalanche Fuji
      </Badge>
    );
  };

  async function handleSuiToEvm() {
    if (!suiAccount) return;

    setStatus({ type: "loading", message: "Building transaction..." });

    try {
      const amountMist = BigInt(Math.floor(parseFloat(amount) * 1e9));
      const durationMs = BigInt(parseInt(duration) * 1000);

      const recipientClean = recipient.replace("0x", "").padStart(40, "0");
      const recipientBytes = recipientClean.match(/.{2}/g)!.map((b) => parseInt(b, 16));

      const coins = await suiClient.getCoins({
        owner: suiAccount.address,
        coinType: "0x2::sui::SUI",
      });

      if (!coins.data.length) {
        setStatus({ type: "error", message: "No SUI coins found" });
        return;
      }

      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [amountMist]);

      const startPriceMist = BigInt(Math.round(parseFloat(startPrice) * 1e9));
      const floorPriceMist = BigInt(Math.round(parseFloat(floorPrice) * 1e9));

      const targetWormholeChain = evmChain === "base-sepolia" ? WORMHOLE_CHAIN_BASE : WORMHOLE_CHAIN_FUJI;

      tx.moveCall({
        target: `${SUI_PACKAGE_ID}::intent_bridge::create_intent`,
        arguments: [
          coin,
          tx.pure.vector("u8", recipientBytes),
          tx.pure.u16(targetWormholeChain),
          tx.pure.u64(startPriceMist),
          tx.pure.u64(floorPriceMist),
          tx.pure.u64(durationMs),
          tx.object("0x6"),
        ],
      });

      setStatus({ type: "loading", message: "Waiting for signature..." });

      const result = await signAndExecute({ transaction: tx });
      setStatus({
        type: "success",
        message: "Intent created successfully!",
        txHash: result.digest,
      });
    } catch (err) {
      setStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Unknown error occurred",
      });
    }
  }

  async function handleEvmToSui() {
    if (!evmAddress) return;

    if (currentChainId !== selectedChainId && switchChainAsync) {
      try {
        setStatus({ type: "loading", message: "Switching network..." });
        await switchChainAsync({ chainId: selectedChainId });
      } catch (err) {
        setStatus({ type: "error", message: "Network switch failed" });
        return;
      }
    }

    setStatus({ type: "loading", message: "Sending transaction..." });

    try {
      const amountWei = parseEther(amount);

      const recipientClean = recipient.replace("0x", "");
      const recipientBytes32 = `0x${recipientClean.padStart(64, "0")}` as `0x${string}`;

      const startPriceMist = BigInt(Math.round(parseFloat(startPrice) * 1e9));
      const floorPriceMist = BigInt(Math.round(parseFloat(floorPrice) * 1e9));

      const data = encodeFunctionData({
        abi: INTENT_BRIDGE_ABI,
        functionName: "createOrder",
        args: [recipientBytes32, WORMHOLE_CHAIN_SUI, startPriceMist, floorPriceMist, BigInt(duration)],
      });

      const contractAddr = selectedChainId === AVALANCHE_FUJI_CHAIN_ID
        ? AVALANCHE_FUJI_CONTRACT_ADDRESS
        : BASE_SEPOLIA_CONTRACT_ADDRESS;

      const hash = await sendTransaction({
        to: contractAddr as `0x${string}`,
        value: amountWei,
        data,
      });
      
      setStatus({
        type: "success",
        message: "Order created successfully!",
        txHash: hash,
      });
    } catch (err) {
      setStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Unknown error occurred",
      });
    }
  }

  const autoFillPrices = () => {
    const val = parseFloat(amount);
    if (isNaN(val) || !suiEthRate) return;
    const market = direction === "sui-to-evm" ? val * suiEthRate : val / suiEthRate;
    setStartPrice((market * 1.02).toFixed(6));
    setFloorPrice((market * 0.95).toFixed(6));
  };

  return (
    <TooltipProvider>
      <Card className="w-full max-w-lg border-border/50 shadow-lg">
        <CardHeader className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-lg">
                <ArrowRightLeft className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-xl">Cross-Chain Bridge</CardTitle>
                <CardDescription className="text-xs">
                  Sui ↔ EVM via Dutch Auction
                </CardDescription>
              </div>
            </div>
            {getChainBadge(evmChain)}
          </div>

          <Tabs value={direction} onValueChange={(v) => setDirection(v as Direction)} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="sui-to-evm" className="gap-2">
                <span>Sui</span>
                <ArrowRightLeft className="h-3 w-3" />
                <span>EVM</span>
              </TabsTrigger>
              <TabsTrigger value="evm-to-sui" className="gap-2">
                <span>EVM</span>
                <ArrowRightLeft className="h-3 w-3" />
                <span>Sui</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Chain Selection */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              Target Chain
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">Select the destination chain for your bridge transaction</p>
                </TooltipContent>
              </Tooltip>
            </Label>
            <Select value={evmChain} onValueChange={(v) => setEvmChain(v as EvmChain)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select chain" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="base-sepolia">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    Base Sepolia
                  </div>
                </SelectItem>
                <SelectItem value="avalanche-fuji">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    Avalanche Fuji
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Market Rate */}
          {suiEthRate !== null && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Market Rate
                </span>
                <span className="font-mono font-medium">1 SUI ≈ {suiEthRate.toFixed(6)} ETH</span>
              </div>
              {amount && !isNaN(parseFloat(amount)) && (
                <>
                  <Separator className="my-2" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Value</span>
                    <span className="font-mono">
                      {direction === "sui-to-evm"
                        ? `${(parseFloat(amount) * suiEthRate).toFixed(6)} ETH`
                        : `${(parseFloat(amount) / suiEthRate).toFixed(4)} SUI`}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full h-8 text-xs cursor-pointer"
                    onClick={autoFillPrices}
                  >
                    Auto-fill prices (+2% / -5%)
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Amount */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                Amount ({direction === "sui-to-evm" ? "SUI" : "ETH/AVAX"})
              </Label>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Wallet className="h-3.5 w-3.5" />
                <span className="font-mono">{activeBalance.toFixed(4)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto py-0 px-1 text-xs cursor-pointer"
                  onClick={handleMaxClick}
                >
                  Max
                </Button>
              </div>
            </div>
            <Input
              type="number"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={isInsufficientBalance ? "border-destructive" : ""}
            />
            {isInsufficientBalance && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Insufficient balance
              </p>
            )}
          </div>

          {/* Recipient */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                Recipient ({direction === "sui-to-evm" ? "EVM Address" : "Sui Address"})
              </Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-0 px-1 text-xs cursor-pointer"
              onClick={() => {
                const addr = direction === "sui-to-evm" ? evmAddress ?? "" : suiAccount?.address ?? "";
                setRecipient(addr);
              }}
            >
              My Address
            </Button>
            </div>
            <Input
              placeholder={direction === "sui-to-evm" ? "0x..." : "0x..."}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </div>

          {/* Auction Params */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">Auction Parameters</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    Dutch auction price decays linearly from start to floor price over the duration
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Start Price ({direction === "sui-to-evm" ? "ETH" : "SUI"})
                </Label>
                <Input
                  type="number"
                  placeholder="0.00095"
                  value={startPrice}
                  onChange={(e) => setStartPrice(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Floor Price ({direction === "sui-to-evm" ? "ETH" : "SUI"})
                </Label>
                <Input
                  type="number"
                  placeholder="0.00045"
                  value={floorPrice}
                  onChange={(e) => setFloorPrice(e.target.value)}
                />
              </div>
            </div>
            
            {floorPrice && !isNaN(parseFloat(floorPrice)) && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Minimum receive: {" "}
                <span className="font-mono font-medium text-foreground">
                  {parseFloat(floorPrice).toFixed(6)} {direction === "sui-to-evm" ? "ETH" : "SUI"}
                </span>
              </p>
            )}
          </div>

          {/* Duration */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" />
              Duration
            </Label>
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="3600"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="flex-1"
              />
              <div className="flex gap-1">
                {["300", "1800", "3600"].map((sec) => (
                  <Button
                    key={sec}
                    variant="outline"
                    size="sm"
                    className="px-2 text-xs cursor-pointer"
                    onClick={() => setDuration(sec)}
                  >
                    {parseInt(sec) >= 3600 ? `${parseInt(sec) / 3600}h` : `${parseInt(sec) / 60}m`}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Status */}
          {status.type !== "idle" && (
            <div
              className={`rounded-lg p-3 text-sm ${
                status.type === "success"
                  ? "bg-green-500/10 text-green-600 border border-green-500/20"
                  : status.type === "error"
                  ? "bg-destructive/10 text-destructive border border-destructive/20"
                  : "bg-muted border"
              }`}
            >
              <div className="flex items-start gap-2">
                {status.type === "loading" && <Loader2 className="h-4 w-4 animate-spin mt-0.5" />}
                {status.type === "success" && <CheckCircle2 className="h-4 w-4 mt-0.5" />}
                {status.type === "error" && <AlertCircle className="h-4 w-4 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{status.message}</p>
                {status.txHash && (
                  <a
                    href={`https://suiscan.xyz/testnet/tx/${status.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline truncate block mt-1 hover:no-underline cursor-pointer"
                  >
                      {status.txHash.slice(0, 20)}...{status.txHash.slice(-8)}
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex-col gap-3">
          <Button
            className="w-full h-11 text-base font-medium cursor-pointer"
            disabled={!canSubmit || isLoading}
            onClick={direction === "sui-to-evm" ? handleSuiToEvm : handleEvmToSui}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : !canSubmit ? (
              <>
                <Wallet className="mr-2 h-4 w-4" />
                Connect {direction === "sui-to-evm" ? "Sui" : "EVM"} Wallet
              </>
            ) : (
              <>
                Create Bridge Intent
                <ArrowUpRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
          
          <p className="text-xs text-muted-foreground text-center">
            Powered by Wormhole • Dutch Auction Settlement
          </p>
        </CardFooter>
      </Card>
    </TooltipProvider>
  );
}
