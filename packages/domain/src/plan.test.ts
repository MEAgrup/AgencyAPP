/**
 * M6B / backlog B-01 — the `PLAN-` schema, machine #16, and the read layer.
 *
 * B-01 has no write path (Rule 1: periods are generated on Strategi approval,
 * B-02), so the DB assertions insert periods directly as the owning superuser —
 * exactly what the B-02 generator will do — and prove the SHAPE holds:
 *
 *   1. machine #16 is registered and a period actually transitions through it;
 *   2. `lingkup` keeps its two forms honest (kontrak needs a contract + a
 *      Strategi version; klien forbids a contract) — the pairing that stops a
 *      hybrid row being stored;
 *   3. `nilai_strategi` is frozen BY THE DATABASE (the PE-5 anchor a service-role
 *      call must not be able to lower);
 *   4. a Plan row has exactly one origin (Strategi pillar / service / flagged
 *      out) — Rule 6's "no silent orphan";
 *   5. the hybrid-actuals shape (§8): manual needs proof, a dispute belongs only
 *      to an auto metric;
 *   6. only one period is `Aktif` per chain (Rule 5).
 *
 * Skipped without DATABASE_URL. "N skip" is not "N pass" (HANDOFF_M6ABC_SESI5
 * §9) — these are meaningless unless they reach Postgres.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { ForbiddenError, NotFoundError } from './account';
import { createStrategi } from './strategi';
import {
  MSG_PLAN_FORBIDDEN,
  MSG_PLAN_NOT_FOUND,
  canReadPlan,
  canWritePlan,
  computePeriods,
  generatePlanPeriods,
  getPlan,
  getPlanDetail,
  listPlansForContract,
} from './plan';

const am = (id = 'ZZ-AM') => ({
  employeeId: id,
  role: permission.makeRole({ division: 'Account', level: 'staff' }),
});
const otherAm = () => am('ZZ-AM2');
const spv = () => ({
  employeeId: 'ZZ-SPV',
  role: permission.makeRole({ division: 'Account', level: 'lead' }),
});
const director = () => ({
  employeeId: 'ZZ-DIR',
  role: permission.makeRole({ division: 'Account', level: 'staff', director: true }),
});
const od = () => ({
  employeeId: 'ZZ-OD',
  role: permission.makeRole({ division: 'Account', level: 'staff', od: true }),
});

// ---------------------------------------------------------------------------
// Pure permission predicates (no DB)
// ---------------------------------------------------------------------------

describe('permission predicates', () => {
  it('lets the owning AM, the Account lead and a Director write', () => {
    expect(canWritePlan(am(), 'ZZ-AM')).toBe(true);
    expect(canWritePlan(otherAm(), 'ZZ-AM')).toBe(false);
    expect(canWritePlan(spv(), 'ZZ-AM')).toBe(true);
    expect(canWritePlan(director(), 'ZZ-AM')).toBe(true);
    expect(canWritePlan(am(), null)).toBe(false);
  });

  it('adds the read-everywhere roles on the read side only', () => {
    expect(canReadPlan(od(), 'ZZ-AM')).toBe(true);
    expect(canWritePlan(od(), 'ZZ-AM')).toBe(false);
    expect(canReadPlan(otherAm(), 'ZZ-AM')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computePeriods — anniversary-month boundary math (no DB)
// ---------------------------------------------------------------------------

describe('computePeriods', () => {
  it('lays out the Alpha Digital contract exactly as §7 states', () => {
    const p = computePeriods('2026-08-12', 6);
    expect(p).toHaveLength(6);
    expect(p[0]).toMatchObject({
      periodeNo: 1,
      tanggalMulai: '2026-08-12',
      tanggalAkhir: '2026-09-11',
    });
    // Last period ends on the contract's last day (12 Aug + 6 months − 1 day).
    expect(p[5]).toMatchObject({
      periodeNo: 6,
      tanggalMulai: '2027-01-12',
      tanggalAkhir: '2027-02-11',
    });
    // Each period is one calendar month → 4 weeks (last absorbs 8-10 days, PD-4).
    expect(p.every((x) => x.jumlahMinggu >= 4 && x.jumlahMinggu <= 6)).toBe(true);
  });

  it('recovers the intended day after a short month — no permanent drift', () => {
    // The failure B-02 names: a cycle on the 31st must not stick to the 28th
    // once February clamps it.
    const p = computePeriods('2026-01-31', 4);
    expect(p.map((x) => x.tanggalMulai)).toEqual([
      '2026-01-31',
      '2026-02-28', // clamped (Feb 2026 = 28 days)
      '2026-03-31', // RECOVERED to the intended 31st, not drifted to the 28th
      '2026-04-30', // clamped again (Apr = 30 days)
    ]);
    expect(p[0].tanggalAkhir).toBe('2026-02-27');
    expect(p[2].tanggalAkhir).toBe('2026-04-29');
  });

  it('rejects a bad cycle-start and a non-positive count', () => {
    expect(() => computePeriods('2026-8-1', 3)).toThrow();
    expect(() => computePeriods('2026-08-12', 0)).toThrow();
  });
});

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
  await sql`delete from plan where created_by like 'ZZ-%'`;
  await sql`truncate strategi_version`;
  await sql`delete from strategi where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
});

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
            'Full Store Management', '40000000.00', '10%', '[Awaiting Onboarding]',
            true, 'plan_wajib', 'ZZ-AM')`;
  return serviceId;
}

const HEADER = {
  durasiKontrakBulan: 6,
  tanggalMulaiKontrak: '2026-08-12',
  tanggalAkhirKontrak: '2027-02-11',
  tanggalMulaiSiklus: '2026-08-12',
};

/** A full-management fixture: client → service → Strategi (with its Contract). */
async function seedContractStrategi(amId = 'ZZ-AM'): Promise<{
  clientId: string;
  contractId: string;
  strategiId: string;
}> {
  const clientId = await seedClient(amId);
  const serviceId = await seedService(clientId);
  const s = await createStrategi(sql, am(amId), serviceId, HEADER);
  return { clientId, contractId: s.contractId, strategiId: s.id };
}

