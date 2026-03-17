export interface ApiKey {
  /** Unique identifier for the key */
  id: string;
  /** Hashed key value (never store plaintext) */
  keyHash: string;
  /** Key prefix for identification (e.g., "sk-prod-abc123") */
  keyPrefix: string;
  /** Human-readable name for the key */
  name: string;
  /** Optional description */
  description: string | undefined;
  /** Permissions - array of allowed route patterns or ["*"] for all */
  permissions: string[];
  /** When the key was created */
  createdAt: string;
  /** When the key expires (optional) */
  expiresAt: string | undefined;
  /** Last time the key was used */
  lastUsedAt: string | undefined;
  /** Whether the key is active */
  isActive: boolean;
  /** Created by which admin key (master key id or "env") */
  createdBy: string;
}

export interface ApiKeyCreateInput {
  name: string;
  description: string | undefined;
  permissions: string[] | undefined;
  expiresInDays: number | undefined;
}

export interface ApiKeyCreateResult {
  /** The full API key (shown only once at creation) */
  key: string;
  /** The API key metadata */
  apiKey: ApiKey;
}

export interface ApiKeyListItem {
  id: string;
  keyPrefix: string;
  name: string;
  description: string | undefined;
  permissions: string[];
  createdAt: string;
  expiresAt: string | undefined;
  lastUsedAt: string | undefined;
  isActive: boolean;
}

/** Permissions constants */
export const PERMISSIONS = {
  ALL: "*",
  CHAT: "chat",
  TOOLS: "tools",
  RAG: "rag",
  OAUTH: "oauth",
  KEY_MANAGEMENT: "keys"
} as const;

/** Default permissions for new keys */
export const DEFAULT_PERMISSIONS = [
  PERMISSIONS.CHAT,
  PERMISSIONS.TOOLS,
  PERMISSIONS.RAG,
  PERMISSIONS.OAUTH
];
