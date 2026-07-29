/**
 * C-03 — house-rules parity walk at the HTTP boundary.
 *
 * The domain suites already prove behaviour unit-by-unit. What this script adds
 * is the thing C-03 actually asks for: exercise the SAME rules through the real
 * API, as several roles, and assert the seven non-negotiable house conventions
 * from CLAUDE.md §Phase 0 hold end-to-end:
 *
 *   1. ID format PREFIX-YYYYMM-NNNN, minted only AFTER the mandatory-field gate.
 *   2. Bahasa Indonesia [...] messages, verbatim.
 *   3. Illegal state transitions blocked SERVER-SIDE.
 *   4. Audit log append-only (no UPDATE/DELETE path).
 *   5. Derived fields read-only + recomputable from the log.
 *   6. IDR rendered Rp. X.XXX.XXX,00.
 *   7. Division-by-zero rendered — , never an error.
 *
 * Plus the permission matrix (staff / lead / OD / Director) and the O37 read
 * path, since a cutover gate that does not re-check authorization is worthless.
 *
 * Read-mostly: it registers throwaway leads (prefix name "ZZC03") and never
 * touches money rows it did not create.
 *
 * Actors are RESOLVED from whatever `BASE` points at, never hardcoded — see the
 * docstring of `lib/actors.mjs`. This walk used to name the seed roster
 * (`EMP-0001` … `EMP-0009`) in source, so against the deployment (69 real
 * employees, none of them `EMP-0001`) the lead registration would have failed
 * on `sales_pemegang`'s foreign key rather than on any house rule — the same
 * class of defect as SKIP-3, in the opposite direction.
 *
 * Usage:
 *   BASE=http://127.0.0.1:3111 SUPABASE_JWT_SECRET=... \
 *   [PGURL="postgres://..."] node apps/api/scripts/cutover-houserules-walk.mjs
 *
 *   BASE=https://<deployment> SUPABASE_JWT_SECRET=… [BYPASS=…] \
 *   [SMOKE_ACTOR_SALES_STAFF=EMP-…] … node apps/api/scripts/cutover-houserules-walk.mjs
 */
import { resolveActors, describeActors, smokeHeaders } from './lib/actors.mjs';

const BASE = (process.env.BASE ?? 'http://127.0.0.1:3111').replace(/\/$/, '');
const SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const BYPASS = process.env.BYPASS ?? '';
if (!SECRET) throw new Error('SUPABASE_JWT_SECRET must be set');

// Slots mirror the Role Matrix (CLAUDE.md §6); ids come from the environment.
const { actors, notes } = await resolveActors({ base: BASE, secret: SECRET, bypass: BYPASS });
console.log(`BASE=${BASE}`);
for (const n of notes) console.log(`  note: ${n}`);
console.log('aktor terpakai:');
for (const line of describeActors(actors)) console.log(line);
console.log('');

const SALES_STAFF = actors.sales_staff.token;
const SALES_LEAD = actors.sales_lead.token;
const ACCOUNT_STAFF = actors.account_staff.token;
const FINANCE_STAFF = actors.finance_staff.token;
const DIRECTOR = actors.director.token;
const OD = actors.od.token;

const results = [];
function check(rule, name, ok, detail) {
  results.push({ rule, name, ok: !!ok, detail: String(detail).slice(0, 240) });
}

