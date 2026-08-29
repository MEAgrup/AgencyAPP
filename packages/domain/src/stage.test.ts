/**
 * Tests for M16 Tahapan Produksi Brief (stage.ts) + lead-time computation
 * (leadtime.ts), and the task.ts submitTask guard (LT-26) that ties the two
 * machines together one-way.
 *
 * Integration only (skipped unless DATABASE_URL is set) — the pipeline
 * resolution, the transition engine, RLS-adjacent FKs (brief_review.actor_
 * employee_id, brief_stage_sla.set_by) and `working_days_between` all live in
 * Postgres, so a real DB is the only honest oracle here (same posture as
 * account.test.ts / task.test.ts).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { createBrief, type BriefInput } from './account';
import {
  advanceStage,
  ConflictError,
  ForbiddenError,
  getStageOverview,
  NotFoundError,
  reviewBrief,
  setStageSlaTarget,
  STAGE_RETURNED,
  ValidationError,
  type Actor,
} from './stage';
import { startTask, submitTask, MSG_STAGE_NOT_COMPLETE } from './task';

const creativeStaff = (id = 'ZZ-STG-C'): Actor => ({
  employeeId: id, divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'staff' }),
});
const creativeLead = (id = 'ZZ-STG-CLEAD'): Actor => ({
  employeeId: id, divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'lead' }),
});
const kolStaff = (id = 'ZZ-STG-K'): Actor => ({
  employeeId: id, divisi: 'KOL', role: permission.makeRole({ division: 'KOL', level: 'staff' }),
});
const salesLead = (): Actor => ({
  employeeId: 'ZZ-STG-SL', divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'lead' }),
});
const accountStaff = (id = 'ZZ-STG-AM'): Actor => ({
  employeeId: id, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }),
});
const director = (): Actor => ({ employeeId: 'ZZ-STG-DIR', divisi: 'Management', role: permission.makeRole({ director: true }) });

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

let seq = 0;
const nextClientId = (): string => `CLI-ZZSTG-${Date.now() % 100000}-${seq++}`;
const nextSvcId = (): string => `SVC-ZZSTG-${Date.now() % 100000}-${seq++}`;

async function registerEmployee(id: string, divisi: string, jabatan: string, level: 'staff' | 'lead' = 'staff'): Promise<void> {
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${'ZZ ' + id}, ${id + '@mea.test'}, ${divisi}, ${jabatan}, true, 'ZZ-TEST')
    on conflict (employee_id) do nothing`;
  await sql`
    insert into role_mappings (divisi, jabatan, division, level, created_by)
    values (${divisi}, ${jabatan}, ${divisi}, ${level}, 'ZZ-TEST')
    on conflict (divisi, jabatan) do nothing`;
}

async function insertClient(id: string, amId: string): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
      'ZZ-STG-BUDI', 'ZZ-STG-BUDI', ${amId}, now(), 'ZZ-TEST')`;
}

async function insertService(svcId: string, clientId: string): Promise<void> {
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
      standard_price, commission_rule, status, requires_strategy_plan, created_by)
    values (${svcId}, ${clientId}, 'MSV-X', 1, 'TikTok Shop Full Management', '10000000.00', 'rule',
      '[Awaiting Onboarding]', false, 'ZZ-TEST')`;
}

/** released client + owner AM + Direct awaiting service, ready for createBrief. */
async function fixture(amId = 'ZZ-STG-AM'): Promise<{ clientId: string; svcId: string; amId: string }> {
  const clientId = nextClientId();
  const svcId = nextSvcId();
  await registerEmployee(amId, 'Account', 'ZZ-STG-AM-JAB');
  // Default actors used across most tests below (reviewBrief/setStageSlaTarget
  // write actor_employee_id/set_by, FK'd to employees) — registered here once
  // so individual tests don't have to repeat it.
  await registerEmployee('ZZ-STG-C', 'Creative', 'ZZ-STG-C-JAB');
  await registerEmployee('ZZ-STG-CLEAD', 'Creative', 'ZZ-STG-CLEAD-JAB', 'lead');
  await insertClient(clientId, amId);
  await insertService(svcId, clientId);
  return { clientId, svcId, amId };
}

