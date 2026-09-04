/**
 * Tests for M12 Task Execution (task.ts).
 *
 * - Unit: the pure computeMetrics core (turnaround with blocked intervals
 *   excluded, uncapped speed score, N/A / "—" rendering, revision count + flag,
 *   revision turnaround) with controlled timestamps; plus the §2/§5.3 predicates.
 * - Integration (skipped unless DATABASE_URL is set): the division-side exec
 *   edges (+ Service [In Execution] advance), PIC/SLA assignment, the block
 *   request queue with its notifications, and taskMetrics recompute-from-log.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { bi, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  approveBlockRequest,
  assignPic,
  canExecute,
  canManageTask,
  canRequestBlock,
  canViewTask,
  computeMetrics,
  ConflictError,
  ForbiddenError,
  MSG_EXEC_FORBIDDEN,
  MSG_OUTPUT_LINK_REQUIRED,
  NotFoundError,
  pendingBlockRequests,
  rejectBlockRequest,
  resumeTask,
  reworkTask,
  setSlaTarget,
  startAssetBatch,
  startTask,
  submitAssetBatch,
  submitBlockRequest,
  submitTask,
  taskMetrics,
  ValidationError,
  type Actor,
  type Transition,
} from './task';

const creativeStaff = (id = 'ZZ-C'): Actor => ({
  employeeId: id, divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'staff' }),
});
const creativeLead = (id = 'ZZ-CLEAD'): Actor => ({
  employeeId: id, divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'lead' }),
});
const adsStaff = (id = 'ZZ-A'): Actor => ({
  employeeId: id, divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'staff' }),
});
const accountLead = (): Actor => ({
  employeeId: 'ZZ-ALEAD', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'lead' }),
});
const am = (id = 'ZZ-SINTA'): Actor => ({
  employeeId: id, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }),
});
const od = (): Actor => ({ employeeId: 'ZZ-OD', divisi: 'Management', role: permission.makeRole({ od: true }) });
const director = (): Actor => ({ employeeId: 'ZZ-DIR', divisi: 'Management', role: permission.makeRole({ director: true }) });

// ---------------------------------------------------------------------------
// Unit: pure computeMetrics (§5.1) with controlled timestamps.
// ---------------------------------------------------------------------------
const t = (h: number): Date => new Date(Date.UTC(2026, 6, 1, h, 0, 0));
const ev = (to: string, h: number): Transition => ({ to, at: t(h) });

describe('computeMetrics (§5.1/§5.2)', () => {
  it('turnaround = first In Progress → first Approved, blocked intervals excluded', () => {
    const m = computeMetrics(
      [ev('[In Progress]', 0), ev('[Blocked]', 2), ev('[In Progress]', 5), ev('[Submitted]', 6), ev('[In Review]', 7), ev('[Approved]', 8)],
      10,
    );
    // Span 0→8 = 8h; minus the 2→5 blocked interval (3h) = 5h.
    expect(m.turnaroundHours).toBe(5);
    expect(m.speedScorePct).toBe(50); // 5 / 10 * 100
    expect(m.speedScoreDisplay).toBe('50.00%');
    expect(m.approvedPeriodWib).toBe('2026-07');
  });

  it('speed score is uncapped (Rule 12) and can exceed 100%', () => {
    const m = computeMetrics([ev('[In Progress]', 0), ev('[Approved]', 30)], 10);
    expect(m.speedScorePct).toBe(300);
    expect(m.speedScoreDisplay).toBe('300.00%');
  });

  it('renders N/A before approval or with no SLA, and "—" on a zero SLA', () => {
    expect(computeMetrics([ev('[In Progress]', 0)], 10).speedScoreDisplay).toBe('N/A'); // not approved
    expect(computeMetrics([ev('[In Progress]', 0), ev('[Approved]', 5)], null).speedScoreDisplay).toBe('N/A'); // no SLA
    expect(computeMetrics([ev('[In Progress]', 0), ev('[Approved]', 5)], 0).speedScoreDisplay).toBe('—'); // div-by-zero
  });

  it('counts revisions, flags at ≥3, and measures the latest revision turnaround', () => {
    const m = computeMetrics(
      [
        ev('[In Progress]', 0), ev('[Submitted]', 2), ev('[In Review]', 3), ev('[Revision Requested]', 4),
        ev('[In Progress]', 5), ev('[Submitted]', 8), ev('[In Review]', 9), ev('[Revision Requested]', 10),
        ev('[In Progress]', 11), ev('[Submitted]', 14), ev('[In Review]', 15), ev('[Revision Requested]', 16),
      ],
      10,
    );
    expect(m.revisionCount).toBe(3);
    expect(m.revisionFlagged).toBe(true);
    expect(m.turnaroundHours).toBeNull(); // never approved
  });

  it('revision turnaround = latest Revision Requested → next Submitted', () => {
    const m = computeMetrics([ev('[Revision Requested]', 4), ev('[Submitted]', 9)], 10);
    expect(m.revisionTurnaroundHours).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// M16 §6 (LT-30/LT-31) — AM review latency split out of turnaroundHours.
// ---------------------------------------------------------------------------
describe('computeMetrics — M16 §6 AM review latency split (LT-30/LT-31)', () => {
  const d = (day: number, h: number): Date => new Date(Date.UTC(2026, 7, day, h, 0, 0)); // Aug 2026

  it('matches the PRD §6.2 worked example exactly (SLA 24h)', () => {
    // Mon 09:00 In Progress → Tue 09:00 Submitted (24h kerja, tepat target) →
    // Thu 09:00 AM opens In Review (48h AM belum buka) → Thu 11:00 Approved (2h review).
    const evs: Transition[] = [
      { to: '[In Progress]', at: d(3, 9) },
      { to: '[Submitted]', at: d(4, 9) },
      { to: '[In Review]', at: d(6, 9) },
      { to: '[Approved]', at: d(6, 11) },
    ];
    const m = computeMetrics(evs, 24);
    expect(m.turnaroundHours).toBe(74); // UNCHANGED basis — PRD §6.3 continuity
    expect(m.speedScorePct).toBeCloseTo((74 / 24) * 100, 6); // old basis, still 308.33% — untouched
    expect(m.turnaroundKerjaHours).toBe(24);
    expect(m.waktuAmBelumBukaHours).toBe(48);
    expect(m.waktuAmReviewHours).toBe(2);
    expect(m.speedScoreKerjaPct).toBe(100);
    expect(m.speedScoreKerjaDisplay).toBe('100.00%');
  });

  it('sums the AM-wait windows across EVERY revision cycle, not just the first', () => {
    const evs: Transition[] = [
      ev('[In Progress]', 0), ev('[Submitted]', 2), ev('[In Review]', 3), ev('[Revision Requested]', 4),
      ev('[In Progress]', 5), ev('[Submitted]', 8), ev('[In Review]', 9), ev('[Approved]', 10),
    ];
    const m = computeMetrics(evs, 100);
    expect(m.waktuAmBelumBukaHours).toBe(2); // (3-2) + (9-8)
    expect(m.waktuAmReviewHours).toBe(2); // (4-3) + (10-9)
    expect(m.turnaroundKerjaHours).toBe(6); // span 0→10 (10h) minus both (2h+2h)
  });

  it('is null before approval, same gate as turnaroundHours', () => {
    const m = computeMetrics([ev('[In Progress]', 0), ev('[Submitted]', 2)], 24);
    expect(m.turnaroundHours).toBeNull();
    expect(m.turnaroundKerjaHours).toBeNull();
    expect(m.waktuAmBelumBukaHours).toBeNull();
    expect(m.waktuAmReviewHours).toBeNull();
    expect(m.speedScoreKerjaDisplay).toBe('N/A');
  });

  it('subtracts [Blocked] from turnaroundKerjaHours too (same span turnaroundHours uses)', () => {
    const evs: Transition[] = [
      ev('[In Progress]', 0), ev('[Blocked]', 2), ev('[In Progress]', 5),
      ev('[Submitted]', 6), ev('[In Review]', 7), ev('[Approved]', 8),
    ];
    const m = computeMetrics(evs, 10);
    expect(m.turnaroundHours).toBe(5); // 8-0 minus 3h blocked
    expect(m.waktuAmBelumBukaHours).toBe(1); // 7-6
    expect(m.waktuAmReviewHours).toBe(1); // 8-7
    expect(m.turnaroundKerjaHours).toBe(3); // 5-1-1
  });
});

describe('task predicates', () => {
  const row = { division: 'Creative', assignedPic: '', ownerAm: 'ZZ-SINTA' };
  it('canExecute: division staff/lead (or the assigned PIC); AM + other divisions denied', () => {
    expect(canExecute(creativeStaff(), row)).toBe(true); // unassigned → any division staff
    expect(canExecute(director(), row)).toBe(true);
    expect(canExecute(adsStaff(), row)).toBe(false);
    expect(canExecute(am(), row)).toBe(false);
    // Assigned to a specific PIC → only that PIC or the division lead.
    const assigned = { division: 'Creative', assignedPic: 'ZZ-C', ownerAm: 'ZZ-SINTA' };
    expect(canExecute(creativeStaff('ZZ-C'), assigned)).toBe(true);
    expect(canExecute(creativeStaff('ZZ-OTHER'), assigned)).toBe(false);
    expect(canExecute(creativeLead(), assigned)).toBe(true);
  });
  it('canManageTask: division lead / Director only', () => {
    expect(canManageTask(creativeLead(), 'Creative')).toBe(true);
    expect(canManageTask(director(), 'Creative')).toBe(true);
    expect(canManageTask(creativeStaff(), 'Creative')).toBe(false);
  });
  it('canRequestBlock: division staff/lead, owning AM, or Director', () => {
    expect(canRequestBlock(creativeStaff(), row)).toBe(true);
    expect(canRequestBlock(am(), row)).toBe(true); // owning AM
    expect(canRequestBlock(adsStaff(), row)).toBe(false);
  });
  it('canViewTask: OD/Director/Account-lead/owner-AM/target-division', () => {
    expect(canViewTask(od(), 'ZZ-SINTA', 'Creative')).toBe(true);
    expect(canViewTask(accountLead(), 'ZZ-SINTA', 'Creative')).toBe(true);
    expect(canViewTask(am(), 'ZZ-SINTA', 'Creative')).toBe(true);
    expect(canViewTask(creativeStaff(), 'ZZ-SINTA', 'Creative')).toBe(true);
    expect(canViewTask(adsStaff(), 'ZZ-SINTA', 'Creative')).toBe(false);
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
const uid = (p: string): string => `${p}-ZZ-${Date.now() % 100000}-${seq++}`;

async function insertClient(id: string, amId: string): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', now(), ${amId}, 'ZZ-TEST')`;
}
async function insertService(id: string, clientId: string, status: string): Promise<void> {
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
      standard_price, commission_rule, status, requires_strategy_plan, created_by)
    values (${id}, ${clientId}, 'MSV-X', 1, 'Svc', '10000000.00', 'rule', ${status}, false, 'ZZ-TEST')`;
}
async function insertBrief(id: string, svcId: string, division: string, status: string, pic: string | null): Promise<void> {
  await sql`
    insert into briefs (id, service_id, title, status, assigned_division, assigned_pic, deliverable_type,
      quantity_target, priority, recurring, created_by)
    values (${id}, ${svcId}, 'Brief', ${status}, ${division}, ${pic}, 'Video', 1, 'High', false, 'ZZ-TEST')`;
}
async function registerStaff(id: string, division: string, level: string): Promise<void> {
  const jab = `ZZ-${division}-${level}`;
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${id}, ${id + '@mea.id'}, ${division}, ${jab}, true, 'ZZ-TEST') on conflict (employee_id) do nothing`;
  await sql`
    insert into role_mappings (divisi, jabatan, division, level, created_by)
    values (${division}, ${jab}, ${division}, ${level}, 'ZZ-TEST') on conflict (divisi, jabatan) do nothing`;
}

/** A released client + [Briefed] service + a [To Do] Creative brief. Returns ids. */
async function briefFixture(status = '[To Do]', pic: string | null = null): Promise<{ briefId: string; svcId: string }> {
  const clientId = uid('CLI');
  const svcId = uid('SVC');
  const briefId = uid('BRF');
  await insertClient(clientId, 'ZZ-SINTA');
  await insertService(svcId, clientId, '[Briefed]');
  await insertBrief(briefId, svcId, 'Creative', status, pic);
  return { briefId, svcId };
}

