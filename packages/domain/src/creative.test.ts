/**
 * Tests for M7 Creative (creative.ts) + the M12 Asset source / Brief→Asset
 * roll-up (task.ts).
 *
 * - Unit: the §9.1 / §4 / §5 predicates.
 * - Integration (skipped unless DATABASE_URL is set): incremental Asset creation
 *   + sequence rules, the full division→review Asset lifecycle driving the parent
 *   Brief roll-up ([To Do]→[In Progress]→[Submitted]→[In Review]→[Approved]) and
 *   the Service [In Execution] advance, the per-Asset revision loop + §6 Rule 4
 *   flag, Hours Logged, asset metrics with the revision speed score, and reads.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  approveAsset,
  canCreateAsset,
  canLogHours,
  canRunHoursReminderScan,
  canSeeAsset,
  canSeeDailyOutput,
  ConflictError,
  createAsset,
  dailyOutput,
  ForbiddenError,
  getAsset,
  listBriefAssets,
  logHours,
  NotFoundError,
  requestAssetRevision,
  reviewAsset,
  runHoursReminderScan,
  scanHoursReminders,
  ValidationError,
  type Actor,
} from './creative';
import {
  approveAssetBlockRequest,
  assetMetrics,
  ForbiddenError as TaskForbiddenError,
  reworkAsset,
  setAssetRevisionSla,
  setAssetSla,
  startAsset,
  submitAsset,
  submitAssetBlockRequest,
  ValidationError as TaskValidationError,
} from './task';

const creativeStaff = (id = 'ZZ-C'): Actor => ({
  employeeId: id, divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'staff' }),
});
const creativeLead = (id = 'ZZ-CLEAD'): Actor => ({
  employeeId: id, divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'lead' }),
});
const adsStaff = (): Actor => ({ employeeId: 'ZZ-A', divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'staff' }) });
const accountLead = (): Actor => ({ employeeId: 'ZZ-ALEAD', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const am = (id = 'ZZ-SINTA'): Actor => ({ employeeId: id, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const od = (): Actor => ({ employeeId: 'ZZ-OD', divisi: 'Management', role: permission.makeRole({ od: true }) });
const director = (): Actor => ({ employeeId: 'ZZ-DIR', divisi: 'Management', role: permission.makeRole({ director: true }) });

// ---------------------------------------------------------------------------
// Unit predicates.
// ---------------------------------------------------------------------------
describe('creative predicates', () => {
  it('canCreateAsset: Creative staff/lead or Director', () => {
    expect(canCreateAsset(creativeStaff())).toBe(true);
    expect(canCreateAsset(creativeLead())).toBe(true);
    expect(canCreateAsset(director())).toBe(true);
    expect(canCreateAsset(adsStaff())).toBe(false);
    expect(canCreateAsset(am())).toBe(false);
  });
  it('canSeeAsset: OD/Director/Account-lead/owner-AM/Creative-division', () => {
    expect(canSeeAsset(od(), 'ZZ-SINTA', 'Creative')).toBe(true);
    expect(canSeeAsset(am(), 'ZZ-SINTA', 'Creative')).toBe(true);
    expect(canSeeAsset(creativeStaff(), 'ZZ-SINTA', 'Creative')).toBe(true);
    expect(canSeeAsset(adsStaff(), 'ZZ-SINTA', 'Creative')).toBe(false);
  });
  it('canLogHours: assigned PIC, Creative lead, or Director', () => {
    expect(canLogHours(creativeStaff('ZZ-C'), 'Creative', 'ZZ-C')).toBe(true);
    expect(canLogHours(creativeLead(), 'Creative', 'ZZ-C')).toBe(true);
    expect(canLogHours(director(), 'Creative', 'ZZ-C')).toBe(true);
    expect(canLogHours(creativeStaff('ZZ-OTHER'), 'Creative', 'ZZ-C')).toBe(false);
  });
  it('canSeeDailyOutput (§9.1): PIC self, Creative lead, OD, Director; not a foreign staff/AM', () => {
    expect(canSeeDailyOutput(creativeStaff('ZZ-RIAN'), 'ZZ-RIAN')).toBe(true); // own
    expect(canSeeDailyOutput(creativeLead(), 'ZZ-RIAN')).toBe(true); // Creative Team Leader
    expect(canSeeDailyOutput(od(), 'ZZ-RIAN')).toBe(true);
    expect(canSeeDailyOutput(director(), 'ZZ-RIAN')).toBe(true);
    expect(canSeeDailyOutput(creativeStaff('ZZ-OTHER'), 'ZZ-RIAN')).toBe(false); // foreign Creative staff
    expect(canSeeDailyOutput(am(), 'ZZ-RIAN')).toBe(false); // owning AM is not a Daily-Output viewer
    expect(canSeeDailyOutput(accountLead(), 'ZZ-RIAN')).toBe(false);
  });
  it('canRunHoursReminderScan: Creative (any level) or Director; not other divisions', () => {
    expect(canRunHoursReminderScan(creativeStaff())).toBe(true);
    expect(canRunHoursReminderScan(creativeLead())).toBe(true);
    expect(canRunHoursReminderScan(director())).toBe(true);
    expect(canRunHoursReminderScan(adsStaff())).toBe(false);
    expect(canRunHoursReminderScan(am())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration.
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
async function insertService(id: string, clientId: string): Promise<void> {
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
      standard_price, commission_rule, status, requires_strategy_plan, created_by)
    values (${id}, ${clientId}, 'MSV-X', 1, 'Svc', '10000000.00', 'rule', '[Briefed]', false, 'ZZ-TEST')`;
}
async function insertBrief(id: string, svcId: string, division: string, qty: number): Promise<void> {
  await sql`
    insert into briefs (id, service_id, title, status, assigned_division, deliverable_type,
      quantity_target, priority, recurring, created_by)
    values (${id}, ${svcId}, 'Brief', '[To Do]', ${division}, 'Product Video', ${qty}, 'High', false, 'ZZ-TEST')`;
}
async function registerStaff(id: string, division: string, level: string): Promise<void> {
  const jab = `ZZ-${division}-${level}-${id}`;
  await sql`insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${id}, ${id + '@mea.id'}, ${division}, ${jab}, true, 'ZZ-TEST') on conflict (employee_id) do nothing`;
  await sql`insert into role_mappings (divisi, jabatan, division, level, created_by)
    values (${division}, ${jab}, ${division}, ${level}, 'ZZ-TEST') on conflict (divisi, jabatan) do nothing`;
}

/** A released client + [Briefed] service + a Creative Brief of the given quantity. */
async function creativeBrief(qty = 2, division = 'Creative'): Promise<{ briefId: string; svcId: string }> {
  const clientId = uid('CLI');
  const svcId = uid('SVC');
  const briefId = uid('BRF');
  await insertClient(clientId, 'ZZ-SINTA');
  await insertService(svcId, clientId);
  await insertBrief(briefId, svcId, division, qty);
  return { briefId, svcId };
}

