/**
 * Tests for M6 Cluster 1 — client intake & AM assignment (account.ts).
 *
 * - Unit: the §3 authorization predicates (canManageAssignment / canReadIntake),
 *   plus the pre-DB input gates (empty AM, missing reason — reject before DB).
 * - Integration (skipped unless DATABASE_URL is set): assign/reassign atomicity
 *   + audit, the intake queue / workload read model, the read/write permission
 *   matrix, and the immutable-history guarantee, against a migrated Postgres.
 *   Ids namespaced `ZZ-`; afterEach deletes the clients/employees it made
 *   (audit_log is append-only, so client ids are made unique per test instead).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  approveStrategy,
  assignAM,
  canApproveStrategy,
  canManageAssignment,
  canReadIntake,
  ConflictError,
  createStrategy,
  ForbiddenError,
  getStrategy,
  guardBriefCreation,
  intakeQueue,
  listStrategies,
  NotFoundError,
  reassignAM,
  requestRevision,
  setStrategyRequirement,
  STRATEGY_STATUS_APPROVED,
  STRATEGY_STATUS_DRAFTING,
  submitStrategy,
  updateDraft,
  ValidationError,
  workload,
  type Actor,
  type StrategyInput,
} from './account';

const accountLead = (): Actor => ({
  employeeId: 'ZZ-ALEAD', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'lead' }),
});
const accountStaff = (id = 'ZZ-AM'): Actor => ({
  employeeId: id, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }),
});
const salesLead = (): Actor => ({
  employeeId: 'ZZ-SL', divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'lead' }),
});
const od = (): Actor => ({ employeeId: 'ZZ-OD', divisi: 'Management', role: permission.makeRole({ od: true }) });
const director = (): Actor => ({ employeeId: 'ZZ-DIR', divisi: 'Management', role: permission.makeRole({ director: true }) });

// ---------------------------------------------------------------------------
// Unit: §3 authorization predicates + pre-DB gates.
// ---------------------------------------------------------------------------
describe('assignment predicates (§3 Rule 2)', () => {
  it('canManageAssignment: Account Lead / Director only', () => {
    expect(canManageAssignment(accountLead())).toBe(true);
    expect(canManageAssignment(director())).toBe(true);
    expect(canManageAssignment(accountStaff())).toBe(false); // an AM is not an assigner
    expect(canManageAssignment(od())).toBe(false); // read-only everywhere
    expect(canManageAssignment(salesLead())).toBe(false); // other division
  });

  it('canReadIntake: Account Lead / OD / Director (§3 Rule 1)', () => {
    expect(canReadIntake(accountLead())).toBe(true);
    expect(canReadIntake(od())).toBe(true);
    expect(canReadIntake(director())).toBe(true);
    expect(canReadIntake(accountStaff())).toBe(false); // individual AMs cannot see the queue
    expect(canReadIntake(salesLead())).toBe(false);
  });
});

describe('pre-DB input gates', () => {
  const anySql = undefined as unknown as Sql; // never reached: gate rejects first

  it('assignAM rejects a non-assigner before any DB access', async () => {
    await expect(assignAM(anySql, accountStaff(), 'CLI-X', 'ZZ-AM')).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('assignAM rejects an empty AM id', async () => {
    await expect(assignAM(anySql, accountLead(), 'CLI-X', '  ')).rejects.toBeInstanceOf(ValidationError);
  });
  it('reassignAM rejects an empty reason', async () => {
    await expect(reassignAM(anySql, accountLead(), 'CLI-X', 'ZZ-AM', '  ')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('strategy predicates (§4 Rule 4)', () => {
  it('canApproveStrategy: Account Lead / Director only', () => {
    expect(canApproveStrategy(accountLead())).toBe(true);
    expect(canApproveStrategy(director())).toBe(true);
    expect(canApproveStrategy(accountStaff())).toBe(false); // owner AM cannot approve their own plan
    expect(canApproveStrategy(od())).toBe(false);
    expect(canApproveStrategy(salesLead())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration (real Postgres).
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

let seq = 0;
/** A fresh client id per call — audit_log is append-only, so ids never repeat. */
const nextClientId = (): string => `CLI-ZZ-${Date.now() % 100000}-${seq++}`;

