/**
 * Unit tests for the C-03 smoke-script actor resolver.
 *
 * These lock in the fix for SKIP-3's ROOT CAUSE, not its symptom. The symptom
 * was one 401 in one report; the cause was that actor identity lived in script
 * source, so every script was pinned to whichever environment it was written
 * against (`auth-smoke` → live's `EMP-202607-0001`, the house-rules walk →
 * seed's `EMP-0001`…). A regression here is invisible at review time and only
 * shows up as a mystery FAIL during a cutover gate — exactly the failure mode
 * worth a test.
 *
 * `fetch` is stubbed: the resolver's contract is "ask the environment", and the
 * point is to prove it does so correctly for each answer the environment can
 * give (roster, denial, unreachable).
 */
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOOTSTRAP_EMPLOYEE_ID,
  SEED_FALLBACK,
  describeActors,
  discoverRoster,
  resolveActors,
  resolveOneActor,
  signToken,
  smokeHeaders,
} from './actors.mjs';

const SECRET = 'test-secret';

/** Decodes and verifies a token the way apps/api's verifyJwtHS256 does. */
function decode(token, secret = SECRET) {
  const [h, p, s] = token.split('.');
  const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return {
    valid: s === expected,
    header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')),
  };
}

const emp = (employee_id, nama, divisi, jabatan, status_aktif = true) => ({
  employee_id, nama, divisi, jabatan, status_aktif,
});

/** A roster shaped like live: real HRIS jabatan, ids in PREFIX-YYYYMM-NNNN. */
const LIVE_LIKE = {
  employees: [
    emp('EMP-202607-0007', 'Cena', 'Sales', 'Sales Executive'),
    emp('EMP-202607-0008', 'Esal', 'Sales', 'Sales Executive'),
    emp('EMP-202607-0002', 'Sales Head', 'Sales', 'Sales Head'),
    emp('EMP-202607-0003', 'AM', 'Account', 'Account Manager'),
    emp('EMP-202607-0004', 'Fin', 'Finance', 'Finance Staff'),
    emp('EMP-202607-0001', 'Yohan', 'Management', 'Director'),
    emp('EMP-202607-0099', 'Nonaktif', 'Sales', 'Sales Executive', false),
  ],
  mappings: [
    { divisi: 'Sales', jabatan: 'Sales Executive', division: 'Sales', level: 'staff' },
    { divisi: 'Sales', jabatan: 'Sales Head', division: 'Sales', level: 'lead' },
    { divisi: 'Account', jabatan: 'Account Manager', division: 'Account', level: 'staff' },
    { divisi: 'Finance', jabatan: 'Finance Staff', division: 'Finance', level: 'staff' },
    { divisi: 'Management', jabatan: 'Director', division: 'Management', level: 'lead' },
  ],
  layered: [{ employee_id: 'EMP-202607-0001', role: 'director', enabled: true }],
};

/**
 * Stubs the three admin reads discovery performs. `fixture: null` makes every
 * call fail, standing in for "gateway/deployment refuses us".
 */
function stubFetch(fixture, { status = 200 } = {}) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    if (!fixture) throw new Error('connect ECONNREFUSED');
    const path = String(url);
    const body = path.includes('/admin/employees')
      ? { data: fixture.employees }
      : path.includes('/admin/role-mappings')
        ? { data: fixture.mappings }
        : { data: fixture.layered ?? [] };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

const ENV_KEYS = [
  'SMOKE_EMPLOYEE_ID',
  ...['SALES_STAFF', 'SALES_LEAD', 'ACCOUNT_STAFF', 'FINANCE_STAFF', 'DIRECTOR', 'OD'].map((s) => `SMOKE_ACTOR_${s}`),
];
const realFetch = globalThis.fetch;

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) delete process.env[k];
});