const briefStatus = async (id: string): Promise<string> =>
  (await sql<{ status: string }[]>`select status from briefs where id = ${id}`)[0].status;
const svcStatus = async (id: string): Promise<string> =>
  (await sql<{ status: string }[]>`select status from services where id = ${id}`)[0].status;
const notifCount = async (recipient: string, event: string, entityId: string): Promise<number> =>
  Number((await sql<{ n: string }[]>`
    select count(*) as n from notifications
    where recipient_employee_id = ${recipient} and event_type = ${event} and entity_id = ${entityId}`)[0].n);

async function insertAsset(
  id: string, briefId: string, sequenceNo: number, status: string, pic: string | null = null,
): Promise<void> {
  await sql`
    insert into assets (id, brief_id, asset_type, sequence_no, assigned_pic, status, created_by)
    values (${id}, ${briefId}, 'Video', ${sequenceNo}, ${pic}, ${status}, 'ZZ-TEST')`;
}
const assetStatus = async (id: string): Promise<string> =>
  (await sql<{ status: string }[]>`select status from assets where id = ${id}`)[0].status;
const assetOutputLink = async (id: string): Promise<string | null> =>
  (await sql<{ output_link: string | null }[]>`select output_link from assets where id = ${id}`)[0].output_link;
const assetTransitionAuditCount = async (id: string): Promise<number> =>
  Number((await sql<{ n: string }[]>`
    select count(*) as n from audit_log
     where entity_type = 'asset' and entity_id = ${id} and action like 'transition:%'`)[0].n);
