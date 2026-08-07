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
import { permission, statemachine } from '@cdps/core';
import { createClient, executors, type Sql } from '@cdps/db';
import {
  approveBrief,
  approveStrategy,
  assignAM,
  canApproveStrategy,
  canManageAssignment,
  canManageComplaint,
  canReadIntake,
  canSeeBrief,
  closeComplaint,
  ConflictError,
  createBrief,
  createStrategy,
  ForbiddenError,
  getBrief,
  getComplaint,
  getService,
  getStrategy,
  guardBriefCreation,
  intakeQueue,
  listClientComplaints,
  listDivisionQueue,
  listServiceBriefs,
  listStrategies,
  logComplaint,
  NotFoundError,
  reassignAM,
  requestBriefRevision,
  requestRevision,
  resolveComplaint,
  reviewBrief,
  serviceQueue,
  setStrategyRequirement,
  startComplaint,
  STRATEGY_STATUS_APPROVED,
  STRATEGY_STATUS_DRAFTING,
  submitStrategy,
  updateDraft,
  ValidationError,
  workload,
  type Actor,
  type BriefInput,
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
  // NOTE: notifications + audit_log are append-only (no-delete triggers), so they
  // are never cleaned here — test assertions filter by the unique per-test entity id.
  await sql`delete from complaints where created_by like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from strategy_plans where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
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

// --- Cluster 3/4 fixtures ---

const divisionStaff = (division: string, id: string): Actor => ({
  employeeId: id, divisi: division, role: permission.makeRole({ division, level: 'staff' }),
});

const goodBrief = (): BriefInput => ({
  title: 'Konten Promo Lebaran', assignedDivision: 'Creative', deliverableType: 'Video',
  quantityTarget: 12, dueDate: '2026-08-15', priority: 'High',
});

/** released client + owner AM + Direct awaiting service (no plan gate). */
async function directFixture(): Promise<{ clientId: string; svcId: string; amId: string }> {
  const clientId = nextClientId();
  const svcId = nextSvcId();
  await insertClient(clientId, true);
  await setAM(clientId, 'ZZ-SINTA');
  await insertService(svcId, clientId, false, '[Awaiting Onboarding]');
  return { clientId, svcId, amId: 'ZZ-SINTA' };
}

/** Drives a Brief through a brief_task edge directly (division-side, deferred to M12). */
async function driveBrief(briefId: string, to: string, actor: Actor): Promise<void> {
  const res = await statemachine.transition(executors(sql).sm, {
    machine: 'brief_task', entityType: 'brief', table: 'briefs', entityId: briefId, to, actor,
  });
  if (!res.ok) {
    throw new Error(`driveBrief ${to}: ${res.message}`);
  }
}

/** Creates a Direct Creative brief and drives it to [Submitted], ready for AM review. */
async function submittedBrief(): Promise<{ briefId: string; amId: string }> {
  const { svcId, amId } = await directFixture();
  const b = await createBrief(sql, accountStaff(amId), svcId, goodBrief());
  await driveBrief(b.id, '[In Progress]', divisionStaff('Creative', 'ZZ-C'));
  await driveBrief(b.id, '[Submitted]', divisionStaff('Creative', 'ZZ-C'));
  return { briefId: b.id, amId };
}

const briefStatus = async (id: string): Promise<string> =>
  (await sql<{ status: string }[]>`select status from briefs where id = ${id}`)[0].status;

const notifCount = async (recipient: string, event: string, entityId: string): Promise<number> =>
  Number(
    (await sql<{ n: string }[]>`
      select count(*) as n from notifications
      where recipient_employee_id = ${recipient} and event_type = ${event} and entity_id = ${entityId}`)[0].n,
  );

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

describeDb('serviceQueue + getService (§3 Rule 4 — the AM personal queue)', () => {
  it('lists the Services of the clients an AM owns, and only those', async () => {
    const { clientId, svcId, amId } = await planGatedFixture();
    // A second client, owned by a DIFFERENT AM, must not leak into this AM's queue.
    const otherClient = nextClientId();
    const otherSvc = nextSvcId();
    await insertClient(otherClient, true);
    await setAM(otherClient, 'ZZ-OTHER');
    await insertService(otherSvc, otherClient, false, '[Awaiting Onboarding]');

    const mine = await serviceQueue(sql, accountStaff(amId));
    expect(mine.map((r) => r.serviceId)).toContain(svcId);
    expect(mine.map((r) => r.serviceId)).not.toContain(otherSvc);
    expect(mine.every((r) => r.assignedAmId === amId)).toBe(true);
    const row = mine.find((r) => r.serviceId === svcId)!;
    expect(row.clientId).toBe(clientId);
    expect(row.status).toBe('[Awaiting Onboarding]');
    expect(row.briefCount).toBe(0);
    expect(row.strategyId).toBeNull(); // nothing drafted yet — the FE's first step
  });

  it('reports the EFFECTIVE plan gate, not just the MSL pin (M6-OA-1)', async () => {
    const { clientId } = await planGatedFixture();
    const svc = nextSvcId();
    await insertService(svc, clientId, false, '[Awaiting Onboarding]'); // Direct by pin
    await setStrategyRequirement(sql, accountStaff('ZZ-SINTA'), svc, true, 'butuh strategi khusus');

    const row = (await serviceQueue(sql, accountStaff('ZZ-SINTA'))).find((r) => r.serviceId === svc)!;
    expect(row.requiresStrategyPlan).toBe(true); // effective
    expect(row.pinnedRequiresStrategyPlan).toBe(false); // the immutable pin
    expect(row.overridden).toBe(true);
  });

  it('carries the Strategy status once one exists, so the UI can name the next step', async () => {
    const { svcId, amId } = await planGatedFixture();
    const st = await createDrafted(svcId, amId);
    const row = (await serviceQueue(sql, accountStaff(amId))).find((r) => r.serviceId === svcId)!;
    expect(row.strategyId).toBe(st.id);
    expect(row.strategyStatus).toBe(STRATEGY_STATUS_DRAFTING);
  });

  it('counts the Briefs under a Service', async () => {
    const { svcId } = await directFixture();
    await createBrief(sql, accountStaff('ZZ-SINTA'), svcId, goodBrief());
    const row = (await serviceQueue(sql, accountStaff('ZZ-SINTA'))).find((r) => r.serviceId === svcId)!;
    expect(row.briefCount).toBe(1);
  });

  it('lead/OD/Director see the whole division; a non-Account actor is forbidden', async () => {
    const { svcId } = await planGatedFixture();
    for (const a of [accountLead(), od(), director()]) {
      const rows = await serviceQueue(sql, a);
      expect(rows.map((r) => r.serviceId)).toContain(svcId);
    }
    await expect(serviceQueue(sql, salesLead())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(serviceQueue(sql, divisionStaff('Creative', 'ZZ-RIAN'))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('hides Services of clients Finance has not released yet (M5 §5)', async () => {
    const held = nextClientId();
    const heldSvc = nextSvcId();
    await insertClient(held, false); // not released
    await insertService(heldSvc, held, true, '[Awaiting Onboarding]');
    expect((await serviceQueue(sql, accountLead())).map((r) => r.serviceId)).not.toContain(heldSvc);
  });

  it('getService: owner AM / lead / OD / Director allowed, another AM forbidden, ghost not found', async () => {
    const { svcId, amId } = await planGatedFixture();
    for (const a of [accountStaff(amId), accountLead(), od(), director()]) {
      await expect(getService(sql, a, svcId)).resolves.toMatchObject({ serviceId: svcId });
    }
    await expect(getService(sql, accountStaff('ZZ-OTHER'), svcId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getService(sql, accountStaff(amId), 'SVC-GHOST-0')).rejects.toBeInstanceOf(NotFoundError);
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

// ===========================================================================
// Cluster 3 — Brief breakdown (§5) + dispatch (§6).
// ===========================================================================

describeDb('createBrief (§5)', () => {
  it('breaks a Direct service into a Brief born [To Do]; first Brief drives service → [Briefed]', async () => {
    const { svcId, amId } = await directFixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, goodBrief());
    expect(b.status).toBe('[To Do]');
    expect(b.strategyId).toBe(''); // Direct → no strategy link
    expect(b.id).toMatch(/^BRF-\d{6}-\d{4}$/);
    expect(await svcStatus(svcId)).toBe('[Briefed]');
    const actions = (await sql<{ action: string }[]>`
      select action from audit_log where entity_type='brief' and entity_id=${b.id}`).map((r) => r.action);
    expect(actions).toEqual(['create']);
    // A second Brief leaves the service already [Briefed] (idempotent §5 Flow 2).
    await createBrief(sql, accountStaff(amId), svcId, { ...goodBrief(), assignedDivision: 'Ads' });
    expect(await svcStatus(svcId)).toBe('[Briefed]');
  });

  it('a Live Stream Brief is born off-machine ([Dispatched to Vendor], §6 Rule 2)', async () => {
    const { svcId, amId } = await directFixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, { ...goodBrief(), assignedDivision: 'Live Stream' });
    expect(b.status).toBe('[Dispatched to Vendor]');
  });

  it('only the owning AM (or Director) may create a Brief', async () => {
    const { svcId } = await directFixture();
    await expect(createBrief(sql, director(), svcId, goodBrief())).resolves.toBeTruthy();
    const { svcId: s2 } = await directFixture();
    for (const actor of [accountStaff('ZZ-OTHER'), accountLead(), salesLead(), od()]) {
      await expect(createBrief(sql, actor, s2, goodBrief())).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('guards: plan-gated-awaiting blocked, terminal service not briefable, missing not found', async () => {
    const { svcId, amId } = await planGatedFixture(); // plan-gated, still [Awaiting Onboarding]
    await expect(createBrief(sql, accountStaff(amId), svcId, goodBrief())).rejects.toBeInstanceOf(ConflictError);
    const { clientId } = await directFixture();
    const done = nextSvcId();
    await insertService(done, clientId, false, 'Done');
    await expect(createBrief(sql, accountStaff('ZZ-SINTA'), done, goodBrief())).rejects.toBeInstanceOf(ConflictError);
    await expect(createBrief(sql, accountStaff('ZZ-SINTA'), 'SVC-GHOST-0', goodBrief())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('validates mandatory fields, division, priority, and the recurring block', async () => {
    const { svcId, amId } = await directFixture();
    const staff = accountStaff(amId);
    await expect(createBrief(sql, staff, svcId, { ...goodBrief(), title: '  ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createBrief(sql, staff, svcId, { ...goodBrief(), quantityTarget: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createBrief(sql, staff, svcId, { ...goodBrief(), assignedDivision: 'Finance' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createBrief(sql, staff, svcId, { ...goodBrief(), priority: 'Urgent' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createBrief(sql, staff, svcId, { ...goodBrief(), recurring: true })).rejects.toBeInstanceOf(ValidationError);
  });

  it('strategy linkage: Direct rejects a strategy id; plan-gated requires the approved plan id', async () => {
    // Direct service must not carry a Strategy ID.
    const { svcId, amId } = await directFixture();
    await expect(createBrief(sql, accountStaff(amId), svcId, { ...goodBrief(), strategyId: 'STR-X' }))
      .rejects.toBeInstanceOf(ValidationError);
    // Plan-gated + approved: a wrong id mismatches, the real id links.
    const pg = await planGatedFixture();
    const st = await createStrategy(sql, accountStaff(pg.amId), pg.svcId, goodInput());
    await submitStrategy(sql, accountStaff(pg.amId), st.id);
    await approveStrategy(sql, accountLead(), st.id);
    await expect(createBrief(sql, accountStaff(pg.amId), pg.svcId, { ...goodBrief(), strategyId: 'STR-WRONG' }))
      .rejects.toBeInstanceOf(ValidationError);
    const b = await createBrief(sql, accountStaff(pg.amId), pg.svcId, { ...goodBrief(), strategyId: st.id });
    expect(b.strategyId).toBe(st.id);
  });
});

describeDb('brief reads (§5/§6)', () => {
  it('listServiceBriefs, listDivisionQueue, and getBrief honour the §6/§9.1 read gates', async () => {
    const { svcId, amId } = await directFixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, goodBrief());
    // listServiceBriefs: owner AM + Account lead + OD/Director.
    expect((await listServiceBriefs(sql, accountStaff(amId), svcId)).length).toBe(1);
    expect((await listServiceBriefs(sql, accountLead(), svcId)).length).toBe(1);
    await expect(listServiceBriefs(sql, accountStaff('ZZ-OTHER'), svcId)).rejects.toBeInstanceOf(ForbiddenError);
    // listDivisionQueue: Creative staff/lead, Account lead, OD/Director.
    expect((await listDivisionQueue(sql, divisionStaff('Creative', 'ZZ-C'), 'Creative')).some((r) => r.id === b.id)).toBe(true);
    await expect(listDivisionQueue(sql, divisionStaff('Ads', 'ZZ-A'), 'Creative')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listDivisionQueue(sql, accountStaff(amId), 'Bogus')).rejects.toBeInstanceOf(ValidationError);
    // getBrief: owner AM sees it; an unrelated Ads staff does not.
    expect((await getBrief(sql, accountStaff(amId), b.id)).id).toBe(b.id);
    await expect(getBrief(sql, divisionStaff('Ads', 'ZZ-A'), b.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ===========================================================================
// Cluster 4a — AM-side Brief review (§7).
// ===========================================================================

describeDb('brief review edges (§6/§7)', () => {
  it('AM pulls [Submitted] → [In Review] → [Approved]', async () => {
    const { briefId, amId } = await submittedBrief();
    expect((await reviewBrief(sql, accountStaff(amId), briefId)).ok).toBe(true);
    expect(await briefStatus(briefId)).toBe('[In Review]');
    expect((await approveBrief(sql, accountStaff(amId), briefId)).ok).toBe(true);
    expect(await briefStatus(briefId)).toBe('[Approved]');
  });

  it('only the owning AM (or Director) may review a Brief (§6 Rule 3)', async () => {
    const owner = await submittedBrief();
    expect((await reviewBrief(sql, accountStaff(owner.amId), owner.briefId)).ok).toBe(true);
    for (const actor of [accountStaff('ZZ-OTHER'), accountLead(), divisionStaff('Creative', 'ZZ-C'), od()]) {
      const s = await submittedBrief();
      await expect(reviewBrief(sql, actor, s.briefId)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('reviewing a [To Do] Brief is blocked; a missing Brief is not-found', async () => {
    const { svcId, amId } = await directFixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, goodBrief()); // [To Do]
    expect((await reviewBrief(sql, accountStaff(amId), b.id)).ok).toBe(false); // no [To Do]→[In Review] edge
    await expect(reviewBrief(sql, accountStaff(amId), 'BRF-GHOST-0')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('requestBriefRevision: feedback mandatory, logs feedback, derives count, flags at 3 (§7 Rule 4)', async () => {
    const { briefId, amId } = await submittedBrief();
    const am = accountStaff(amId);
    // A Creative lead so the §7 Rule 4 flag (leadsOfDivision resolver) has a recipient.
    await sql`insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values ('ZZ-CLEAD', 'C Lead', 'cl@mea.id', 'Creative', 'ZZ-CLEAD-JAB', true, 'ZZ-TEST') on conflict do nothing`;
    await sql`insert into role_mappings (divisi, jabatan, division, level, created_by)
      values ('Creative', 'ZZ-CLEAD-JAB', 'Creative', 'lead', 'ZZ-TEST') on conflict do nothing`;
    await reviewBrief(sql, am, briefId);
    await expect(requestBriefRevision(sql, am, briefId, '  ')).rejects.toBeInstanceOf(ValidationError);
    // Revision #1.
    expect((await requestBriefRevision(sql, am, briefId, 'perbaiki hook 3 detik')).ok).toBe(true);
    expect(await briefStatus(briefId)).toBe('[Revision Requested]');
    expect((await getBrief(sql, am, briefId)).revisionCount).toBe(1);
    const fb = (await sql<{ action: string }[]>`
      select action from audit_log where entity_id=${briefId} and action='revision_feedback'`);
    expect(fb.length).toBe(1);
    // Cycle to the 3rd revision → SPV flag fires once on the crossing.
    const cycle = async () => {
      await driveBrief(briefId, '[In Progress]', divisionStaff('Creative', 'ZZ-C'));
      await driveBrief(briefId, '[Submitted]', divisionStaff('Creative', 'ZZ-C'));
      await reviewBrief(sql, am, briefId);
    };
    await cycle();
    await requestBriefRevision(sql, am, briefId, 'revisi 2');
    await cycle();
    await requestBriefRevision(sql, am, briefId, 'revisi 3');
    expect((await getBrief(sql, am, briefId)).revisionCount).toBe(3);
    expect((await getBrief(sql, am, briefId)).revisionFlagged).toBe(true);
    // The revision-count flag notification fired once, to the Creative lead.
    expect(await notifCount('ZZ-CLEAD', 'm12.revision_count.flag', briefId)).toBe(1);
  });
});

// ===========================================================================
// Cluster 4b — Complaint door #2 (§8).
// ===========================================================================

describeDb('complaints (§8)', () => {
  it('AM logs a WhatsApp complaint → [Open], assigned to the AM, audited + notified', async () => {
    const { clientId } = await directFixture();
    // Director logs so the owning AM (ZZ-SINTA) is the notified recipient.
    const c = await logComplaint(sql, director(), clientId, { description: 'produk telat', severity: 'High' });
    expect(c.status).toBe('[Open]');
    expect(c.source).toBe('WhatsApp (AM-logged)');
    expect(c.assignedTo).toBe('ZZ-SINTA');
    expect(c.id).toMatch(/^CPL-\d{6}-\d{4}$/);
    expect(await notifCount('ZZ-SINTA', 'm6.complaint.logged', c.id)).toBeGreaterThanOrEqual(1);
  });

  it('only the owning AM (or Director) may log; pre-release/missing client is not-found', async () => {
    const { clientId } = await directFixture();
    await expect(logComplaint(sql, accountStaff('ZZ-OTHER'), clientId, { description: 'x', severity: 'Low' }))
      .rejects.toBeInstanceOf(ForbiddenError);
    const pre = nextClientId();
    await insertClient(pre, false);
    await setAM(pre, 'ZZ-SINTA');
    await expect(logComplaint(sql, accountStaff('ZZ-SINTA'), pre, { description: 'x', severity: 'Low' }))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it('validates description/severity and the optional related ref (§8 Rule 3)', async () => {
    const { clientId, svcId } = await directFixture();
    const am = accountStaff('ZZ-SINTA');
    await expect(logComplaint(sql, am, clientId, { description: '  ', severity: 'High' })).rejects.toBeInstanceOf(ValidationError);
    await expect(logComplaint(sql, am, clientId, { description: 'x', severity: 'Critical' })).rejects.toBeInstanceOf(ValidationError);
    await expect(logComplaint(sql, am, clientId, { description: 'x', severity: 'High', relatedRef: 'SVC-NOPE' }))
      .rejects.toBeInstanceOf(ValidationError);
    // A real service of this client is a valid related ref.
    const c = await logComplaint(sql, am, clientId, { description: 'x', severity: 'High', relatedRef: svcId });
    expect(c.relatedRef).toBe(svcId);
  });

  it('lifecycle [Open]→[In Progress]→[Resolved]→[Closed]; resolution notes mandatory; manage gate', async () => {
    const { clientId } = await directFixture();
    const am = accountStaff('ZZ-SINTA');
    const c = await logComplaint(sql, am, clientId, { description: 'produk telat', severity: 'High' });
    // Manage gate: another AM and OD are denied.
    await expect(startComplaint(sql, accountStaff('ZZ-OTHER'), c.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(startComplaint(sql, od(), c.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await startComplaint(sql, am, c.id)).ok).toBe(true);
    await expect(resolveComplaint(sql, am, c.id, '  ')).rejects.toBeInstanceOf(ValidationError);
    expect((await resolveComplaint(sql, am, c.id, 'diganti unit baru')).ok).toBe(true);
    // Account lead (SPV escalation) may also drive it.
    expect((await closeComplaint(sql, accountLead(), c.id)).ok).toBe(true);
    expect((await getComplaint(sql, am, c.id)).status).toBe('[Closed]');
  });

  it('read gates: owning AM/Account lead/OD/Director see it; an unrelated AM does not', async () => {
    const { clientId } = await directFixture();
    const c = await logComplaint(sql, accountStaff('ZZ-SINTA'), clientId, { description: 'x', severity: 'Low' });
    for (const a of [accountStaff('ZZ-SINTA'), accountLead(), od(), director()]) {
      await expect(getComplaint(sql, a, c.id)).resolves.toBeTruthy();
    }
    await expect(getComplaint(sql, accountStaff('ZZ-OTHER'), c.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listClientComplaints(sql, accountLead(), clientId)).length).toBe(1);
  });
});

// ===========================================================================
// Cluster 3/4 unit predicates (no DB).
// ===========================================================================

describe('brief/complaint read predicates', () => {
  it('canSeeBrief: OD/Director/Account-lead/owner-AM/target-division', () => {
    const owner = 'ZZ-SINTA';
    expect(canSeeBrief(od(), owner, 'Creative')).toBe(true);
    expect(canSeeBrief(accountLead(), owner, 'Creative')).toBe(true);
    expect(canSeeBrief(accountStaff(owner), owner, 'Creative')).toBe(true);
    expect(canSeeBrief(divisionStaff('Creative', 'ZZ-C'), owner, 'Creative')).toBe(true);
    expect(canSeeBrief(divisionStaff('Ads', 'ZZ-A'), owner, 'Creative')).toBe(false);
    expect(canSeeBrief(accountStaff('ZZ-OTHER'), owner, 'Creative')).toBe(false);
  });

  it('canManageComplaint: owning AM or Account lead/Director only', () => {
    expect(canManageComplaint(accountStaff('ZZ-SINTA'), 'ZZ-SINTA')).toBe(true);
    expect(canManageComplaint(accountLead(), 'ZZ-SINTA')).toBe(true);
    expect(canManageComplaint(director(), 'ZZ-SINTA')).toBe(true);
    expect(canManageComplaint(accountStaff('ZZ-OTHER'), 'ZZ-SINTA')).toBe(false);
    expect(canManageComplaint(od(), 'ZZ-SINTA')).toBe(false);
  });
});
