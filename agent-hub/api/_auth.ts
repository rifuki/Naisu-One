import crypto from 'crypto';

const COOKIE_NAME = 'agenthub_session';

function getSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('ADMIN_SESSION_SECRET is missing or too short (min 16 chars)');
  }
  return secret;
}

export function parseCookie(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  return cookieHeader
    .split(';')
    .map((v) => v.trim())
    .filter(Boolean)
    .reduce((acc: Record<string, string>, item) => {
      const idx = item.indexOf('=');
      if (idx <= 0) return acc;
      const k = decodeURIComponent(item.slice(0, idx));
      const v = decodeURIComponent(item.slice(idx + 1));
      acc[k] = v;
      return acc;
    }, {});
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function sign(payload: string): string {
  return base64url(
    crypto.createHmac('sha256', getSecret()).update(payload).digest()
  );
}

export function createSessionToken(username: string, maxAgeSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const payload = base64url(JSON.stringify({ u: username, exp }));
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export function verifySessionToken(token?: string): { ok: boolean; username?: string } {
  if (!token) return { ok: false };
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return { ok: false };

  const expected = sign(payload);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false };
  }

  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      u: string;
      exp: number;
    };
    if (!json?.u || !json?.exp) return { ok: false };
    if (json.exp < Math.floor(Date.now() / 1000)) return { ok: false };
    return { ok: true, username: json.u };
  } catch {
    return { ok: false };
  }
}

export function buildSessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === 'production';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; ${secure ? 'Secure;' : ''}`;
}

export function buildClearSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; ${secure ? 'Secure;' : ''}`;
}

export function getSessionFromRequest(req: any): { ok: boolean; username?: string } {
  const cookies = parseCookie(req.headers?.cookie);
  return verifySessionToken(cookies[COOKIE_NAME]);
}

export function verifyAdminPassword(input: string): boolean {
  const plain = process.env.ADMIN_PASSWORD;
  if (plain) return input === plain;

  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) return false;

  // format: scrypt$<saltHex>$<hashHex>
  const [algo, saltHex, hashHex] = hash.split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;

  const derived = crypto.scryptSync(input, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function getAdminUsername(): string {
  return process.env.ADMIN_USERNAME || 'admin';
}

export function getSessionMaxAgeSeconds(): number {
  const raw = process.env.ADMIN_SESSION_MAX_AGE_SECONDS;
  const n = raw ? Number(raw) : 60 * 60 * 8;
  if (!Number.isFinite(n) || n <= 0) return 60 * 60 * 8;
  return Math.floor(n);
}
