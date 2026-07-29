/**
 * HTTP auth smoke test for apps/api against a running `next start` server — or
 * against the Vercel deployment (C-03 closes only when it is run there).
 *
 * Exercises the request-time auth gate (requireActor → verifyJwtHS256 →
 * actorFromClaims) at the real HTTP boundary. The Bearer-gate checks need no
 * database: a mutation route calls requireActor() BEFORE db(), so an auth
 * failure is a clean 401 and an auth PASS surfaces as a non-401. We assert on
 * that 401 / not-401 split.
 *
 * `/me` is the one check that DOES need a real row: it loads the employee
 * profile and answers 401 for a session whose employee no longer exists. That
 * is what made it SKIP-3 in CUTOVER_UAT_REPORT_20260728 — the id was a source
 * constant (`EMP-202607-0001`, live-only) rather than something resolved from
 * the environment under test. The identity now comes from
 * `lib/actors.mjs`: `SMOKE_EMPLOYEE_ID` if pinned, else the first active
 * employee the target environment reports, else the local seed roster.
 *
 * Usage:
 *   BASE=http://127.0.0.1:3111 SUPABASE_JWT_SECRET=... node auth-smoke.mjs
 *   BASE=https://<deployment> SUPABASE_JWT_SECRET=... [BYPASS=…] [SMOKE_EMPLOYEE_ID=EMP-…] \
 *     node apps/api/scripts/auth-smoke.mjs
 */
import { resolveOneActor, signToken, smokeHeaders } from './lib/actors.mjs';

const BASE = (process.env.BASE ?? 'http://127.0.0.1:3111').replace(/\/$/, '');
const SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const BYPASS = process.env.BYPASS ?? '';
if (!SECRET) throw new Error('SUPABASE_JWT_SECRET must be set for the smoke test');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// The actor for the happy paths — an employee that EXISTS where BASE points.
const me = await resolveOneActor({ base: BASE, secret: SECRET, bypass: BYPASS });
console.log(`BASE=${BASE}`);
for (const n of me.notes ?? []) console.log(`  note: ${n}`);
console.log(`  aktor: ${me.employeeId} (${me.division}/${me.level}) [${me.source}]\n`);

const claims = { employeeId: me.employeeId, division: me.division, level: me.level, od: false, director: false };
const validToken = me.token;
const wrongSecret = signToken('not-the-secret', claims);
const expired = signToken(SECRET, claims, -10);
const noClaim = signToken(SECRET, { employeeId: '' , division: '', level: '' });
const algNone = `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(
  JSON.stringify({ app_metadata: { employee_id: me.employeeId }, exp: Math.floor(Date.now() / 1000) + 3600 }),
)}.`;

const MUT = '/api/v1/leads'; // POST calls requireActor() before db()

async function res(path, init) {
  return fetch(BASE + path, init);
}
async function status(path, init) {
  return (await res(path, init)).status;
}
function get(extraHeaders = {}) {
  return { headers: { ...smokeHeaders('', BYPASS), ...extraHeaders } };
}
function post(token) {
  return {
    method: 'POST',
    headers: smokeHeaders(token, BYPASS),
    body: JSON.stringify({ lead_name: 'Smoke', phone_number: '0800' }),
  };
}

const checks = [];
const expect = (name, got, ok) => { checks.push({ name, got, ok, pass: ok(got) }); };

// --- Bearer gate (mutation route: requireActor before db) ---
expect('healthz → 200', await status('/api/healthz', get()), (s) => s === 200);
expect('no token → 401', await status(MUT, post(null)), (s) => s === 401);
expect('garbage token → 401', await status(MUT, post('not.a.jwt')), (s) => s === 401);
expect('wrong-secret signature → 401', await status(MUT, post(wrongSecret)), (s) => s === 401);
expect('expired token → 401', await status(MUT, post(expired)), (s) => s === 401);
expect('alg:none (confusion) → 401', await status(MUT, post(algNone)), (s) => s === 401);
expect('valid sig, no employee_id claim → 401', await status(MUT, post(noClaim)), (s) => s === 401);
expect('valid token → auth passes (not 401)', await status(MUT, post(validToken)), (s) => s !== 401);

// --- /me: cookie-based session (auth-context hydration) ---
expect('GET /me no session → 401', await status('/api/v1/me', get()), (s) => s === 401);
expect('GET /me valid cookie → auth passes (not 401)',
  await status('/api/v1/me', get({ cookie: `cdps_access_token=${validToken}` })),
  (s) => s !== 401);

// --- /auth/login: input validation (GoTrue exchange needs live Supabase) ---
expect('POST /auth/login empty body → 400',
  await status('/api/v1/auth/login', { method: 'POST', headers: smokeHeaders('', BYPASS), body: '{}' }),
  (s) => s === 400);

// --- /auth/logout: always clears the cookie, always 200 ---
const logout = await res('/api/v1/auth/logout', { method: 'POST', headers: smokeHeaders('', BYPASS) });
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