describe('signToken', () => {
  it('mints an HS256 token carrying the five CDPS claims', () => {
    const t = signToken(SECRET, { employeeId: 'EMP-0001', division: 'Sales', level: 'staff' });
    const { valid, header, payload } = decode(t);
    expect(valid).toBe(true);
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(payload.app_metadata).toEqual({
      employee_id: 'EMP-0001', division: 'Sales', level: 'staff', od: false, director: false,
    });
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('a negative ttl yields an already-expired token (the 401 fixture)', () => {
    const { payload } = decode(signToken(SECRET, { employeeId: 'EMP-0001' }, -10));
    expect(payload.exp).toBeLessThan(Math.floor(Date.now() / 1000));
  });
});

describe('smokeHeaders', () => {
  it('omits the Vercel bypass header unless BYPASS is set', () => {
    expect(smokeHeaders('tok')).toEqual({ 'content-type': 'application/json', authorization: 'Bearer tok' });
    expect(smokeHeaders('tok', 'b')['x-vercel-protection-bypass']).toBe('b');
    expect(smokeHeaders('')).not.toHaveProperty('authorization');
  });
});

describe('discoverRoster', () => {
  it('grades active employees by joining role_mappings on (divisi, jabatan)', async () => {
    stubFetch(LIVE_LIKE);
    const r = await discoverRoster({ base: 'https://x', secret: SECRET });
    expect(r.ok).toBe(true);
    expect(r.mappingCount).toBe(5);
    // The inactive employee is dropped: a deactivated HRIS row has no CDPS access.
    expect(r.roster.map((e) => e.employeeId)).not.toContain('EMP-202607-0099');
    expect(r.roster.find((e) => e.employeeId === 'EMP-202607-0002')).toMatchObject({
      division: 'Sales', level: 'lead',
    });
    expect(r.holders.director.has('EMP-202607-0001')).toBe(true);
  });

  it('discovers with a director-claim bootstrap token, and never writes', async () => {
    const calls = stubFetch(LIVE_LIKE);
    await discoverRoster({ base: 'https://x', secret: SECRET });
    expect(calls.every((c) => c.url.includes('/api/v1/admin/'))).toBe(true);
    const bearer = calls[0].headers.authorization.replace('Bearer ', '');
    const { valid, payload } = decode(bearer);
    expect(valid).toBe(true);
    // director:true is what canReadAdmin + RLS jwt_can_read_all() gate on; the
    // id is a sentinel precisely because no employees row is required to READ.
    expect(payload.app_metadata.director).toBe(true);
    expect(payload.app_metadata.employee_id).toBe(BOOTSTRAP_EMPLOYEE_ID);
  });

  it('reports a denial instead of pretending the roster is empty', async () => {
    stubFetch(LIVE_LIKE, { status: 403 });
    const r = await discoverRoster({ base: 'https://x', secret: SECRET });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/admin\/employees.*403/);
  });
});

describe('resolveActors — discovery', () => {
  it('fills every slot from the environment, never from source constants', async () => {
    stubFetch(LIVE_LIKE);
    const { actors } = await resolveActors({ base: 'https://x', secret: SECRET });
    expect(actors.sales_staff.employeeId).toBe('EMP-202607-0007');
    expect(actors.sales_lead).toMatchObject({ employeeId: 'EMP-202607-0002', division: 'Sales', level: 'lead' });
    expect(actors.account_staff.employeeId).toBe('EMP-202607-0003');
    expect(actors.finance_staff.employeeId).toBe('EMP-202607-0004');
    // Not one seed id leaked through — the regression that made the walk
    // unrunnable against the deployment.
    const ids = Object.values(actors).map((a) => a.employeeId);
    expect(ids.some((id) => Object.values(SEED_FALLBACK).includes(id))).toBe(false);
    for (const a of Object.values(actors)) expect(decode(a.token).valid).toBe(true);
  });

  it('prefers a layered holder for the director slot', async () => {
    stubFetch(LIVE_LIKE);
    const { actors } = await resolveActors({ base: 'https://x', secret: SECRET });
    expect(actors.director).toMatchObject({ employeeId: 'EMP-202607-0001', source: 'layered:director', director: true });
    expect(actors.director.od).toBe(false);
  });

  it('gives each slot a DISTINCT employee, so the O37 cross-scope check is real', async () => {
    stubFetch(LIVE_LIKE);
    const { actors } = await resolveActors({ base: 'https://x', secret: SECRET });
    const ids = Object.values(actors).map((a) => a.employeeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('falls back to a synthetic claim on a REAL employee when no role matches, and says so', async () => {
    stubFetch(LIVE_LIKE);
    const { actors, notes } = await resolveActors({ base: 'https://x', secret: SECRET });
    // The fixture has no `od` layered row (mirrors live, where O26 is unresolved).
    expect(actors.od.synthetic).toBe(true);
    expect(actors.od.od).toBe(true);
    // …but the employee still EXISTS, which is what audit/FK writes require.
    expect(LIVE_LIKE.employees.map((e) => e.employee_id)).toContain(actors.od.employeeId);
    expect(notes.join(' ')).toMatch(/slot od.*sintetis/);
  });

  it('resolves only the slots asked for', async () => {
    stubFetch(LIVE_LIKE);
    const { actors } = await resolveActors({ base: 'https://x', secret: SECRET, slots: ['director'] });
    expect(Object.keys(actors)).toEqual(['director']);
  });
});

describe('resolveActors — env overrides', () => {
  it('an override wins over discovery and is not stolen by another slot', async () => {
    stubFetch(LIVE_LIKE);
    process.env.SMOKE_ACTOR_SALES_STAFF = 'EMP-202607-0008';
    const { actors } = await resolveActors({ base: 'https://x', secret: SECRET });
    expect(actors.sales_staff).toMatchObject({ employeeId: 'EMP-202607-0008', source: 'env' });
    expect(Object.values(actors).filter((a) => a.employeeId === 'EMP-202607-0008')).toHaveLength(1);
  });

  it('flags an override that is absent from the roster rather than failing silently', async () => {
    stubFetch(LIVE_LIKE);
    process.env.SMOKE_ACTOR_FINANCE_STAFF = 'EMP-TIDAK-ADA';
    const { actors, notes } = await resolveActors({ base: 'https://x', secret: SECRET });
    expect(actors.finance_staff).toMatchObject({ employeeId: 'EMP-TIDAK-ADA', synthetic: true });
    expect(notes.join(' ')).toMatch(/EMP-TIDAK-ADA tidak ada di roster/);
  });
});

describe('resolveActors — unreachable environment', () => {
  it('falls back to the seed roster with the failure recorded', async () => {
    stubFetch(null);
    const { actors, notes } = await resolveActors({ base: 'http://127.0.0.1:9', secret: SECRET });
    expect(notes.join(' ')).toMatch(/discovery gagal/);
    for (const [slot, id] of Object.entries(SEED_FALLBACK)) {
      expect(actors[slot]).toMatchObject({ employeeId: id, source: 'seed-fallback', synthetic: true });
    }
  });
});

describe('resolveOneActor', () => {
  it('honours SMOKE_EMPLOYEE_ID without touching the network', async () => {
    const calls = stubFetch(LIVE_LIKE);
    process.env.SMOKE_EMPLOYEE_ID = 'EMP-202607-0042';
    const a = await resolveOneActor({ base: 'https://x', secret: SECRET });
    expect(a).toMatchObject({ employeeId: 'EMP-202607-0042', source: 'env:SMOKE_EMPLOYEE_ID' });
    expect(calls).toHaveLength(0);
  });

  it('otherwise resolves a real employee — the /me check needs an existing row', async () => {
    stubFetch(LIVE_LIKE);
    const a = await resolveOneActor({ base: 'https://x', secret: SECRET });
    expect(LIVE_LIKE.employees.map((e) => e.employee_id)).toContain(a.employeeId);
    expect(a.director).toBe(false);
  });
});

describe('describeActors', () => {
  it('renders one provenance line per slot for the UAT report', async () => {
    stubFetch(LIVE_LIKE);
    const { actors } = await resolveActors({ base: 'https://x', secret: SECRET });
    const lines = describeActors(actors);
    expect(lines).toHaveLength(6);
    expect(lines.join('\n')).toMatch(/director\s+EMP-202607-0001.*\+director.*layered:director/);
  });
});
