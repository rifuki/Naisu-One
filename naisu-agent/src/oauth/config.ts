import { env } from "../config/env.js";
import type { OAuthConfig } from "./types.js";

// Default Kimi OAuth endpoints (these are placeholders - actual endpoints may vary)
const KIMI_OAUTH_AUTH_URL = "https://kimi.com/oauth/authorize";
const KIMI_OAUTH_TOKEN_URL = "https://kimi.com/oauth/token";
const KIMI_OAUTH_USERINFO_URL = "https://kimi.com/oauth/userinfo";

export function getOAuthConfig(): OAuthConfig {
  return {
    enabled: env.OAUTH_ENABLED === "true",
    provider: env.OAUTH_PROVIDER,
    clientId: env.OAUTH_CLIENT_ID ?? undefined,
    clientSecret: env.OAUTH_CLIENT_SECRET ?? undefined,
    redirectUri: env.OAUTH_REDIRECT_URI ?? undefined,
    authUrl: env.OAUTH_AUTH_URL ?? (env.OAUTH_PROVIDER === "kimi" ? KIMI_OAUTH_AUTH_URL : undefined),
    tokenUrl: env.OAUTH_TOKEN_URL ?? (env.OAUTH_PROVIDER === "kimi" ? KIMI_OAUTH_TOKEN_URL : undefined),
    userinfoUrl: env.OAUTH_USERINFO_URL ?? (env.OAUTH_PROVIDER === "kimi" ? KIMI_OAUTH_USERINFO_URL : undefined)
  };
}

export function isOAuthConfigured(): boolean {
  const config = getOAuthConfig();
  return (
    config.enabled &&
    !!config.clientId &&
    !!config.clientSecret &&
    !!config.redirectUri &&
    !!config.authUrl &&
    !!config.tokenUrl
  );
}
