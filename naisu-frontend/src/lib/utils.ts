// ── Time ──────────────────────────────────────────────────────────────────────

export function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return "just now";
  const diff = Date.now() - timestamp;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < 86400000) {
    const h = Math.floor(diff / 3600000);
    return `${h} hour${h > 1 ? "s" : ""} ago`;
  }
  if (diff < 172800000) return "yesterday";
  const d = new Date(timestamp);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

export function formatAbsoluteTime(timestamp: number | undefined): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const isToday = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  if (isToday) return time;
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${day}, ${time}`;
}

// ── Numbers & Amounts ─────────────────────────────────────────────────────────

export function secondsAgo(timestamp: number): number {
  return Math.floor((Date.now() - timestamp) / 1000);
}

export function fmtRate(rate: number | null | undefined): string {
  if (rate == null) return "—";
  return rate >= 1000
    ? rate.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : rate.toFixed(4).replace(/\.?0+$/, "");
}

export function fmtUsd(usd: number | null | undefined): string {
  if (usd == null) return "";
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function fmtNumber(value: number, decimals = 2): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

export function fmtPercentageChange(change: number): string {
  return `${change >= 0 ? "+" : ""}${(change * 100).toFixed(2)}%`;
}

// ── Token / Raw ───────────────────────────────────────────────────────────────

export function rawToUi(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";
  const n = Number(BigInt(raw)) / 10 ** decimals;
  return n < 0.0001 ? n.toExponential(4) : n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function uiToRaw(ui: string, decimals: number): string {
  const [whole, fraction = ""] = ui.split(".");
  return `${whole}${fraction.padEnd(decimals, "0").slice(0, decimals)}`;
}

export function lamportsToSol(lamports: string): string {
  return rawToUi(lamports, 9);
}

export function solToLamports(sol: string): string {
  return uiToRaw(sol, 9);
}

export function fmtCrypto(amount: string, decimals: number, displayDecimals = 4): string {
  return fmtNumber(parseFloat(rawToUi(amount, decimals).replace(/,/g, "")), displayDecimals);
}

// ── Addresses & Hashes ────────────────────────────────────────────────────────

export function fmtAddress(address: string, start = 6, end = 4): string {
  if (!address || address.length <= start + end) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

export function fmtTxHash(hash: string): string {
  return fmtAddress(hash, 10, 8);
}

// ── Input ─────────────────────────────────────────────────────────────────────

export function parseTokenInput(input: string): string {
  let cleaned = input.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length > 2) cleaned = parts[0] + "." + parts.slice(1).join("");
  if (cleaned.length > 1 && cleaned.startsWith("0") && !cleaned.startsWith("0.")) {
    cleaned = cleaned.replace(/^0+/, "");
  }
  return cleaned;
}