const briefTransitionAuditCount = async (id: string): Promise<number> =>
  Number((await sql<{ n: string }[]>`
    select count(*) as n from audit_log
     where entity_type = 'brief' and entity_id = ${id} and action like 'transition:%'`)[0].n);

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  // notifications + audit_log are append-only; never cleaned (assertions scope by entity id).
  await sql`delete from brief_block_requests where created_by like 'ZZ-%'`;
  await sql`delete from asset_block_requests where created_by like 'ZZ-%'`;
  await sql`delete from assets where created_by like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from employees where created_by like 'ZZ-%'`;
  await sql`delete from role_mappings where created_by like 'ZZ-%'`;
});

describeDb('execution edges (§3)', () => {
  it('startTask [To Do]→[In Progress] advances the parent Service to [In Execution]', async () => {
    const { briefId, svcId } = await briefFixture();
    expect((await startTask(sql, creativeStaff(), briefId)).ok).toBe(true);
    expect(await briefStatus(briefId)).toBe('[In Progress]');
    expect(await svcStatus(svcId)).toBe('[In Execution]');
  });

  it('submit + rework cycle stays on the same brief', async () => {
    const { briefId } = await briefFixture();
    await startTask(sql, creativeStaff(), briefId);
    expect((await submitTask(sql, creativeStaff(), briefId)).ok).toBe(true);
    expect(await briefStatus(briefId)).toBe('[Submitted]');
    // Drive to Revision Requested via the AM review edges is M6; here set it directly is not allowed —
    // instead verify rework from a Revision-Requested fixture.
    const rr = await briefFixture('[Revision Requested]');
    expect((await reworkTask(sql, creativeStaff(), rr.briefId)).ok).toBe(true);
    expect(await briefStatus(rr.briefId)).toBe('[In Progress]');
  });

  it('§2 Rule 1 exec gate: division staff/Director allowed; AM + other divisions denied', async () => {
    for (const actor of [creativeStaff(), director()]) {
      const { briefId } = await briefFixture();
      await expect(startTask(sql, actor, briefId)).resolves.toBeTruthy();
    }
    for (const actor of [am(), adsStaff(), accountLead()]) {
      const { briefId } = await briefFixture();
      await expect(startTask(sql, actor, briefId)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('a wrong source state is a conflict; a vendor-dispatched brief is not a task', async () => {
    const { briefId } = await briefFixture('[In Progress]');
    await expect(startTask(sql, creativeStaff(), briefId)).rejects.toBeInstanceOf(ConflictError); // not [To Do]
    const ls = await briefFixture('[Dispatched to Vendor]');
    await expect(startTask(sql, creativeStaff(), ls.briefId)).rejects.toBeInstanceOf(ConflictError);
    await expect(startTask(sql, creativeStaff(), 'BRF-GHOST-0')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describeDb('submitAssetBatch / startAssetBatch (C2, Revisi Sales/Creative/Performa)', () => {
  it('atomicity: one bad row rejects the WHOLE batch — nothing written, not even the good rows', async () => {
    const { briefId } = await briefFixture('[In Progress]');
    const ready = [uid('AST'), uid('AST'), uid('AST'), uid('AST')];
    for (const [i, id] of ready.entries()) {
      await insertAsset(id, briefId, i + 1, '[In Progress]', 'ZZ-C');
    }
    const stillTodo = uid('AST');
    await insertAsset(stillTodo, briefId, 5, '[To Do]', 'ZZ-C');

    const lines = [...ready, stillTodo].map((assetId) => ({ assetId, outputLink: 'https://drive/x' }));
    const report = await submitAssetBatch(sql, creativeStaff('ZZ-C'), briefId, lines);
    expect(report.applied).toBe(0);
    expect(report.rejected).toBe(1);
    expect(report.rows).toHaveLength(5);
    expect(report.rejections).toHaveLength(1);
    expect(report.rejections[0].assetId).toBe(stillTodo);
    expect(report.rejections[0].reason).toBe(bi.TRANSITION_NOT_ALLOWED);

    // Re-read all five: zero moved, zero link written, zero new transition row.
    for (const id of ready) {
      expect(await assetStatus(id)).toBe('[In Progress]');
      expect(await assetOutputLink(id)).toBeNull();
      expect(await assetTransitionAuditCount(id)).toBe(0);
    }
    expect(await assetStatus(stillTodo)).toBe('[To Do]');
    expect(await briefStatus(briefId)).toBe('[In Progress]'); // roll-up never ran
  });

  it('one rejection case per BI constant, asserted against the exported constant', async () => {
    const { briefId } = await briefFixture('[In Progress]');

    // Not found — id belongs to a different Brief entirely.
    const other = await briefFixture('[In Progress]');
    const foreignAsset = uid('AST');
    await insertAsset(foreignAsset, other.briefId, 1, '[In Progress]', 'ZZ-C');
    const notFound = await submitAssetBatch(sql, creativeStaff('ZZ-C'), briefId, [{ assetId: foreignAsset, outputLink: 'x' }]);
    expect(notFound.rejections[0].reason).toBe('[aset tidak ditemukan]');

    // Forbidden — an Ads staff cannot execute a Creative asset.
    const forbiddenAsset = uid('AST');
    await insertAsset(forbiddenAsset, briefId, 1, '[In Progress]', null);
    const forbidden = await submitAssetBatch(sql, adsStaff(), briefId, [{ assetId: forbiddenAsset, outputLink: 'x' }]);
    expect(forbidden.rejections[0].reason).toBe(MSG_EXEC_FORBIDDEN);

    // Wrong source state — still [To Do].
    const todoAsset = uid('AST');
    await insertAsset(todoAsset, briefId, 2, '[To Do]', 'ZZ-C');
    const wrongState = await submitAssetBatch(sql, creativeStaff('ZZ-C'), briefId, [{ assetId: todoAsset, outputLink: 'x' }]);
    expect(wrongState.rejections[0].reason).toBe(bi.TRANSITION_NOT_ALLOWED);

    // Blank output link.
    const noLinkAsset = uid('AST');
    await insertAsset(noLinkAsset, briefId, 3, '[In Progress]', 'ZZ-C');
    const noLink = await submitAssetBatch(sql, creativeStaff('ZZ-C'), briefId, [{ assetId: noLinkAsset, outputLink: '  ' }]);
    expect(noLink.rejections[0].reason).toBe(MSG_OUTPUT_LINK_REQUIRED);
  });

  it('§2 Rule 1 exec gate applies per row, not to the whole call: Director always allowed', async () => {
    const { briefId } = await briefFixture('[In Progress]');
    const id = uid('AST');
    await insertAsset(id, briefId, 1, '[In Progress]', 'ZZ-C');
    const report = await submitAssetBatch(sql, director(), briefId, [{ assetId: id, outputLink: 'https://drive/x' }]);
    expect(report.applied).toBe(1);
    expect(await assetStatus(id)).toBe('[Submitted]');
  });

  it('clean batch of N applies all N, writes exactly N asset audit rows (not one shared row), and turnaround differs per asset', async () => {
    const { briefId } = await briefFixture('[In Progress]');
    const ids = [uid('AST'), uid('AST'), uid('AST')];
    for (const [i, id] of ids.entries()) {
      await insertAsset(id, briefId, i + 1, '[To Do]', 'ZZ-C');
    }
    // Start them at DIFFERENT times (own transactions) so each has its own
    // [In Progress] timestamp — proves a later batch submit doesn't collapse
    // per-asset turnaround to one shared number (M7 §5 Rule 1 / Speed Score).
    for (const id of ids) {
      const r = await startAssetBatch(sql, creativeStaff('ZZ-C'), briefId, [id]);
      expect(r.applied).toBe(1);
    }
    const startedAt = new Map<string, Date>();
    for (const id of ids) {
      const [row] = await sql<{ created_at: Date }[]>`
        select created_at from audit_log
         where entity_type = 'asset' and entity_id = ${id} and action = 'transition:[To Do]->[In Progress]'`;
      startedAt.set(id, row.created_at);
      // Space them out so the timestamps are unambiguously distinct even on a fast machine.
      await new Promise((r2) => setTimeout(r2, 5));
    }
    expect(new Set([...startedAt.values()].map((d) => d.getTime())).size).toBe(ids.length);

    const lines = ids.map((assetId) => ({ assetId, outputLink: 'https://drive/x' }));
    const report = await submitAssetBatch(sql, creativeStaff('ZZ-C'), briefId, lines);
    expect(report.applied).toBe(ids.length);
    expect(report.rejected).toBe(0);
    expect(report.rows.map((r) => r.sequenceNo)).toEqual([1, 2, 3]);

    for (const id of ids) {
      expect(await assetStatus(id)).toBe('[Submitted]');
      expect(await assetTransitionAuditCount(id)).toBe(2); // start + submit, PER asset
    }
    // The [In Progress] timestamps recorded above still differ — the submit
    // batch didn't rewrite or collapse them.
    expect(new Set([...startedAt.values()].map((d) => d.getTime())).size).toBe(ids.length);

    // All 3 of 3 assets reached [Submitted] -> the Brief roll-up follows, in
    // ONE chain of transitions (no duplicate [In Progress]->[Submitted] hop).
    expect(await briefStatus(briefId)).toBe('[Submitted]');
    expect(await briefTransitionAuditCount(briefId)).toBe(1);
  });

  it('startAssetBatch drives [To Do] -> [In Progress] only — never auto-advances to [Submitted]', async () => {
    const { briefId } = await briefFixture('[In Progress]');
    const id = uid('AST');
    await insertAsset(id, briefId, 1, '[To Do]', 'ZZ-C');
    const report = await startAssetBatch(sql, creativeStaff('ZZ-C'), briefId, [id]);
    expect(report.applied).toBe(1);
    expect(await assetStatus(id)).toBe('[In Progress]');
  });

  it('rejects an empty batch and an unknown Brief without touching anything', async () => {
    const { briefId } = await briefFixture('[In Progress]');
    await expect(submitAssetBatch(sql, creativeStaff('ZZ-C'), briefId, [])).rejects.toBeInstanceOf(ValidationError);
    await expect(submitAssetBatch(sql, creativeStaff('ZZ-C'), 'BRF-GHOST-0', [{ assetId: 'AST-GHOST-0' }]))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describeDb('assign PIC + set SLA (§5.3)', () => {
  it('the division lead assigns an active division-staff PIC (audited); bad PIC rejected', async () => {
    const { briefId } = await briefFixture();
    await registerStaff('ZZ-C', 'Creative', 'staff');
    await expect(assignPic(sql, creativeStaff(), briefId, 'ZZ-C')).rejects.toBeInstanceOf(ForbiddenError); // staff cannot assign
    await assignPic(sql, creativeLead(), briefId, 'ZZ-C');
    expect((await sql<{ assigned_pic: string }[]>`select assigned_pic from briefs where id=${briefId}`)[0].assigned_pic).toBe('ZZ-C');
    // An Ads staff is not a valid Creative PIC.
    await registerStaff('ZZ-A', 'Ads', 'staff');
    await expect(assignPic(sql, creativeLead(), briefId, 'ZZ-A')).rejects.toBeInstanceOf(ValidationError);
    await expect(assignPic(sql, creativeLead(), briefId, '  ')).rejects.toBeInstanceOf(ValidationError);
  });

  it('the division lead sets a positive SLA target (audited); non-positive rejected', async () => {
    const { briefId } = await briefFixture();
    await expect(setSlaTarget(sql, creativeLead(), briefId, 0)).rejects.toBeInstanceOf(ValidationError);
    await setSlaTarget(sql, creativeLead(), briefId, 48);
    expect(Number((await sql<{ sla_target_hours: string }[]>`select sla_target_hours from briefs where id=${briefId}`)[0].sla_target_hours)).toBe(48);
    await expect(setSlaTarget(sql, creativeStaff(), briefId, 24)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describeDb('block workflow (§5.3a)', () => {
  it('staff requests, lead approves → [Blocked], resume → [In Progress]; requester notified', async () => {
    const { briefId } = await briefFixture();
    await registerStaff('ZZ-CLEAD', 'Creative', 'lead'); // a recipient for the submitted event
    await startTask(sql, creativeStaff(), briefId); // [In Progress]
    const req = await submitBlockRequest(sql, creativeStaff(), briefId, 'menunggu aset klien');
    expect(req.status).toBe('pending');
    expect(await notifCount('ZZ-CLEAD', 'm12.block_request.submitted', briefId)).toBe(1);
    // A staff member cannot decide a request.
    await expect(approveBlockRequest(sql, creativeStaff(), briefId, req.id)).rejects.toBeInstanceOf(ForbiddenError);
    await approveBlockRequest(sql, creativeLead(), briefId, req.id);
    expect(await briefStatus(briefId)).toBe('[Blocked]');
    expect(await notifCount('ZZ-C', 'm12.block_request.decided', briefId)).toBe(1); // requester notified
    // A resolved request cannot be decided again.
    await expect(approveBlockRequest(sql, creativeLead(), briefId, req.id)).rejects.toBeInstanceOf(ConflictError);
    // Resume back to [In Progress].
    expect((await resumeTask(sql, creativeLead(), briefId)).ok).toBe(true);
    expect(await briefStatus(briefId)).toBe('[In Progress]');
  });

  it('reject closes the request without moving the task; reason mandatory', async () => {
    const { briefId } = await briefFixture();
    await startTask(sql, creativeStaff(), briefId);
    await expect(submitBlockRequest(sql, creativeStaff(), briefId, '  ')).rejects.toBeInstanceOf(ValidationError);
    const req = await submitBlockRequest(sql, creativeStaff(), briefId, 'alasan');
    await rejectBlockRequest(sql, creativeLead(), briefId, req.id);
    expect(await briefStatus(briefId)).toBe('[In Progress]'); // unchanged
    await expect(approveBlockRequest(sql, creativeLead(), briefId, 'BBR-GHOST-0')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('pendingBlockRequests: a division lead sees own-division pending, others see none', async () => {
    const { briefId } = await briefFixture();
    await startTask(sql, creativeStaff(), briefId);
    await submitBlockRequest(sql, creativeStaff(), briefId, 'x');
    expect((await pendingBlockRequests(sql, creativeLead())).some((r) => r.entityId === briefId)).toBe(true);
    expect((await pendingBlockRequests(sql, adsStaff())).some((r) => r.entityId === briefId)).toBe(false);
    expect((await pendingBlockRequests(sql, director())).some((r) => r.entityId === briefId)).toBe(true);
  });
});

describeDb('taskMetrics (recompute-from-log)', () => {
  it('reflects status + SLA, N/A until approved, and the read gate', async () => {
    const { briefId } = await briefFixture();
    await setSlaTarget(sql, creativeLead(), briefId, 24);
    await startTask(sql, creativeStaff(), briefId);
    const m = await taskMetrics(sql, creativeStaff(), briefId);
    expect(m.status).toBe('[In Progress]');
    expect(m.slaTargetHours).toBe(24);
    expect(m.turnaroundHours).toBeNull(); // not approved yet
    expect(m.speedScoreDisplay).toBe('N/A');
    expect(m.revisionCount).toBe(0);
    // Read gate: an unrelated Ads staff cannot view a Creative task.
    await expect(taskMetrics(sql, adsStaff(), briefId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(taskMetrics(sql, creativeStaff(), 'BRF-GHOST-0')).rejects.toBeInstanceOf(NotFoundError);
  });
});
