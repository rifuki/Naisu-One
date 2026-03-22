'use strict';

/**
 * Watch SSE stream for an orderId, print progress, resolve when terminal event received.
 *
 * Terminal events: sol_confirmed, sol_sent, failed, cancelled, expired
 */

const http  = require('http');
const https = require('https');

const TERMINAL = new Set(['sol_confirmed', 'sol_sent', 'failed', 'cancelled', 'expired', 'filled']);
const TIMEOUT_MS = 5 * 60 * 1000; // 5 min

function watchOrder(backendUrl, orderId) {
  return new Promise((resolve, reject) => {
    const url    = new URL(`${backendUrl}/api/v1/intent/watch`);
    const mod    = url.protocol === 'https:' ? https : http;

    let settled = false;
    function done(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('SSE watch timeout (5 min)')); }
    }, TIMEOUT_MS);

    const req = mod.get({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      headers:  { Accept: 'text/event-stream' },
    }, res => {
      let buf = '';
      res.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop(); // keep incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue; // heartbeat / blank

          if (trimmed.startsWith('data:')) {
            const raw = trimmed.slice(5).trim();
            try {
              const ev = JSON.parse(raw);

              // Only care about events for our order
              const evOrderId = ev.orderId || ev.order_id;
              if (evOrderId && evOrderId.toLowerCase() !== orderId.toLowerCase()) continue;

              const step = ev.step || ev.type || ev.event;
              const sig  = ev.txSignature || ev.tx || ev.sig || '';

              // Print
              const label = {
                sol_sent:       '  Solana tx sent     ',
                sol_confirmed:  '  Solana tx confirmed',
                failed:         '  ✗ Failed           ',
                cancelled:      '  ✗ Cancelled        ',
                expired:        '  ✗ Expired          ',
                filled:         '  ✓ Filled           ',
              }[step] ?? `  ${step}`;

              console.log(`${label}${sig ? `  tx: ${sig}` : ''}`);
              if (ev.error) console.log(`  error: ${ev.error}`);

              if (TERMINAL.has(step)) done({ step, sig, ev });
            } catch {
              // non-JSON line, ignore
            }
          }
        }
      });
      res.on('end', () => { if (!settled) done({ step: 'stream_ended' }); });
      res.on('error', reject);
    });

    req.on('error', reject);
  });
}

module.exports = { watchOrder };