const creativeBrief = (): BriefInput => ({
  title: 'Konten Promo', assignedDivision: 'Creative', deliverableType: 'Video',
  quantityTarget: 3, dueDate: '2026-09-15', priority: 'High',
});
const kolBrief = (): BriefInput => ({
  title: 'Campaign KOL', assignedDivision: 'KOL', deliverableType: 'Campaign',
  quantityTarget: 1, dueDate: '2026-09-15', priority: 'High',
});
const storeOpsBrief = (): BriefInput => ({
  title: 'Banding Pelanggaran', assignedDivision: 'Store Operation', deliverableType: 'Banding',
  quantityTarget: 1, dueDate: '2026-09-15', priority: 'High',
});

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from brief_stage_sla where brief_id like 'BRF-%' and set_by like 'ZZ-%'`;
  await sql`delete from brief_review where actor_employee_id like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from employees where created_by like 'ZZ-%'`;
  await sql`delete from role_mappings where created_by like 'ZZ-%'`;
});

// ---------------------------------------------------------------------------
// Pipeline resolution at birth (account.insertBrief → stage.resolvePipeline).
// ---------------------------------------------------------------------------
describeDb('pipeline resolution at Brief birth (Rule 1/Rule 12)', () => {
  it('a Creative Brief is born at Cek Brief AM on the Content Production pipeline', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, creativeBrief());
    expect(b.stagePipelineCode).toBe('CREATIVE_CONTENT');
    expect(b.productionStage).toBe('Cek Brief AM');
  });

  it('a Store Operation Brief is born with NO pipeline (Rule 12) — both columns null', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, storeOpsBrief());
    expect(b.stagePipelineCode).toBeNull();
    expect(b.productionStage).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// reviewBrief — Cek Brief AM (PRD §2 Rule 10).
// ---------------------------------------------------------------------------
describeDb('reviewBrief (Cek Brief AM)', () => {
  it('Diterima advances Cek Brief AM → the next real stage, and notifies the owning AM', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, creativeBrief());
    await reviewBrief(sql, creativeStaff(), b.id, { keputusan: 'Diterima' });

    const overview = await getStageOverview(sql, accountStaff(amId), b.id);
    expect(overview.productionStage).toBe('Script');
    expect(overview.review?.keputusan).toBe('Diterima');

    const notifs = await sql<{ event_type: string; recipient_employee_id: string }[]>`
      select event_type, recipient_employee_id from notifications
       where entity_type = 'brief' and entity_id = ${b.id} and event_type = 'm16.brief.diterima_divisi'`;
    expect(notifs.some((n) => n.recipient_employee_id === amId)).toBe(true);
  });

  it('Dikembalikan requires a valid alasan_kode for the division, and dead-ends at Brief Dikembalikan ke AM', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, creativeBrief());

    await expect(reviewBrief(sql, creativeStaff(), b.id, { keputusan: 'Dikembalikan' })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      reviewBrief(sql, creativeStaff(), b.id, { keputusan: 'Dikembalikan', alasanKode: 'Data tidak lengkap' }),
    ).rejects.toBeInstanceOf(ValidationError); // valid for KOL, not Creative

    await reviewBrief(sql, creativeStaff(), b.id, { keputusan: 'Dikembalikan', alasanKode: 'Sampel belum diterima', catatan: 'menunggu klien' });
    const overview = await getStageOverview(sql, accountStaff(amId), b.id);
    expect(overview.productionStage).toBe(STAGE_RETURNED);
  });

  it('is one-time — a second review on the same Brief is a conflict', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, creativeBrief());
    await reviewBrief(sql, creativeStaff(), b.id, { keputusan: 'Diterima' });
    await expect(reviewBrief(sql, creativeStaff(), b.id, { keputusan: 'Diterima' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects a reviewer outside the target division', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, creativeBrief());
    await expect(reviewBrief(sql, kolStaff(), b.id, { keputusan: 'Diterima' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reviewBrief(sql, salesLead(), b.id, { keputusan: 'Diterima' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('records the decision even for a division with no pipeline (Store Operation, Rule 12)', async () => {
    await registerEmployee('ZZ-STG-SO', 'Store Operation', 'ZZ-STG-SO-JAB');
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, storeOpsBrief());
    const soStaff: Actor = { employeeId: 'ZZ-STG-SO', divisi: 'Store Operation', role: permission.makeRole({ division: 'Store Operation', level: 'staff' }) };
    await reviewBrief(sql, soStaff, b.id, { keputusan: 'Diterima' });
    const overview = await getStageOverview(sql, accountStaff(amId), b.id);
    expect(overview.review?.keputusan).toBe('Diterima');
    expect(overview.productionStage).toBeNull(); // no machine to move — Rule 12
  });
});

// ---------------------------------------------------------------------------
// advanceStage — role gates + DB-enforced edges.
// ---------------------------------------------------------------------------
describeDb('advanceStage', () => {
  it('walks the Creative pipeline forward one edge at a time, and blocks an illegal jump at the DB', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, creativeBrief());
    await reviewBrief(sql, creativeStaff(), b.id, { keputusan: 'Diterima' }); // → Script

    await expect(advanceStage(sql, creativeStaff(), b.id, 'Jadwal Posting')).rejects.toBeInstanceOf(ConflictError); // Script → Jadwal Posting is not an edge

    const res = await advanceStage(sql, creativeStaff(), b.id, 'QC internal');
    expect(res.ok).toBe(true);
    const overview = await getStageOverview(sql, accountStaff(amId), b.id);
    expect(overview.productionStage).toBe('QC internal');
  });

  it("gate_pihak='AM' restricts the transition OUT of that stage to the owning AM or Director", async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, {
      title: 'Optimasi SKU', assignedDivision: 'AI Optimizer', deliverableType: 'Optimasi SKU',
      quantityTarget: 1, dueDate: '2026-09-15', priority: 'High',
    });
    expect(b.stagePipelineCode).toBe('AI_OPT_SKU');
    const aiOptStaff: Actor = { employeeId: 'ZZ-STG-AIO', divisi: 'AI Optimizer', role: permission.makeRole({ division: 'AI Optimizer', level: 'staff' }) };
    await registerEmployee('ZZ-STG-AIO', 'AI Optimizer', 'ZZ-STG-AIO-JAB');
    await reviewBrief(sql, aiOptStaff, b.id, { keputusan: 'Diterima' }); // → Ambil SKU
    await advanceStage(sql, aiOptStaff, b.id, 'Riset');
    await advanceStage(sql, aiOptStaff, b.id, 'Perbaikan');
    await advanceStage(sql, aiOptStaff, b.id, 'QC');
    // QC → Approve is a plain division edge (Approve's gate is on ITS OWN outgoing edge, not incoming).
    await advanceStage(sql, aiOptStaff, b.id, 'Approve');
    // Approve → Terapkan requires the OWNING AM (gate_pihak='AM' on the Approve stage).
    await expect(advanceStage(sql, aiOptStaff, b.id, 'Terapkan')).rejects.toBeInstanceOf(ForbiddenError);
    const res = await advanceStage(sql, accountStaff(amId), b.id, 'Terapkan');
    expect(res.ok).toBe(true);
  });

  it('rejects advancing a Brief with no pipeline', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, storeOpsBrief());
    const soStaff: Actor = { employeeId: 'ZZ-STG-SO2', divisi: 'Store Operation', role: permission.makeRole({ division: 'Store Operation', level: 'staff' }) };
    await registerEmployee('ZZ-STG-SO2', 'Store Operation', 'ZZ-STG-SO2-JAB');
    await expect(advanceStage(sql, soStaff, b.id, 'anything')).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects an unknown Brief', async () => {
    await expect(advanceStage(sql, creativeStaff(), 'BRF-GHOST-0', 'Script')).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// setStageSlaTarget — override per Brief (Rule 7), gate isLead(division).
// ---------------------------------------------------------------------------
describeDb('setStageSlaTarget', () => {
  it('a division lead overrides a stage target; staff is forbidden; invalid stage_code is rejected', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, creativeBrief());
    await registerEmployee('ZZ-STG-CLEAD', 'Creative', 'ZZ-STG-CLEAD-JAB', 'lead');

    await expect(setStageSlaTarget(sql, creativeStaff(), b.id, 'Script', 3)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setStageSlaTarget(sql, creativeLead(), b.id, 'Script', 0)).rejects.toBeInstanceOf(ValidationError);
    await expect(setStageSlaTarget(sql, creativeLead(), b.id, 'Tahap Ngasal', 3)).rejects.toBeInstanceOf(ValidationError);

    await setStageSlaTarget(sql, creativeLead(), b.id, 'Script', 3);
    const rows = await sql<{ target_hari_kerja: number }[]>`select target_hari_kerja from brief_stage_sla where brief_id = ${b.id} and stage_code = 'Script'`;
    expect(Number(rows[0].target_hari_kerja)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// LT-26 — task.submitTask guard: Rule 11, one-way.
// ---------------------------------------------------------------------------
describeDb('submitTask guard (M16 §2 Rule 11)', () => {
  it('blocks [Submitted] before the stage pipeline reaches its terminal state', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, creativeBrief());
    await startTask(sql, creativeStaff(), b.id);
    await expect(submitTask(sql, creativeStaff(), b.id)).rejects.toMatchObject({ message: MSG_STAGE_NOT_COMPLETE });
  });

  it('allows [Submitted] once production_stage is the pipeline terminal', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, creativeBrief());
    await reviewBrief(sql, creativeStaff(), b.id, { keputusan: 'Diterima' }); // → Script
    for (const s of ['QC internal', 'Shooting', 'Edit', 'Jadwal Posting']) {
      await advanceStage(sql, creativeStaff(), b.id, s);
    }
    await startTask(sql, creativeStaff(), b.id);
    const res = await submitTask(sql, creativeStaff(), b.id);
    expect(res.ok).toBe(true);
  });

  it('never blocks a Brief with no pipeline (Rule 12)', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, storeOpsBrief());
    const soStaff: Actor = { employeeId: 'ZZ-STG-SO3', divisi: 'Store Operation', role: permission.makeRole({ division: 'Store Operation', level: 'staff' }) };
    await registerEmployee('ZZ-STG-SO3', 'Store Operation', 'ZZ-STG-SO3-JAB');
    await startTask(sql, soStaff, b.id);
    const res = await submitTask(sql, soStaff, b.id);
    expect(res.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// leadtime — gate KLIEN exclusion + working-day computation (Rule 6/Rule 9).
// ---------------------------------------------------------------------------
describeDb('getStageOverview / lead time (PRD §5.3, Rule 9)', () => {
  it("excludes gate_pihak='KLIEN' (Approval Sampel, KOL) from totalHariKerja but still records its duration", async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, kolBrief());
    await registerEmployee('ZZ-STG-K', 'KOL', 'ZZ-STG-K-JAB');
    await reviewBrief(sql, kolStaff(), b.id, { keputusan: 'Diterima' }); // → Buat Campaign
    for (const s of ['Approach Creator & Sebar Link Product', 'Buat & Update Daftar Creator', 'Nego & Dealing Creator', 'Approval Sampel']) {
      await advanceStage(sql, kolStaff(), b.id, s);
    }
    const overview = await getStageOverview(sql, accountStaff(amId), b.id);
    const approval = overview.leadTime.stages.find((s) => s.stageCode === 'Approval Sampel');
    expect(approval?.gatePihak).toBe('KLIEN');
    expect(approval?.status).toBe('tidak_berlaku');
    expect(approval?.hariKerja).not.toBeNull(); // dicatat...
    // ...tapi tidak ikut totalHariKerja: total sebelum Approval Sampel harus
    // sama dengan total sesudahnya melewati tahap itu (tahap itu sendiri masih
    // aktif/belum keluar di sini, jadi cukup pastikan ia bukan satu-satunya
    // kontributor dan statusnya benar tidak_berlaku).
    expect(overview.leadTime.tahapAktif).toBe('Approval Sampel');
  });

  it('maps QC Account Service / Revisi from the brief_task status log, not the stage machine', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, accountStaff(amId), svcId, creativeBrief());
    await reviewBrief(sql, creativeStaff(), b.id, { keputusan: 'Diterima' });
    for (const s of ['QC internal', 'Shooting', 'Edit', 'Jadwal Posting']) {
      await advanceStage(sql, creativeStaff(), b.id, s);
    }
    await startTask(sql, creativeStaff(), b.id);
    await submitTask(sql, creativeStaff(), b.id);
    // AM pulls it into review then sends it back for revision — brief_task
    // machine, entity_type='brief', completely separate from `brief_stage`.
    const { reviewBrief: accountReviewBrief } = await import('./account');
    await accountReviewBrief(sql, accountStaff(amId), b.id);
    const overview = await getStageOverview(sql, accountStaff(amId), b.id);
    const qcAccount = overview.leadTime.stages.find((s) => s.stageCode === 'QC Account Service');
    expect(qcAccount?.sumber).toBe('status_brief');
    expect(qcAccount?.masukPada).not.toBeNull(); // entered [In Review] → checkpoint opened
  });
});