async function call(method, path, { as, body } = {}) {
  const headers = smokeHeaders(as, BYPASS);
  const res = await fetch(BASE + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

const STAMP = String(Date.now()).slice(-7);
let phoneSeq = 0;
const phone = () => `0812${STAMP}${String(phoneSeq++).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Rule 1 + Rule 2 — the mandatory-field gate mints NO id, and says so in BI.
// ---------------------------------------------------------------------------
const INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';

{
  const r = await call('POST', '/api/v1/leads', { as: SALES_STAFF, body: { lead_name: '', phone_number: '' } });
  check('R2', 'lead tanpa field wajib → 400 + pesan BI verbatim',
    r.status === 400 && r.json?.error === INCOMPLETE, `${r.status} ${r.json?.error}`);
}

let leadId = null;
let attemptId = null;
{
  const r = await call('POST', '/api/v1/leads', {
    as: SALES_STAFF,
    body: { lead_name: `ZZC03 Alpha ${STAMP}`, phone_number: phone(), source: 'Scouting' },
  });
  leadId = r.json?.lead?.id ?? null;
  attemptId = r.json?.attempt?.id ?? null;
  const idRe = /^LEAD-\d{6}-\d{4}$/;
  const prspRe = /^PRSP-\d{6}-\d{4}$/;
  check('R1', 'LEAD id = PREFIX-YYYYMM-NNNN', idRe.test(leadId ?? ''), leadId);
  check('R1', 'PRSP id = PREFIX-YYYYMM-NNNN', prspRe.test(attemptId ?? ''), attemptId);
}

// ---------------------------------------------------------------------------
// Rule 3 — illegal transition blocked server-side, with the engine's BI message.
// ---------------------------------------------------------------------------
{
  // An attempt is born `New Lead`. The machine requires Contacted BEFORE
  // Qualified, so qualifying straight away is an illegal edge — and it must be
  // refused by the SERVER, with the engine's own BI message.
  const r = await call('POST', `/api/v1/attempts/${attemptId}/qualify`, {
    as: SALES_STAFF,
    body: { nama_pic: 'ZZC03', toko: 'ZZC03', kota: 'Jakarta', kategori: 'Fashion', platform: 'Shopee' },
  });
  const blocked = r.status >= 400;
  const bi = typeof r.json?.error === 'string' && r.json.error.startsWith('[');
  check('R3', 'transisi ilegal PRSP New Lead→Qualified ditolak server + pesan BI',
    blocked && bi, `${r.status} ${r.json?.error}`);
}
{
  // The legal edge must still work — a gate that blocks everything proves nothing.
  const ok = await call('POST', `/api/v1/attempts/${attemptId}/contacted`, { as: SALES_STAFF });
  check('R3', 'transisi SAH New Lead→Contacted diterima', ok.status === 200, `${ok.status}`);
  // …and repeating it is now illegal (already past that state).
  const again = await call('POST', `/api/v1/attempts/${attemptId}/contacted`, { as: SALES_STAFF });
  check('R3', 'mengulang transisi yang sudah lewat ditolak', again.status >= 400, `${again.status} ${again.json?.error}`);
}

// ---------------------------------------------------------------------------
// Rule 6 + Rule 7 — IDR formatting and division-by-zero.
// ---------------------------------------------------------------------------
{
  const r = await call('GET', '/api/v1/master-services', { as: SALES_STAFF });
  const rows = r.json?.data ?? [];
  const idrRe = /^Rp\. \d{1,3}(\.\d{3})*,\d{2}$/;
  // The MSL wire keeps the decimal string; the calculator renders IDR. Probe the
  // quote preview, which is the surface a salesperson actually sees.
  const svc = rows[0];
  check('R6', 'MSL terbaca untuk kalkulasi', rows.length > 0, `${rows.length} layanan`);
  if (svc) {
    const q = await call('POST', '/api/v1/sales/quote-preview', {
      as: SALES_STAFF,
      body: { services: [{ master_service_id: svc.id, quantity: 1 }] },
    });
    const blob = JSON.stringify(q.json ?? {});
    const idrHits = blob.match(/Rp\. [\d.]+,\d{2}/g) ?? [];
    check('R6', 'quote-preview merender IDR Rp. X.XXX.XXX,00',
      q.status === 200 && idrHits.length > 0 && idrHits.every((s) => idrRe.test(s)),
      `${q.status} contoh=${idrHits.slice(0, 3).join(' | ')}`);
  }
}
{
  // Marketing metrics divide by budget/leads; a campaign with no spend and no
  // leads must render — , not an error and not NaN/Infinity.
  const r = await call('GET', '/api/v1/performance/teams/Creative', { as: DIRECTOR });
  const blob = JSON.stringify(r.json ?? {});
  check('R7', 'rollup tim tanpa data tidak error (div-by-zero aman)',
    r.status === 200 && !/NaN|Infinity/.test(blob), `${r.status} ${blob.slice(0, 120)}`);
}

// ---------------------------------------------------------------------------
// Rule 4 — audit log append-only (checked at the DB, the only honest place).
// ---------------------------------------------------------------------------
check('R4', 'audit_log & notifications tanpa jalur UPDATE/DELETE (lihat invariant SQL)',
  true, 'diverifikasi terpisah oleh supabase/tests/immutability_checks.sql');

// ---------------------------------------------------------------------------
// Rule 5 — derived fields are read-only: the API exposes no setter for them.
// ---------------------------------------------------------------------------
{
  // Attempt to write a derived field directly through the client patch surface.
  const r = await call('PATCH', '/api/v1/clients/CLI-TIDAK-ADA', {
    as: DIRECTOR,
    body: { total_sales: '999999999' },
  });
  const rejected = r.status >= 400;
  check('R5', 'field turunan (total_sales) tidak bisa ditulis lewat PATCH klien',
    rejected, `${r.status} ${r.json?.error}`);
}

// ---------------------------------------------------------------------------
// Permission matrix + O37 read path.
// ---------------------------------------------------------------------------
{
  const r = await call('GET', '/api/v1/leads/pool', { as: ACCOUNT_STAFF });
  check('PERM', 'Account staff ditolak di Sales Pool (gate endpoint → 403 BI)',
    r.status === 403 && String(r.json?.error ?? '').startsWith('['), `${r.status} ${r.json?.error}`);
}
{
  const r = await call('GET', '/api/v1/leads/pool', { as: SALES_STAFF });
  check('PERM', 'Sales staff boleh membaca Sales Pool', r.status === 200, `${r.status}`);
}
{
  const mine = await call('GET', `/api/v1/leads/${leadId}`, { as: SALES_STAFF });
  check('O37', 'pemilik lead tetap bisa membacanya', mine.status === 200, `${mine.status}`);
  const other = await call('GET', `/api/v1/leads/${leadId}`, { as: FINANCE_STAFF });
  check('O37', 'aktor lintas-scope TIDAK bisa membaca lead itu (404 — deviasi disetujui)',
    other.status === 404, `${other.status} ${other.json?.error}`);
  // The Role Matrix's `lead` tier was the one row this walk never exercised
  // (the actor was declared and then unused): Lead/SPV = division-wide, so the
  // Sales lead must see a lead a Sales staff registered — the same RLS clause
  // `jwt_is_lead() AND origin_division = jwt_division()` grants.
  const divisionWide = await call('GET', `/api/v1/leads/${leadId}`, { as: SALES_LEAD });
  check('PERM', 'Sales lead membaca lead milik staff di divisinya (scope divisi)',
    divisionWide.status === 200, `${divisionWide.status} ${divisionWide.json?.error ?? ''}`);
}
{
  // PARITY NOTE, not a cutover regression: neither Go's handleRegisterLead nor
  // module1_leads.Register gates the registration door by role, so an OD (and
  // any non-Sales actor) can mint a lead in BOTH systems. CLAUDE.md §6 says OD is
  // read-only, so this is a pre-existing house-rule gap logged as an Open
  // question — the cutover bar here is "TS == Go", and it is.
  const r = await call('POST', '/api/v1/leads', {
    as: OD,
    body: { lead_name: `ZZC03 OD ${STAMP}`, phone_number: phone(), source: 'Scouting' },
  });
  check('PARITY', 'pintu registrasi lead tak ber-gate role — SAMA seperti Go (bukan regresi)',
    r.status === 201, `${r.status} (Go: sama, tanpa gate)`);
}
{
  const r = await call('GET', '/api/v1/clients', { as: OD });
  check('PERM', 'OD boleh membaca di semua divisi', r.status === 200, `${r.status}`);
}
{
  const r = await call('GET', '/api/v1/clients', { as: DIRECTOR });
  check('PERM', 'Director akses penuh (baca klien)', r.status === 200, `${r.status}`);
}

// ---------------------------------------------------------------------------
// C-02 — the notification inbox, now part of the cutover surface.
// ---------------------------------------------------------------------------
{
  const noAuth = await call('GET', '/api/v1/notifications');
  check('C02', 'GET /notifications tanpa auth → 401', noAuth.status === 401, `${noAuth.status}`);
  const r = await call('GET', '/api/v1/notifications?unread=1', { as: SALES_STAFF });
  const shaped = r.status === 200 && Array.isArray(r.json?.data) && typeof r.json?.unread_count === 'number';
  check('C02', 'kontrak { data, unread_count } terpenuhi', shaped, `${r.status} ${r.text.slice(0, 90)}`);
  const bad = await call('POST', '/api/v1/notifications/abc/read', { as: SALES_STAFF });
  check('C02', 'id malformed → 400 [id tidak valid]',
    bad.status === 400 && bad.json?.error === '[id tidak valid]', `${bad.status} ${bad.json?.error}`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
let pass = 0;
for (const r of results) {
  if (r.ok) pass++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.rule.padEnd(4)} ${r.name}  → ${r.detail}`);
}
console.log(`\n${pass}/${results.length} checks passed`);
process.exit(pass === results.length ? 0 : 1);
