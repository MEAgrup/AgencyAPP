/**
 * RAB-16 — `brief-inherit`: the one-click "warisi semua" from an Aktif Plan
 * period into division Briefs (keputusan pemilik 3).
 *
 * Two layers, tested separately:
 *   1. `planRowToBriefInput` — the pure projection (no DB), incl. its non-empty
 *      fallbacks for deliverable type + title;
 *   2. `inheritBriefsFromPlan` — the write path: it resolves each row's Service
 *      (service-origin vs Strategi-pillar origin vs skipped di-luar), links
 *      `briefs.plan_row_id`, is idempotent, advances the first-briefed Service,
 *      and is write-scoped + Aktif-gated.
 *
 * DB assertions are skipped without DATABASE_URL. "N skip" is not "N pass".
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { ConflictError, ForbiddenError, MSG_INVALID_PRIORITY, createBrief } from './account';
import { createStrategi } from './strategi';
import { MSG_PLAN_FORBIDDEN } from './plan';
import {
  MSG_INHERIT_PLAN_NOT_ACTIVE,
  inheritBriefsFromPlan,
  planRowToBriefInput,
  type BriefInheritFill,
} from './brief-inherit';
import type { PlanRow } from './plan';

// ---------------------------------------------------------------------------
// 1. Pure projection — planRowToBriefInput
// ---------------------------------------------------------------------------

/** A minimal PlanRow literal; only the fields the projection reads matter. */
function planRow(over: Partial<PlanRow> = {}): PlanRow {
  return {
    id: 1,
    planId: 'PLAN-1',
    channel: 'TikTok Shop',
    pilar: 'iklan',
    strategiPillarId: null,
    serviceId: null,
    diLuarStrategi: false,
    diLuarService: false,
    diLuarAlasan: null,
    aksi: 'boost 5 SKU Pareto',
    skuSasaran: [],
    kuota: 30,
    satuan: 'video',
    budget: null,
    divisiPic: 'Ads',
    mingguSasaran: [],
    prioritas: 'Penting',
    hasilDiharapkan: 'ROAS >= 8',
    prasyarat: null,
    instruksiBrief: null,
    statusBaris: 'Rencana',
    statusBarisAlasan: null,
    visibilitas: 'Bagikan ke Klien',
    keberatanKapasitas: false,
    keberatanAlasan: null,
    terbawa: false,
    periodeAsalId: null,
    keputusanCarryover: null,
    ...over,
  };
}

const FILL: BriefInheritFill = { planRowId: 1, dueDate: '2026-09-30', priority: 'High' };