/** Insert one period directly — what the B-02 generator will do. */
async function seedPeriod(
  f: { clientId: string; contractId: string | null; strategiId: string | null },
  opts: { periodeNo?: number; status?: string; lingkup?: string } = {},
): Promise<string> {
  seq += 1;
  const id = `ZZ-PLAN-${RUN}-${seq}`;
  await sql`
    insert into plan
      (id, lingkup, contract_id, client_id, strategi_id, periode_no,
       tanggal_mulai, tanggal_akhir, jumlah_minggu, status, created_by)
    values (${id}, ${opts.lingkup ?? 'kontrak'}, ${f.contractId}, ${f.clientId},
            ${f.strategiId}, ${opts.periodeNo ?? 1}, '2026-08-12', '2026-09-11', 5,
            ${opts.status ?? 'Terjadwal'}, 'ZZ-AM')`;
  return id;
}

// ---------------------------------------------------------------------------
// Machine #16
// ---------------------------------------------------------------------------

describeDb('machine #16 (plan)', () => {
  it('is registered with the PA-5 initial state and its terminals', async () => {
    const m = await sql<{ initial_state: string }[]>`
      select initial_state from sm_machines where name = 'plan'`;
    expect(m[0]?.initial_state).toBe('Terjadwal');
    const term = await sql<{ state: string }[]>`
      select state from sm_terminal_states where machine = 'plan' order by state`;
    expect(term.map((t) => t.state)).toEqual(['Ditutup', 'Ditutup Otomatis']);
  });

  it('carries exactly the edges §8 declares, with period-1 approval gated to a lead', async () => {
    const edges = await sql<{ from_state: string; to_state: string; require_lead: boolean }[]>`
      select from_state, to_state, require_lead from sm_edges where machine = 'plan'
       order by from_state, to_state`;
    // The two period-1 SPV transitions are lead-gated; the auto ones are not.
    const approve = edges.find((e) => e.from_state === 'Diajukan' && e.to_state === 'Aktif');
    expect(approve?.require_lead).toBe(true);
    const auto = edges.find((e) => e.from_state === 'Terjadwal' && e.to_state === 'Aktif');
    expect(auto?.require_lead).toBe(false);
    expect(edges).toHaveLength(9);
  });

  it('actually moves a period through sm_transition (Terjadwal → Draft), and blocks a bad edge', async () => {
    const f = await seedContractStrategi();
    const id = await seedPeriod(f, { status: 'Terjadwal' });
    const ok = await sql<{ r: { ok: boolean; to: string } }[]>`
      select sm_transition('plan','plan','plan','id','status', ${id}, 'Draft', 'ZZ-AM', false, false) as r`;
    expect(ok[0].r.ok).toBe(true);
    expect(ok[0].r.to).toBe('Draft');
    // Terjadwal → Ditutup is not an edge: blocked, not silently applied.
    const bad = await sql<{ r: { ok: boolean; code: string } }[]>`
      select sm_transition('plan','plan','plan','id','status', ${id}, 'Ditutup', 'ZZ-AM', false, false) as r`;
    expect(bad[0].r.ok).toBe(false);
    expect(bad[0].r.code).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// Shape invariants
// ---------------------------------------------------------------------------

describeDb('plan shape', () => {
  it('mints valid full-management periods and reads them back in order', async () => {
    const f = await seedContractStrategi();
    await seedPeriod(f, { periodeNo: 1, status: 'Aktif' });
    await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    const periods = await listPlansForContract(sql, am(), f.contractId);
    expect(periods.map((p) => p.periodeNo)).toEqual([1, 2]);
    expect(periods[0].status).toBe('Aktif');
    expect(periods[0].lingkup).toBe('kontrak');
    expect(periods[0].strategiId).toBe(f.strategiId);
  });

  it('refuses a kontrak period without a Strategi, and a klien period with a contract', async () => {
    const f = await seedContractStrategi();
    // kontrak but no strategi_id → ck_plan_lingkup_shape.
    await expect(
      seedPeriod({ ...f, strategiId: null }, { lingkup: 'kontrak' }),
    ).rejects.toThrow(/ck_plan_lingkup_shape/);
    // klien but carrying a contract_id → ck_plan_lingkup_shape.
    await expect(
      seedPeriod(f, { lingkup: 'klien' }),
    ).rejects.toThrow(/ck_plan_lingkup_shape/);
  });

  it('allows only one Aktif period per contract (Rule 5)', async () => {
    const f = await seedContractStrategi();
    await seedPeriod(f, { periodeNo: 1, status: 'Aktif' });
    await expect(
      seedPeriod(f, { periodeNo: 2, status: 'Aktif' }),
    ).rejects.toThrow(/uq_plan_aktif_kontrak/);
  });
});

// ---------------------------------------------------------------------------
// plan_target — the frozen anchor
// ---------------------------------------------------------------------------

describeDb('plan_target', () => {
  async function seedTarget(planId: string, over: Record<string, unknown> = {}): Promise<void> {
    await sql`
      insert into plan_target (plan_id, channel, metric, nilai_strategi, nilai_dipakai, created_by)
      values (${planId}, ${(over.channel as string) ?? 'Shopee'}, 'gmv',
              ${(over.nilai_strategi as number) ?? 195000000},
              ${(over.nilai_dipakai as number) ?? 195000000}, 'ZZ-AM')`;
  }

  it('freezes nilai_strategi at the DB, but lets nilai_dipakai move', async () => {
    const f = await seedContractStrategi();
    const id = await seedPeriod(f);
    await seedTarget(id);
    // Lowering the used figure is allowed (that is what Rule 9 governs) — moved
    // together with its direction + reason, as B-04 will always do.
    await sql`update plan_target set nilai_dipakai = 180000000, arah = 'turun', alasan = 'stok terbatas'
               where plan_id = ${id} and metric = 'gmv'`;
    // ...but the anchor cannot be touched, even by this superuser connection.
    await expect(
      sql`update plan_target set nilai_strategi = 100000000 where plan_id = ${id} and metric = 'gmv'`,
    ).rejects.toThrow(/target dari Strategi tidak dapat diubah/);
  });

  it('requires a reason when the direction is turun, and rejects an inconsistent direction', async () => {
    const f = await seedContractStrategi();
    const id = await seedPeriod(f);
    // arah=turun without alasan → ck_plan_target_alasan_turun.
    await expect(
      sql`insert into plan_target (plan_id, channel, metric, nilai_strategi, nilai_dipakai, arah, created_by)
          values (${id}, 'Shopee', 'gmv', 195000000, 180000000, 'turun', 'ZZ-AM')`,
    ).rejects.toThrow(/ck_plan_target_alasan_turun/);
    // arah=tetap but the figures differ → ck_plan_target_arah_konsisten.
    await expect(
      sql`insert into plan_target (plan_id, channel, metric, nilai_strategi, nilai_dipakai, arah, created_by)
          values (${id}, 'TikTok Shop', 'gmv', 20000000, 25000000, 'tetap', 'ZZ-AM')`,
    ).rejects.toThrow(/ck_plan_target_arah_konsisten/);
  });
});

// ---------------------------------------------------------------------------
// plan_row / plan_actual — origin & hybrid shape
// ---------------------------------------------------------------------------

describeDb('plan_row & plan_actual shape', () => {
  it('demands exactly one origin per row (Rule 6)', async () => {
    const f = await seedContractStrategi();
    const id = await seedPeriod(f);
    // No origin at all → ck_plan_row_asal_tunggal.
    await expect(
      sql`insert into plan_row (plan_id, channel, pilar, kuota, divisi_pic, created_by)
          values (${id}, 'Shopee', 'iklan', 3, 'Ads', 'ZZ-AM')`,
    ).rejects.toThrow(/ck_plan_row_asal_tunggal/);
    // Flagged out-of-strategy but no reason → ck_plan_row_di_luar_alasan.
    await expect(
      sql`insert into plan_row (plan_id, channel, pilar, kuota, divisi_pic, di_luar_strategi, created_by)
          values (${id}, 'Shopee', 'iklan', 3, 'Ads', true, 'ZZ-AM')`,
    ).rejects.toThrow(/ck_plan_row_di_luar_alasan/);
    // Flagged out-of-strategy WITH a reason → accepted.
    await sql`insert into plan_row (plan_id, channel, pilar, kuota, divisi_pic, di_luar_strategi, di_luar_alasan, created_by)
              values (${id}, 'Shopee', 'iklan', 3, 'Ads', true, 'scope creep disepakati klien', 'ZZ-AM')`;
    const n = await sql<{ n: number }[]>`select count(*)::int as n from plan_row where plan_id = ${id}`;
    expect(n[0].n).toBe(1);
  });

  it('makes manual actuals carry proof and confines a dispute to auto metrics', async () => {
    const f = await seedContractStrategi();
    const id = await seedPeriod(f);
    // manual without file/date → ck_plan_actual_manual_bukti.
    await expect(
      sql`insert into plan_actual (plan_id, channel, metric, sumber, nilai, created_by)
          values (${id}, 'Shopee', 'gmv', 'manual', 188000000, 'ZZ-AM')`,
    ).rejects.toThrow(/ck_plan_actual_manual_bukti/);
    // a dispute on a manual row makes no sense → ck_plan_actual_sengketa.
    await expect(
      sql`insert into plan_actual (plan_id, channel, metric, sumber, nilai, file_bukti, tanggal_ambil, sengketa, created_by)
          values (${id}, 'Shopee', 'gmv', 'manual', 188000000, 'export.pdf', '2026-09-12', 'salah', 'ZZ-AM')`,
    ).rejects.toThrow(/ck_plan_actual_sengketa/);
    // a well-formed manual GMV row → accepted.
    await sql`insert into plan_actual (plan_id, channel, metric, sumber, nilai, file_bukti, tanggal_ambil, created_by)
              values (${id}, 'Shopee', 'gmv', 'manual', 188000000, 'export.pdf', '2026-09-12', 'ZZ-AM')`;
  });
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describeDb('reads', () => {
  it('getPlanDetail bundles the header with its child rows', async () => {
    const f = await seedContractStrategi();
    const id = await seedPeriod(f);
    await sql`insert into plan_target (plan_id, channel, metric, nilai_strategi, nilai_dipakai, created_by)
              values (${id}, 'Shopee', 'gmv', 195000000, 195000000, 'ZZ-AM')`;
    await sql`insert into plan_row (plan_id, channel, pilar, kuota, satuan, divisi_pic, hasil_diharapkan, di_luar_service, di_luar_alasan, created_by)
              values (${id}, 'Shopee', 'iklan', 3, 'kampanye', 'Ads', 'ACOS <= 18%', true, 'uji', 'ZZ-AM')`;

    const detail = await getPlanDetail(sql, am(), id);
    expect(detail.plan.id).toBe(id);
    expect(detail.targets).toHaveLength(1);
    expect(detail.targets[0].nilaiStrategi).toBe(195000000);
    expect(detail.rows).toHaveLength(1);
    expect(detail.rows[0].diLuarService).toBe(true);
    expect(detail.review).toBeNull();
  });

  it('hides a period from an unrelated AM and 404s a missing id', async () => {
    const f = await seedContractStrategi();
    const id = await seedPeriod(f);
    await expect(getPlan(sql, otherAm(), id)).rejects.toThrow(MSG_PLAN_FORBIDDEN);
    await expect(getPlan(sql, otherAm(), id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getPlan(sql, am(), 'ZZ-PLAN-nope')).rejects.toThrow(MSG_PLAN_NOT_FOUND);
    await expect(getPlan(sql, am(), 'ZZ-PLAN-nope')).rejects.toBeInstanceOf(NotFoundError);
    // read-all still sees it.
    expect((await getPlan(sql, od(), id)).id).toBe(id);
  });
});

// ---------------------------------------------------------------------------
// generatePlanPeriods (B-02)
// ---------------------------------------------------------------------------

describeDb('generatePlanPeriods', () => {
  async function seedTargets(strategiId: string, months = 6): Promise<void> {
    // `pengunjung` (not gmv) so no floor is required by strategi_target CHECKs.
    for (let m = 1; m <= months; m += 1) {
      await sql`
        insert into strategi_target
          (strategi_id, channel, month_index, metric, nilai_floor, nilai_stretch, sumber_floor, created_by)
        values (${strategiId}, 'Shopee', ${m}, 'pengunjung', null, ${1000 + m}, null, 'ZZ-AM')`;
    }
  }

  it('mints n periods (1 Draft, rest Terjadwal) and prefills each month target', async () => {
    const f = await seedContractStrategi();
    await seedTargets(f.strategiId, 6);
    const ids = await sql.begin((tx) =>
      generatePlanPeriods(tx, am(), {
        id: f.strategiId,
        contractId: f.contractId,
        clientId: f.clientId,
        tanggalMulaiSiklus: '2026-08-12',
        durasiKontrakBulan: 6,
      }),
    );
    expect(ids).toHaveLength(6);
    expect(ids.every((id) => /^PLAN-\d{6}-\d{4}$/.test(id))).toBe(true);

    const periods = await listPlansForContract(sql, am(), f.contractId);
    expect(periods.map((p) => p.status)).toEqual([
      'Draft',
      'Terjadwal',
      'Terjadwal',
      'Terjadwal',
      'Terjadwal',
      'Terjadwal',
    ]);
    expect(periods[0].tanggalMulai).toBe('2026-08-12');
    expect(periods[0].strategiId).toBe(f.strategiId);

    // Each period carries its own month's target, anchored + frozen.
    const detail1 = await getPlanDetail(sql, am(), periods[0].id);
    expect(detail1.targets).toHaveLength(1);
    expect(detail1.targets[0]).toMatchObject({
      channel: 'Shopee',
      metric: 'pengunjung',
      nilaiStrategi: 1001,
      nilaiDipakai: 1001,
      arah: 'tetap',
    });
    const detail6 = await getPlanDetail(sql, am(), periods[5].id);
    expect(detail6.targets[0].nilaiStrategi).toBe(1006);
  });

  it('is idempotent by contract — a second run mints nothing', async () => {
    const f = await seedContractStrategi();
    await seedTargets(f.strategiId, 3);
    const first = await sql.begin((tx) =>
      generatePlanPeriods(tx, am(), {
        id: f.strategiId,
        contractId: f.contractId,
        clientId: f.clientId,
        tanggalMulaiSiklus: '2026-08-12',
        durasiKontrakBulan: 3,
      }),
    );
    expect(first).toHaveLength(3);
    const second = await sql.begin((tx) =>
      generatePlanPeriods(tx, am(), {
        id: f.strategiId,
        contractId: f.contractId,
        clientId: f.clientId,
        tanggalMulaiSiklus: '2026-08-12',
        durasiKontrakBulan: 3,
      }),
    );
    expect(second).toEqual([]);
    expect(await listPlansForContract(sql, am(), f.contractId)).toHaveLength(3);
  });
});
