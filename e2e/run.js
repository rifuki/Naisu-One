#!/usr/bin/env node
/**
 * Naisu E2E Test Runner
 * Simulates the full frontend bridge/stake flow without a browser.
 *
 * Usage:
 *   node run.js [scenario] [amount_eth]
 *
 * Scenarios:
 *   sol       — bridge ETH → plain SOL             (intent_type=0)
 *   marinade  — bridge ETH → Marinade mSOL          (intent_type=1)
 *   jito      — bridge ETH → Jito jitoSOL           (intent_type=4)
 *   jupsol    — bridge ETH → Jupiter jupSOL         (intent_type=5)
 *   kamino    — bridge ETH → Kamino kSOL            (intent_type=6)
 *   all       — run all scenarios sequentially
 *
 * Default: marinade 0.0001
 *
 * Flow (identical to frontend):
 *   1. GET  /api/v1/intent/nonce
 *   2. POST /api/v1/intent/build-gasless  → get prices
 *   3. EIP-712 sign locally
 *   4. POST /api/v1/intent/submit-signature
 *   5. SSE  /api/v1/intent/watch          → monitor until terminal event
 */

'use strict';

require('dotenv').config({ path: __dirname + '/.env' });

const { privToAddress, domainSeparator, structHash, sign, solanaPubkeyToBytes32 } = require('./lib/eip712');
const { get, post } = require('./lib/http');
const { watchOrder } = require('./lib/sse');

// ── Config ────────────────────────────────────────────────────────────────────

const EVM_PRIV        = process.env.EVM_PRIVATE_KEY;
const SOL_RECIPIENT   = process.env.SOLANA_RECIPIENT || 'GeEac43TsWaPpEnEGQXtia4C2TJGJBx1GT4Troz4Vkrh';
const BACKEND         = (process.env.BACKEND_URL || 'http://localhost:3939').replace(/\/$/, '');
const DURATION        = parseInt(process.env.DURATION_SECONDS || '600', 10);

const CHAIN_ID        = 84532n;  // Base Sepolia
const CONTRACT        = '0x26B7E5af3F1831ca938444c02CecFeBBb86F748e';
const DEST_CHAIN_SOL  = 1;

const DOMAIN = { name: 'NaisuIntentBridge', version: '1', chainId: CHAIN_ID, verifyingContract: CONTRACT };
const DOM_SEP = domainSeparator(DOMAIN);

// ── Scenario map ──────────────────────────────────────────────────────────────