/** Births a client with a controllable release state (created_by 'ZZ-…' for cleanup). */
async function insertClient(id: string, released: boolean): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', ${released ? sql`now()` : null}, 'ZZ-TEST')`;
}

/** Seeds an active Account-division AM (employee + role mapping) validateAMCandidate accepts. */
async function registerAM(id: string): Promise<void> {
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${'AM ' + id}, ${id + '@mea.id'}, 'Account', 'ZZ-AM', true, 'ZZ-TEST')
    on conflict (employee_id) do nothing`;
  await sql`
    insert into role_mappings (divisi, jabatan, division, level, created_by)
    values ('Account', 'ZZ-AM', 'Account', 'staff', 'ZZ-TEST')
    on conflict (divisi, jabatan) do nothing`;
}

const assignedAm = async (clientId: string): Promise<string | null> =>
  (await sql<{ assigned_am_id: string | null }[]>`select assigned_am_id from clients where id = ${clientId}`)[0]
    ?.assigned_am_id ?? null;

const auditActions = async (entityId: string): Promise<string[]> =>
  (await sql<{ action: string }[]>`
    select action from audit_log where entity_type = 'client' and entity_id = ${entityId} order by id desc`)
    .map((r) => r.action);

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from strategy_plans where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from employees where created_by like 'ZZ-%'`;
  await sql`delete from role_mappings where created_by like 'ZZ-%'`;
});

// --- Cluster 2 fixtures ---

let svcSeq = 0;
const nextSvcId = (): string => `SVC-ZZ-${Date.now() % 100000}-${svcSeq++}`;

/** Points a client's assigned_am_id directly (bypasses assignAM to keep tests terse). */
async function setAM(clientId: string, amId: string): Promise<void> {
  await sql`update clients set assigned_am_id = ${amId} where id = ${clientId}`;
}

