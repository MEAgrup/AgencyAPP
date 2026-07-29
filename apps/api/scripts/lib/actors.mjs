/**
 * Shared actor resolution for the C-03 cutover smoke scripts.
 *
 * WHY THIS EXISTS
 * ---------------
 * The C-03 scripts used to bake employee ids into their source, and that is
 * exactly what produced **SKIP-3** in `CUTOVER_UAT_REPORT_20260728`:
 * `auth-smoke` asserted `/me` with a cookie minted for `EMP-202607-0001` — a
 * row that exists in the live project (69 employees) but not in the 10-row
 * `supabase/seed.sql` roster, so `/me` answered 401 and the check was written
 * off as environment noise.
 *
 * The mirror image of that defect was still latent and would have bitten the
 * moment C-03 was finally run against the deployment, which is the one thing
 * HANDOFF_CUTOVER_SESI9 §1 asks for: `cutover-houserules-walk` hardcodes the
 * SEED ids (`EMP-0001` … `EMP-0009`), none of which exist in live. Its lead
 * registration writes `sales_pemegang`, so against the deployment those checks
 * would have failed on a foreign key, not on a house rule.
 *
 * Both are one class of defect: **actor identity was a source constant instead
 * of something resolved from the environment under test.** This module removes
 * the class. Scripts ask for a ROLE SLOT; the slot is filled from whichever
 * environment `BASE` points at.
 *
 * RESOLUTION ORDER (first hit wins, per slot)
 *   1. `SMOKE_ACTOR_<SLOT>=EMP-…`  — owner-supplied override, always wins.
 *   2. discovery — `GET /admin/employees` joined to `GET /admin/role-mappings`
 *      on HRIS `(divisi, jabatan)` → CDPS `(division, level)`; pick an ACTIVE
 *      employee whose REAL mapped role matches the slot. `director`/`od` slots
 *      prefer a holder in `GET /admin/layered-roles`.
 *   3. seed fallback — the `supabase/seed.sql` roster, so the local sandbox
 *      flow keeps working with no env at all.
 *
 * Slots never share an employee: the O37 cross-scope check is only meaningful
 * if the Finance actor is a different person from the Sales one.
 *
 * Discovery reads with a self-signed bootstrap Director token. That is not a
 * privilege hole: minting any token here already requires
 * `SUPABASE_JWT_SECRET`. `canReadAdmin` and RLS `jwt_can_read_all()` both gate
 * on the `director`/`od` CLAIM, not on an employees row, so the bootstrap id
 * deliberately need not exist — it is a sentinel, and it is never used to
 * write anything.
 */
import { createHmac } from 'node:crypto';

/** The six role slots the C-03 scripts exercise, with their nominal claims. */
export const SLOTS = {
  sales_staff: { division: 'Sales', level: 'staff' },
  sales_lead: { division: 'Sales', level: 'lead' },
  account_staff: { division: 'Account', level: 'staff' },
  finance_staff: { division: 'Finance', level: 'staff' },
  director: { division: 'Management', level: 'lead', director: true },
  od: { division: 'Management', level: 'lead', od: true },
};

/** `supabase/seed.sql` roster — the last resort, and the local-sandbox default. */
export const SEED_FALLBACK = {
  sales_staff: 'EMP-0001', // Budi Santoso   — Sales / Sales Executive
  sales_lead: 'EMP-0006', // Dewi Anggraini — Sales / Sales Head
  account_staff: 'EMP-0002', // Sinta Rahma    — Account / Account Manager
  finance_staff: 'EMP-0007', // Fajar Nugroho  — Finance / Finance Staff
  director: 'EMP-0008', // Yohan Saputra  — layered director
  od: 'EMP-0009', // Nerissa Arviana — layered director (no OD row in seed)
};

/** Sentinel id for the discovery-only bootstrap token (never written anywhere). */
export const BOOTSTRAP_EMPLOYEE_ID = 'EMP-SMOKE-BOOTSTRAP';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/**
 * Signs an HS256 GoTrue-shaped access token carrying the five CDPS claims.
 * Same technique the scripts used inline; centralised so every script mints
 * tokens identically.
 */