const SCENARIOS = {
  sol:      { intentType: 0, outputToken: 'sol',     label: 'plain SOL' },
  marinade: { intentType: 1, outputToken: 'msol',    label: 'Marinade mSOL' },
  jito:     { intentType: 4, outputToken: 'jito',    label: 'Jito jitoSOL' },
  jupsol:   { intentType: 5, outputToken: 'jupsol',  label: 'Jupiter jupSOL' },
  kamino:   { intentType: 6, outputToken: 'kamino',  label: 'Kamino kSOL' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEP  = '─'.repeat(55);
const SEP2 = '━'.repeat(55);

function log(msg)  { console.log(msg); }
function ok(msg)   { console.log(`  ✅ ${msg}`); }
function err(msg)  { console.log(`  ❌ ${msg}`); }
function step(n, total, msg) { console.log(`  [${n}/${total}] ${msg}`); }

// ── Core flow ─────────────────────────────────────────────────────────────────

async function runScenario(scenarioKey, amountEth) {
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioKey}. Valid: ${Object.keys(SCENARIOS).join(', ')}`);

  const creator = privToAddress(EVM_PRIV);

  log('');
  log(SEP2);
  log(`  Naisu E2E — ${scenario.label}`);
  log(SEP2);
  log(`  creator   : ${creator}`);
  log(`  recipient : ${SOL_RECIPIENT}`);
  log(`  amount    : ${amountEth} ETH`);
  log(`  backend   : ${BACKEND}`);
  log(SEP);

  // ── Step 1: nonce ────────────────────────────────────────────────────────────
  step(1, 4, 'Fetching nonce...');
  const nonceRes = await get(`${BACKEND}/api/v1/intent/nonce?address=${creator}`);
  if (nonceRes.status !== 200) throw new Error(`Nonce failed (${nonceRes.status}): ${JSON.stringify(nonceRes.body)}`);
  const nonce = nonceRes.body?.data?.nonce ?? nonceRes.body?.nonce ?? 0;
  log(`         nonce = ${nonce}`);

  // ── Step 2: build-gasless ────────────────────────────────────────────────────
  step(2, 4, 'Building intent (fetching prices)...');
  const buildRes = await post(`${BACKEND}/api/v1/intent/build-gasless`, {
    senderAddress:    creator,
    recipientAddress: SOL_RECIPIENT,
    destinationChain: 'solana',
    amount:           String(amountEth),
    durationSeconds:  DURATION,
    outputToken:      scenario.outputToken,
  });
  if (buildRes.status !== 200) throw new Error(`build-gasless failed (${buildRes.status}): ${JSON.stringify(buildRes.body)}`);
  const d = buildRes.body.data;
  log(`         startPrice = ${d.startPrice} lamports`);
  log(`         floorPrice = ${d.floorPrice} lamports`);
  if (d.fromUsd) log(`         fromUsd     = $${d.fromUsd}`);
  if (d.toUsd)   log(`         toUsd       = $${d.toUsd}`);

  // ── Step 3: sign ─────────────────────────────────────────────────────────────
  step(3, 4, 'Signing EIP-712...');
  const amountWei  = BigInt(Math.round(amountEth * 1e18)).toString();
  const deadline   = Math.floor(Date.now() / 1000) + DURATION;
  const recipientHex = solanaPubkeyToBytes32(SOL_RECIPIENT);

  const intent = {
    creator,
    recipient:        recipientHex,
    destinationChain: DEST_CHAIN_SOL,
    amount:           amountWei,
    startPrice:       d.startPrice,
    floorPrice:       d.floorPrice,
    deadline,
    intentType:       scenario.intentType,
    nonce,
  };

  const signature = sign(EVM_PRIV, DOM_SEP, structHash(intent));
  log(`         sig = ${signature.slice(0, 22)}...${signature.slice(-6)}`);

  // ── Step 4: submit ───────────────────────────────────────────────────────────
  step(4, 4, 'Submitting to backend...');
  const submitRes = await post(`${BACKEND}/api/v1/intent/submit-signature`, { intent, signature });

  if (submitRes.status !== 200 && submitRes.status !== 201) {
    err(`submit-signature failed (${submitRes.status})`);
    log(JSON.stringify(submitRes.body, null, 2));
    return { success: false, scenario: scenarioKey };
  }

  const intentId = submitRes.body?.data?.intentId || submitRes.body?.intentId;
  ok(`Intent submitted!`);
  if (intentId) log(`         intentId = ${intentId}`);
  log('');

  // ── Step 5: watch SSE ────────────────────────────────────────────────────────
  if (!intentId) {
    log('  ⚠  No intentId in response — skipping SSE watch');
    log(JSON.stringify(submitRes.body, null, 2));
    return { success: true, scenario: scenarioKey };
  }

  log(`  Watching SSE for progress (${DURATION}s timeout)...`);
  log(`  (waiting for gasless_resolved, then solver events...)`);
  log(SEP);
  try {
    const result = await watchOrder(BACKEND, intentId, creator);
    log(SEP);
    if (['sol_sent', 'vaa_ready', 'settled', 'filled', 'sol_confirmed'].includes(result.step)) {
      ok(`Bridge complete! step=${result.step}`);
      if (result.sig) log(`  Solana tx : https://explorer.solana.com/tx/${result.sig}?cluster=devnet`);
    } else {
      err(`Terminal event: ${result.step}`);
      if (result.ev?.error) log(`  error: ${result.ev.error}`);
    }
    return { success: true, step: result.step, scenario: scenarioKey };
  } catch (e) {
    log(SEP);
    err(`SSE watch error: ${e.message}`);
    return { success: false, scenario: scenarioKey };
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!EVM_PRIV) {
    console.error('Error: EVM_PRIVATE_KEY not set in e2e/.env');
    process.exit(1);
  }

  const scenarioArg = process.argv[2] || 'marinade';
  const amountEth   = parseFloat(process.argv[3] || '0.0001');

  // Health check
  try {
    const h = await get(`${BACKEND}/health`);
    if (h.status !== 200) throw new Error(`HTTP ${h.status}`);
  } catch (e) {
    console.error(`Backend not reachable at ${BACKEND}: ${e.message}`);
    process.exit(1);
  }

  if (scenarioArg === 'all') {
    const results = [];
    for (const key of Object.keys(SCENARIOS)) {
      try {
        const r = await runScenario(key, amountEth);
        results.push(r);
      } catch (e) {
        console.error(`  ✗ ${key} threw: ${e.message}`);
        results.push({ success: false, scenario: key, error: e.message });
      }
      // Small gap between scenarios
      await new Promise(r => setTimeout(r, 2000));
    }

    log('');
    log(SEP2);
    log('  Results summary');
    log(SEP2);
    for (const r of results) {
      const label = SCENARIOS[r.scenario]?.label ?? r.scenario;
      const icon  = r.success ? '✅' : '❌';
      log(`  ${icon}  ${label.padEnd(20)} ${r.step ?? r.error ?? ''}`);
    }
    log(SEP2);
  } else {
    try {
      await runScenario(scenarioArg, amountEth);
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  }
}

main();
