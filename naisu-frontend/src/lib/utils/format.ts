/**
 * Format a rate/APR value for display
 * @example
 * fmtRate(5.6789) // "5.6789"
 * fmtRate(1234.56) // "1,234.56"
 * fmtRate(null) // "—"
 */
export function fmtRate(rate: number | null | undefined): string {
  if (rate == null) return '—'
  return rate >= 1000
    ? rate.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : rate.toFixed(4).replace(/\.?0+$/, '')
}

/**
 * Format a USD amount for display
 * @example
 * fmtUsd(1234.56) // "$1,234.56"
 * fmtUsd(null) // ""
 */
export function fmtUsd(usd: number | null | undefined): string {
  if (usd == null) return ''
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

/**
 * Calculate seconds elapsed since a timestamp
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Seconds elapsed
 */
export function secondsAgo(timestamp: number): number {
  return Math.floor((Date.now() - timestamp) / 1000)
}

/**
 * Format a timestamp as relative time
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted string like "2s ago", "5m ago", "1h ago"
 */
export function formatRelativeTime(timestamp: number): string {
  const seconds = secondsAgo(timestamp)
  
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/**
 * Convert raw amount to UI display format
 * @param raw - Raw amount as string (e.g., "1000000000")
 * @param decimals - Number of decimals for the token
 * @returns Formatted string
 * @example
 * rawToUi("1000000000", 9) // "1"
 * rawToUi("1234567890", 9) // "1.23456789"
 */
export function rawToUi(raw: string, decimals: number): string {
  if (!raw || raw === '0') return '0'
  const n = Number(BigInt(raw)) / 10 ** decimals
  return n < 0.0001 ? n.toExponential(4) : n.toLocaleString(undefined, { maximumFractionDigits: 6 })
}

/**
 * Convert UI amount to raw amount
 * @param ui - UI amount (e.g., "1.5")
 * @param decimals - Number of decimals for the token
 * @returns Raw amount as string
 * @example
 * uiToRaw("1.5", 9) // "1500000000"
 */
export function uiToRaw(ui: string, decimals: number): string {
  const [whole, fraction = ''] = ui.split('.')
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals)
  return `${whole}${paddedFraction}`
}

/**
 * Convert lamports to SOL
 * @param lamports - Amount in lamports
 * @returns Formatted SOL amount
 * @example
 * lamportsToSol("1000000000") // "1"
 */
export function lamportsToSol(lamports: string): string {
  return rawToUi(lamports, 9)
}

/**
 * Convert SOL to lamports
 * @param sol - Amount in SOL
 * @returns Amount in lamports
 * @example
 * solToLamports("1.5") // "1500000000"
 */
export function solToLamports(sol: string): string {
  return uiToRaw(sol, 9)
}

/**
 * Format a number with specified decimals
 * @param value - Number to format
 * @param decimals - Number of decimal places
 * @returns Formatted string
 */
export function fmtNumber(value: number, decimals = 2): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals })
}

/**
 * Format a crypto amount with appropriate decimals
 * @param amount - Amount as string
 * @param decimals - Token decimals
 * @param displayDecimals - Number of decimals to display
 * @returns Formatted string
 */
export function fmtCrypto(
  amount: string,
  decimals: number,
  displayDecimals = 4
): string {
  const uiAmount = rawToUi(amount, decimals)
  const num = parseFloat(uiAmount.replace(/,/g, ''))
  return fmtNumber(num, displayDecimals)
}

/**
 * Format an address for display (truncate middle)
 * @param address - Full address
 * @param start - Number of chars at start
 * @param end - Number of chars at end
 * @returns Truncated address
 * @example
 * fmtAddress("0x1234567890abcdef...", 6, 4) // "0x1234...cdef"
 */
export function fmtAddress(address: string, start = 6, end = 4): string {
  if (!address || address.length <= start + end) return address
  return `${address.slice(0, start)}...${address.slice(-end)}`
}

/**
 * Format a percentage change
 * @param change - Change value (e.g., 0.05 for 5%)
 * @returns Formatted string with sign
 * @example
 * fmtPercentageChange(0.05) // "+5.00%"
 * fmtPercentageChange(-0.025) // "-2.50%"
 */
export function fmtPercentageChange(change: number): string {
  const sign = change >= 0 ? '+' : ''
  return `${sign}${(change * 100).toFixed(2)}%`
}

/**
 * Parse a token amount input, removing invalid characters
 * @param input - Raw input string
 * @returns Cleaned input string
 */
export function parseTokenInput(input: string): string {
  // Remove all non-numeric characters except dot
  let cleaned = input.replace(/[^\d.]/g, '')
  
  // Ensure only one dot
  const parts = cleaned.split('.')
  if (parts.length > 2) {
    cleaned = parts[0] + '.' + parts.slice(1).join('')
  }
  
  // Remove leading zeros (except for "0.x")
  if (cleaned.length > 1 && cleaned.startsWith('0') && !cleaned.startsWith('0.')) {
    cleaned = cleaned.replace(/^0+/, '')
  }
  
  return cleaned
}

/**
 * Format a transaction hash for display
 * @param hash - Full transaction hash
 * @returns Truncated hash
 * @example
 * fmtTxHash("0x1234567890abcdef...") // "0x1234...5678"
 */
export function fmtTxHash(hash: string): string {
  return fmtAddress(hash, 10, 8)
}
