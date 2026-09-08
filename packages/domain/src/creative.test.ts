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
import { bi, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  approveAsset,
  approveAssetBatch,
  canAssignAssetBatch,
  canCreateAsset,
  canDriveReviewEdge,
  canLogHours,
  canRunHoursReminderScan,
  canSeeAsset,
  canSeeDailyOutput,
  ConflictError,
  createAsset,
  createAssetBatch,
  dailyOutput,
  ForbiddenError,
  getAsset,
  listApprovedAssetsForClient,
  listBriefAssets,
  listMyAssets,
  logHours,
  MSG_ASSET_FORBIDDEN,
  MSG_ASSET_NOT_FOUND,
  MSG_INVALID_PIC,
  MSG_BATCH_ASSIGN_FORBIDDEN,
  MSG_CLIENT_NOT_FOUND,
  MSG_INVALID_QUANTITY,
  MSG_QC_REJECT_FORBIDDEN,
  MSG_QUANTITY_EXCEEDS_TARGET,
  MSG_REVIEW_FORBIDDEN,
  MSG_REVIEW_START_FORBIDDEN,
  NotFoundError,
  requestAssetRevision,
  reviewEdgeForbiddenMessage,
  reviewAsset,
  reviewAssetBatch,
  runHoursReminderScan,
  scanHoursReminders,
  ValidationError,
  type Actor,
} from './creative';
import {
  approveAssetBlockRequest,
  assetMetrics,
  diagnoseBriefRollup,
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
const adsLead = (): Actor => ({ employeeId: 'ZZ-ALEAD-ADS', divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'lead' }) });
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
  it('canSeeAsset: OD/Director/Account-lead/owner-AM/Creative-division, plus the B-5 Ads arm', () => {
    expect(canSeeAsset(od(), 'ZZ-SINTA', 'Creative')).toBe(true);
    expect(canSeeAsset(am(), 'ZZ-SINTA', 'Creative')).toBe(true);
    expect(canSeeAsset(creativeStaff(), 'ZZ-SINTA', 'Creative')).toBe(true);
    // B-5/K-3: the Ads division now reads Creative Assets (it has to link them
    // into campaigns — PRD M8 §9.1). Before this it was `false`, which is why
    // the campaign page shipped a type-the-id-from-memory textbox.
    expect(canSeeAsset(adsStaff(), 'ZZ-SINTA', 'Creative')).toBe(true);
    expect(canSeeAsset(adsLead(), 'ZZ-SINTA', 'Creative')).toBe(true);
    // Still shut for a division with no business in Creative output.
    expect(canSeeAsset(
      { employeeId: 'ZZ-K', divisi: 'KOL', role: permission.makeRole({ division: 'KOL', level: 'staff' }) },
      'ZZ-SINTA', 'Creative',
    )).toBe(false);
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
  // ---- B-4 / K-1: the leader is the internal-QC gate, the AM still approves ----
  it('canDriveReviewEdge: the QC pass is lead-OR-AM, the QC reject is lead-only, approval is AM-only', () => {
    const SUBMITTED = '[Submitted]';
    const IN_REVIEW = '[In Review]';
    // The whole ruling as one table: actor · from · to · may?  Written out so a
    // future widening has to change a row here rather than slip through.
    const cases: [string, Actor, string, string, boolean][] = [
      // [Submitted] -> [In Review] : "lolos QC internal, teruskan ke AM"
      ['lead QC-passes', creativeLead(), SUBMITTED, IN_REVIEW, true],
      ['owning AM still starts review', am(), SUBMITTED, IN_REVIEW, true],
      ['Director', director(), SUBMITTED, IN_REVIEW, true],
      ['plain Creative staff', creativeStaff(), SUBMITTED, IN_REVIEW, false],
      ['a FOREIGN AM', am('ZZ-OTHER'), SUBMITTED, IN_REVIEW, false],
      ['a lead of ANOTHER division', adsLead(), SUBMITTED, IN_REVIEW, false],
      ['OD (read-only everywhere)', od(), SUBMITTED, IN_REVIEW, false],
      // [Submitted] -> [Revision Requested] : "QC internal gagal, balik ke PIC"
      ['lead QC-rejects', creativeLead(), SUBMITTED, '[Revision Requested]', true],
      ['AM cannot QC-reject a not-yet-reviewed Asset', am(), SUBMITTED, '[Revision Requested]', false],
      ['staff cannot QC-reject', creativeStaff(), SUBMITTED, '[Revision Requested]', false],
      // [In Review] -> [Approved] : the client's verdict, the AM's alone (K-1)
      ['owning AM approves', am(), IN_REVIEW, '[Approved]', true],
      ['lead may NOT approve', creativeLead(), IN_REVIEW, '[Approved]', false],
      ['Director may approve', director(), IN_REVIEW, '[Approved]', true],
      // [In Review] -> [Revision Requested] : also the AM's verdict, unchanged
      ['owning AM asks for revision', am(), IN_REVIEW, '[Revision Requested]', true],
      ['lead may NOT ask for a client revision', creativeLead(), IN_REVIEW, '[Revision Requested]', false],
    ];
    for (const [label, actor, from, to, expected] of cases) {
      expect(canDriveReviewEdge(actor, from, to, 'ZZ-SINTA', 'Creative'), label).toBe(expected);
    }
  });
  it('reviewEdgeForbiddenMessage names the door that was refused, not always the AM', () => {
    // The old single message said "only the owning AM" for every refusal; after
    // B-4 that is a lie on two of the three doors.
    expect(reviewEdgeForbiddenMessage('[Submitted]', '[In Review]')).toBe(MSG_REVIEW_START_FORBIDDEN);
    expect(reviewEdgeForbiddenMessage('[Submitted]', '[Revision Requested]')).toBe(MSG_QC_REJECT_FORBIDDEN);
    expect(reviewEdgeForbiddenMessage('[In Review]', '[Approved]')).toBe(MSG_REVIEW_FORBIDDEN);
    expect(reviewEdgeForbiddenMessage('[In Review]', '[Revision Requested]')).toBe(MSG_REVIEW_FORBIDDEN);
  });
  it('canAssignAssetBatch: Creative lead or Director hand work OUT; staff never do', () => {
    expect(canAssignAssetBatch(creativeLead())).toBe(true);
    expect(canAssignAssetBatch(director())).toBe(true);
    expect(canAssignAssetBatch(creativeStaff())).toBe(false);
    expect(canAssignAssetBatch(adsLead())).toBe(false);
    expect(canAssignAssetBatch(am())).toBe(false);
    expect(canAssignAssetBatch(od())).toBe(false);
    // canCreateAsset is deliberately NOT narrowed — the self-claim survives.
    expect(canCreateAsset(creativeStaff())).toBe(true);
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
  await sql`delete from contracts where created_by like 'ZZ-%'`;
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

describeDb('createAssetBatch — fan-out by quantity per PIC (§3 Rule 4)', () => {
  it('splits a 12-unit Brief between two PICs; Sequence #s allocated 1..12 in order', async () => {
    const { briefId } = await creativeBrief(12);
    await registerStaff('ZZ-CLEAD', 'Creative', 'lead');
    await registerStaff('ZZ-RIAN', 'Creative', 'staff');
    await registerStaff('ZZ-DITA', 'Creative', 'staff');
    const created = await createAssetBatch(sql, creativeLead(), briefId, [
      { assignedPic: 'ZZ-RIAN', quantity: 8 },
      { assignedPic: 'ZZ-DITA', quantity: 4 },
    ]);
    expect(created).toHaveLength(12);
    expect(created.map((a) => a.sequenceNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(created.filter((a) => a.assignedPic === 'ZZ-RIAN').map((a) => a.sequenceNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(created.filter((a) => a.assignedPic === 'ZZ-DITA').map((a) => a.sequenceNo)).toEqual([9, 10, 11, 12]);
    expect(created.every((a) => a.status === '[To Do]' && a.assetType === 'Product Video')).toBe(true);
    // House rule 3: one immutable create line per Asset, nothing else.
    const audits = await sql<{ n: string }[]>`
      select count(*) as n from audit_log where entity_type='asset' and action='create'
        and entity_id = any(${created.map((a) => a.id)})`;
    expect(Number(audits[0].n)).toBe(12);
  });

  it('all units to one PIC, and a second batch takes only the still-free slots', async () => {
    const { briefId } = await creativeBrief(5);
    await registerStaff('ZZ-CLEAD', 'Creative', 'lead');
    await registerStaff('ZZ-RIAN', 'Creative', 'staff');
    const lead = creativeLead();
    const first = await createAssetBatch(sql, lead, briefId, [{ assignedPic: 'ZZ-RIAN', quantity: 3 }]);
    expect(first.map((a) => a.sequenceNo)).toEqual([1, 2, 3]);
    const second = await createAssetBatch(sql, lead, briefId, [{ assignedPic: 'ZZ-RIAN', quantity: 2 }]);
    expect(second.map((a) => a.sequenceNo)).toEqual([4, 5]); // continues, never reuses
    // Target exhausted → the next unit is refused.
    await expect(createAssetBatch(sql, lead, briefId, [{ assignedPic: 'ZZ-RIAN', quantity: 1 }]))
      .rejects.toThrow(MSG_QUANTITY_EXCEEDS_TARGET);
  });

  it('reuses the freed slot of a sequence gap rather than overrunning the target', async () => {
    const { briefId } = await creativeBrief(3);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    const staff = creativeStaff('ZZ-C');
    await createAsset(sql, staff, briefId, { sequenceNo: 2 }); // single door left 1 and 3 free
    const rest = await createAssetBatch(sql, staff, briefId, [{ quantity: 2 }]);
    expect(rest.map((a) => a.sequenceNo)).toEqual([1, 3]);
    expect(rest.every((a) => a.assignedPic === 'ZZ-C')).toBe(true); // self-claim (§4 Flow 1)
  });

  it('an overrun batch creates NOTHING (one transaction), and bad quantities are refused', async () => {
    const { briefId } = await creativeBrief(4);
    await registerStaff('ZZ-CLEAD', 'Creative', 'lead');
    await registerStaff('ZZ-RIAN', 'Creative', 'staff');
    const lead = creativeLead();
    await expect(createAssetBatch(sql, lead, briefId, [
      { assignedPic: 'ZZ-RIAN', quantity: 3 },
      { assignedPic: 'ZZ-RIAN', quantity: 3 }, // 6 > 4 free
    ])).rejects.toThrow(MSG_QUANTITY_EXCEEDS_TARGET);
    expect((await listBriefAssets(sql, lead, briefId))).toEqual([]); // all-or-nothing
    // Quantity must be a whole positive number; an empty batch is incomplete data.
    for (const bad of [0, -2, 1.5, Number.NaN]) {
      await expect(createAssetBatch(sql, lead, briefId, [{ assignedPic: 'ZZ-RIAN', quantity: bad }]))
        .rejects.toThrow(MSG_INVALID_QUANTITY);
    }
    await expect(createAssetBatch(sql, lead, briefId, [])).rejects.toBeInstanceOf(ValidationError);
  });

  it('carries the same gates as the single door: PIC validity, division, permission, existence', async () => {
    const { briefId } = await creativeBrief(4);
    await registerStaff('ZZ-CLEAD', 'Creative', 'lead');
    await registerStaff('ZZ-A', 'Ads', 'staff');
    const lead = creativeLead();
    // Non-Creative / unknown PIC → invalid PIC, nothing created.
    await expect(createAssetBatch(sql, lead, briefId, [{ assignedPic: 'ZZ-A', quantity: 2 }]))
      .rejects.toThrow(MSG_INVALID_PIC);
    await expect(createAssetBatch(sql, lead, briefId, [{ assignedPic: 'ZZ-GHOST', quantity: 2 }]))
      .rejects.toThrow(MSG_INVALID_PIC);
    expect(await listBriefAssets(sql, lead, briefId)).toEqual([]);
    // AM / other division cannot fan out; a non-Creative Brief cannot be fanned out.
    await expect(createAssetBatch(sql, am(), briefId, [{ quantity: 1 }])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createAssetBatch(sql, adsStaff(), briefId, [{ quantity: 1 }])).rejects.toBeInstanceOf(ForbiddenError);
    const ads = await creativeBrief(2, 'Ads');
    await expect(createAssetBatch(sql, lead, ads.briefId, [{ quantity: 1 }])).rejects.toBeInstanceOf(ConflictError);
    await expect(createAssetBatch(sql, lead, 'BRF-GHOST-0', [{ quantity: 1 }])).rejects.toBeInstanceOf(NotFoundError);
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

describeDb('B-1 — rollup yang diam sekarang bersuara, dan AM diberi tahu', () => {
  /** Brief Creative ber-target `qty` dengan `n` Aset yang seluruhnya [Submitted]. */
  async function submittedAssets(qty: number, n: number): Promise<{ briefId: string; ids: string[]; staff: Actor }> {
    const { briefId } = await creativeBrief(qty);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    await registerStaff('ZZ-CLEAD', 'Creative', 'lead');
    await registerStaff('ZZ-SINTA', 'Account', 'staff');
    const staff = creativeStaff('ZZ-C');
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = await createAsset(sql, staff, briefId, { sequenceNo: i + 1 });
      await startAsset(sql, staff, a.id);
      await submitAsset(sql, staff, a.id, `https://drive/${a.id}`);
      ids.push(a.id);
    }
    return { briefId, ids, staff };
  }

  const notifOf = async (event: string, entityId: string): Promise<string[]> =>
    (await sql<{ recipient_employee_id: string }[]>`
      select recipient_employee_id from notifications
       where event_type = ${event} and entity_id = ${entityId}
       order by recipient_employee_id`).map((r) => r.recipient_employee_id);

  it('B-1a: 3 dari 12 yang SEMUANYA selesai tetap [In Progress] — dan diagnosisnya mengatakan kenapa', async () => {
    // Keluhan aslinya, apa adanya. `allExist = created >= quantity_target`,
    // jadi rollup TIDAK AKAN menutup berapa pun yang selesai.
    const { briefId, ids } = await submittedAssets(12, 3);
    for (const id of ids) {
      await reviewAsset(sql, creativeLead(), id);
      await approveAsset(sql, am(), id);
    }
    expect(await briefStatus(briefId)).toBe('[In Progress]');
    const d = await diagnoseBriefRollup(sql, briefId);
    expect(d.blocker).toBe('unit_belum_lengkap');
    expect({ created: d.created, target: d.target, done: d.done }).toEqual({ created: 3, target: 12, done: 3 });
    // Dan sebabnya BUKAN "masih ada yang dikerjakan": semuanya sudah selesai.
    expect(d.done).toBe(d.created);
  });

  it('B-1a: nol unit, unit lengkap-tapi-jalan, dan selesai punya blocker yang BERBEDA', async () => {
    // Ketiganya kelihatan sama di halaman hari ini (status tidak berubah, nol
    // galat), jadi yang diuji adalah bahwa ketiganya bisa DIBEDAKAN.
    const kosong = await creativeBrief(2);
    expect((await diagnoseBriefRollup(sql, kosong.briefId)).blocker).toBe('nol_unit');

    const { briefId, ids } = await submittedAssets(2, 2);
    // Dua Aset [Submitted] dari target 2 ⇒ unit lengkap, tapi belum disetujui.
    expect((await diagnoseBriefRollup(sql, briefId)).blocker).toBe('menunggu_pekerjaan');
    for (const id of ids) {
      await reviewAsset(sql, creativeLead(), id);
      await approveAsset(sql, am(), id);
    }
    expect(await briefStatus(briefId)).toBe('[Approved]');
    const d = await diagnoseBriefRollup(sql, briefId);
    expect(d.blocker).toBe('selesai');
    expect(d.done).toBe(2);
  });

  it('B-1a: Brief di luar rantai 5-state dilaporkan `di_luar_rantai`, bukan didiamkan', async () => {
    // Rollup mati PERMANEN di sini — tidak ada peristiwa Aset yang bisa
    // memperbaikinya — jadi ini justru sebab yang paling wajib bersuara.
    const { briefId } = await submittedAssets(1, 1);
    await sql`update briefs set status = '[Dispatched to Vendor]' where id = ${briefId}`;
    const d = await diagnoseBriefRollup(sql, briefId);
    expect(d.blocker).toBe('di_luar_rantai');
  });

  it('B-1b: rollup ke [In Review] memberi tahu AM PEMILIK, dan ke [Approved] sekali lagi', async () => {
    const { briefId, ids } = await submittedAssets(2, 2);
    // Katalog v15 mendaftarkan keduanya dengan resolver `explicit` — jadi yang
    // diuji bukan cuma "ada notifikasi", tapi bahwa penerimanya AM pemilik
    // klien (ZZ-SINTA), bukan aktor yang menjalankan transisinya (lead).
    //
    // Pemicunya adalah EDGE Brief-nya, bukan jumlah Aset yang di-review: dengan
    // kedua Aset sudah dibuat dan tidak ada satu pun yang masih dikerjakan,
    // `rollupTarget` sudah [In Review] pada QC pass PERTAMA. Itu diturunkan dari
    // mesin, bukan ditebak — makanya di-expect lewat status Brief-nya dulu.
    await reviewAsset(sql, creativeLead(), ids[0]);
    expect(await briefStatus(briefId)).toBe('[In Review]');
    expect(await notifOf('m6.brief.siap_review_am', briefId)).toEqual(['ZZ-SINTA']);
    expect(await notifOf('m6.brief.selesai', briefId)).toEqual([]);
    // QC pass kedua TIDAK menambah notifikasi: edge-nya sudah dilewati, dan
    // `recomputeBriefRollup` forward-only. Satu handoff = satu notifikasi.
    await reviewAsset(sql, creativeLead(), ids[1]);
    expect(await notifOf('m6.brief.siap_review_am', briefId)).toEqual(['ZZ-SINTA']);

    // Tutup Brief-nya DENGAN AM sebagai aktor: `notifyActor` false, jadi AM
    // TIDAK memberi tahu dirinya sendiri. Ini disengaja — memberi tahu orang
    // tentang tombol yang baru saja ia klik adalah kebisingan.
    await approveAsset(sql, am(), ids[0]);
    await approveAsset(sql, am(), ids[1]);
    expect(await briefStatus(briefId)).toBe('[Approved]');
    expect(await notifOf('m6.brief.selesai', briefId)).toEqual([]);
  });

  it('B-1b: [Approved] yang ditutup aktor LAIN benar-benar sampai ke AM pemilik', async () => {
    // Pasangan tes di atas, dan yang justru menutup keluhannya: kalau bukan AM
    // yang menggerakkan edge terakhirnya, AM WAJIB diberi tahu. Di KOL ini
    // jalur normalnya (QC pass koordinator menutup Brief tanpa AM bertindak);
    // di Creative dipentaskan lewat Director.
    const { briefId, ids } = await submittedAssets(2, 2);
    for (const id of ids) await reviewAsset(sql, creativeLead(), id);
    for (const id of ids) await approveAsset(sql, director(), id);
    expect(await briefStatus(briefId)).toBe('[Approved]');
    expect(await notifOf('m6.brief.selesai', briefId)).toEqual(['ZZ-SINTA']);
  });

  it('B-1b: Brief yang rollup-nya tidak menutup TIDAK memberi tahu AM apa pun', async () => {
    // Cabang negatifnya, diturunkan dari data nyata: 3 dari 12 tidak pernah
    // mencapai edge mana pun yang memancarkan event, jadi inbox AM harus kosong.
    // Tanpa tes ini, `notifyAmOnRollupEdge` yang salah kondisi akan mengirim
    // notifikasi "selesai" untuk brief yang justru macet — kebalikan keluhannya.
    const { briefId, ids } = await submittedAssets(12, 3);
    for (const id of ids) {
      await reviewAsset(sql, creativeLead(), id);
      await approveAsset(sql, am(), id);
    }
    expect(await notifOf('m6.brief.selesai', briefId)).toEqual([]);
    expect(await notifOf('m6.brief.siap_review_am', briefId)).toEqual([]);
  });
});

describeDb('B-5 / K-3 — Ads menemukan aset lewat daftar, bukan hafalan', () => {
  /** A client with `n` Approved Assets on one Creative Brief, plus one still [Submitted]. */
  async function clientWithApproved(n: number): Promise<{ clientId: string; briefId: string; approved: string[] }> {
    const clientId = uid('CLI');
    const svcId = uid('SVC');
    const briefId = uid('BRF');
    await insertClient(clientId, 'ZZ-SINTA');
    await insertService(svcId, clientId);
    await insertBrief(briefId, svcId, 'Creative', n + 1);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    const staff = creativeStaff('ZZ-C');
    const approved: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = await createAsset(sql, staff, briefId, { sequenceNo: i + 1 });
      await startAsset(sql, staff, a.id);
      await submitAsset(sql, staff, a.id, `https://drive/${a.id}`);
      await reviewAsset(sql, am(), a.id);
      await approveAsset(sql, am(), a.id);
      approved.push(a.id);
    }
    // One more that is only [Submitted] — it must NOT be offered as linkable.
    const pending = await createAsset(sql, staff, briefId, { sequenceNo: n + 1 });
    await startAsset(sql, staff, pending.id);
    await submitAsset(sql, staff, pending.id, 'https://drive/pending');
    return { clientId, briefId, approved };
  }

  it('an Advertiser reads the client\'s [Approved] Assets — and only those', async () => {
    const { clientId, approved } = await clientWithApproved(2);
    const rows = await listApprovedAssetsForClient(sql, adsStaff(), clientId);
    // Derived from what the machine actually approved, not from a hand-written
    // literal: an `expect` on a guessed id is green even when the filter is wrong.
    expect(rows.map((r) => r.id).sort()).toEqual([...approved].sort());
    expect(rows.every((r) => r.outputLink !== '')).toBe(true);
    // approvedAt comes out of the immutable log (house rule 4), so it is present
    // for every row the engine approved — a null here means the derivation broke.
    expect(rows.every((r) => r.approvedAt instanceof Date)).toBe(true);
    expect(rows.every((r) => r.briefTitle === 'Brief' && r.assetType === 'Product Video')).toBe(true);
  });

  it('never leaks another client\'s Assets, even to the same Advertiser', async () => {
    const mine = await clientWithApproved(2);
    const theirs = await clientWithApproved(1);
    const rows = await listApprovedAssetsForClient(sql, adsStaff(), mine.clientId);
    const ids = new Set(rows.map((r) => r.id));
    expect(theirs.approved.every((id) => !ids.has(id))).toBe(true);
    expect(ids.size).toBe(2);
  });

  it('the source-Brief filter narrows to one Creative Brief and falls back when empty', async () => {
    const first = await clientWithApproved(2);
    // A SECOND Creative Brief for the SAME client, one Approved Asset.
    const svc2 = uid('SVC');
    const brief2 = uid('BRF');
    await sql`insert into services (id, client_id, master_service_id, master_version_no, name,
        standard_price, commission_rule, status, requires_strategy_plan, created_by)
      values (${svc2}, ${first.clientId}, 'MSV-X', 1, 'Svc2', '10000000.00', 'rule', '[Briefed]', false, 'ZZ-TEST')`;
    await insertBrief(brief2, svc2, 'Creative', 1);
    const staff = creativeStaff('ZZ-C');
    const other = await createAsset(sql, staff, brief2, { sequenceNo: 1 });
    await startAsset(sql, staff, other.id);
    await submitAsset(sql, staff, other.id, 'https://drive/other');
    await reviewAsset(sql, am(), other.id);
    await approveAsset(sql, am(), other.id);

    // Narrowed: only the named Brief's Assets.
    expect((await listApprovedAssetsForClient(sql, adsStaff(), first.clientId, brief2)).map((r) => r.id))
      .toEqual([other.id]);
    expect((await listApprovedAssetsForClient(sql, adsStaff(), first.clientId, first.briefId)).map((r) => r.id).sort())
      .toEqual([...first.approved].sort());
    // Empty / absent / whitespace ⇒ the fallback, all three Assets. Asserted for
    // every spelling because '' is what an unset FE prop actually sends.
    for (const src of [undefined, '', '   ']) {
      expect((await listApprovedAssetsForClient(sql, adsStaff(), first.clientId, src)).length).toBe(3);
    }
  });

  it('gates by role and by client existence — 403 and 404, never a misleading empty list', async () => {
    const { clientId } = await clientWithApproved(1);
    // Allowed: Ads staff/lead, the owning AM, Account lead, OD, Director, Creative.
    for (const actor of [adsStaff(), adsLead(), am(), accountLead(), od(), director(), creativeStaff('ZZ-C')]) {
      expect((await listApprovedAssetsForClient(sql, actor, clientId)).length).toBe(1);
    }
    // Refused: a foreign AM, and a division with no business in Creative output.
    const kolStaff: Actor = {
      employeeId: 'ZZ-K', divisi: 'KOL', role: permission.makeRole({ division: 'KOL', level: 'staff' }),
    };
    for (const actor of [am('ZZ-OTHER'), kolStaff]) {
      await expect(listApprovedAssetsForClient(sql, actor, clientId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listApprovedAssetsForClient(sql, actor, clientId)).rejects.toThrow(MSG_ASSET_FORBIDDEN);
    }
    // A client that does not exist is a 404, not an empty 200 — otherwise a typo
    // in the id looks exactly like "this client has no approved Assets".
    await expect(listApprovedAssetsForClient(sql, adsStaff(), 'CLI-GHOST-0'))
      .rejects.toBeInstanceOf(NotFoundError);
    await expect(listApprovedAssetsForClient(sql, adsStaff(), 'CLI-GHOST-0'))
      .rejects.toThrow(MSG_CLIENT_NOT_FOUND);
  });
});

describeDb('B-4 / K-1 — Leader Creative jadi gerbang QC internal', () => {
  /** One Creative Asset driven to [Submitted] through the real division flow. */
  async function submitted(qty = 2): Promise<{ assetId: string; briefId: string; staff: Actor }> {
    const { briefId } = await creativeBrief(qty);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    await registerStaff('ZZ-CLEAD', 'Creative', 'lead');
    const staff = creativeStaff('ZZ-C');
    const a = await createAsset(sql, staff, briefId, { sequenceNo: 1 });
    await startAsset(sql, staff, a.id);
    await submitAsset(sql, staff, a.id, 'https://drive/x');
    return { assetId: a.id, briefId, staff };
  }

  it('the edge exists in sm_edges as lead-gated, and NO new machine or state came with it', async () => {
    // Derived from the real table, not from a literal in the test: the migration
    // is the thing under test, so reading it back is the whole point.
    const edge = await sql<{ require_lead: boolean }[]>`
      select require_lead from sm_edges
       where machine='brief_task' and from_state='[Submitted]' and to_state='[Revision Requested]'`;
    expect(edge).toHaveLength(1);
    expect(edge[0].require_lead).toBe(true); // staff cannot reach it even via service-role
    // House rule 2: nol mesin baru, nol state baru. Every brief_task edge must
    // still land on a state the machine already had before B-4.
    const states = new Set((await sql<{ s: string }[]>`
      select from_state as s from sm_edges where machine='brief_task'
      union select to_state as s from sm_edges where machine='brief_task'`).map((r) => r.s));
    expect([...states].sort()).toEqual([
      '[Approved]', '[Blocked]', '[Cancelled — Service Voided]', '[In Progress]', '[In Review]',
      '[Revision Requested]', '[Submitted]', '[To Do]',
    ]);
  });

  it('lead QC-passes to [In Review]; AM then approves — the seam, both halves real', async () => {
    // Quantity/Target 1 so the parent Brief's roll-up can reach [Approved]: with
    // an unfilled target it stops at [In Progress] regardless of the Assets in
    // it, which is B-1a and is NOT what this test is about.
    const { assetId, briefId } = await submitted(1);
    // The leader forwards internal QC. Before B-4 this was a 403.
    await reviewAsset(sql, creativeLead(), assetId);
    expect(await assetStatus(assetId)).toBe('[In Review]');
    // The leader may NOT sign off for the client (K-1: "AM tetap pemegang approval akhir").
    await expect(approveAsset(sql, creativeLead(), assetId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(approveAsset(sql, creativeLead(), assetId)).rejects.toThrow(MSG_REVIEW_FORBIDDEN);
    expect(await assetStatus(assetId)).toBe('[In Review]'); // refusal wrote nothing
    // The AM does, and the parent Brief rolls up with it.
    await approveAsset(sql, am(), assetId);
    expect(await assetStatus(assetId)).toBe('[Approved]');
    expect(await briefStatus(briefId)).toBe('[Approved]'); // the seam holds end to end
  });

  it('lead QC-rejects to [Revision Requested]: feedback mandatory, PIC can rework, count untouched', async () => {
    const { assetId, staff } = await submitted();
    await expect(requestAssetRevision(sql, creativeLead(), assetId, '   ')).rejects.toBeInstanceOf(ValidationError);
    await requestAssetRevision(sql, creativeLead(), assetId, 'framing kepotong, ulangi');
    expect(await assetStatus(assetId)).toBe('[Revision Requested]');
    // The feedback is readable on the SAME audit action the FE already looks for.
    const fb = await sql<{ after_json: { feedback: string } }[]>`
      select after_json from audit_log
       where entity_type='asset' and entity_id=${assetId} and action='revision_feedback'`;
    expect(fb.map((r) => r.after_json.feedback)).toEqual(['framing kepotong, ulangi']);
    // Revision Count is the CLIENT's revision count (M7 §6 Rule 2) — internal QC
    // must not inflate it, or the Quality score punishes the division for its own
    // QC being strict.
    expect((await getAsset(sql, am(), assetId)).revisionCount).toBe(0);
    // …and the PIC's way back is the edge that already existed.
    await reworkAsset(sql, staff, assetId);
    expect(await assetStatus(assetId)).toBe('[In Progress]');
  });

  it('a QC reject at revision count 3 does NOT re-fire the §6 Rule 4 flag', async () => {
    const { assetId, staff } = await submitted();
    // Three real AM revision rounds → count 3, flag fires exactly once.
    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        await reworkAsset(sql, staff, assetId);
        await submitAsset(sql, staff, assetId, 'https://drive/x');
      }
      await reviewAsset(sql, am(), assetId);
      await requestAssetRevision(sql, am(), assetId, `revisi ${i + 1}`);
    }
    const flagCount = async (): Promise<number> => Number((await sql<{ n: string }[]>`
      select count(*) as n from notifications
       where recipient_employee_id='ZZ-CLEAD' and event_type='m12.revision_count.flag' and entity_id=${assetId}`)[0].n);
    expect((await getAsset(sql, am(), assetId)).revisionCount).toBe(3);
    expect(await flagCount()).toBe(1);
    // Now a LEAD QC reject while the count already sits at 3. The count does not
    // move, so the "exact 3rd revision" flag must not fire a second time.
    await reworkAsset(sql, staff, assetId);
    await submitAsset(sql, staff, assetId, 'https://drive/x');
    await requestAssetRevision(sql, creativeLead(), assetId, 'QC internal: audio pecah');
    expect((await getAsset(sql, am(), assetId)).revisionCount).toBe(3);
    expect(await flagCount()).toBe(1);
  });

  it('a lead of ANOTHER division, plain staff, and OD are all refused both QC doors', async () => {
    const { assetId } = await submitted();
    const staff = creativeStaff('ZZ-C');
    for (const actor of [adsLead(), staff, accountLead()]) {
      await expect(reviewAsset(sql, actor, assetId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(requestAssetRevision(sql, actor, assetId, 'x')).rejects.toBeInstanceOf(ForbiddenError);
    }
    // accountLead is refused by the review gate, not by RLS — assert the message
    // so a future widening of Account-lead reads cannot silently open a WRITE.
    await expect(reviewAsset(sql, accountLead(), assetId)).rejects.toThrow(MSG_REVIEW_START_FORBIDDEN);
    await expect(requestAssetRevision(sql, staff, assetId, 'x')).rejects.toThrow(MSG_QC_REJECT_FORBIDDEN);
    expect(await assetStatus(assetId)).toBe('[Submitted]');
  });

  it('the batch QC pass is open to the lead; the batch approve stays the AM\'s', async () => {
    const { briefId } = await creativeBrief(2);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    await registerStaff('ZZ-CLEAD', 'Creative', 'lead');
    const staff = creativeStaff('ZZ-C');
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const a = await createAsset(sql, staff, briefId, { sequenceNo: i + 1 });
      await startAsset(sql, staff, a.id);
      await submitAsset(sql, staff, a.id, `https://drive/${a.id}`);
      ids.push(a.id);
    }
    const reviewed = await reviewAssetBatch(sql, creativeLead(), briefId, ids);
    expect(reviewed.applied).toBe(2);
    expect(reviewed.rejected).toBe(0);
    // The lead's batch approve is refused per row, and (batch semantics) writes nothing.
    const refused = await approveAssetBatch(sql, creativeLead(), briefId, ids);
    expect(refused.applied).toBe(0);
    expect(refused.rejections.map((r) => r.reason)).toEqual([MSG_REVIEW_FORBIDDEN, MSG_REVIEW_FORBIDDEN]);
    expect(await assetStatus(ids[0])).toBe('[In Review]');
    // The AM's does land.
    expect((await approveAssetBatch(sql, am(), briefId, ids)).applied).toBe(2);
    expect(await briefStatus(briefId)).toBe('[Approved]');
  });

  it('batch fan-out is lead-only; a staffer keeps the §4 Flow 1 self-claim of ONE unit', async () => {
    const { briefId } = await creativeBrief(6);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    await registerStaff('ZZ-RIAN', 'Creative', 'staff');
    await registerStaff('ZZ-CLEAD', 'Creative', 'lead');
    const staff = creativeStaff('ZZ-C');
    // Assigning someone ELSE: refused, whatever the quantity.
    await expect(createAssetBatch(sql, staff, briefId, [{ assignedPic: 'ZZ-RIAN', quantity: 1 }]))
      .rejects.toThrow(MSG_BATCH_ASSIGN_FORBIDDEN);
    // Mixed batch: one own line + one foreign line is still a distribution, and
    // it must create NOTHING (the refusal lands before the transaction opens).
    await expect(createAssetBatch(sql, staff, briefId, [{ quantity: 1 }, { assignedPic: 'ZZ-RIAN', quantity: 1 }]))
      .rejects.toThrow(MSG_BATCH_ASSIGN_FORBIDDEN);
    expect((await sql<{ n: string }[]>`select count(*) as n from assets where brief_id=${briefId}`)[0].n).toBe('0');
    // A bad quantity is still a 400, not a 403 — the permission check must not
    // swallow the real complaint.
    await expect(createAssetBatch(sql, staff, briefId, [{ quantity: 0 }])).rejects.toBeInstanceOf(ValidationError);
    // The self-claim survives, both spellings (empty PIC and own id), and is NOT
    // capped at one unit — createAssetBatch is the only door that reuses a
    // Sequence # gap, so capping it would cost the self-claimer that.
    expect(await createAssetBatch(sql, staff, briefId, [{ quantity: 2 }])).toHaveLength(2);
    const own = await createAssetBatch(sql, staff, briefId, [{ assignedPic: 'ZZ-C', quantity: 1 }]);
    expect(own.map((a) => a.assignedPic)).toEqual(['ZZ-C']);
    // The lead still distributes freely (3 slots left of 6).
    const fan = await createAssetBatch(sql, creativeLead(), briefId, [
      { assignedPic: 'ZZ-RIAN', quantity: 2 }, { assignedPic: 'ZZ-C', quantity: 1 },
    ]);
    expect(fan).toHaveLength(3);
  });
});

describeDb('reviewAssetBatch / approveAssetBatch (C4, Revisi Sales/Creative/Performa)', () => {
  /** N Assets driven to [Submitted] via the real division-side flow (not raw SQL). */
  async function submittedAssets(briefId: string, staff: Actor, n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = await createAsset(sql, staff, briefId, { sequenceNo: i + 1 });
      await startAsset(sql, staff, a.id);
      await submitAsset(sql, staff, a.id, `https://drive/${a.id}`);
      ids.push(a.id);
    }
    return ids;
  }

  it('atomicity: one bad row rejects the WHOLE batch — nothing written', async () => {
    const { briefId } = await creativeBrief(4);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    const staff = creativeStaff('ZZ-C');
    const submitted = await submittedAssets(briefId, staff, 3);
    const stillInProgress = await createAsset(sql, staff, briefId, { sequenceNo: 4 });
    await startAsset(sql, staff, stillInProgress.id);

    const report = await reviewAssetBatch(sql, am(), briefId, [...submitted, stillInProgress.id]);
    expect(report.applied).toBe(0);
    expect(report.rejected).toBe(1);
    expect(report.rejections[0].assetId).toBe(stillInProgress.id);
    expect(report.rejections[0].reason).toBe(bi.TRANSITION_NOT_ALLOWED);

    for (const id of submitted) {
      expect(await assetStatus(id)).toBe('[Submitted]'); // untouched
    }
    expect(await assetStatus(stillInProgress.id)).toBe('[In Progress]');
    // Brief never reached [Submitted] in the first place — quantity_target is 4 and
    // only 3/4 Assets are Submitted (the 4th is [In Progress]), so rollupTarget was
    // already pinned at [In Progress] before this batch call. The rejected batch
    // must leave it exactly there — proof the roll-up recompute never ran.
    expect(await briefStatus(briefId)).toBe('[In Progress]');
  });

  it('one rejection case per BI constant, asserted against the exported constant', async () => {
    const { briefId } = await creativeBrief(3);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    const staff = creativeStaff('ZZ-C');

    // Not found — id belongs to a different Brief.
    const other = await creativeBrief(1);
    await registerStaff('ZZ-C2', 'Creative', 'staff');
    const [foreignAsset] = await submittedAssets(other.briefId, creativeStaff('ZZ-C2'), 1);
    const notFound = await reviewAssetBatch(sql, am(), briefId, [foreignAsset]);
    expect(notFound.rejections[0].reason).toBe(MSG_ASSET_NOT_FOUND);

    // Forbidden — a different AM does not own this client.
    const [submitted] = await submittedAssets(briefId, staff, 1);
    // B-4 widened THIS door ([Submitted]->[In Review]) to the executing division's
    // lead, so its refusal now names both roles; the approve door below still
    // carries MSG_REVIEW_FORBIDDEN, which is why both constants stay asserted.
    const forbidden = await reviewAssetBatch(sql, am('ZZ-OTHER-AM'), briefId, [submitted]);
    expect(forbidden.rejections[0].reason).toBe(MSG_REVIEW_START_FORBIDDEN);

    // Wrong source state — approve before review.
    const wrongState = await approveAssetBatch(sql, am(), briefId, [submitted]);
    expect(wrongState.rejections[0].reason).toBe(bi.TRANSITION_NOT_ALLOWED);
  });

  it('§4 Flow 3 gate applies per row: Director always allowed, even without owning the client', async () => {
    const { briefId } = await creativeBrief(1);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    const [id] = await submittedAssets(briefId, creativeStaff('ZZ-C'), 1);
    const report = await reviewAssetBatch(sql, director(), briefId, [id]);
    expect(report.applied).toBe(1);
    expect(await assetStatus(id)).toBe('[In Review]');
  });

  it('clean batch of N applies all N and writes exactly N asset audit rows; two SEPARATE doors reach [Approved]', async () => {
    const { briefId } = await creativeBrief(3);
    await registerStaff('ZZ-C', 'Creative', 'staff');
    const ids = await submittedAssets(briefId, creativeStaff('ZZ-C'), 3);

    const reviewReport = await reviewAssetBatch(sql, am(), briefId, ids);
    expect(reviewReport.applied).toBe(3);
    expect(reviewReport.rejected).toBe(0);
    for (const id of ids) {
      expect(await assetStatus(id)).toBe('[In Review]');
    }
    expect(await briefStatus(briefId)).toBe('[In Review]');

    // Approving is a SEPARATE call/edge — one review-batch click does not
    // also approve (M16 §6/LT-30: waktuAmReviewHours needs the two
    // timestamps to stay distinct).
    expect(await briefStatus(briefId)).not.toBe('[Approved]');

    const approveReport = await approveAssetBatch(sql, am(), briefId, ids);
    expect(approveReport.applied).toBe(3);
    for (const id of ids) {
      expect(await assetStatus(id)).toBe('[Approved]');
      const n = await sql<{ n: string }[]>`
        select count(*) as n from audit_log where entity_type = 'asset' and entity_id = ${id} and action like 'transition:%'`;
      // start + submit + review + approve = 4 transitions, per Asset.
      expect(Number(n[0].n)).toBe(4);
    }
    expect(await briefStatus(briefId)).toBe('[Approved]');
  });

  it('rejects an empty batch and an unknown Brief without touching anything', async () => {
    const { briefId } = await creativeBrief(1);
    await expect(reviewAssetBatch(sql, am(), briefId, [])).rejects.toBeInstanceOf(ValidationError);
    await expect(reviewAssetBatch(sql, am(), 'BRF-GHOST-0', ['AST-GHOST-0'])).rejects.toBeInstanceOf(NotFoundError);
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
    // B-5/K-3 opened the READ side of Assets to the Ads division (`canSeeAsset`),
    // so an Advertiser now lists a Brief's Assets — that is the point: the picker
    // links to the Asset page, and a 403 there would be a dead end. The gate is
    // still shut for a division with no business in Creative output.
    expect((await listBriefAssets(sql, adsStaff(), briefId)).map((x) => x.sequenceNo)).toEqual([1, 2]);
    await expect(listBriefAssets(
      sql,
      { employeeId: 'ZZ-K', divisi: 'KOL', role: permission.makeRole({ division: 'KOL', level: 'staff' }) },
      briefId,
    )).rejects.toBeInstanceOf(ForbiddenError);
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

describeDb('listMyAssets — personal Asset queue (§3 Rule 2)', () => {
  it('returns only the caller\'s Assets, across Briefs/clients, sorted by due date (NULLs last)', async () => {
    await registerStaff('ZZ-RIAN', 'Creative', 'staff');
    await registerStaff('ZZ-DITA', 'Creative', 'staff');
    const rian = creativeStaff('ZZ-RIAN');

    // Two Briefs on two clients, with different Due Dates; one Brief left with no Due Date.
    const early = await creativeBrief(2); // due 2026-09-01
    const late = await creativeBrief(2); // due 2026-09-20
    const undated = await creativeBrief(1); // no due_date
    await sql`update briefs set due_date = '2026-09-01' where id = ${early.briefId}`;
    await sql`update briefs set due_date = '2026-09-20' where id = ${late.briefId}`;

    // Rian self-claims one Asset in each Brief; Dita takes one in `late` (must NOT appear for Rian).
    const aLate = await createAsset(sql, rian, late.briefId, { sequenceNo: 1 });
    const aEarly = await createAsset(sql, rian, early.briefId, { sequenceNo: 1 });
    const aUndated = await createAsset(sql, rian, undated.briefId, { sequenceNo: 1 });
    await createAsset(sql, creativeStaff('ZZ-DITA'), late.briefId, { sequenceNo: 2 });

    const queue = await listMyAssets(sql, rian);
    // Cross-brief, own-only, sorted by due date ascending with NULLs last.
    expect(queue.map((q) => q.id)).toEqual([aEarly.id, aLate.id, aUndated.id]);
    expect(queue.every((q) => q.status === '[To Do]')).toBe(true);
    // Carries the Brief/client context the queue view needs.
    const first = queue[0];
    expect(first.id).toBe(aEarly.id);
    expect(first.dueDate).toBe('2026-09-01');
    expect(first.priority).toBe('High');
    expect(first.clientName).toBe(first.clientId); // fixture sets clients.toko = client id
    expect(first.clientId).toMatch(/^CLI-/);
    expect(first.serviceId).toMatch(/^SVC-/);
    expect(queue.find((q) => q.id === aUndated.id)?.dueDate).toBeNull();

    // Dita sees only her own; a non-PIC (AM) sees an empty queue.
    const dita = await listMyAssets(sql, creativeStaff('ZZ-DITA'));
    expect(dita.map((q) => q.id)).toEqual([expect.any(String)]);
    expect(dita.every((q) => q.id !== aEarly.id && q.id !== aLate.id && q.id !== aUndated.id)).toBe(true);
    expect(await listMyAssets(sql, am())).toEqual([]);
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
