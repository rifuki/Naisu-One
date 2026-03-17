import { randomBytes, createHash } from "node:crypto";
import type { OAuthStore } from "./store.js";
import type { 
  OAuthConfig, 
  OAuthState, 
  OAuthTokenResponse, 
  OAuthUserInfo,
  OAuthSession 
} from "./types.js";
import { getOAuthConfig, isOAuthConfigured } from "./config.js";

export class OAuthService {
  private config: OAuthConfig;

  constructor(private readonly store: OAuthStore) {
    this.config = getOAuthConfig();
  }

  isEnabled(): boolean {
    return isOAuthConfigured();
  }

  /**
   * Generate authorization URL for OAuth flow
   */
  async generateAuthUrl(redirectUrl: string = "/"): Promise<{ url: string; state: string }> {
    if (!this.isEnabled()) {
      throw new Error("OAuth is not configured");
    }

    const state = this.generateState();
    const nonce = randomBytes(16).toString("hex");
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    const stateData: OAuthState = {
      provider: this.config.provider,
      redirectUrl,
      nonce,
      createdAt: Date.now()
    };

    // Store code verifier with state (for PKCE)
    await this.store.saveState(state, { ...stateData, codeVerifier } as OAuthState & { codeVerifier: string });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId!,
      redirect_uri: this.config.redirectUri!,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      scope: "openid profile email"
    });

    const url = `${this.config.authUrl}?${params.toString()}`;
    return { url, state };
  }

  /**
   * Handle OAuth callback and exchange code for tokens
   */
  async handleCallback(code: string, state: string): Promise<{ session: OAuthSession; redirectUrl: string }> {
    if (!this.isEnabled()) {
      throw new Error("OAuth is not configured");
    }

    const stateData = await this.store.getState(state);
    if (!stateData) {
      throw new Error("Invalid or expired state");
    }

    // Clean up state
    await this.store.deleteState(state);

    // Get code verifier if PKCE was used
    const codeVerifier = (stateData as unknown as { codeVerifier?: string }).codeVerifier;

    // Exchange code for tokens
    const tokens = await this.exchangeCodeForTokens(code, codeVerifier);

    // Get user info
    const userInfo = await this.getUserInfo(tokens.access_token);

    // Create session
    const sessionId = this.generateSessionId();
    const session: OAuthSession = {
      userId: userInfo.id,
      provider: this.config.provider,
      accessToken: tokens.access_token,
      userInfo,
      createdAt: new Date().toISOString()
    };
    
    if (tokens.refresh_token) {
      session.refreshToken = tokens.refresh_token;
    }
    if (tokens.expires_in) {
      session.expiresAt = Date.now() + tokens.expires_in * 1000;
    }

    await this.store.saveSession(sessionId, session);

    return { session, redirectUrl: stateData.redirectUrl };
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<OAuthSession | undefined> {
    return this.store.getSession(sessionId);
  }

  /**
   * Validate and refresh session if needed
   */
  async validateSession(sessionId: string): Promise<OAuthSession | undefined> {
    const session = await this.store.getSession(sessionId);
    if (!session) {
      return undefined;
    }

    // Check if token needs refresh
    if (session.expiresAt && Date.now() > session.expiresAt - 5 * 60 * 1000) {
      // Token expires in less than 5 minutes, try to refresh
      if (session.refreshToken) {
        try {
          const newTokens = await this.refreshTokens(session.refreshToken);
          session.accessToken = newTokens.access_token;
          if (newTokens.refresh_token) {
            session.refreshToken = newTokens.refresh_token;
          }
          if (newTokens.expires_in) {
            session.expiresAt = Date.now() + newTokens.expires_in * 1000;
          }
          await this.store.saveSession(sessionId, session);
        } catch (error) {
          // Refresh failed, session is invalid
          await this.store.deleteSession(sessionId);
          return undefined;
        }
      }
    }

    return session;
  }

  /**
   * Logout and delete session
   */
  async logout(sessionId: string): Promise<void> {
    await this.store.deleteSession(sessionId);
  }

  private generateState(): string {
    return randomBytes(32).toString("hex");
  }

  private generateSessionId(): string {
    return randomBytes(32).toString("hex");
  }

  private generateCodeVerifier(): string {
    return randomBytes(32).toString("base64url");
  }

  private generateCodeChallenge(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url");
  }

  private async exchangeCodeForTokens(code: string, codeVerifier?: string): Promise<OAuthTokenResponse> {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: this.config.clientId!,
      client_secret: this.config.clientSecret!,
      redirect_uri: this.config.redirectUri!
    });

    if (codeVerifier) {
      params.append("code_verifier", codeVerifier);
    }

    const response = await fetch(this.config.tokenUrl!, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return response.json() as Promise<OAuthTokenResponse>;
  }

  private async refreshTokens(refreshToken: string): Promise<OAuthTokenResponse> {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.config.clientId!,
      client_secret: this.config.clientSecret!
    });

    const response = await fetch(this.config.tokenUrl!, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    return response.json() as Promise<OAuthTokenResponse>;
  }

  private async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    if (!this.config.userinfoUrl) {
      // If no userinfo URL, return a placeholder based on token
      return {
        id: `oauth_${this.hashToken(accessToken).slice(0, 16)}`
      };
    }

    const response = await fetch(this.config.userinfoUrl, {
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`User info fetch failed: ${error}`);
    }

    const data = await response.json() as OAuthUserInfo;
    
    // Ensure id exists
    if (!data.id) {
      data.id = `oauth_${this.hashToken(accessToken).slice(0, 16)}`;
    }

    return data;
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