describe('planRowToBriefInput (pure projection)', () => {
  it('inherits divisi/kuota/satuan/hasil and takes only due date + priority from the AM', () => {
    const b = planRowToBriefInput(planRow(), FILL);
    expect(b.assignedDivision).toBe('Ads');
    expect(b.quantityTarget).toBe(30);
    expect(b.deliverableType).toBe('video'); // ← satuan
    expect(b.title).toBe('ROAS >= 8'); // ← hasilDiharapkan
    expect(b.dueDate).toBe('2026-09-30');
    expect(b.priority).toBe('High');
    expect(b.instructions).toContain('Kanal: TikTok Shop');
    expect(b.instructions).toContain('Pilar: iklan');
    expect(b.instructions).toContain('Aksi: boost 5 SKU Pareto');
  });

  it('falls back to a non-empty deliverable type and title when satuan/hasil are blank', () => {
    const b = planRowToBriefInput(planRow({ satuan: '', hasilDiharapkan: '', aksi: 'x' }), FILL);
    expect(b.deliverableType).toBe('x'); // satuan blank → aksi
    expect(b.title).toBe('iklan — TikTok Shop'); // hasil blank → pilar — channel
    const b2 = planRowToBriefInput(planRow({ satuan: '', aksi: '', hasilDiharapkan: '' }), FILL);
    expect(b2.deliverableType).toBe('iklan'); // satuan + aksi blank → pilar
  });

  it('rounds a fractional quota to a whole count and includes prasyarat', () => {
    const b = planRowToBriefInput(planRow({ kuota: 12.6, prasyarat: 'materi klien siap' }), FILL);
    expect(b.quantityTarget).toBe(13);
    expect(b.instructions).toContain('Prasyarat: materi klien siap');
  });

  it('carries SKU Sasaran (PC-5) and Budget (PC-7) into the trace instead of dropping them', () => {
    const b = planRowToBriefInput(
      planRow({
        skuSasaran: ['SKU-001', { sku: 'SKU-002', peran: 'hero' }, { catatan: 'no sku key' }],
        budget: 5_000_000,
      }),
      FILL,
    );
    expect(b.instructions).toContain('SKU Sasaran: SKU-001, SKU-002');
    expect(b.instructions).toContain('Budget: Rp 5.000.000');
  });

  it('omits SKU Sasaran/Budget lines entirely when the row has neither', () => {
    const b = planRowToBriefInput(planRow({ skuSasaran: [], budget: null }), FILL);
    expect(b.instructions).not.toContain('SKU Sasaran');
    expect(b.instructions).not.toContain('Budget');
  });

  // Owner-added 2026-09-02 (not a PC-numbered field): free text or a link the
  // AM attaches to the row, e.g. because there is no other way to hand the
  // division the Brief's actual content before "Berikan Brief" is clicked.
  it('appends free-text instruksiBrief to the trace without touching referenceAttachments', () => {
    const b = planRowToBriefInput(planRow({ instruksiBrief: 'Fokus ke rak promo bulan ini' }), FILL);
    expect(b.instructions).toContain('Instruksi Brief: Fokus ke rak promo bulan ini');
    expect(b.referenceAttachments).toBeUndefined();
  });

  it('also lands a URL-shaped instruksiBrief on referenceAttachments (e.g. Google Drive)', () => {
    const url = 'https://drive.google.com/drive/folders/abc123';
    const b = planRowToBriefInput(planRow({ instruksiBrief: url }), FILL);
    expect(b.instructions).toContain(`Instruksi Brief: ${url}`);
    expect(b.referenceAttachments).toBe(url);
  });

  it('omits the Instruksi Brief line entirely when the row has none', () => {
    const b = planRowToBriefInput(planRow({ instruksiBrief: null }), FILL);
    expect(b.instructions).not.toContain('Instruksi Brief');
  });
});

// ---------------------------------------------------------------------------
// 2. Write path — inheritBriefsFromPlan (integration)
// ---------------------------------------------------------------------------

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  // Briefs first (FK → services; and their plan_row link is SET NULL on row drop).
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from plan where created_by like 'ZZ-%' or client_id like 'ZZ-CLI-%'`;
  await sql`truncate strategi_version`;
  await sql`delete from strategi where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
});

const am = (id = 'ZZ-AM') => ({
  employeeId: id,
  role: permission.makeRole({ division: 'Account', level: 'staff' }),
});
const otherAm = () => am('ZZ-AM2');

const RUN = Date.now().toString(36).slice(-6);
let seq = 0;

