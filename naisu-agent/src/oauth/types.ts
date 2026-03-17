export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export interface OAuthUserInfo {
  id: string;
  email?: string;
  name?: string;
  avatar?: string;
  [key: string]: unknown;
}

export interface OAuthState {
  provider: string;
  redirectUrl: string;
  nonce: string;
  createdAt: number;
}

export interface OAuthConfig {
  enabled: boolean;
  provider: "kimi" | "custom";
  clientId: string | undefined;
  clientSecret: string | undefined;
  redirectUri: string | undefined;
  authUrl: string | undefined;
  tokenUrl: string | undefined;
  userinfoUrl: string | undefined;
}

export interface OAuthSession {
  userId: string;
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  userInfo?: OAuthUserInfo;
  createdAt: string;
}
