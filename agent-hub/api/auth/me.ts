import { getSessionFromRequest } from '../_auth.js';

export default async function handler(req: any, res: any) {
  const session = getSessionFromRequest(req);
  if (!session.ok) {
    return res.status(200).json({ ok: true, authenticated: false });
  }

  return res.status(200).json({ ok: true, authenticated: true, username: session.username });
}