async function seedClient(amId = 'ZZ-AM'): Promise<string> {
  seq += 1;
  const clientId = `ZZ-CLI-${RUN}-${seq}`;
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${clientId}, 'Rani', 'Alpha Digital', 'Bandung', 'https://shopee.co.id/alpha',
            'Home Living', 0, 0, 0, 'ZZ-SALES', 'ZZ-SALES', ${amId}, now(), 'ZZ-AM')`;
  return clientId;
}

async function seedService(clientId: string): Promise<string> {
  seq += 1;
  const serviceId = `ZZ-SVC-${RUN}-${seq}`;
  const msv = await sql<{ service_id: string; version_no: number }[]>`
    select service_id, version_no from master_service_versions
     where name = 'Ads Management' order by version_no desc limit 1`;
  await sql`
    insert into services
      (id, client_id, master_service_id, master_version_no, name, standard_price,
       commission_rule, status, requires_strategy_plan, plan_tier, created_by)
    values (${serviceId}, ${clientId}, ${msv[0].service_id}, ${msv[0].version_no},
            'Full Store Management', '40000000.00', '10%', '[Strategy Approved]',
            true, 'plan_wajib', 'ZZ-AM')`;
  return serviceId;
}

/** A Direct (non-plan-gated) service — the manual STR- Brief path (RAB-17). */
async function seedDirectService(clientId: string): Promise<string> {
  seq += 1;
  const serviceId = `ZZ-SVC-${RUN}-${seq}`;
  const msv = await sql<{ service_id: string; version_no: number }[]>`
    select service_id, version_no from master_service_versions
     where name = 'Ads Management' order by version_no desc limit 1`;
  await sql`
    insert into services
      (id, client_id, master_service_id, master_version_no, name, standard_price,
       commission_rule, status, requires_strategy_plan, plan_tier, created_by)
    values (${serviceId}, ${clientId}, ${msv[0].service_id}, ${msv[0].version_no},
            'Konten Bulanan', '5000000.00', '10%', '[Awaiting Onboarding]',
            false, 'tanpa_plan', 'ZZ-AM')`;
  return serviceId;
}

const HEADER = {
  durasiKontrakBulan: 6,
  tanggalMulaiKontrak: '2026-08-12',
  tanggalAkhirKontrak: '2027-02-11',
  tanggalMulaiSiklus: '2026-08-12',
};

async function seedFullMgmt(amId = 'ZZ-AM'): Promise<{
  clientId: string;
  serviceId: string;
  contractId: string;
  strategiId: string;
}> {
  const clientId = await seedClient(amId);
  const serviceId = await seedService(clientId);
  const s = await createStrategi(sql, am(amId), serviceId, HEADER);
  return { clientId, serviceId, contractId: s.contractId, strategiId: s.id };
}

async function seedPeriod(
  f: { clientId: string; contractId: string | null; strategiId: string | null },
  opts: { status?: string; lingkup?: string; periodeNo?: number } = {},
): Promise<string> {
  seq += 1;
  const id = `ZZ-PLAN-${RUN}-${seq}`;
  await sql`
    insert into plan
      (id, lingkup, contract_id, client_id, strategi_id, periode_no,
       tanggal_mulai, tanggal_akhir, jumlah_minggu, status, created_by)
    values (${id}, ${opts.lingkup ?? 'kontrak'}, ${f.contractId}, ${f.clientId},
            ${f.strategiId}, ${opts.periodeNo ?? 1}, '2026-08-12', '2026-09-11', 5,
            ${opts.status ?? 'Aktif'}, 'ZZ-AM')`;
  return id;
}

async function seedPillar(strategiId: string, jenis = 'iklan'): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    insert into strategi_pillar (strategi_id, jenis, created_by)
    values (${strategiId}, ${jenis}, 'ZZ-AM') returning id`;
  return Number(rows[0].id);
}

async function seedRow(planId: string, over: Record<string, unknown>): Promise<number> {
  const base = {
    channel: 'TikTok Shop',
    pilar: 'iklan',
    strategi_pillar_id: null,
    service_id: null,
    di_luar_strategi: false,
    di_luar_service: false,
    di_luar_alasan: null,
    aksi: 'boost',
    kuota: 10,
    satuan: 'video',
    divisi_pic: 'Ads',
    hasil_diharapkan: 'ROAS >= 8',
    ...over,
  };
  const rows = await sql<{ id: number }[]>`
    insert into plan_row
      (plan_id, channel, pilar, strategi_pillar_id, service_id, di_luar_strategi, di_luar_service,
       di_luar_alasan, aksi, kuota, satuan, divisi_pic, hasil_diharapkan, created_by)
    values (${planId}, ${base.channel}, ${base.pilar}, ${base.strategi_pillar_id}, ${base.service_id},
            ${base.di_luar_strategi}, ${base.di_luar_service}, ${base.di_luar_alasan}, ${base.aksi},
            ${base.kuota}, ${base.satuan}, ${base.divisi_pic}, ${base.hasil_diharapkan}, 'ZZ-AM')
    returning id`;
  return Number(rows[0].id);
}

