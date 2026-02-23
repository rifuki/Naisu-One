export interface AuthMeResponse {
  ok: boolean;
  authenticated: boolean;
  username?: string;
}

export async function getAuthMe(): Promise<AuthMeResponse> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (!res.ok) return { ok: false, authenticated: false };
  return res.json();
}

export async function login(username: string, password: string): Promise<AuthMeResponse> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  const data = await res.json().catch(() => ({ ok: false, authenticated: false }));
  if (!res.ok) return { ok: false, authenticated: false };
  return data;
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  });
}