/** Births a service row with a controllable plan-gate flag + status. */
async function insertService(svcId: string, clientId: string, requiresPlan: boolean, status: string): Promise<void> {
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
      standard_price, commission_rule, status, requires_strategy_plan, created_by)
    values (${svcId}, ${clientId}, 'MSV-X', 1, 'TikTok Shop Full Management', '10000000.00', 'rule',
      ${status}, ${requiresPlan}, 'ZZ-TEST')`;
}

/** released client + owner AM + plan-gated awaiting service. Returns the ids. */
async function planGatedFixture(): Promise<{ clientId: string; svcId: string; amId: string }> {
  const clientId = nextClientId();
  const svcId = nextSvcId();
  const amId = 'ZZ-SINTA';
  await insertClient(clientId, true);
  await setAM(clientId, amId);
  await insertService(svcId, clientId, true, '[Awaiting Onboarding]');
  return { clientId, svcId, amId };
}

const goodInput = (): StrategyInput => ({
  objective: 'grow GMV 30% in 60 days', targetKpi: 'GMV +30%',
  divisionsInvolved: ['Creative', 'Ads'], plannedBriefOutline: '12 videos, 2 campaigns',
  timelineStart: '2026-07-01', timelineEnd: '2026-08-30',
});

const svcStatus = async (svcId: string): Promise<string> =>
  (await sql<{ status: string }[]>`select status from services where id = ${svcId}`)[0].status;

describeDb('assignAM (§3 Rules 2–4)', () => {
  it('assigns a released, unassigned client; writes the pointer + one audit row', async () => {
    const id = nextClientId();
    await insertClient(id, true);
    await registerAM('ZZ-SINTA');

    const res = await assignAM(sql, accountLead(), id, 'ZZ-SINTA');
    expect(res.assignedAm).toBe('ZZ-SINTA');
    expect(res.assignedBy).toBe('ZZ-ALEAD');
    expect(await assignedAm(id)).toBe('ZZ-SINTA');
    expect(await auditActions(id)).toEqual(['am_assigned']);
  });

  it('§3 Rule 2 authority: only Account Lead / Director may assign', async () => {
    await registerAM('ZZ-SINTA');
    const allow: [string, Actor][] = [['account lead', accountLead()], ['director', director()]];
    for (const [, actor] of allow) {
      const id = nextClientId();
      await insertClient(id, true);
      await expect(assignAM(sql, actor, id, 'ZZ-SINTA')).resolves.toBeTruthy();
    }
    const deny: Actor[] = [accountStaff('ZZ-SINTA'), od(), salesLead()];
    for (const actor of deny) {
      const id = nextClientId();
      await insertClient(id, true);
      await expect(assignAM(sql, actor, id, 'ZZ-SINTA')).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('a pre-release or missing client is invisible (not-found)', async () => {
    const pre = nextClientId();
    await insertClient(pre, false);
    await registerAM('ZZ-SINTA');
    await expect(assignAM(sql, accountLead(), pre, 'ZZ-SINTA')).rejects.toBeInstanceOf(NotFoundError);
    await expect(assignAM(sql, accountLead(), 'CLI-GHOST-000', 'ZZ-SINTA')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('exactly one AM at a time (M6-OA-6): a second assign is a conflict', async () => {
    const id = nextClientId();
    await insertClient(id, true);
    await registerAM('ZZ-SINTA');
    await registerAM('ZZ-RANI');
    await assignAM(sql, accountLead(), id, 'ZZ-SINTA');
    await expect(assignAM(sql, accountLead(), id, 'ZZ-RANI')).rejects.toBeInstanceOf(ConflictError);
  });

  it('the assignee must be an active Account staff', async () => {
    const id = nextClientId();
    await insertClient(id, true);
    // A Sales employee — not an Account AM.
    await sql`insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values ('ZZ-SALES', 'Sales Guy', 'sg@mea.id', 'Sales', 'ZZ-SALESJAB', true, 'ZZ-TEST')`;
    await sql`insert into role_mappings (divisi, jabatan, division, level, created_by)
      values ('Sales', 'ZZ-SALESJAB', 'Sales', 'staff', 'ZZ-TEST') on conflict do nothing`;
    // An inactive Account employee.
    await sql`insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values ('ZZ-EXAM', 'Ex AM', 'ex@mea.id', 'Account', 'ZZ-AM', false, 'ZZ-TEST')`;
    await sql`insert into role_mappings (divisi, jabatan, division, level, created_by)
      values ('Account', 'ZZ-AM', 'Account', 'staff', 'ZZ-TEST') on conflict do nothing`;

    for (const am of ['ZZ-SALES', 'ZZ-EXAM', 'ZZ-UNKNOWN']) {
      await expect(assignAM(sql, accountLead(), id, am)).rejects.toBeInstanceOf(ValidationError);
    }
  });
});

describeDb('reassignAM (§3 Rule 3)', () => {
  it('reason mandatory, target valid + different, pointer moved, second audit row', async () => {
    const id = nextClientId();
    await insertClient(id, true);
    await registerAM('ZZ-SINTA');
    await registerAM('ZZ-RANI');
    await assignAM(sql, accountLead(), id, 'ZZ-SINTA');

    await expect(reassignAM(sql, accountLead(), id, 'ZZ-RANI', '  ')).rejects.toBeInstanceOf(ValidationError);
    await expect(reassignAM(sql, accountLead(), id, 'ZZ-SINTA', 'cuti')).rejects.toBeInstanceOf(ConflictError);

    const res = await reassignAM(sql, accountLead(), id, 'ZZ-RANI', 'Sinta cuti panjang');
    expect(res.previousAm).toBe('ZZ-SINTA');
    expect(res.assignedAm).toBe('ZZ-RANI');
    expect(res.reason).toBe('Sinta cuti panjang');
    expect(await assignedAm(id)).toBe('ZZ-RANI');
    expect(await auditActions(id)).toEqual(['am_reassigned', 'am_assigned']); // newest first
  });

  it('reassigning an unassigned client is a conflict', async () => {
    const id = nextClientId();
    await insertClient(id, true);
    await registerAM('ZZ-RANI');
    await expect(reassignAM(sql, accountLead(), id, 'ZZ-RANI', 'alasan')).rejects.toBeInstanceOf(ConflictError);
  });
});

describeDb('intakeQueue + workload (§3 Rule 1 / Rule 5)', () => {
  it('only released+unassigned clients show; assigning removes them; read gate enforced', async () => {
    const pre = nextClientId();
    const q1 = nextClientId();
    const q2 = nextClientId();
    await insertClient(pre, false); // never in queue
    await insertClient(q1, true); // stays in queue
    await insertClient(q2, true); // leaves queue on assign
    await registerAM('ZZ-SINTA');
    await assignAM(sql, accountLead(), q2, 'ZZ-SINTA');

    const q = await intakeQueue(sql, accountLead());
    const ids = q.map((r) => r.clientId);
    expect(ids).toContain(q1);
    expect(ids).not.toContain(q2);
    expect(ids).not.toContain(pre);

    for (const a of [od(), director()]) {
      await expect(intakeQueue(sql, a)).resolves.toBeTruthy();
    }
    for (const a of [accountStaff('ZZ-SINTA'), salesLead()]) {
      await expect(intakeQueue(sql, a)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('workload counts active clients per AM, highest first; same read gate', async () => {
    const c1 = nextClientId();
    const c2 = nextClientId();
    const c3 = nextClientId();
    await insertClient(c1, true);
    await insertClient(c2, true);
    await insertClient(c3, true);
    await registerAM('ZZ-SINTA');
    await registerAM('ZZ-RANI');
    await assignAM(sql, accountLead(), c1, 'ZZ-SINTA');
    await assignAM(sql, accountLead(), c2, 'ZZ-SINTA');
    await assignAM(sql, accountLead(), c3, 'ZZ-RANI');

    const wl = await workload(sql, accountLead());
    const sinta = wl.find((w) => w.amEmployeeId === 'ZZ-SINTA');
    const rani = wl.find((w) => w.amEmployeeId === 'ZZ-RANI');
    expect(sinta?.activeClientCount).toBe(2);
    expect(rani?.activeClientCount).toBe(1);
    // Highest first: Sinta (2) sorts before Rani (1).
    expect(wl.findIndex((w) => w.amEmployeeId === 'ZZ-SINTA'))
      .toBeLessThan(wl.findIndex((w) => w.amEmployeeId === 'ZZ-RANI'));

    await expect(workload(sql, accountStaff('ZZ-SINTA'))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describeDb('assignment history is immutable', () => {
  it('the am_assigned audit row cannot be updated or deleted', async () => {
    const id = nextClientId();
    await insertClient(id, true);
    await registerAM('ZZ-SINTA');
    await assignAM(sql, accountLead(), id, 'ZZ-SINTA');

    const [{ id: auditId }] = await sql<{ id: string }[]>`
      select id from audit_log where entity_id = ${id} and action = 'am_assigned' limit 1`;
    await expect(sql`update audit_log set action = 'tampered' where id = ${auditId}`).rejects.toBeTruthy();
    await expect(sql`delete from audit_log where id = ${auditId}`).rejects.toBeTruthy();
  });
});

// ===========================================================================
// Cluster 2 — Strategy & Plan (§2 / §4).
// ===========================================================================

/** Drafts a strategy owned by amID for svcID. */
async function createDrafted(svcId: string, amId = 'ZZ-SINTA') {
  return createStrategy(sql, accountStaff(amId), svcId, goodInput());
}
/** Drafts + submits a strategy (→ [Strategy Submitted for Approval]). */
async function createSubmitted(svcId: string, amId = 'ZZ-SINTA') {
  const st = await createDrafted(svcId, amId);
  await submitStrategy(sql, accountStaff(amId), st.id);
  return st;
}

describeDb('createStrategy (§4 Rules 1, 6)', () => {
  it('drafts a plan-gated service; divisions canonicalized; one create audit row', async () => {
    const { svcId, amId } = await planGatedFixture();
    const st = await createDrafted(svcId, amId);
    expect(st.status).toBe(STRATEGY_STATUS_DRAFTING);
    expect(st.serviceId).toBe(svcId);
    expect(st.divisionsInvolved).toEqual(['Creative', 'Ads']);
    expect(st.id).toMatch(/^STR-\d{6}-\d{4}$/);
    const actions = (await sql<{ action: string }[]>`
      select action from audit_log where entity_type='strategy_plan' and entity_id=${st.id}`).map((r) => r.action);
    expect(actions).toEqual(['create']);
  });

  it('only the owning AM (or Director) may draft (§4 Rule 1)', async () => {
    const { clientId } = await planGatedFixture();
    const allow: Actor[] = [accountStaff('ZZ-SINTA'), director()];
    for (const actor of allow) {
      const svc = nextSvcId();
      await insertService(svc, clientId, true, '[Awaiting Onboarding]');
      await expect(createStrategy(sql, actor, svc, goodInput())).resolves.toBeTruthy();
    }
    const deny: Actor[] = [accountStaff('ZZ-OTHER'), accountLead(), salesLead(), od()];
    for (const actor of deny) {
      const svc = nextSvcId();
      await insertService(svc, clientId, true, '[Awaiting Onboarding]');
      await expect(createStrategy(sql, actor, svc, goodInput())).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('guards: direct service, non-awaiting service, missing service', async () => {
    const { clientId } = await planGatedFixture();
    const direct = nextSvcId();
    await insertService(direct, clientId, false, '[Awaiting Onboarding]');
    await expect(createStrategy(sql, accountStaff('ZZ-SINTA'), direct, goodInput())).rejects.toBeInstanceOf(ConflictError);
    const late = nextSvcId();
    await insertService(late, clientId, true, '[Strategy Approved]');
    await expect(createStrategy(sql, accountStaff('ZZ-SINTA'), late, goodInput())).rejects.toBeInstanceOf(ConflictError);
    await expect(createStrategy(sql, accountStaff('ZZ-SINTA'), 'SVC-GHOST-0', goodInput())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('is 1:1 — a second create is a conflict', async () => {
    const { svcId, amId } = await planGatedFixture();
    await createDrafted(svcId, amId);
    await expect(createStrategy(sql, accountStaff(amId), svcId, goodInput())).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects invalid input and mints no STR- id', async () => {
    const { svcId, amId } = await planGatedFixture();
    const missing = { ...goodInput(), objective: '  ' };
    await expect(createStrategy(sql, accountStaff(amId), svcId, missing)).rejects.toBeInstanceOf(ValidationError);
    const badDiv = { ...goodInput(), divisionsInvolved: ['Creative', 'Finance'] };
    await expect(createStrategy(sql, accountStaff(amId), svcId, badDiv)).rejects.toBeInstanceOf(ValidationError);
    const reversed = { ...goodInput(), timelineStart: '2026-08-30', timelineEnd: '2026-07-01' };
    await expect(createStrategy(sql, accountStaff(amId), svcId, reversed)).rejects.toBeInstanceOf(ValidationError);
    const n = await sql<{ n: string }[]>`select count(*) as n from strategy_plans where service_id = ${svcId}`;
    expect(Number(n[0].n)).toBe(0);
  });
});

describeDb('updateDraft + submit (§4 Rule 3)', () => {
  it('owner edits in draft; non-owner denied; edit after submit is a conflict', async () => {
    const { svcId, amId } = await planGatedFixture();
    const st = await createDrafted(svcId, amId);
    await expect(updateDraft(sql, accountStaff('ZZ-OTHER'), st.id, goodInput())).rejects.toBeInstanceOf(ForbiddenError);
    await updateDraft(sql, accountStaff(amId), st.id, { ...goodInput(), objective: 'revised objective' });
    expect((await getStrategy(sql, accountStaff(amId), st.id)).objective).toBe('revised objective');
    await submitStrategy(sql, accountStaff(amId), st.id);
    await expect(updateDraft(sql, accountStaff(amId), st.id, goodInput())).rejects.toBeInstanceOf(ConflictError);
  });

  it('submit is owner-only and returns an ok transition result', async () => {
    const { svcId, amId } = await planGatedFixture();
    const st = await createDrafted(svcId, amId);
    await expect(submitStrategy(sql, accountStaff('ZZ-OTHER'), st.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(submitStrategy(sql, accountLead(), st.id)).rejects.toBeInstanceOf(ForbiddenError);
    const res = await submitStrategy(sql, accountStaff(amId), st.id);
    expect(res.ok).toBe(true);
  });
});

describeDb('approveStrategy (§4 Rule 4 double transition)', () => {
  it('approval flips STR + parent Service to Approved in one tx, records approvedBy', async () => {
    const { svcId, amId } = await planGatedFixture();
    const st = await createSubmitted(svcId, amId);
    await approveStrategy(sql, accountLead(), st.id);
    const got = await getStrategy(sql, accountLead(), st.id);
    expect(got.status).toBe(STRATEGY_STATUS_APPROVED);
    expect(got.approvedBy).toBe('ZZ-ALEAD');
    expect(await svcStatus(svcId)).toBe('[Strategy Approved]');
  });

  it('only Account Lead / Director may approve', async () => {
    const { clientId } = await planGatedFixture();
    const allow: Actor[] = [accountLead(), director()];
    const deny: Actor[] = [accountStaff('ZZ-SINTA'), salesLead(), od()];
    for (const actor of allow) {
      const svc = nextSvcId();
      await insertService(svc, clientId, true, '[Awaiting Onboarding]');
      const st = await createSubmitted(svc);
      await expect(approveStrategy(sql, actor, st.id)).resolves.toBeUndefined();
    }
    for (const actor of deny) {
      const svc = nextSvcId();
      await insertService(svc, clientId, true, '[Awaiting Onboarding]');
      const st = await createSubmitted(svc);
      await expect(approveStrategy(sql, actor, st.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('approving a still-drafting plan is blocked and moves nothing', async () => {
    const { svcId, amId } = await planGatedFixture();
    const st = await createDrafted(svcId, amId); // still Drafting
    await expect(approveStrategy(sql, accountLead(), st.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await svcStatus(svcId)).toBe('[Awaiting Onboarding]');
  });
});

describeDb('requestRevision (§4 Rule 4) — derived revision count', () => {
  it('notes mandatory, AM denied, lead sends back to Drafting; count derives from the log', async () => {
    const { svcId, amId } = await planGatedFixture();
    const st = await createSubmitted(svcId, amId);
    await expect(requestRevision(sql, accountLead(), st.id, '  ')).rejects.toBeInstanceOf(ValidationError);
    await expect(requestRevision(sql, accountStaff(amId), st.id, 'fix KPI')).rejects.toBeInstanceOf(ForbiddenError);
    await requestRevision(sql, accountLead(), st.id, 'target KPI kurang spesifik');
    let got = await getStrategy(sql, accountLead(), st.id);
    expect(got.status).toBe(STRATEGY_STATUS_DRAFTING);
    expect(got.revisionNotes).toBe('target KPI kurang spesifik');
    expect(got.revisionCount).toBe(1);
    // Resubmit + revise again → count derives to 2.
    await submitStrategy(sql, accountStaff(amId), st.id);
    await requestRevision(sql, accountLead(), st.id, 'sekali lagi');
    got = await getStrategy(sql, accountLead(), st.id);
    expect(got.revisionCount).toBe(2);
  });
});

describeDb('strategy visibility (§3) + immutable history', () => {
  it('get: owner/lead/OD/director allowed, other AM forbidden', async () => {
    const { svcId, amId } = await planGatedFixture();
    const st = await createDrafted(svcId, amId);
    for (const a of [accountStaff(amId), accountLead(), od(), director()]) {
      await expect(getStrategy(sql, a, st.id)).resolves.toBeTruthy();
    }
    await expect(getStrategy(sql, accountStaff('ZZ-OTHER'), st.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('list: lead sees all, owner AM sees own, other AM sees none, sales forbidden', async () => {
    const { svcId, amId } = await planGatedFixture();
    await createDrafted(svcId, amId);
    expect((await listStrategies(sql, accountLead())).length).toBeGreaterThanOrEqual(1);
    const ownerList = await listStrategies(sql, accountStaff(amId));
    expect(ownerList.every((s) => s.serviceId === svcId || s.status)).toBe(true);
    expect(ownerList.length).toBe(1);
    expect((await listStrategies(sql, accountStaff('ZZ-OTHER'))).length).toBe(0);
    await expect(listStrategies(sql, salesLead())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('the create audit row cannot be updated or deleted', async () => {
    const { svcId, amId } = await planGatedFixture();
    const st = await createDrafted(svcId, amId);
    const [{ id: auditId }] = await sql<{ id: string }[]>`
      select id from audit_log where entity_id = ${st.id} and action = 'create' limit 1`;
    await expect(sql`update audit_log set action='tampered' where id = ${auditId}`).rejects.toBeTruthy();
    await expect(sql`delete from audit_log where id = ${auditId}`).rejects.toBeTruthy();
  });
});

describeDb('guardBriefCreation (§6) + setStrategyRequirement (M6-OA-1)', () => {
  it('gates Brief creation by effective plan flag + service status', async () => {
    const { clientId } = await planGatedFixture();
    const gated = nextSvcId();
    await insertService(gated, clientId, true, '[Awaiting Onboarding]');
    await expect(guardBriefCreation(sql, gated)).rejects.toBeInstanceOf(ConflictError);
    const ok = nextSvcId();
    await insertService(ok, clientId, true, '[Strategy Approved]');
    await expect(guardBriefCreation(sql, ok)).resolves.toBeUndefined();
    const direct = nextSvcId();
    await insertService(direct, clientId, false, '[Awaiting Onboarding]');
    await expect(guardBriefCreation(sql, direct)).resolves.toBeUndefined();
    await expect(guardBriefCreation(sql, 'SVC-GHOST-0')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('override flips a Direct service to plan-gated (reason logged); then a plan can be drafted', async () => {
    const { clientId } = await planGatedFixture();
    const svc = nextSvcId();
    await insertService(svc, clientId, false, '[Awaiting Onboarding]'); // Direct by pin
    await expect(setStrategyRequirement(sql, accountStaff('ZZ-SINTA'), svc, true, '  ')).rejects.toBeInstanceOf(ValidationError);
    const req = await setStrategyRequirement(sql, accountStaff('ZZ-SINTA'), svc, true, 'butuh strategi khusus');
    expect(req.requiresStrategyPlan).toBe(true);
    expect(req.pinnedRequirement).toBe(false);
    expect(req.overridden).toBe(true);
    // Now guard blocks (effective plan-gated) and a plan can be drafted.
    await expect(guardBriefCreation(sql, svc)).rejects.toBeInstanceOf(ConflictError);
    await expect(createStrategy(sql, accountStaff('ZZ-SINTA'), svc, goodInput())).resolves.toBeTruthy();
    // Audit before→after captured.
    const a = await sql<{ before_json: { requires_strategy_plan: boolean }; after_json: { reason: string } }[]>`
      select before_json, after_json from audit_log
      where entity_id = ${svc} and action = 'strategy_requirement_override' order by id desc limit 1`;
    expect(a[0].before_json.requires_strategy_plan).toBe(false);
    expect(a[0].after_json.reason).toBe('butuh strategi khusus');
  });

  it('override is owner-AM/lead/director only, awaiting-only, and rejected once a plan exists', async () => {
    const { clientId } = await planGatedFixture();
    const svc = nextSvcId();
    await insertService(svc, clientId, false, '[Awaiting Onboarding]');
    await expect(setStrategyRequirement(sql, accountStaff('ZZ-OTHER'), svc, true, 'x')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setStrategyRequirement(sql, od(), svc, true, 'x')).rejects.toBeInstanceOf(ForbiddenError);
    // Lead may; then a plan exists → further override rejected.
    await setStrategyRequirement(sql, accountLead(), svc, true, 'butuh strategi');
    await createStrategy(sql, accountStaff('ZZ-SINTA'), svc, goodInput());
    await expect(setStrategyRequirement(sql, accountLead(), svc, false, 'batal')).rejects.toBeInstanceOf(ConflictError);
    // Non-awaiting service → conflict.
    const late = nextSvcId();
    await insertService(late, clientId, false, '[Strategy Approved]');
    await expect(setStrategyRequirement(sql, accountLead(), late, true, 'x')).rejects.toBeInstanceOf(ConflictError);
  });
});