export function signToken(secret, { employeeId, division = '', level = '', od = false, director = false }, ttlSeconds = 3600) {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    app_metadata: { employee_id: employeeId, division, level, od, director },
  });
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}

/**
 * Request headers for a smoke call. `BYPASS` carries Vercel's
 * deployment-protection bypass token, without which a protected deployment
 * answers every path with an HTML challenge — which reads exactly like a
 * routing 404 and would be misfiled as a path-drift FAIL.
 */
export function smokeHeaders(token, bypass = '') {
  const h = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  if (bypass) h['x-vercel-protection-bypass'] = bypass;
  return h;
}

async function getJson(base, path, token, bypass) {
  let res;
  try {
    res = await fetch(base + path, { headers: smokeHeaders(token, bypass) });
  } catch (e) {
    return { ok: false, note: `network: ${e.message}` };
  }
  const text = await res.text();
  if (!res.ok) return { ok: false, note: `HTTP ${res.status} ${text.slice(0, 120)}` };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, note: `non-JSON body: ${text.slice(0, 120)}` };
  }
}

const key = (divisi, jabatan) => `${divisi}\u001f${jabatan}`;

/**
 * Reads the target environment's roster and grades every active employee with
 * the CDPS (division, level) their HRIS (divisi, jabatan) maps to — the same
 * join `employee_claims()` performs in SQL.
 */
export async function discoverRoster({ base, secret, bypass = '', bootstrapEmployeeId = BOOTSTRAP_EMPLOYEE_ID }) {
  const boot = signToken(secret, { employeeId: bootstrapEmployeeId, director: true });
  const employees = await getJson(base, '/api/v1/admin/employees', boot, bypass);
  if (!employees.ok) return { ok: false, note: `GET /admin/employees → ${employees.note}` };
  const mappings = await getJson(base, '/api/v1/admin/role-mappings', boot, bypass);
  if (!mappings.ok) return { ok: false, note: `GET /admin/role-mappings → ${mappings.note}` };

  const grade = new Map();
  for (const m of mappings.body?.data ?? []) grade.set(key(m.divisi, m.jabatan), { division: m.division, level: m.level });

  const roster = (employees.body?.data ?? [])
    .filter((e) => e.status_aktif)
    .map((e) => ({
      employeeId: e.employee_id,
      nama: e.nama,
      divisi: e.divisi,
      jabatan: e.jabatan,
      ...(grade.get(key(e.divisi, e.jabatan)) ?? { division: '', level: '' }),
    }));

  // Layered OD/Director holders — best-effort; absence is not an error.
  const layered = await getJson(base, '/api/v1/admin/layered-roles', boot, bypass);
  const holders = { director: new Set(), od: new Set() };
  for (const r of layered.ok ? (layered.body?.data ?? []) : []) {
    if (r.enabled && holders[r.role]) holders[r.role].add(r.employee_id);
  }

  return { ok: true, roster, holders, mappingCount: grade.size };
}

/**
 * Resolves the requested slots against the environment `base` points at.
 *
 * Returns `{ actors, notes, roster }` where each actor carries its `token`, the
 * claims that token asserts, and `source` — the provenance a UAT report needs
 * to be reproducible. `synthetic: true` marks a slot whose employee exists but
 * whose real mapped role does NOT match the slot, so the claims are asserted
 * on top of them; the check still exercises the gate, but the report should say
 * so rather than imply an official Director ran it.
 */
