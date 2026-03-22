'use strict';

/**
 * Watch SSE stream for a gasless intent, print progress, resolve when terminal event received.
 *
 * Flow:
 *   Phase 1 — wait for gasless_resolved (user-scoped, filtered by intentId)
 *             → learn contractOrderId (the on-chain EVM order ID)
 *   Phase 2 — filter by contractOrderId, wait for terminal solver event
 *
 * Terminal events: sol_sent, vaa_ready, settled, failed, cancelled, expired
 */

const http  = require('http');
const https = require('https');

const TERMINAL   = new Set(['sol_sent', 'vaa_ready', 'settled', 'failed', 'cancelled', 'expired']);
const TIMEOUT_MS = 5 * 60 * 1000; // 5 min

/**
 * @param {string} backendUrl
 * @param {string} intentId    - backend intentId from submit-signature response
 * @param {string} user        - creator EVM address (for ?user= param)
 */
function watchOrder(backendUrl, intentId, user) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backendUrl}/api/v1/intent/watch`);
    url.searchParams.set('user', user);
    const mod = url.protocol === 'https:' ? https : http;

    let contractOrderId = null; // set after gasless_resolved
    let currentEvent    = null; // current SSE event name
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
      path:     url.pathname + url.search,
      headers:  { Accept: 'text/event-stream' },
    }, res => {
      let buf = '';
      res.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop(); // keep incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) { currentEvent = null; continue; } // blank line = event separator
          if (trimmed.startsWith(':')) continue;           // SSE comment / keep-alive

          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
            continue;
          }

          if (trimmed.startsWith('data:')) {
            const raw  = trimmed.slice(5).trim();
            const step = currentEvent; // SSE event name is the step name
            try {
              const ev        = JSON.parse(raw);
              const evOrderId = ev.orderId || ev.order_id;

              // ── Phase 1: waiting for gasless_resolved ───────────────────────
              if (!contractOrderId) {
                if (
                  step === 'gasless_resolved' &&
                  evOrderId &&
                  evOrderId.toLowerCase() === intentId.toLowerCase()
                ) {
                  contractOrderId = ev.contractOrderId || evOrderId;
                  console.log(`  gasless_resolved  contractOrderId=${contractOrderId}`);
                }
                continue; // ignore all other events until we have contractOrderId
              }

              // ── Phase 2: filter by contractOrderId ──────────────────────────
              if (!evOrderId || evOrderId.toLowerCase() !== contractOrderId.toLowerCase()) continue;

              const sig = ev.txHash || ev.txSignature || ev.tx || ev.sig || '';
              const label = {
                sol_sent:     '  Solana tx sent     ',
                vaa_ready:    '  VAA ready          ',
                settled:      '  ✓ Settled          ',
                execute_sent: '  EVM tx sent        ',
                failed:       '  ✗ Failed           ',
                cancelled:    '  ✗ Cancelled        ',
                expired:      '  ✗ Expired          ',
              }[step] ?? `  ${step}`;

              console.log(`${label}${sig ? `  tx: ${sig}` : ''}`);
              if (ev.error) console.log(`  error: ${ev.error}`);

              if (TERMINAL.has(step)) done({ step, sig, ev });
            } catch {
              // non-JSON data line, ignore
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
