const API_BASE_URL = process.env.API_BASE_URL;
const MASTER_API_KEY = process.env.MASTER_API_KEY;

async function readRawBody(req: any): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  return Buffer.concat(chunks);
}

export default async function handler(req: any, res: any) {
  if (!API_BASE_URL || !MASTER_API_KEY) {
    return res.status(500).json({
      ok: false,
      error: 'Proxy is not configured',
      message: 'Missing API_BASE_URL or MASTER_API_KEY in server environment',
    });
  }

  const path = typeof req.query.path === 'string' ? req.query.path : '';
  if (!path || !path.startsWith('/')) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid path',
      message: 'Expected query param: ?path=/v1/...',
    });
  }

  const targetUrl = `${API_BASE_URL.replace(/\/$/, '')}${path}`;

  try {
    const body = await readRawBody(req);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${MASTER_API_KEY}`,
    };

    const contentType = req.headers['content-type'];
    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    const responseText = await upstream.text();

    res.status(upstream.status);

    const upstreamContentType = upstream.headers.get('content-type');
    if (upstreamContentType) {
      res.setHeader('content-type', upstreamContentType);
    }

    return res.send(responseText);
  } catch (error: any) {
    return res.status(502).json({
      ok: false,
      error: 'Proxy request failed',
      message: error?.message || 'Unknown error',
    });
  }
}
