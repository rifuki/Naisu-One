import { buildClearSessionCookie } from '../_auth.js';

export default async function handler(_req: any, res: any) {
  res.setHeader('Set-Cookie', buildClearSessionCookie());
  return res.status(200).json({ ok: true, authenticated: false });
}
