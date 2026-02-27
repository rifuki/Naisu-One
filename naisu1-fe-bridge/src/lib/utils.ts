import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Validates if a string is a valid Sui address (32 bytes)
 * Format: 0x followed by 64 hex characters (66 total)
 */
export function isValidSuiAddress(address: string): boolean {
  if (!address) return false;
  const clean = address.startsWith("0x") ? address.slice(2) : address;
  // Sui address: 64 hex chars (32 bytes)
  return /^[0-9a-fA-F]{64}$/.test(clean);
}

/**
 * Validates if a string is a valid EVM address (20 bytes)
 * Format: 0x followed by 40 hex characters (42 total)
 */
export function isValidEvmAddress(address: string): boolean {
  if (!address) return false;
  const clean = address.startsWith("0x") ? address.slice(2) : address;
  // EVM address: 40 hex chars (20 bytes)
  return /^[0-9a-fA-F]{40}$/.test(clean);
}

/**
 * Detects if an address is likely an EVM address (20 bytes with padding)
 * This catches the padded EVM addresses like 0x0000...791a
 */
export function isPaddedEvmAddress(address: string): boolean {
  if (!address) return false;
  const clean = address.startsWith("0x") ? address.slice(2) : address;
  if (clean.length !== 64) return false;
  
  // Check if first 24 chars (12 bytes) are zeros and rest form valid EVM address
  const first24 = clean.slice(0, 24);
  const last40 = clean.slice(24);
  
  return /^0{24}$/.test(first24) && /^[0-9a-fA-F]{40}$/.test(last40);
}

/**
 * Validates if a string is a valid Solana address (base58, 32-44 characters).
 * Solana public keys are 32 bytes encoded in base58.
 */
export function isValidSolanaAddress(address: string): boolean {
  if (!address || address.length < 32 || address.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}
