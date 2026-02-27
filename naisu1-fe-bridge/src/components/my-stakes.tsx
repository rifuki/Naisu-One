import { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
} from "@solana/web3.js";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wallet, TrendingUp, ArrowDownToLine, Loader2, RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { MOCK_STAKING_PROGRAM_ID, MOCK_STAKING_POOL_ADDRESS } from "@/lib/constants";

// ── helpers ────────────────────────────────────────────────────────────────────

async function anchorDiscriminator(ixName: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(`global:${ixName}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(hash).slice(0, 8);
}

function readU64LE(data: Uint8Array, offset: number): bigint {
  let val = 0n;
  for (let i = 0; i < 8; i++) val |= BigInt(data[offset + i]) << BigInt(i * 8);
  return val;
}

function writeU64LE(val: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(val & 0xffn);
    val >>= 8n;
  }
  return buf;
}

// ── component ─────────────────────────────────────────────────────────────────

interface StakeInfo {
  stakeAccountPda: string;
  shares: bigint;         // 1 share = 1 lamport
  poolTotalShares: bigint;
}

export function MyStakes() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [info, setInfo] = useState<StakeInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const stakingProgram = new PublicKey(MOCK_STAKING_PROGRAM_ID);
  const stakePoolPk = new PublicKey(MOCK_STAKING_POOL_ADDRESS);

  // ── fetch StakeAccount ─────────────────────────────────────────────────────

  const fetchStakeInfo = useCallback(async () => {
    if (!publicKey || !connected) { setInfo(null); return; }

    setLoading(true);
    try {
      // Derive stake_account PDA: seeds = [b"stake_account", staker_pubkey]
      const [stakeAccountPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("stake_account"), publicKey.toBuffer()],
        stakingProgram
      );

      const [accData, poolData] = await Promise.all([
        connection.getAccountInfo(stakeAccountPda),
        connection.getAccountInfo(stakePoolPk),
      ]);

      if (!accData) {
        setInfo({ stakeAccountPda: stakeAccountPda.toBase58(), shares: 0n, poolTotalShares: 0n });
        return;
      }

      // StakeAccount layout: disc(8) + staker(32) + shares(u64=8) + bump(1)
      const shares = readU64LE(new Uint8Array(accData.data), 40);

      // StakePool layout: disc(8) + authority(32) + total_shares(u64=8) + bump(1)
      const poolTotalShares = poolData
        ? readU64LE(new Uint8Array(poolData.data), 40)
        : 0n;

      setInfo({ stakeAccountPda: stakeAccountPda.toBase58(), shares, poolTotalShares });
    } catch (e) {
      console.error("fetchStakeInfo error:", e);
    } finally {
      setLoading(false);
    }
  }, [publicKey, connected, connection, stakingProgram, stakePoolPk]);

  useEffect(() => {
    fetchStakeInfo();
    const id = setInterval(fetchStakeInfo, 15000);
    return () => clearInterval(id);
  }, [fetchStakeInfo]);

  // ── withdraw all shares ────────────────────────────────────────────────────

  async function handleWithdraw() {
    if (!publicKey || !info || info.shares === 0n) return;

    setWithdrawing(true);
    try {
      const [stakeAccountPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("stake_account"), publicKey.toBuffer()],
        stakingProgram
      );

      // Instruction: withdraw(shares_to_burn: u64)
      const disc = await anchorDiscriminator("withdraw");
      const sharesData = writeU64LE(info.shares);
      const data = new Uint8Array([...disc, ...sharesData]);

      const ix = new TransactionInstruction({
        programId: stakingProgram,
        keys: [
          { pubkey: publicKey,    isSigner: true,  isWritable: true  }, // staker
          { pubkey: stakePoolPk,  isSigner: false, isWritable: true  }, // stake_pool
          { pubkey: stakeAccountPda, isSigner: false, isWritable: true }, // stake_account
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from(data),
      });

      const { blockhash } = await connection.getLatestBlockhash();
      const msg = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
      }).compileToV0Message();

      const tx = new VersionedTransaction(msg);
      const sig = await sendTransaction(tx, connection);

      await connection.confirmTransaction(sig, "confirmed");

      toast.success("Withdrawn successfully!", {
        description: `${(Number(info.shares) / 1e9).toFixed(6)} SOL returned to your wallet`,
        action: {
          label: "View",
          onClick: () =>
            window.open(
              `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
              "_blank"
            ),
        },
      });

      await fetchStakeInfo();
    } catch (e) {
      toast.error("Withdraw failed", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setWithdrawing(false);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  if (!connected || !publicKey) {
    return (
      <Card className="border-purple-500/20 bg-purple-500/5">
        <CardContent className="p-4 flex items-center gap-3 text-muted-foreground">
          <Wallet className="h-5 w-5 text-purple-400" />
          <div>
            <p className="text-sm font-medium text-foreground">My Staked SOL</p>
            <p className="text-xs">Connect Solana wallet to view stakes</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const solBalance = info ? Number(info.shares) / 1e9 : 0;
  const poolTotal = info ? Number(info.poolTotalShares) / 1e9 : 0;
  const hasStake = info && info.shares > 0n;

  return (
    <Card className="border-purple-500/20 bg-purple-500/5">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-purple-500" />
            <span className="text-sm font-semibold">My Staked SOL</span>
            <Badge variant="outline" className="text-[10px] text-purple-500 border-purple-500/30">
              Mock Staking
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 cursor-pointer"
            onClick={fetchStakeInfo}
            disabled={loading}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {loading && !info ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading stake info...
          </div>
        ) : (
          <>
            {/* Staked Balance */}
            <div className="flex items-end justify-between">
              <div>
                <p className="text-2xl font-bold font-mono">
                  {solBalance.toFixed(6)}
                </p>
                <p className="text-xs text-muted-foreground">SOL staked</p>
              </div>
              {hasStake && (
                <div className="text-right text-xs text-muted-foreground">
                  <p>Pool total</p>
                  <p className="font-mono">{poolTotal.toFixed(4)} SOL</p>
                </div>
              )}
            </div>

            {/* StakeAccount PDA */}
            {info?.stakeAccountPda && (
              <div className="rounded-md bg-muted/40 px-3 py-2">
                <p className="text-[10px] text-muted-foreground mb-0.5">StakeAccount PDA</p>
                <a
                  href={`https://explorer.solana.com/address/${info.stakeAccountPda}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-mono text-purple-500 hover:underline"
                >
                  {info.stakeAccountPda.slice(0, 12)}...{info.stakeAccountPda.slice(-8)}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {/* Withdraw button */}
            {hasStake ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full cursor-pointer border-purple-500/30 hover:border-purple-500/60 hover:bg-purple-500/10"
                onClick={handleWithdraw}
                disabled={withdrawing}
              >
                {withdrawing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ArrowDownToLine className="mr-2 h-4 w-4" />
                )}
                {withdrawing ? "Withdrawing..." : `Withdraw ${solBalance.toFixed(4)} SOL`}
              </Button>
            ) : (
              <p className="text-xs text-center text-muted-foreground py-1">
                No staked SOL yet. Bridge ETH → SOL with Auto-Stake enabled.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