describeDb('inheritBriefsFromPlan (RAB-16)', () => {
  it('warisi a Strategi-pillar row into a Brief on the period Service, links plan_row_id, advances the Service', async () => {
    const f = await seedFullMgmt();
    const planId = await seedPeriod(f, { status: 'Aktif' });
    const pillarId = await seedPillar(f.strategiId);
    const rowId = await seedRow(planId, { strategi_pillar_id: pillarId, kuota: 30, satuan: 'video' });

    const res = await inheritBriefsFromPlan(sql, am(), planId, [
      { planRowId: rowId, dueDate: '2026-09-30', priority: 'High' },
    ]);
    expect(res.created).toHaveLength(1);
    expect(res.skipped).toHaveLength(0);
    const brief = res.created[0];
    expect(brief.serviceId).toBe(f.serviceId);
    expect(brief.assignedDivision).toBe('Ads');
    expect(brief.quantityTarget).toBe(30);
    expect(brief.strategyId).toBe(''); // STRG- world: no STR- strategy_id

    // plan_row_id is written (§8 trace).
    const link = await sql<{ plan_row_id: number }[]>`
      select plan_row_id from briefs where id = ${brief.id}`;
    expect(Number(link[0].plan_row_id)).toBe(rowId);
    // Service advanced to [Briefed] (§5 Flow 2).
    const svc = await sql<{ status: string }[]>`select status from services where id = ${f.serviceId}`;
    expect(svc[0].status).toBe('[Briefed]');
  });

  it('is idempotent: a second click skips the already-inherited row', async () => {
    const f = await seedFullMgmt();
    const planId = await seedPeriod(f, { status: 'Aktif' });
    const rowId = await seedRow(planId, { service_id: f.serviceId, strategi_pillar_id: null, pilar: 'konten', divisi_pic: 'Creative' });

    const first = await inheritBriefsFromPlan(sql, am(), planId, [
      { planRowId: rowId, dueDate: '2026-09-30', priority: 'Medium' },
    ]);
    expect(first.created).toHaveLength(1);
    const second = await inheritBriefsFromPlan(sql, am(), planId, [
      { planRowId: rowId, dueDate: '2026-09-30', priority: 'Medium' },
    ]);
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toEqual([{ planRowId: rowId, reason: 'sudah_diwarisi' }]);
    // Exactly one Brief exists for that row.
    const count = await sql<{ n: number }[]>`select count(*)::int as n from briefs where plan_row_id = ${rowId}`;
    expect(count[0].n).toBe(1);
  });

  it('skips zero-quota and invalid-division rows with reasons; still briefs the good one AND a di-luar row on the contract sole Service', async () => {
    const f = await seedFullMgmt();
    const planId = await seedPeriod(f, { status: 'Aktif' });
    const good = await seedRow(planId, { service_id: f.serviceId, pilar: 'konten', divisi_pic: 'Creative', kuota: 5 });
    // "Di Luar Strategi" on a Full-Management Plan is a governance flag (PG-1),
    // not a delivery block (Module 6B §1 Rule 6) — it still lands on the
    // contract's sole Service, same as a pillar-origin row (2026-09-02 fix).
    const diLuar = await seedRow(planId, {
      di_luar_strategi: true, di_luar_alasan: 'scope creep', divisi_pic: 'Ads', kuota: 3,
    });
    const zero = await seedRow(planId, { service_id: f.serviceId, kuota: 0 });
    const badDiv = await seedRow(planId, { service_id: f.serviceId, divisi_pic: 'Finance', kuota: 4 });

    const fills: BriefInheritFill[] = [good, diLuar, zero, badDiv].map((id) => ({
      planRowId: id,
      dueDate: '2026-09-30',
      priority: 'Low',
    }));
    const res = await inheritBriefsFromPlan(sql, am(), planId, fills);
    expect(res.created.map((b) => b.assignedDivision).sort()).toEqual(['Ads', 'Creative']);
    expect(res.created.every((b) => b.serviceId === f.serviceId)).toBe(true);
    const byRow = Object.fromEntries(res.skipped.map((s) => [s.planRowId, s.reason]));
    expect(byRow[zero]).toBe('kuota_nol');
    expect(byRow[badDiv]).toBe('divisi_pic_tidak_valid');
  });

  it('still skips di_luar_strategi with no Service anchor: a Plan Satuan (klien, no contract) row', async () => {
    const clientId = await seedClient();
    const planId = await seedPeriod({ clientId, contractId: null, strategiId: null }, { status: 'Aktif', lingkup: 'klien' });
    const rowId = await seedRow(planId, {
      di_luar_strategi: true, di_luar_alasan: 'belum ada service cocok', divisi_pic: 'Ads', kuota: 3,
    });

    const res = await inheritBriefsFromPlan(sql, am(), planId, [
      { planRowId: rowId, dueDate: '2026-09-30', priority: 'Low' },
    ]);
    expect(res.created).toHaveLength(0);
    expect(res.skipped).toEqual([{ planRowId: rowId, reason: 'di_luar' }]);
  });

  it('service_ambigu applies identically to a pillar row and a di_luar_strategi row on a multi-service contract', async () => {
    const f = await seedFullMgmt();
    const secondService = await seedService(f.clientId);
    await sql`update services set contract_id = ${f.contractId} where id = ${secondService}`;
    const planId = await seedPeriod(f, { status: 'Aktif' });
    const pillarId = await seedPillar(f.strategiId);
    const pillarRow = await seedRow(planId, { strategi_pillar_id: pillarId, kuota: 5 });
    const diLuarRow = await seedRow(planId, { di_luar_strategi: true, di_luar_alasan: 'x', kuota: 3 });

    const res = await inheritBriefsFromPlan(sql, am(), planId, [
      { planRowId: pillarRow, dueDate: '2026-09-30', priority: 'Low' },
      { planRowId: diLuarRow, dueDate: '2026-09-30', priority: 'Low' },
    ]);
    expect(res.created).toHaveLength(0);
    const byRow = Object.fromEntries(res.skipped.map((s) => [s.planRowId, s.reason]));
    expect(byRow[pillarRow]).toBe('service_ambigu');
    expect(byRow[diLuarRow]).toBe('service_ambigu');
  });

  it('skips a row with no AM fill (tanpa_jadwal) — AM only briefs what they scheduled', async () => {
    const f = await seedFullMgmt();
    const planId = await seedPeriod(f, { status: 'Aktif' });
    const rowId = await seedRow(planId, { service_id: f.serviceId, pilar: 'konten', divisi_pic: 'Creative' });
    const res = await inheritBriefsFromPlan(sql, am(), planId, []);
    expect(res.created).toHaveLength(0);
    expect(res.skipped).toEqual([{ planRowId: rowId, reason: 'tanpa_jadwal' }]);
  });

  it('is write-scoped and only on an Aktif period', async () => {
    const f = await seedFullMgmt();
    const draft = await seedPeriod(f, { status: 'Draft' });
    const rowId = await seedRow(draft, { service_id: f.serviceId, pilar: 'konten', divisi_pic: 'Creative' });
    const fill = [{ planRowId: rowId, dueDate: '2026-09-30', priority: 'Low' }];
    // Unrelated AM forbidden.
    await expect(inheritBriefsFromPlan(sql, otherAm(), draft, fill)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inheritBriefsFromPlan(sql, otherAm(), draft, fill)).rejects.toThrow(MSG_PLAN_FORBIDDEN);
    // Draft (not Aktif) rejected.
    await expect(inheritBriefsFromPlan(sql, am(), draft, fill)).rejects.toBeInstanceOf(ConflictError);
    await expect(inheritBriefsFromPlan(sql, am(), draft, fill)).rejects.toThrow(MSG_INHERIT_PLAN_NOT_ACTIVE);
  });

  it('validates the AM fills before any Brief is minted (bad priority / date)', async () => {
    const f = await seedFullMgmt();
    const planId = await seedPeriod(f, { status: 'Aktif' });
    const rowId = await seedRow(planId, { service_id: f.serviceId, pilar: 'konten', divisi_pic: 'Creative' });
    await expect(
      inheritBriefsFromPlan(sql, am(), planId, [{ planRowId: rowId, dueDate: '2026-09-30', priority: 'Urgent' }]),
    ).rejects.toThrow(MSG_INVALID_PRIORITY);
    await expect(
      inheritBriefsFromPlan(sql, am(), planId, [{ planRowId: rowId, dueDate: '30-09-2026', priority: 'Low' }]),
    ).rejects.toThrow();
    // Nothing was created.
    const n = await sql<{ n: number }[]>`select count(*)::int as n from briefs where plan_row_id = ${rowId}`;
    expect(n[0].n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RAB-17 — the manual STR- Brief path stays served, unchanged, alongside M6B.
// ---------------------------------------------------------------------------

describeDb('RAB-17 — manual STR- Brief coexists (plan_row_id NULL)', () => {
  it('createBrief on a Direct service leaves plan_row_id NULL — two worlds, one table', async () => {
    const clientId = await seedClient();
    const serviceId = await seedDirectService(clientId);
    const brief = await createBrief(sql, am(), serviceId, {
      title: 'Konten organik mingguan',
      assignedDivision: 'Creative',
      deliverableType: 'post',
      quantityTarget: 5,
      dueDate: '2026-09-30',
      priority: 'Low',
    });
    expect(brief.serviceId).toBe(serviceId);
    expect(brief.strategyId).toBe(''); // Direct: no STR- strategy either
    const link = await sql<{ plan_row_id: number | null }[]>`
      select plan_row_id from briefs where id = ${brief.id}`;
    expect(link[0].plan_row_id).toBeNull(); // manual path never sets the M6B link
  });
});
