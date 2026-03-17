import crypto from "node:crypto";

export interface ApiKeyOptions {
  /** Key prefix (default: "sk") */
  prefix?: string;
  /** Random part length (default: 64) */
  length?: number;
  /** Separator character (default: "-") */
  separator?: string;
}

/**
 * Generate a secure random API key
 * 
 * Format: {prefix}-{timestamp}-{random}
 * Example: sk-ABCD1234-a1b2c3d4e5f6...
 * 
 * @param options - Configuration options
 * @returns Generated API key
 */
export function generateApiKey(options: ApiKeyOptions = {}): string {
  const {
    prefix = "sk",
    length = 64,
    separator = "-"
  } = options;

  // Use crypto for secure random generation
  const randomBytes = crypto.randomBytes(length);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let key = "";

  for (let i = 0; i < length; i++) {
    // Use modulo to map random byte to character
    key += chars.charAt(randomBytes[i]! % chars.length);
  }

  // Add timestamp segment for uniqueness and sorting
  const timestamp = Date.now().toString(36).toUpperCase();

  return `${prefix}${separator}${timestamp}${separator}${key}`;
}

/**
 * Generate multiple API keys at once
 * 
 * @param count - Number of keys to generate
 * @param options - Configuration options
 * @returns Array of generated API keys
 */
export function generateApiKeys(count: number, options: ApiKeyOptions = {}): string[] {
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    keys.push(generateApiKey(options));
  }
  return keys;
}

/**
 * Validate API key format
 * 
 * @param apiKey - API key to validate
 * @returns true if format is valid
 */
export function isValidApiKeyFormat(apiKey: string): boolean {
  // Minimum length check
  if (apiKey.length < 20) return false;

  // Should contain at least 2 separators
  const separators = apiKey.split("-").length - 1;
  if (separators < 2) return false;

  // Should start with a prefix (alphanumeric)
  const prefixMatch = apiKey.match(/^[a-zA-Z0-9]+-/);
  if (!prefixMatch) return false;

  return true;
}

/**
 * Hash an API key for storage (one-way)
 * Use this to store keys securely without keeping plaintext
 * 
 * @param apiKey - API key to hash
 * @returns SHA-256 hash
 */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Compare a plain API key with a stored hash
 * 
 * @param apiKey - Plain API key
 * @param hash - Stored hash
 * @returns true if they match
 */
export function compareApiKey(apiKey: string, hash: string): boolean {
  return hashApiKey(apiKey) === hash;
}

// CLI usage example
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("\n🗝️  API Key Generator\n");

  // Generate a default key
  const defaultKey = generateApiKey();
  console.log("Default key:", defaultKey);

  // Generate with custom prefix
  const prodKey = generateApiKey({ prefix: "prod", length: 32 });
  console.log("Production key:", prodKey);

  // Generate multiple keys
  console.log("\n5 Development keys:");
  generateApiKeys(5, { prefix: "dev" }).forEach((key, i) => {
    console.log(`  ${i + 1}. ${key}`);
  });

  console.log("\n📋 Add to your .env:");
  console.log(`API_KEY_REQUIRED=true`);
  console.log(`API_KEY=${defaultKey}`);
  console.log("");
}