const briefStatus = async (id: string): Promise<string> =>
  (await sql<{ status: string }[]>`select status from briefs where id = ${id}`)[0].status;
const svcStatus = async (id: string): Promise<string> =>
  (await sql<{ status: string }[]>`select status from services where id = ${id}`)[0].status;
const assetStatus = async (id: string): Promise<string> =>
  (await sql<{ status: string }[]>`select status from assets where id = ${id}`)[0].status;

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from asset_block_requests where created_by like 'ZZ-%'`;
  await sql`delete from assets where created_by like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from employees where created_by like 'ZZ-%'`;
  await sql`delete from role_mappings where created_by like 'ZZ-%'`;
});

describeDb('createAsset (§4)', () => {
  it('a Creative staff self-claims: PIC defaults to them, born [To Do], one create audit row', async () => {
    const { briefId } = await creativeBrief(2);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    const a = await createAsset(sql, creativeStaff('ZZ-C'), briefId, { sequenceNo: 1 });
    expect(a.status).toBe('[To Do]');
    expect(a.assignedPic).toBe('ZZ-C'); // self-claim
    expect(a.assetType).toBe('Product Video'); // inherited from the Brief
    expect(a.id).toMatch(/^AST-\d{6}-\d{4}$/);
    const actions = (await sql<{ action: string }[]>`
      select action from audit_log where entity_type='asset' and entity_id=${a.id}`).map((r) => r.action);
    expect(actions).toEqual(['create']);
  });

  it('sequence rules: 1..Quantity, unique; and Creative-only, assetable-only, permission gates', async () => {
    const { briefId } = await creativeBrief(2);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    const staff = creativeStaff('ZZ-C');
    await expect(createAsset(sql, staff, briefId, { sequenceNo: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createAsset(sql, staff, briefId, { sequenceNo: 3 })).rejects.toBeInstanceOf(ValidationError);
    await createAsset(sql, staff, briefId, { sequenceNo: 1 });
    await expect(createAsset(sql, staff, briefId, { sequenceNo: 1 })).rejects.toBeInstanceOf(ConflictError); // duplicate
    // Non-creative brief → conflict.
    const ads = await creativeBrief(2, 'Ads');
    await expect(createAsset(sql, staff, ads.briefId, { sequenceNo: 1 })).rejects.toBeInstanceOf(ConflictError);
    // AM / other division cannot create.
    await expect(createAsset(sql, am(), briefId, { sequenceNo: 2 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createAsset(sql, adsStaff(), briefId, { sequenceNo: 2 })).rejects.toBeInstanceOf(ForbiddenError);
    // Missing brief → not found.
    await expect(createAsset(sql, staff, 'BRF-GHOST-0', { sequenceNo: 1 })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describeDb('Asset lifecycle drives the Brief roll-up (M7 §2)', () => {
  it('start/submit/review/approve of all Assets walks the Brief [To Do]→…→[Approved]', async () => {
    const { briefId, svcId } = await creativeBrief(2);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    const staff = creativeStaff('ZZ-C');
    const a1 = await createAsset(sql, staff, briefId, { sequenceNo: 1 });
    const a2 = await createAsset(sql, staff, briefId, { sequenceNo: 2 });

    // First Asset starts → Brief [In Progress], Service [In Execution].
    await startAsset(sql, staff, a1.id);
    expect(await briefStatus(briefId)).toBe('[In Progress]');
    expect(await svcStatus(svcId)).toBe('[In Execution]');

    // Both submitted (link required) → Brief [Submitted].
    await startAsset(sql, staff, a2.id);
    await expect(submitAsset(sql, staff, a1.id, '  ')).rejects.toBeInstanceOf(TaskValidationError); // link mandatory (task edge)
    await submitAsset(sql, staff, a1.id, 'https://drive/x1');
    await submitAsset(sql, staff, a2.id, 'https://drive/x2');
    expect(await briefStatus(briefId)).toBe('[Submitted]');

    // AM reviews the first → Brief [In Review]; approving one keeps it [In Review].
    await reviewAsset(sql, am(), a1.id);
    expect(await briefStatus(briefId)).toBe('[In Review]');
    await approveAsset(sql, am(), a1.id);
    expect(await briefStatus(briefId)).toBe('[In Review]'); // a2 still not approved
    // Approve the last Asset → Brief rolls up to [Approved].
    await reviewAsset(sql, am(), a2.id);
    await approveAsset(sql, am(), a2.id);
    expect(await assetStatus(a2.id)).toBe('[Approved]');
    expect(await briefStatus(briefId)).toBe('[Approved]');
  });
});

describeDb('Asset review + revision loop (§6)', () => {
  it('only the owning AM reviews; feedback mandatory; revision count derives; 3rd flags the Team Leader', async () => {
    const { briefId } = await creativeBrief(1);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    await registerStaff('ZZ-CLEAD', 'Creative', 'lead'); // flag recipient
    const staff = creativeStaff('ZZ-C');
    const a = await createAsset(sql, staff, briefId, { sequenceNo: 1 });
    const toSubmitted = async () => {
      await startAsset(sql, staff, a.id);
      await submitAsset(sql, staff, a.id, 'https://drive/x');
    };
    await toSubmitted();
    // A non-owner AM cannot review.
    await expect(reviewAsset(sql, am('ZZ-OTHER'), a.id)).rejects.toBeInstanceOf(ForbiddenError);
    await reviewAsset(sql, am(), a.id);
    await expect(requestAssetRevision(sql, am(), a.id, '  ')).rejects.toBeInstanceOf(ValidationError);
    await requestAssetRevision(sql, am(), a.id, 'perbaiki warna');
    expect(await assetStatus(a.id)).toBe('[Revision Requested]');
    expect((await getAsset(sql, am(), a.id)).revisionCount).toBe(1);
    // Two more revision rounds → count 3, flag fires once to the Creative lead.
    for (let i = 0; i < 2; i++) {
      await reworkAsset(sql, staff, a.id);
      await submitAsset(sql, staff, a.id, 'https://drive/x');
      await reviewAsset(sql, am(), a.id);
      await requestAssetRevision(sql, am(), a.id, `revisi ${i + 2}`);
    }
    const got = await getAsset(sql, am(), a.id);
    expect(got.revisionCount).toBe(3);
    expect(got.revisionFlagged).toBe(true);
    const flag = await sql<{ n: string }[]>`
      select count(*) as n from notifications where recipient_employee_id='ZZ-CLEAD' and event_type='m12.revision_count.flag' and entity_id=${a.id}`;
    expect(Number(flag[0].n)).toBe(1);
  });
});

describeDb('Hours Logged (§5) + asset metrics + reads', () => {
  it('logs hours (PIC/lead/Director), rejects others and non-positive', async () => {
    const { briefId } = await creativeBrief(1);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    const staff = creativeStaff('ZZ-C');
    const a = await createAsset(sql, staff, briefId, { sequenceNo: 1 });
    await expect(logHours(sql, staff, a.id, 0)).rejects.toBeInstanceOf(ValidationError);
    await logHours(sql, staff, a.id, 4.5); // PIC self-report
    expect((await getAsset(sql, staff, a.id)).hoursLogged).toBe(4.5);
    await expect(logHours(sql, creativeStaff('ZZ-OTHER'), a.id, 2)).rejects.toBeInstanceOf(ForbiddenError);
    await logHours(sql, creativeLead(), a.id, 6); // lead may
  });

  it('assetMetrics reports the revision speed score against the revision SLA; read gate applies', async () => {
    const { briefId } = await creativeBrief(1);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    const staff = creativeStaff('ZZ-C');
    const a = await createAsset(sql, staff, briefId, { sequenceNo: 1 });
    await setAssetSla(sql, creativeLead(), a.id, 24);
    await setAssetRevisionSla(sql, creativeLead(), a.id, 8);
    await startAsset(sql, staff, a.id);
    const m = await assetMetrics(sql, staff, a.id);
    expect(m.slaTargetHours).toBe(24);
    expect(m.revisionSlaTargetHours).toBe(8);
    expect(m.speedScoreDisplay).toBe('N/A'); // not approved yet
    expect(m.revisionSpeedScoreDisplay).toBe('N/A'); // no revision round yet
    await expect(assetMetrics(sql, adsStaff(), a.id)).rejects.toBeInstanceOf(TaskForbiddenError);
  });

  it('listBriefAssets returns assets in sequence order behind the §9.1 read gate', async () => {
    const { briefId } = await creativeBrief(2);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    const staff = creativeStaff('ZZ-C');
    await createAsset(sql, staff, briefId, { sequenceNo: 2 });
    await createAsset(sql, staff, briefId, { sequenceNo: 1 });
    const list = await listBriefAssets(sql, accountLead(), briefId);
    expect(list.map((x) => x.sequenceNo)).toEqual([1, 2]);
    await expect(listBriefAssets(sql, adsStaff(), briefId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describeDb('Asset block workflow', () => {
  it('staff requests, lead approves → Asset [Blocked] (roll-up recomputed)', async () => {
    const { briefId } = await creativeBrief(1);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    await registerStaff('ZZ-CLEAD', 'Creative', 'lead');
    const staff = creativeStaff('ZZ-C');
    const a = await createAsset(sql, staff, briefId, { sequenceNo: 1 });
    await startAsset(sql, staff, a.id); // [In Progress]
    const req = await submitAssetBlockRequest(sql, staff, a.id, 'menunggu brief tambahan');
    await approveAssetBlockRequest(sql, creativeLead(), a.id, req.id);
    expect(await assetStatus(a.id)).toBe('[Blocked]');
  });
});

// ---------------------------------------------------------------------------
// M7 §7 Daily Output — a pure derived read-model over the immutable audit log.
// ---------------------------------------------------------------------------

const utc = (y: number, mo: number, d: number, h = 0, mi = 0): Date => new Date(Date.UTC(y, mo - 1, d, h, mi, 0));

/** seedAssetTransition appends one immutable transition audit row (the exact shape sm_transition writes). */
async function seedAssetTransition(assetId: string, from: string, to: string, at: Date): Promise<void> {
  await sql`
    insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
    values ('asset', ${assetId}, 'ZZ-ACTOR', ${`transition:${from}->${to}`}, ${at}, 'ZZ-ACTOR')`;
}

describeDb('Daily Output (M7 §7) — derived from the immutable log', () => {
  it('recomputes from the transition log: attributed to the PIC, unit = Asset Type, next-day excluded, stable', async () => {
    const { briefId } = await creativeBrief(1);
    await registerStaff('ZZ-RIAN', 'Creative', 'staff');
    const a = await createAsset(sql, creativeStaff('ZZ-RIAN'), briefId, { sequenceNo: 1 });
    // A full production day for Rian — all land on WIB 2026-06-06.
    await seedAssetTransition(a.id, '[To Do]', '[In Progress]', utc(2026, 6, 6, 3)); // 10:00 WIB
    await seedAssetTransition(a.id, '[In Progress]', '[Submitted]', utc(2026, 6, 6, 6)); // 13:00 WIB
    await seedAssetTransition(a.id, '[Submitted]', '[In Review]', utc(2026, 6, 6, 7)); // 14:00 WIB
    await seedAssetTransition(a.id, '[In Review]', '[Approved]', utc(2026, 6, 6, 8)); // 15:00 WIB
    // A transition on the NEXT WIB day must not leak into this bucket.
    await seedAssetTransition(a.id, '[Approved]', '[In Progress]', utc(2026, 6, 7, 3));

    const day = utc(2026, 6, 6, 3);
    const got = await dailyOutput(sql, creativeStaff('ZZ-RIAN'), 'ZZ-RIAN', day);
    expect(got.dateWib).toBe('2026-06-06');
    expect(got.total).toBe(4); // next-day transition excluded
    expect(got.approved).toBe(1);
    for (const e of got.entries) {
      expect(e.pic).toBe('ZZ-RIAN');
      expect(e.outputUnitType).toBe('Product Video'); // inherited Asset Type
      expect(e.assetId).toBe(a.id);
      expect(e.briefId).toBe(briefId);
    }
    // Recompute is stable (house rule #4).
    const again = await dailyOutput(sql, creativeStaff('ZZ-RIAN'), 'ZZ-RIAN', day);
    expect(again.total).toBe(got.total);
    expect(again.approved).toBe(got.approved);
  });

  it('WIB bucketing: a 00:00–07:00 WIB transition (previous UTC date) buckets into the WIB day, not the UTC day', async () => {
    const { briefId } = await creativeBrief(1);
    await registerStaff('ZZ-RIAN', 'Creative', 'staff');
    const a = await createAsset(sql, creativeStaff('ZZ-RIAN'), briefId, { sequenceNo: 1 });
    // 2026-06-05 18:30 UTC == 2026-06-06 01:30 WIB → belongs to WIB day 2026-06-06.
    await seedAssetTransition(a.id, '[To Do]', '[In Progress]', utc(2026, 6, 5, 18, 30));

    const wib = await dailyOutput(sql, director(), 'ZZ-RIAN', utc(2026, 6, 6, 5)); // 12:00 WIB 06-06
    expect(wib.dateWib).toBe('2026-06-06');
    expect(wib.total).toBe(1);
    // The same transition must NOT appear under the UTC calendar date 2026-06-05.
    const utcDay = await dailyOutput(sql, director(), 'ZZ-RIAN', utc(2026, 6, 5, 12)); // 19:00 WIB 06-05
    expect(utcDay.total).toBe(0);
  });

  it('end-of-day lock: today open, past WIB day locked once the current WIB date moves on', async () => {
    const { briefId } = await creativeBrief(1);
    await registerStaff('ZZ-RIAN', 'Creative', 'staff');
    const a = await createAsset(sql, creativeStaff('ZZ-RIAN'), briefId, { sequenceNo: 1 });
    const day = utc(2026, 6, 6, 3);
    await seedAssetTransition(a.id, '[To Do]', '[In Progress]', day);

    // "Now" still on the same WIB day → open.
    const open = await dailyOutput(sql, creativeStaff('ZZ-RIAN'), 'ZZ-RIAN', day, utc(2026, 6, 6, 15)); // 22:00 WIB same day
    expect(open.locked).toBe(false);
    expect(open.entries[0].locked).toBe(false);
    // "Now" advanced past WIB midnight into the next day → locked.
    const locked = await dailyOutput(sql, creativeStaff('ZZ-RIAN'), 'ZZ-RIAN', day, utc(2026, 6, 6, 18)); // 01:00 WIB 06-07
    expect(locked.locked).toBe(true);
    expect(locked.entries[0].locked).toBe(true);
  });

  it('§9.1 read gate + blank pic; and computing the feed writes nothing (immutable by construction)', async () => {
    const { briefId } = await creativeBrief(1);
    await registerStaff('ZZ-RIAN', 'Creative', 'staff');
    const a = await createAsset(sql, creativeStaff('ZZ-RIAN'), briefId, { sequenceNo: 1 });
    const day = utc(2026, 6, 6, 3);
    await seedAssetTransition(a.id, '[To Do]', '[In Progress]', day);

    // Allowed: PIC (own), Creative lead, OD, Director.
    for (const act of [creativeStaff('ZZ-RIAN'), creativeLead(), od(), director()]) {
      await expect(dailyOutput(sql, act, 'ZZ-RIAN', day)).resolves.toBeDefined();
    }
    // Denied: a foreign Creative staff, the owning AM, an Account lead, another division.
    for (const act of [creativeStaff('ZZ-OTHER'), am(), accountLead(), adsStaff()]) {
      await expect(dailyOutput(sql, act, 'ZZ-RIAN', day)).rejects.toBeInstanceOf(ForbiddenError);
    }
    // Blank PIC → incomplete (400).
    await expect(dailyOutput(sql, director(), '  ', day)).rejects.toBeInstanceOf(ValidationError);

    // No mutation path: the derived read touches no row.
    const countRows = async (t: string): Promise<number> =>
      Number((await sql<{ n: string }[]>`select count(*)::int as n from ${sql(t)}`)[0].n);
    const [auditBefore, assetsBefore] = [await countRows('audit_log'), await countRows('assets')];
    await dailyOutput(sql, director(), 'ZZ-RIAN', day);
    expect(await countRows('audit_log')).toBe(auditBefore);
    expect(await countRows('assets')).toBe(assetsBefore);
  });
});

// ---------------------------------------------------------------------------
// M7 Hours Logged reminder sweep (M7-OA-2 / O29) — fire-once per (Asset, WIB day).
// ---------------------------------------------------------------------------

/** Count HoursLoggedReminder notifications delivered to a recipient for an entity. */
const reminderNotifCount = async (recipient: string, entityId: string): Promise<number> =>
  Number(
    (
      await sql<{ n: string }[]>`
        select count(*)::int as n from notifications
        where recipient_employee_id = ${recipient} and event_type = 'm7.hours_logged.reminder' and entity_id = ${entityId}`
    )[0].n,
  );

/** seedHoursLogged appends one immutable "hours_logged" audit row (the shape logHours writes). */
async function seedHoursLogged(assetId: string, actorId: string, at: Date): Promise<void> {
  await sql`
    insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
    values ('asset', ${assetId}, ${actorId}, 'hours_logged', ${at}, ${actorId})`;
}

describeDb('Hours Logged reminder sweep (M7-OA-2 / O29)', () => {
  it('emits once to the PIC of an active, unlogged Asset', async () => {
    const { briefId } = await creativeBrief(1);
    await registerStaff('ZZ-RIAN', 'Creative', 'staff');
    const a = await createAsset(sql, creativeStaff('ZZ-RIAN'), briefId, { sequenceNo: 1 });
    await startAsset(sql, creativeStaff('ZZ-RIAN'), a.id); // [In Progress]

    const res = await scanHoursReminders(sql, utc(2026, 6, 6, 10)); // 17:00 WIB
    expect(res.remindersSent).toBe(1);
    expect(await reminderNotifCount('ZZ-RIAN', a.id)).toBe(1);
  });

  it('skips an Asset whose PIC already logged Hours today (WIB), incl. the 00:00–07:00 WIB edge', async () => {
    const { briefId } = await creativeBrief(1);
    await registerStaff('ZZ-RIAN', 'Creative', 'staff');
    const a = await createAsset(sql, creativeStaff('ZZ-RIAN'), briefId, { sequenceNo: 1 });
    await startAsset(sql, creativeStaff('ZZ-RIAN'), a.id);
    // 2026-06-05 18:30 UTC == 2026-06-06 01:30 WIB → "today" for a later scan on WIB 06-06.
    await seedHoursLogged(a.id, 'ZZ-RIAN', utc(2026, 6, 5, 18, 30));

    const res = await scanHoursReminders(sql, utc(2026, 6, 6, 5)); // 12:00 WIB 06-06
    expect(res.remindersSent).toBe(0);
    expect(await reminderNotifCount('ZZ-RIAN', a.id)).toBe(0);
  });

  it('dedups within a WIB day, then fires again the next WIB day (repeats daily, unlike M5 one-time)', async () => {
    const { briefId } = await creativeBrief(1);
    await registerStaff('ZZ-RIAN', 'Creative', 'staff');
    const a = await createAsset(sql, creativeStaff('ZZ-RIAN'), briefId, { sequenceNo: 1 });
    await startAsset(sql, creativeStaff('ZZ-RIAN'), a.id);

    expect((await scanHoursReminders(sql, utc(2026, 6, 6, 3))).remindersSent).toBe(1); // 10:00 WIB
    expect((await scanHoursReminders(sql, utc(2026, 6, 6, 12))).remindersSent).toBe(0); // 19:00 WIB same day — dedup
    expect(await reminderNotifCount('ZZ-RIAN', a.id)).toBe(1);
    // Next WIB day, still unlogged → fires again.
    expect((await scanHoursReminders(sql, utc(2026, 6, 7, 3))).remindersSent).toBe(1);
    expect(await reminderNotifCount('ZZ-RIAN', a.id)).toBe(2);
  });

  it('skips terminal ([Approved]), [Blocked], and unassigned Assets', async () => {
    await registerStaff('ZZ-CLEAD', 'Creative', 'lead');
    await registerStaff('ZZ-APP', 'Creative', 'staff');
    await registerStaff('ZZ-BLK', 'Creative', 'staff');
    const lead = creativeLead('ZZ-CLEAD');

    // Approved (terminal): full happy path to [Approved].
    const bApp = await creativeBrief(1);
    const app = creativeStaff('ZZ-APP');
    const aApp = await createAsset(sql, app, bApp.briefId, { sequenceNo: 1 });
    await startAsset(sql, app, aApp.id);
    await submitAsset(sql, app, aApp.id, 'https://drive/x');
    await reviewAsset(sql, am(), aApp.id);
    await approveAsset(sql, am(), aApp.id);
    expect(await assetStatus(aApp.id)).toBe('[Approved]');

    // Blocked: submit + approve a block request.
    const bBlk = await creativeBrief(1);
    const blk = creativeStaff('ZZ-BLK');
    const aBlk = await createAsset(sql, blk, bBlk.briefId, { sequenceNo: 1 });
    await startAsset(sql, blk, aBlk.id);
    const req = await submitAssetBlockRequest(sql, blk, aBlk.id, 'menunggu klien');
    await approveAssetBlockRequest(sql, lead, aBlk.id, req.id);
    expect(await assetStatus(aBlk.id)).toBe('[Blocked]');

    // Unassigned: the lead creates without a PIC.
    const bUn = await creativeBrief(1);
    const aUn = await createAsset(sql, lead, bUn.briefId, { sequenceNo: 1 });
    expect(aUn.assignedPic).toBe('');

    const res = await scanHoursReminders(sql, utc(2026, 6, 6, 3));
    expect(res.remindersSent).toBe(0);
    expect(await reminderNotifCount('ZZ-APP', aApp.id)).toBe(0);
    expect(await reminderNotifCount('ZZ-BLK', aBlk.id)).toBe(0);
  });

  it('runHoursReminderScan gates non-Creative/non-Director callers', async () => {
    await expect(runHoursReminderScan(sql, am())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runHoursReminderScan(sql, adsStaff())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runHoursReminderScan(sql, creativeStaff())).resolves.toBeDefined();
  });
});
