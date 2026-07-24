/**
 * HTTP auth smoke test for apps/api against a running `next start` server.
 *
 * Exercises the request-time auth gate (requireActor → verifyJwtHS256 →
 * actorFromClaims) at the real HTTP boundary. It does NOT need a database:
 * a mutation route calls requireActor() BEFORE db(), so an auth failure is a
 * clean 401 and an auth PASS surfaces as a non-401 (here 500, because
 * DATABASE_URL is deliberately unset). We assert on that 401 / not-401 split.
 *
 * Usage: BASE=http://127.0.0.1:3111 SUPABASE_JWT_SECRET=... node auth-smoke.mjs
 */
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3111';
const SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
if (!SECRET) throw new Error('SUPABASE_JWT_SECRET must be set for the smoke test');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(header, payload, secret) {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

const now = Math.floor(Date.now() / 1000);
const claims = { employee_id: 'EMP-202607-0001', division: 'Sales', level: 'staff', od: false, director: false };

const validToken = sign({ alg: 'HS256', typ: 'JWT' }, { app_metadata: claims, exp: now + 3600 }, SECRET);
const wrongSecret = sign({ alg: 'HS256', typ: 'JWT' }, { app_metadata: claims, exp: now + 3600 }, 'not-the-secret');
const expired = sign({ alg: 'HS256', typ: 'JWT' }, { app_metadata: claims, exp: now - 10 }, SECRET);
const noClaim = sign({ alg: 'HS256', typ: 'JWT' }, { app_metadata: {}, exp: now + 3600 }, SECRET);
const algNone = `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(JSON.stringify({ app_metadata: claims, exp: now + 3600 }))}.`;

const MUT = '/api/v1/leads'; // POST calls requireActor() before db()

async function res(path, init) {
  return fetch(BASE + path, init);
}
async function status(path, init) {
  return (await res(path, init)).status;
}
function post(token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return { method: 'POST', headers, body: JSON.stringify({ lead_name: 'Smoke', phone_number: '0800' }) };
}

const checks = [];
const expect = (name, got, ok) => { checks.push({ name, got, ok, pass: ok(got) }); };

// --- Bearer gate (mutation route: requireActor before db) ---
expect('healthz → 200', await status('/api/healthz'), (s) => s === 200);
expect('no token → 401', await status(MUT, post(null)), (s) => s === 401);
expect('garbage token → 401', await status(MUT, post('not.a.jwt')), (s) => s === 401);
expect('wrong-secret signature → 401', await status(MUT, post(wrongSecret)), (s) => s === 401);
expect('expired token → 401', await status(MUT, post(expired)), (s) => s === 401);
expect('alg:none (confusion) → 401', await status(MUT, post(algNone)), (s) => s === 401);
expect('valid sig, no employee_id claim → 401', await status(MUT, post(noClaim)), (s) => s === 401);
expect('valid token → auth passes (not 401)', await status(MUT, post(validToken)), (s) => s !== 401);

// --- /me: cookie-based session (auth-context hydration) ---
expect('GET /me no session → 401', await status('/api/v1/me'), (s) => s === 401);
expect('GET /me valid cookie → auth passes (not 401)',
  await status('/api/v1/me', { headers: { cookie: `cdps_access_token=${validToken}` } }),
  (s) => s !== 401);

// --- /auth/login: input validation (GoTrue exchange needs live Supabase) ---
expect('POST /auth/login empty body → 400',
  await status('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
  (s) => s === 400);

// --- /auth/logout: always clears the cookie, always 200 ---
const logout = await res('/api/v1/auth/logout', { method: 'POST' });
expect('POST /auth/logout → 200', logout.status, (s) => s === 200);
expect('POST /auth/logout clears cookie (Max-Age=0)',
  logout.headers.get('set-cookie') ?? '', (v) => /cdps_access_token=;/.test(v) && /Max-Age=0/.test(v));

let failed = 0;
for (const c of checks) {
  const mark = c.pass ? 'PASS' : 'FAIL';
  if (!c.pass) failed++;
  console.log(`[${mark}] ${c.name}  (status=${c.got})`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
