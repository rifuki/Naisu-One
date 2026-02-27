import { useState, useEffect, useCallback } from "react";
import { useAccount, useSendTransaction, useBalance, useSwitchChain } from "wagmi";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { parseEther, encodeFunctionData, formatEther } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import {
  ArrowRightLeft,
  Wallet,
  TrendingUp,
  Clock,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Sparkles,
  SlidersHorizontal,
  Coins,
} from "lucide-react";
import {
  BASE_SEPOLIA_CONTRACT_ADDRESS,
  WORMHOLE_CHAIN_SOLANA,
  BASE_SEPOLIA_CHAIN_ID,
} from "@/lib/constants";
import { INTENT_BRIDGE_ABI } from "@/lib/abi";
import { isValidSolanaAddress } from "@/lib/utils";
import { toast } from "sonner";

// Direction is now fixed: Base Sepolia → Solana
export type Direction = "base-to-sol";
type PriceMode = "auto" | "manual";

interface BridgeFormProps {
  onIntentCreated?: () => void;
}

const PERCENTAGE_PRESETS = [10, 25, 50, 100];

export function BridgeFormCompact({ onIntentCreated }: BridgeFormProps) {
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [startPrice, setStartPrice] = useState("");
  const [floorPrice, setFloorPrice] = useState("");
  const [duration, setDuration] = useState("3600");
  const [priceMode, setPriceMode] = useState<PriceMode>("auto");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [autoStake, setAutoStake] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [solEthRate, setSolEthRate] = useState<number | null>(null);

  // Market rate: ETH/SOL
  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=eth")
      .then((r) => r.json())
      .then((d) => setSolEthRate(d?.solana?.eth ?? null))
      .catch(() => {});
  }, []);

  // Auto-calculate prices from amount (Base ETH → SOL)
  useEffect(() => {
    if (priceMode === "auto" && amount) {
      const val = parseFloat(amount);
      if (!isNaN(val) && val > 0 && solEthRate) {
        // 1 ETH = 1/solEthRate SOL
        const market = val / solEthRate;
        setStartPrice((market * 1.02).toFixed(6));
        setFloorPrice((market * 0.95).toFixed(6));
      } else {
        setStartPrice("");
        setFloorPrice("");
      }
    }
  }, [amount, priceMode, solEthRate]);

  // EVM (Base Sepolia)
  const { address: evmAddress, chainId: currentChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync: sendTransaction } = useSendTransaction();

  // Solana wallet (for "My Address" button)
  const { publicKey: solanaPublicKey } = useSolanaWallet();

  const { data: evmBalanceData } = useBalance({
    address: evmAddress,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    query: { enabled: !!evmAddress, refetchInterval: 10000 },
  });
  const evmBalance = evmBalanceData ? Number(formatEther(evmBalanceData.value)) : 0;

  const parsedAmount = parseFloat(amount || "0");
  const isInsufficientBalance = parsedAmount > 0 && parsedAmount > evmBalance;

  // Address validation
  const isRecipientValid = isValidSolanaAddress(recipient);
  const recipientError = recipient && !isRecipientValid
    ? "Invalid Solana address (must be base58, 32-44 chars)"
    : null;

  const canSubmit =
    !!evmAddress &&
    !isInsufficientBalance &&
    parsedAmount > 0 &&
    recipient &&
    isRecipientValid &&
    startPrice &&
    floorPrice;

  const handlePercentagePreset = useCallback((percentage: number) => {
    const gasBuffer = 0.001;
    const maxAmount = evmBalance * (1 - gasBuffer);
    const amountValue = percentage === 100 ? Math.max(0, maxAmount) : evmBalance * (percentage / 100);
    const amountStr = amountValue.toFixed(6).replace(/\.?0+$/, "");
    setAmount(amountStr);
    if (priceMode === "auto" && solEthRate) {
      const market = amountValue / solEthRate;
      setStartPrice((market * 1.02).toFixed(6));
      setFloorPrice((market * 0.95).toFixed(6));
    }
  }, [evmBalance, priceMode, solEthRate]);

  async function handleSubmit() {
    if (!evmAddress) return;

    if (!isValidSolanaAddress(recipient)) {
      toast.error("Invalid recipient address", {
        description: "Please enter a valid Solana address (base58, 32-44 characters)",
      });
      return;
    }

    // Switch to Base Sepolia if needed
    if (currentChainId !== BASE_SEPOLIA_CHAIN_ID && switchChainAsync) {
      try {
        await switchChainAsync({ chainId: BASE_SEPOLIA_CHAIN_ID });
      } catch {
        toast.error("Network switch failed");
        return;
      }
    }

    setIsLoading(true);
    try {
      const amountWei = parseEther(amount);

      // Decode base58 Solana address → 32-byte hex for bytes32 recipient
      const base58Chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
      let num = BigInt(0);
      for (const char of recipient) {
        num = num * 58n + BigInt(base58Chars.indexOf(char));
      }
      const recipientHex = `0x${num.toString(16).padStart(64, "0")}` as `0x${string}`;

      // Price in lamports (SOL smallest unit = 1e-9 SOL)
      const startPriceLamports = BigInt(Math.round(parseFloat(startPrice) * 1e9));
      const floorPriceLamports = BigInt(Math.round(parseFloat(floorPrice) * 1e9));

      const data = encodeFunctionData({
        abi: INTENT_BRIDGE_ABI,
        functionName: "createOrder",
        args: [recipientHex, WORMHOLE_CHAIN_SOLANA, startPriceLamports, floorPriceLamports, BigInt(duration)],
      });

      const hash = await sendTransaction({
        to: BASE_SEPOLIA_CONTRACT_ADDRESS as `0x${string}`,
        value: amountWei,
        data,
      });

      const stakeNote = autoStake ? " • SOL will be auto-staked" : "";
      toast.success("Order created on Base Sepolia!", {
        description: `Locked ${amount} ETH → Solana${stakeNote}`,
        action: {
          label: "View",
          onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, "_blank"),
        },
      });

      setAmount("");
      setRecipient("");
      setStartPrice("");
      setFloorPrice("");

      if (onIntentCreated) onIntentCreated();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
      toast.error("Failed to create order", { description: errorMessage });
    } finally {
      setIsLoading(false);
    }
  }

  const marketValue = parsedAmount > 0 && solEthRate ? parsedAmount / solEthRate : null;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Fixed Direction Badge */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">Base Sepolia</span>
          </div>
          <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />
            <span className="text-sm font-semibold text-purple-600 dark:text-purple-400">Solana Devnet</span>
          </div>
          <Badge variant="outline" className="text-[10px] ml-auto">~18min VAA</Badge>
        </div>

        {/* Amount */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium text-foreground/80">Amount</Label>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" />
              <span className="font-mono">{evmBalance.toFixed(4)}</span>
              <span>ETH</span>
            </div>
          </div>

          <div className="relative">
            <Input
              type="number"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`h-12 text-lg font-mono pr-16 ${isInsufficientBalance ? "border-destructive" : ""}`}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <Badge variant="secondary" className="font-medium">ETH</Badge>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="flex gap-2">
            {PERCENTAGE_PRESETS.map((p) => (
              <Button
                key={p}
                variant="outline"
                size="sm"
                className="flex-1 text-xs cursor-pointer"
                onClick={() => handlePercentagePreset(p)}
                disabled={evmBalance <= 0}
              >
                {p === 100 ? "MAX" : `${p}%`}
              </Button>
            ))}
          </div>

          {isInsufficientBalance && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              Insufficient balance
            </p>
          )}
        </div>

        {/* Market Rate */}
        {marketValue !== null && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 text-sm">
            <span className="text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" />
              Market Rate
            </span>
            <span className="font-mono font-medium">
              1 ETH ≈ {solEthRate ? (1 / solEthRate).toFixed(4) : "-"} SOL
            </span>
          </div>
        )}

        {/* Recipient */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium text-foreground/80">Recipient (Solana Address)</Label>
            {solanaPublicKey && (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto py-0 px-1 text-xs cursor-pointer"
                onClick={() => setRecipient(solanaPublicKey.toBase58())}
              >
                My Solana Address
              </Button>
            )}
          </div>
          <Input
            placeholder="Base58 address..."
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className={recipientError ? "border-destructive" : ""}
          />
          {recipientError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {recipientError}
            </p>
          )}
        </div>

        {/* Auto-Stake Toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg border bg-purple-500/5 border-purple-500/20">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-purple-500/10">
              <Coins className="h-4 w-4 text-purple-500" />
            </div>
            <div>
              <p className="text-sm font-medium">Auto-Stake SOL</p>
              <p className="text-xs text-muted-foreground">
                {autoStake
                  ? "Solver will deposit SOL into StakePool on arrival"
                  : "SOL sent directly to recipient wallet"}
              </p>
              <p className="text-[10px] text-amber-500 mt-0.5">
                Controlled by solver configuration — toggle reflects solver intent
              </p>
            </div>
          </div>
          <Switch
            checked={autoStake}
            onCheckedChange={setAutoStake}
          />
        </div>

        {/* Price Mode Toggle */}
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-primary/10">
                {priceMode === "auto" ? <Sparkles className="h-4 w-4 text-primary" /> : <SlidersHorizontal className="h-4 w-4 text-primary" />}
              </div>
              <div>
                <p className="text-sm font-medium">
                  {priceMode === "auto" ? "Auto Price" : "Manual Price"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {priceMode === "auto"
                    ? "Prices calculated from market rate"
                    : "Set your own start and floor prices"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Auto</span>
              <Switch
                checked={priceMode === "manual"}
                onCheckedChange={(checked) => {
                  setPriceMode(checked ? "manual" : "auto");
                  if (!checked && amount && solEthRate) {
                    const val = parseFloat(amount);
                    if (!isNaN(val) && val > 0) {
                      const market = val / solEthRate;
                      setStartPrice((market * 1.02).toFixed(6));
                      setFloorPrice((market * 0.95).toFixed(6));
                    }
                  }
                }}
              />
              <span className="text-xs text-muted-foreground">Manual</span>
            </div>
          </div>

          {priceMode === "auto" && marketValue !== null && (
            <div className="p-4 rounded-lg border bg-muted/20 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Start Price</span>
                <span className="font-mono text-sm">
                  {startPrice} SOL
                  <Badge variant="outline" className="text-[10px] ml-2">+2%</Badge>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Floor Price</span>
                <span className="font-mono text-sm">
                  {floorPrice} SOL
                  <Badge variant="outline" className="text-[10px] ml-2">-5%</Badge>
                </span>
              </div>
              <div className="h-px bg-border" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Market Reference</span>
                <span className="font-mono">{marketValue.toFixed(6)} SOL</span>
              </div>
            </div>
          )}

          {priceMode === "auto" && !marketValue && (
            <div className="p-4 rounded-lg border bg-muted/20 text-center text-sm text-muted-foreground">
              Enter amount to see auto-calculated prices
            </div>
          )}

          {priceMode === "manual" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Start Price (SOL)</Label>
                <Input
                  type="number"
                  placeholder="0.00095"
                  value={startPrice}
                  onChange={(e) => setStartPrice(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Floor Price (SOL)</Label>
                <Input
                  type="number"
                  placeholder="0.00045"
                  value={floorPrice}
                  onChange={(e) => setFloorPrice(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Duration */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium text-foreground/80 flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Duration
            </Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-0 px-1 text-xs cursor-pointer"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? "Hide" : "Edit"}
              {showAdvanced ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
            </Button>
          </div>

          {showAdvanced ? (
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
          ) : (
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20 text-sm">
              <span className="text-muted-foreground">Auction Duration</span>
              <span className="font-medium">
                {parseInt(duration) >= 3600
                  ? `${(parseInt(duration) / 3600).toFixed(1)} hours`
                  : `${(parseInt(duration) / 60).toFixed(0)} minutes`}
              </span>
            </div>
          )}
        </div>

        {/* Submit */}
        <Button
          className="w-full h-12 text-base font-medium cursor-pointer"
          disabled={!canSubmit || isLoading}
          onClick={handleSubmit}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : !evmAddress ? (
            <>
              <Wallet className="mr-2 h-4 w-4" />
              Connect EVM Wallet
            </>
          ) : !canSubmit ? (
            <>
              <Wallet className="mr-2 h-4 w-4" />
              Fill all fields
            </>
          ) : (
            <>
              {autoStake ? <Coins className="mr-2 h-4 w-4" /> : <ArrowUpRight className="mr-2 h-4 w-4" />}
              {autoStake ? "Bridge & Stake SOL" : "Bridge to Solana"}
            </>
          )}
        </Button>

        {autoStake && (
          <p className="text-xs text-purple-500 text-center flex items-center justify-center gap-1">
            <Coins className="h-3 w-3" />
            Solver will deposit SOL into StakePool via mock-staking CPI
          </p>
        )}

        <p className="text-xs text-muted-foreground text-center">
          Powered by Wormhole • Dutch Auction Settlement
        </p>
      </div>
    </TooltipProvider>
  );
}
