import {
  buildSessionCookie,
  createSessionToken,
  getAdminUsername,
  getSessionMaxAgeSeconds,
  verifyAdminPassword,
} from '../_auth.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, authenticated: false, error: 'Missing credentials' });
  }

  const adminUsername = getAdminUsername();
  const validUser = username === adminUsername;
  const validPass = verifyAdminPassword(password);

  if (!validUser || !validPass) {
    return res.status(401).json({ ok: false, authenticated: false, error: 'Invalid credentials' });
  }

  const maxAge = getSessionMaxAgeSeconds();
  const token = createSessionToken(username, maxAge);
  res.setHeader('Set-Cookie', buildSessionCookie(token, maxAge));

  return res.status(200).json({ ok: true, authenticated: true, username });
}