export async function resolveActors({ base, secret, bypass = '', slots = Object.keys(SLOTS), bootstrapEmployeeId }) {
  const notes = [];
  const discovery = await discoverRoster({ base, secret, bypass, bootstrapEmployeeId });
  if (!discovery.ok) {
    notes.push(`discovery gagal (${discovery.note}) → memakai roster seed sebagai fallback`);
  } else {
    notes.push(`discovery: ${discovery.roster.length} karyawan aktif, ${discovery.mappingCount} role_mapping`);
  }
  const roster = discovery.ok ? discovery.roster : [];
  const holders = discovery.ok ? discovery.holders : { director: new Set(), od: new Set() };

  const taken = new Set();
  const actors = {};

  const claim = (slot, employeeId, source, { synthetic = false, nama = '', from = null } = {}) => {
    const spec = SLOTS[slot];
    // A discovered employee keeps their REAL mapped division/level (more
    // realistic for RLS row-scoping); layered flags come from the slot.
    const division = from?.division || spec.division;
    const level = from?.level || spec.level;
    const c = {
      employeeId,
      division,
      level,
      od: spec.od === true,
      director: spec.director === true,
    };
    taken.add(employeeId);
    actors[slot] = { slot, ...c, nama, source, synthetic, token: signToken(secret, c) };
  };

  // Pass 1 — env overrides first, so discovery cannot steal an id the owner pinned.
  for (const slot of slots) {
    const override = process.env[`SMOKE_ACTOR_${slot.toUpperCase()}`];
    if (override) {
      const hit = roster.find((r) => r.employeeId === override);
      if (!hit) notes.push(`SMOKE_ACTOR_${slot.toUpperCase()}=${override} tidak ada di roster — dipakai apa adanya`);
      claim(slot, override, 'env', { nama: hit?.nama ?? '', from: hit ?? null, synthetic: !hit });
    }
  }

  // Pass 2 — discovery: prefer an employee whose real mapped role IS the slot.
  for (const slot of slots) {
    if (actors[slot]) continue;
    const spec = SLOTS[slot];
    let hit = null;
    if (spec.director || spec.od) {
      const role = spec.director ? 'director' : 'od';
      hit = roster.find((r) => holders[role]?.has(r.employeeId) && !taken.has(r.employeeId)) ?? null;
      if (hit) {
        claim(slot, hit.employeeId, `layered:${role}`, { nama: hit.nama, from: hit });
        continue;
      }
    } else {
      hit = roster.find((r) => r.division === spec.division && r.level === spec.level && !taken.has(r.employeeId)) ?? null;
      if (hit) {
        claim(slot, hit.employeeId, 'role-match', { nama: hit.nama, from: hit });
        continue;
      }
    }
    // No role match: any active employee will do — the employee must EXIST (so
    // audit/FK writes land), the authority under test comes from the claims.
    const any = roster.find((r) => !taken.has(r.employeeId));
    if (any) {
      notes.push(`slot ${slot}: tak ada karyawan ber-role ${spec.division}/${spec.level}${spec.director ? '+director' : ''}${spec.od ? '+od' : ''} → klaim sintetis di atas ${any.employeeId}`);
      claim(slot, any.employeeId, 'synthetic', { nama: any.nama, synthetic: true });
      continue;
    }
    // Pass 3 — seed fallback (no roster at all: local sandbox, or discovery denied).
    claim(slot, SEED_FALLBACK[slot], 'seed-fallback', { synthetic: !discovery.ok });
  }

  return { actors, notes, roster };
}

/**
 * Resolves ONE actor that is guaranteed to exist in the target environment —
 * what `auth-smoke` needs for its `/me` cookie assertion. `SMOKE_EMPLOYEE_ID`
 * pins it explicitly.
 */
export async function resolveOneActor({ base, secret, bypass = '', slot = 'sales_staff' }) {
  const pinned = process.env.SMOKE_EMPLOYEE_ID;
  if (pinned) {
    const spec = SLOTS[slot];
    const claims = { employeeId: pinned, division: spec.division, level: spec.level, od: false, director: false };
    return { ...claims, slot, nama: '', source: 'env:SMOKE_EMPLOYEE_ID', synthetic: false, token: signToken(secret, claims), notes: [] };
  }
  const { actors, notes } = await resolveActors({ base, secret, bypass, slots: [slot] });
  return { ...actors[slot], notes };
}

/** One line per slot — paste-able provenance for the UAT report. */
export function describeActors(actors) {
  return Object.values(actors).map(
    (a) => `  ${a.slot.padEnd(14)} ${String(a.employeeId).padEnd(18)} ${`${a.division}/${a.level}`.padEnd(18)}` +
      `${a.director ? ' +director' : ''}${a.od ? ' +od' : ''}  [${a.source}${a.synthetic ? ', klaim sintetis' : ''}]` +
      `${a.nama ? `  ${a.nama}` : ''}`,
  );
}
