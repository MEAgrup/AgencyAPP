/**
 * Wave-3 FE↔API contract smoke (M2/M3/M10/M13/M14).
 *
 * Calls EVERY endpoint the web-internal FE clients declare
 * (web-internal/src/lib/{marketing,livestream,health,performance}.ts) at the
 * real HTTP boundary and asserts the route is WIRED — i.e. the response is not
 * a Next routing-404 (path drift) and not a 405 (method drift).
 *
 * It does NOT need seeded data and does NOT write anything: GETs are read-only
 * (a bogus id yields a domain 404 "[data tidak ditemukan]", which still proves
 * the route exists); mutations are sent with an empty body so they stop at the
 * auth/validation gate (400/403/500) — never past it. A signed valid JWT is
 * used so requireActor() passes (same technique as auth-smoke.mjs).
 *
 * Usage:
 *   BASE=https://agency-app-api.vercel.app \
 *   SUPABASE_JWT_SECRET=... \
 *   [BYPASS=<vercel-protection-bypass-token>] \
 *   node apps/api/scripts/wave3-contract-smoke.mjs
 */
import { createHmac } from 'node:crypto';

const BASE = (process.env.BASE ?? 'http://127.0.0.1:3111').replace(/\/$/, '');
const SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const BYPASS = process.env.BYPASS ?? '';
if (!SECRET) throw new Error('SUPABASE_JWT_SECRET must be set for the smoke test');

const b64url = (buf) => Buffer.from(buf).toString('base64url');
function sign(header, payload, secret) {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

const now = Math.floor(Date.now() / 1000);
// Director so permission gates never mask a wired route as 403 (still PASS if
// they did, but cleaner signal this way).
const claims = { employee_id: 'EMP-202607-0001', division: 'Account', level: 'lead', od: false, director: true };
const token = sign({ alg: 'HS256', typ: 'JWT' }, { app_metadata: claims, exp: now + 3600 }, SECRET);

// Plausible-format ids (routing ignores id shape; kept realistic for logs).
const CMP = 'CMP-202607-0001';
const BRF = 'BRF-202607-0001';
const LSS = 'LSS-202607-0001';
const CLI = 'CLI-202607-0001';
const EMP = 'EMP-202607-0001';
const DIV = encodeURIComponent('Live Stream');
const PDIV = 'Creative';

// [method, path]  — mirrors the FE client call sites 1:1.
const endpoints = [
  // M2 Marketing + M3 Campaign
  ['POST', '/api/v1/marketing/campaigns'],
  ['GET', '/api/v1/marketing/campaigns'],
  ['GET', `/api/v1/marketing/campaigns/${CMP}`],
  ['GET', `/api/v1/marketing/campaigns/${CMP}/rollup`],
  ['POST', `/api/v1/marketing/campaigns/${CMP}/transition`],
  ['POST', `/api/v1/marketing/campaigns/${CMP}/reassign`],
  ['POST', `/api/v1/marketing/campaigns/${CMP}/performance`],
  ['PATCH', `/api/v1/marketing/campaigns/${CMP}/performance/budget`],
  ['GET', `/api/v1/marketing/campaigns/${CMP}/performance`],
  ['GET', '/api/v1/marketing/performance-dashboard'],
  // M10 Live Stream
  ['POST', `/api/v1/briefs/${BRF}/sessions`],
  ['GET', `/api/v1/briefs/${BRF}/sessions`],
  ['GET', `/api/v1/sessions/${LSS}`],
  ['POST', `/api/v1/sessions/${LSS}/confirm`],
  ['POST', `/api/v1/sessions/${LSS}/results`],
  ['POST', `/api/v1/sessions/${LSS}/reconcile`],
  ['POST', `/api/v1/sessions/${LSS}/flag-discrepancy`],
  ['POST', `/api/v1/briefs/${BRF}/reopen`],
  ['GET', `/api/v1/briefs/${BRF}`],
  ['GET', `/api/v1/divisions/${DIV}/brief-queue`],
  // M13 Client Health
  ['POST', '/api/v1/health/snapshots/scan'],
  ['GET', `/api/v1/clients/${CLI}/health`],
  ['GET', `/api/v1/clients/${CLI}/health/trend`],
  ['GET', `/api/v1/clients/${CLI}/health/preview`],
  ['GET', `/api/v1/clients/${CLI}/health/roas-toggle`],
  ['PUT', `/api/v1/clients/${CLI}/health/roas-toggle`],
  // M14 Team Performance
  ['POST', '/api/v1/performance/snapshots/scan'],
  ['GET', `/api/v1/staff/${EMP}/performance`],
  ['GET', `/api/v1/staff/${EMP}/performance/trend`],
  ['GET', `/api/v1/performance/teams/${PDIV}`],
  ['GET', '/api/v1/performance/config/weights'],
  ['PUT', '/api/v1/performance/config/weights'],
  ['GET', '/api/v1/performance/config/targets'],
  ['PUT', '/api/v1/performance/config/targets'],
];

function headers() {
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  if (BYPASS) h['x-vercel-protection-bypass'] = BYPASS;
  return h;
}

// A route is "wired" unless it's a Next routing-404 or a 405.
// Routing-404 sets `x-matched-path: /404` and returns no domain error body;
// a domain 404 ("[data tidak ditemukan]") goes through the handler with a JSON
// {error|message} body — that still proves the route exists.
async function checkOne(method, path) {
  const init = { method, headers: headers() };
  if (method !== 'GET') init.body = '{}';
  let res;
  try {
    res = await fetch(BASE + path, init);
  } catch (e) {
    return { path, method, status: 0, wired: false, note: `network: ${e.message}` };
  }
  const matched = res.headers.get('x-matched-path') ?? '';
  const text = await res.text();
  let domainErr = false;
  try {
    const b = JSON.parse(text);
    domainErr = b && typeof b === 'object' && (typeof b.error === 'string' || typeof b.message === 'string');
  } catch {
    /* non-JSON body */
  }
  if (res.status === 405) return { path, method, status: 405, wired: false, note: 'method not allowed (method drift)' };
  if (res.status === 404 && (matched === '/404' || !domainErr)) {
    return { path, method, status: 404, wired: false, note: 'routing 404 (path drift)' };
  }
  return { path, method, status: res.status, wired: true, note: domainErr ? 'domain response' : '' };
}

const results = [];
for (const [method, path] of endpoints) {
  // sequential to keep logs readable and avoid hammering the deployment
  results.push(await checkOne(method, path));
}

let failed = 0;
for (const r of results) {
  const mark = r.wired ? 'PASS' : 'FAIL';
  if (!r.wired) failed++;
  console.log(`[${mark}] ${r.method.padEnd(5)} ${r.path}  (status=${r.status}${r.note ? `, ${r.note}` : ''})`);
}
console.log(`\n${results.length - failed}/${results.length} endpoints wired`);
process.exit(failed === 0 ? 0 : 1);
