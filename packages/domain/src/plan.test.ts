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
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './account';
import { createStrategi } from './strategi';
import {
  BIG_DATE_WEIGHT,
  DOWNWARD_APPROVAL_THRESHOLD_PCT,
  MSG_PLAN_ADJUST_ALASAN_REQUIRED,
  MSG_PLAN_ADJUST_BUKTI_REQUIRED,
  MSG_PLAN_ADJUST_NILAI_INVALID,
  MSG_PLAN_ADJUST_NOT_PENDING,
  MSG_PLAN_ADJUST_REJECT_NOTES_REQUIRED,
  MSG_PLAN_ADJUST_STATUS,
  MSG_PLAN_APPROVE_FORBIDDEN,
  MSG_PLAN_CATATAN_PEMBUKA_REQUIRED,
  MSG_PLAN_FORBIDDEN,
  MSG_PLAN_NOT_FOUND,
  MSG_PLAN_RETURN_NOTES_REQUIRED,
  MSG_PLAN_ROW_NOT_FOUND,
  MSG_PLAN_TARGET_NOT_FOUND,
  MSG_ACTUAL_BUKTI_REQUIRED,
  MSG_ACTUAL_METRIC_NOT_MANUAL,
  MSG_ACTUAL_NILAI_INVALID,
  MSG_ACTUAL_NOT_FOUND,
  MSG_PLAN_WEEK_NO_INVALID,
  MSG_PLAN_WEEK_STATUS,
  MSG_PLAN_WEEK_SUM_MISMATCH,
  MSG_SENGKETA_ALASAN_REQUIRED,
  MSG_SENGKETA_NOT_AUTO,
  MSG_CLOSE_STATUS,
  MSG_CLOSE_GMV_INCOMPLETE,
  MSG_CLOSE_ROWS_NOT_TERMINAL,
  MSG_CLOSE_REVIEW_INCOMPLETE,
  MSG_ROW_STATUS_INVALID,
  MSG_ROW_STATUS_ALASAN_REQUIRED,
  MSG_ROW_STATUS_PERIOD,
  MSG_REVIEW_PERIOD,
  MSG_REVIEW_DIAGNOSA_INVALID,
  MSG_CARRYOVER_KEPUTUSAN_INVALID,
  MSG_CARRYOVER_PERIOD,
  MSG_CARRYOVER_ROW_STATUS,
  MSG_CARRYOVER_ALREADY_DECIDED,
  MSG_CARRYOVER_NO_TARGET,
  MANUAL_METRICS,
  FORCE_CLOSE_ALASAN,
  ROW_TERMINAL_STATUSES,
  activatePlanPeriode,
  decideCarryOver,
  listCarryOverPending,
  adjustPlanTarget,
  approvePlanPeriode,
  approveTargetAdjustment,
  canApprovePlan,
  canReadPlan,
  canWritePlan,
  checkCloseReadiness,
  classifyAdjustment,
  closePlanPeriode,
  computePeriods,
  contractDeficit,
  distributeWeeks,
  fileSengketa,
  forceClosePlanPeriode,
  generatePlanPeriods,
  getPlan,
  getPlanDetail,
  listPlansForContract,
  recordAutoActual,
  recordManualActual,
  rejectTargetAdjustment,
  returnPlanPeriode,
  savePlanReview,
  setRowStatus,
  setWeeklyDistribution,
  submitPlanPeriode,
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

  it('gates period-1 approval to an Account lead / Director only (Rule 3)', () => {
    expect(canApprovePlan(spv())).toBe(true);
    expect(canApprovePlan(director())).toBe(true);
    // An AM cannot approve their own period; a read-only OD never writes.
    expect(canApprovePlan(am())).toBe(false);
    expect(canApprovePlan(od())).toBe(false);
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

describe('classifyAdjustment (Rule 9, pure)', () => {
  it('treats an unchanged figure as tetap with no guardrails', () => {
    expect(classifyAdjustment(200, 200)).toEqual({
      arah: 'tetap',
      persenPerubahan: 0,
      requiresReason: false,
      requiresBukti: false,
      requiresApproval: false,
    });
  });

  it('lets any upward move through free', () => {
    const up = classifyAdjustment(200, 250);
    expect(up.arah).toBe('naik');
    expect(up.persenPerubahan).toBe(25);
    expect(up.requiresReason).toBe(false);
    expect(up.requiresApproval).toBe(false);
  });

  it('requires a reason for a small downward move but no approval', () => {
    // 210 → 200 is −4.76%: reason mandatory, still activates immediately.
    const down = classifyAdjustment(210, 200);
    expect(down.arah).toBe('turun');
    expect(down.persenPerubahan).toBe(4.76);
    expect(down.requiresReason).toBe(true);
    expect(down.requiresBukti).toBe(false);
    expect(down.requiresApproval).toBe(false);
  });

  it('requires evidence + approval past the threshold, and holds exactly at it', () => {
    // Exactly 10% is NOT "> 10%": still auto (the boundary is deliberate).
    const at = classifyAdjustment(200, 180);
    expect(at.persenPerubahan).toBe(DOWNWARD_APPROVAL_THRESHOLD_PCT);
    expect(at.requiresApproval).toBe(false);
    // 200 → 150 is −25%: evidence + SPV approval.
    const over = classifyAdjustment(200, 150);
    expect(over.arah).toBe('turun');
    expect(over.persenPerubahan).toBe(25);
    expect(over.requiresBukti).toBe(true);
    expect(over.requiresApproval).toBe(true);
  });

  it('renders a zero anchor as 0% rather than dividing by zero (house rule #7)', () => {
    expect(classifyAdjustment(0, 500)).toMatchObject({ arah: 'naik', persenPerubahan: 0 });
  });
});

describe('distributeWeeks (Rule 7, pure)', () => {
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  it('splits evenly and always sums back to the quota', () => {
    expect(distributeWeeks(100, 5)).toEqual([20, 20, 20, 20, 20]);
    // 100 / 3 does not divide: remainder lands on the last weeks, sum preserved.
    const three = distributeWeeks(100, 3);
    expect(sum(three)).toBe(100);
    expect(three).toEqual([33.33, 33.33, 33.34]);
  });

  it('re-weights toward a big-date week (heavier share) and still balances', () => {
    // Week 3 emphasized → carries ~2× a plain week.
    const d = distributeWeeks(100, 5, [3]);
    expect(sum(d)).toBe(100);
    const max = Math.max(...d);
    expect(d[2]).toBe(max); // the big-date week is the heaviest
    // A plain week ≈ 100/6, the big-date week ≈ 2×; ratio reflects BIG_DATE_WEIGHT.
    expect(Math.round(d[2] / d[0])).toBe(BIG_DATE_WEIGHT);
  });

  it('keeps two-decimal quotas exact (no float drift)', () => {
    expect(sum(distributeWeeks(100.01, 4)).toFixed(2)).toBe('100.01');
    expect(sum(distributeWeeks(0, 5))).toBe(0);
  });

  it('rejects a non-positive week count', () => {
    expect(() => distributeWeeks(100, 0)).toThrow();
    expect(() => distributeWeeks(100, 2.5)).toThrow();
  });
});

describe('checkCloseReadiness (Rule 15, pure)', () => {
  const okReview = {
    planId: 'P',
    yangJalan: 'iklan Shopee naik',
    yangTidakJalan: 'live vendor telat',
    diagnosaGap: null,
    diagnosaGapBukti: null,
    rekomendasi: 'geser budget ke konten',
    perluRevisi: false,
    materiKlien: 'ROAS 4.6, GMV 200jt',
  } as const;
  const target = (channel: string, nilaiDipakai: number) => ({ channel, metric: 'gmv', nilaiDipakai });
  const manual = (channel: string, nilai: number) =>
    ({ channel, metric: 'gmv', sumber: 'manual', nilai }) as const;
  const terminalRow = { statusBaris: 'Selesai', statusBarisAlasan: null } as const;

  it('is ready when GMV is in for every channel, all rows terminal, review complete', () => {
    const r = checkCloseReadiness({
      targets: [target('Shopee', 100), target('TikTok Shop', 50)],
      actuals: [manual('Shopee', 120), manual('TikTok Shop', 60)],
      rows: [terminalRow],
      review: okReview,
    });
    expect(r).toMatchObject({ gmvComplete: true, rowsTerminal: true, reviewComplete: true, ready: true });
    expect(r.varianceNegative).toBe(false); // actual 180 > target 150
  });

  it('is not ready when a channel with a GMV target has no manual GMV', () => {
    const r = checkCloseReadiness({
      targets: [target('Shopee', 100), target('TikTok Shop', 50)],
      actuals: [manual('Shopee', 120)], // TikTok Shop missing
      rows: [terminalRow],
      review: okReview,
    });
    expect(r.gmvComplete).toBe(false);
    expect(r.ready).toBe(false);
  });

  it('does not count an AUTO gmv row as the manual entry', () => {
    const r = checkCloseReadiness({
      targets: [target('Shopee', 100)],
      actuals: [{ channel: 'Shopee', metric: 'gmv', sumber: 'otomatis', nilai: 120 }],
      rows: [terminalRow],
      review: okReview,
    });
    expect(r.gmvComplete).toBe(false);
  });

  it('rejects a non-terminal row, and a Sebagian/Tidak Dikerjakan row without a reason', () => {
    const base = { targets: [target('Shopee', 100)], actuals: [manual('Shopee', 120)], review: okReview };
    expect(checkCloseReadiness({ ...base, rows: [{ statusBaris: 'Jalan', statusBarisAlasan: null }] }).rowsTerminal).toBe(false);
    expect(checkCloseReadiness({ ...base, rows: [{ statusBaris: 'Sebagian', statusBarisAlasan: null }] }).rowsTerminal).toBe(false);
    expect(checkCloseReadiness({ ...base, rows: [{ statusBaris: 'Sebagian', statusBarisAlasan: 'stok telat' }] }).rowsTerminal).toBe(true);
    // 'Selesai' needs no reason.
    expect(checkCloseReadiness({ ...base, rows: [terminalRow] }).rowsTerminal).toBe(true);
  });

  it('requires the Diagnosa Gap (+ evidence) ONLY when variance is negative (PF-3)', () => {
    const shortfall = { targets: [target('Shopee', 200)], actuals: [manual('Shopee', 150)], rows: [terminalRow] };
    expect(checkCloseReadiness({ ...shortfall, review: okReview }).varianceNegative).toBe(true);
    // no diagnosa → not complete when short
    expect(checkCloseReadiness({ ...shortfall, review: okReview }).reviewComplete).toBe(false);
    // diagnosa enum but no evidence → still not complete
    expect(
      checkCloseReadiness({ ...shortfall, review: { ...okReview, diagnosaGap: 'eksekusi_tidak_jalan', diagnosaGapBukti: null } }).reviewComplete,
    ).toBe(false);
    // diagnosa + evidence → complete
    expect(
      checkCloseReadiness({ ...shortfall, review: { ...okReview, diagnosaGap: 'eksekusi_tidak_jalan', diagnosaGapBukti: '71% baris Selesai (PE-8)' } }).reviewComplete,
    ).toBe(true);
  });

  it('treats a null review, or one missing any W field, as incomplete', () => {
    const base = { targets: [target('Shopee', 100)], actuals: [manual('Shopee', 120)], rows: [terminalRow] };
    expect(checkCloseReadiness({ ...base, review: null }).reviewComplete).toBe(false);
    expect(checkCloseReadiness({ ...base, review: { ...okReview, rekomendasi: '  ' } }).reviewComplete).toBe(false);
    expect(checkCloseReadiness({ ...base, review: { ...okReview, perluRevisi: null } }).reviewComplete).toBe(false);
    expect(checkCloseReadiness({ ...base, review: { ...okReview, materiKlien: null } }).reviewComplete).toBe(false);
  });

  it('a period with no GMV target is vacuously GMV-complete', () => {
    const r = checkCloseReadiness({ targets: [], actuals: [], rows: [terminalRow], review: okReview });
    expect(r.gmvComplete).toBe(true);
  });

  it('exposes the terminal PC-14 statuses (the closeable set)', () => {
    expect([...ROW_TERMINAL_STATUSES].sort()).toEqual(['Sebagian', 'Selesai', 'Tidak Dikerjakan']);
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

// ---------------------------------------------------------------------------
// B-03 — lifecycle gates (machine #16)
// ---------------------------------------------------------------------------

async function statusOf(id: string): Promise<string> {
  const r = await sql<{ status: string }[]>`select status from plan where id = ${id}`;
  return r[0].status;
}

describeDb('submitPlanPeriode (Draft → Diajukan)', () => {
  it('lets the owning AM submit once the opening note is filled (PA-7)', async () => {
    const f = await seedContractStrategi();
    const id = await seedPeriod(f, { status: 'Draft' });
    // PA-7 is mandatory at submit — an empty opening is rejected first.
    await expect(submitPlanPeriode(sql, am(), id)).rejects.toThrow(
      MSG_PLAN_CATATAN_PEMBUKA_REQUIRED,
    );
    await expect(submitPlanPeriode(sql, am(), id)).rejects.toBeInstanceOf(ValidationError);
    await sql`update plan set catatan_pembuka = 'Fokus akuisisi bulan 1' where id = ${id}`;
    const plan = await submitPlanPeriode(sql, am(), id);
    expect(plan.status).toBe('Diajukan');
  });

  it('refuses an unrelated AM, and lets the machine confine it to period 1', async () => {
    const f = await seedContractStrategi();
    const draft = await seedPeriod(f, { periodeNo: 1, status: 'Draft' });
    await sql`update plan set catatan_pembuka = 'x' where id = ${draft}`;
    await expect(submitPlanPeriode(sql, otherAm(), draft)).rejects.toThrow(MSG_PLAN_FORBIDDEN);
    // A period 2..n never sits in Draft: with the note set, the move is still
    // blocked because Terjadwal has no `→ Diajukan` edge (not a silent no-op).
    const sched = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    await sql`update plan set catatan_pembuka = 'x' where id = ${sched}`;
    await expect(submitPlanPeriode(sql, am(), sched)).rejects.toBeInstanceOf(ConflictError);
    expect(await statusOf(sched)).toBe('Terjadwal');
  });
});

describeDb('approvePlanPeriode (Diajukan → Aktif)', () => {
  it('activates period 1 when the SPV approves, and switches on the chain', async () => {
    const f = await seedContractStrategi();
    const id = await seedPeriod(f, { periodeNo: 1, status: 'Diajukan' });
    const plan = await approvePlanPeriode(sql, spv(), id);
    expect(plan.status).toBe('Aktif');
  });

  it('refuses a non-lead, and blocks approval of a period not yet submitted', async () => {
    const f = await seedContractStrategi();
    const diajukan = await seedPeriod(f, { periodeNo: 1, status: 'Diajukan' });
    // An AM (even the owner) is not the SPV — the domain gate refuses before the DB.
    await expect(approvePlanPeriode(sql, am(), diajukan)).rejects.toThrow(
      MSG_PLAN_APPROVE_FORBIDDEN,
    );
    await expect(approvePlanPeriode(sql, am(), diajukan)).rejects.toBeInstanceOf(ForbiddenError);
    // A Draft has no `→ Aktif` edge: the SPV cannot skip the AM's submit.
    const draft = await seedPeriod(f, { periodeNo: 2, status: 'Draft' });
    await expect(approvePlanPeriode(sql, spv(), draft)).rejects.toBeInstanceOf(ConflictError);
    expect(await statusOf(draft)).toBe('Draft');
  });

  it('404s a missing period', async () => {
    await expect(approvePlanPeriode(sql, spv(), 'PLAN-209901-9999')).rejects.toThrow(
      MSG_PLAN_NOT_FOUND,
    );
  });
});

describeDb('returnPlanPeriode (Diajukan → Draft)', () => {
  it('sends period 1 back with a mandatory note recorded in the audit log', async () => {
    const f = await seedContractStrategi();
    const id = await seedPeriod(f, { periodeNo: 1, status: 'Diajukan' });
    // A blank note is rejected before anything moves (checked ahead of the gate).
    await expect(returnPlanPeriode(sql, spv(), id, '   ')).rejects.toThrow(
      MSG_PLAN_RETURN_NOTES_REQUIRED,
    );
    await expect(returnPlanPeriode(sql, spv(), id, '')).rejects.toBeInstanceOf(ValidationError);
    expect(await statusOf(id)).toBe('Diajukan');

    const plan = await returnPlanPeriode(sql, spv(), id, 'Target Shopee terlalu agresif');
    expect(plan.status).toBe('Draft');
    // The note lands in the immutable log (Rule 19), not on a mutable column.
    const audit = await sql<{ after_json: { catatan?: string } }[]>`
      select after_json from audit_log
       where entity_type = 'plan' and entity_id = ${id} and action = 'dikembalikan'`;
    expect(audit).toHaveLength(1);
    expect(audit[0].after_json.catatan).toBe('Target Shopee terlalu agresif');
  });

  it('refuses a non-lead even with a note', async () => {
    const f = await seedContractStrategi();
    const id = await seedPeriod(f, { periodeNo: 1, status: 'Diajukan' });
    await expect(returnPlanPeriode(sql, am(), id, 'coba')).rejects.toThrow(
      MSG_PLAN_APPROVE_FORBIDDEN,
    );
    expect(await statusOf(id)).toBe('Diajukan');
  });
});

describeDb('activatePlanPeriode (Terjadwal → Aktif, periods 2..n)', () => {
  it('auto-activates a scheduled period WITHOUT a lead (the service-role path)', async () => {
    const f = await seedContractStrategi();
    // Period 1 closed, period 2 scheduled — the one-Aktif-per-chain rule is free.
    await seedPeriod(f, { periodeNo: 1, status: 'Ditutup' });
    const p2 = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    // A staff AM is explicitly NOT a lead: activation still succeeds, proving the
    // edge is not lead-gated (Rule 4). The 00:00 WIB job (B-09) is the real caller.
    const plan = await activatePlanPeriode(sql, am(), p2);
    expect(plan.status).toBe('Aktif');
  });

  it('refuses an unrelated account', async () => {
    const f = await seedContractStrategi();
    const p2 = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    await expect(activatePlanPeriode(sql, otherAm(), p2)).rejects.toThrow(MSG_PLAN_FORBIDDEN);
    expect(await statusOf(p2)).toBe('Terjadwal');
  });
});

// ---------------------------------------------------------------------------
// B-04 — Rule 9 asymmetric target adjustment + defisit_terbawa
// ---------------------------------------------------------------------------

/** Seed one GMV target on a period (the shape the B-02 generator prefills). */
async function seedTarget(
  planId: string,
  opts: { channel?: string; metric?: string; nilaiStrategi?: number } = {},
): Promise<void> {
  const v = opts.nilaiStrategi ?? 200000000;
  await sql`
    insert into plan_target (plan_id, channel, metric, nilai_strategi, nilai_dipakai, created_by)
    values (${planId}, ${opts.channel ?? 'Shopee'}, ${opts.metric ?? 'gmv'}, ${v}, ${v}, 'ZZ-AM')`;
}

async function targetOf(planId: string, channel = 'Shopee', metric = 'gmv') {
  const r = await sql<
    { nilai_dipakai: string | number; arah: string; persen_perubahan: string | number; status_persetujuan: string | null }[]
  >`select nilai_dipakai, arah, persen_perubahan, status_persetujuan
      from plan_target where plan_id = ${planId} and channel = ${channel} and metric = ${metric}`;
  return r[0];
}

describeDb('adjustPlanTarget (Rule 9 write path)', () => {
  it('applies an upward move immediately, no reason, period stays scheduled', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    await seedTarget(p, { nilaiStrategi: 200000000 });
    const t = await adjustPlanTarget(sql, am(), p, 'Shopee', 'gmv', 250000000);
    expect(t.arah).toBe('naik');
    expect(t.nilaiDipakai).toBe(250000000);
    expect(t.statusPersetujuan).toBeNull();
    expect(await statusOf(p)).toBe('Terjadwal');
  });

  it('requires a reason for a downward ≤10% move, then applies it and notifies (seam)', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    await seedTarget(p, { nilaiStrategi: 210000000 });
    // No reason → rejected before the write.
    await expect(adjustPlanTarget(sql, am(), p, 'Shopee', 'gmv', 200000000)).rejects.toThrow(
      MSG_PLAN_ADJUST_ALASAN_REQUIRED,
    );
    const t = await adjustPlanTarget(sql, am(), p, 'Shopee', 'gmv', 200000000, {
      alasan: 'Kompetitor agresif, target dikoreksi',
    });
    expect(t.arah).toBe('turun');
    expect(t.persenPerubahan).toBe(4.76);
    expect(t.statusPersetujuan).toBeNull();
    // ≤10% activates immediately — no hold.
    expect(await statusOf(p)).toBe('Terjadwal');
    // The adjustment is in the immutable log (Rule 19).
    const audit = await sql<{ n: string }[]>`
      select count(*)::text as n from audit_log
       where entity_id = ${p} and action = 'penyesuaian_target'`;
    expect(audit[0].n).toBe('1');
  });

  it('holds a scheduled period at Menunggu Persetujuan for a downward >10% move', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    await seedTarget(p, { nilaiStrategi: 200000000 });
    // >10% needs BOTH reason and evidence.
    await expect(
      adjustPlanTarget(sql, am(), p, 'Shopee', 'gmv', 150000000, { alasan: 'x' }),
    ).rejects.toThrow(MSG_PLAN_ADJUST_BUKTI_REQUIRED);
    const t = await adjustPlanTarget(sql, am(), p, 'Shopee', 'gmv', 150000000, {
      alasan: 'Penurunan permintaan',
      buktiFile: 's3://bukti.png',
    });
    expect(t.statusPersetujuan).toBe('Menunggu Persetujuan');
    expect(await statusOf(p)).toBe('Menunggu Persetujuan');
  });

  it('does NOT hold period 1 (Draft) — its own SPV loop covers the >10% figure', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 1, status: 'Draft' });
    await seedTarget(p, { nilaiStrategi: 200000000 });
    const t = await adjustPlanTarget(sql, am(), p, 'Shopee', 'gmv', 150000000, {
      alasan: 'Penurunan permintaan',
      buktiFile: 's3://bukti.png',
    });
    expect(t.arah).toBe('turun');
    expect(t.statusPersetujuan).toBeNull();
    expect(await statusOf(p)).toBe('Draft');
  });

  it('refuses to adjust an active period, an unrelated AM, a missing target, and a negative figure', async () => {
    const f = await seedContractStrategi();
    const active = await seedPeriod(f, { periodeNo: 1, status: 'Aktif' });
    await seedTarget(active, {});
    await expect(adjustPlanTarget(sql, am(), active, 'Shopee', 'gmv', 190000000, { alasan: 'x' })).rejects.toThrow(
      MSG_PLAN_ADJUST_STATUS,
    );
    const p = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    await seedTarget(p, {});
    await expect(adjustPlanTarget(sql, otherAm(), p, 'Shopee', 'gmv', 190000000, { alasan: 'x' })).rejects.toThrow(
      MSG_PLAN_FORBIDDEN,
    );
    await expect(adjustPlanTarget(sql, am(), p, 'Tokopedia', 'gmv', 190000000, { alasan: 'x' })).rejects.toThrow(
      MSG_PLAN_TARGET_NOT_FOUND,
    );
    await expect(adjustPlanTarget(sql, am(), p, 'Shopee', 'gmv', -1, { alasan: 'x' })).rejects.toThrow(
      MSG_PLAN_ADJUST_NILAI_INVALID,
    );
  });
});

describeDb('approve / reject target adjustment (SPV, PH-3)', () => {
  async function heldPeriod() {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    await seedTarget(p, { nilaiStrategi: 200000000 });
    await adjustPlanTarget(sql, am(), p, 'Shopee', 'gmv', 150000000, {
      alasan: 'Penurunan permintaan',
      buktiFile: 's3://bukti.png',
    });
    return { f, p };
  }

  it('lets the SPV approve — the reduced figure stands, activation stays with the job', async () => {
    const { p } = await heldPeriod();
    const t = await approveTargetAdjustment(sql, spv(), p, 'Shopee', 'gmv');
    expect(t.statusPersetujuan).toBe('Disetujui');
    expect(t.nilaiDipakai).toBe(150000000);
    // Approval does not activate — the period still waits for the 00:00 WIB job.
    expect(await statusOf(p)).toBe('Menunggu Persetujuan');
  });

  it('reverts to the Strategi figure on rejection, with a mandatory note in the log', async () => {
    const { p } = await heldPeriod();
    await expect(rejectTargetAdjustment(sql, spv(), p, 'Shopee', 'gmv', '  ')).rejects.toThrow(
      MSG_PLAN_ADJUST_REJECT_NOTES_REQUIRED,
    );
    const t = await rejectTargetAdjustment(sql, spv(), p, 'Shopee', 'gmv', 'Bukti kurang meyakinkan');
    expect(t.statusPersetujuan).toBe('Ditolak');
    expect(t.nilaiDipakai).toBe(200000000);
    expect(t.arah).toBe('tetap');
    const audit = await sql<{ after_json: { catatan?: string } }[]>`
      select after_json from audit_log where entity_id = ${p} and action = 'penyesuaian_ditolak'`;
    expect(audit[0].after_json.catatan).toBe('Bukti kurang meyakinkan');
  });

  it('refuses a non-lead and 409s when nothing is pending', async () => {
    const { p } = await heldPeriod();
    await expect(approveTargetAdjustment(sql, am(), p, 'Shopee', 'gmv')).rejects.toThrow(
      MSG_PLAN_APPROVE_FORBIDDEN,
    );
    await approveTargetAdjustment(sql, spv(), p, 'Shopee', 'gmv');
    // Second approve: no longer pending.
    await expect(approveTargetAdjustment(sql, spv(), p, 'Shopee', 'gmv')).rejects.toThrow(
      MSG_PLAN_ADJUST_NOT_PENDING,
    );
  });
});

describeDb('activatePlanPeriode resolves a held period (Rule 4)', () => {
  it('expires an unanswered >10% request and activates on the ORIGINAL target', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    await seedTarget(p, { nilaiStrategi: 200000000 });
    await adjustPlanTarget(sql, am(), p, 'Shopee', 'gmv', 150000000, {
      alasan: 'Penurunan permintaan',
      buktiFile: 's3://bukti.png',
    });
    expect(await statusOf(p)).toBe('Menunggu Persetujuan');
    const plan = await activatePlanPeriode(sql, am(), p);
    expect(plan.status).toBe('Aktif');
    const t = await targetOf(p);
    expect(Number(t.nilai_dipakai)).toBe(200000000); // reverted to original
    expect(t.arah).toBe('tetap');
    expect(t.status_persetujuan).toBe('Kedaluwarsa');
  });

  it('keeps an APPROVED reduced target when the period activates', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    await seedTarget(p, { nilaiStrategi: 200000000 });
    await adjustPlanTarget(sql, am(), p, 'Shopee', 'gmv', 150000000, {
      alasan: 'Penurunan permintaan',
      buktiFile: 's3://bukti.png',
    });
    await approveTargetAdjustment(sql, spv(), p, 'Shopee', 'gmv');
    const plan = await activatePlanPeriode(sql, am(), p);
    expect(plan.status).toBe('Aktif');
    const t = await targetOf(p);
    expect(Number(t.nilai_dipakai)).toBe(150000000); // approved figure stands
    expect(t.status_persetujuan).toBe('Disetujui');
  });
});

describeDb('defisit_terbawa (Rule 9 / PA-6, computed)', () => {
  it('carries a committed shortfall forward but never a pending one', async () => {
    const f = await seedContractStrategi();
    const p1 = await seedPeriod(f, { periodeNo: 1, status: 'Terjadwal' });
    await seedTarget(p1, { nilaiStrategi: 200000000 });
    // Period 1 dropped 200 → 190 (−5%, committed): Rp 10jt shortfall.
    await adjustPlanTarget(sql, am(), p1, 'Shopee', 'gmv', 190000000, { alasan: 'koreksi' });

    const p2 = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    await seedTarget(p2, { nilaiStrategi: 200000000 });

    // PA-6 on period 2 = the shortfall carried from period 1; period 1 itself
    // has nothing before it.
    expect((await getPlanDetail(sql, am(), p2)).defisitTerbawa).toBe(10000000);
    expect((await getPlanDetail(sql, am(), p1)).defisitTerbawa).toBe(0);
    // Contract rollup = sum across the whole chain.
    expect(await contractDeficit(sql, am(), f.contractId)).toBe(10000000);

    // A pending >10% request on period 2 does NOT count until it takes effect.
    await adjustPlanTarget(sql, am(), p2, 'Shopee', 'gmv', 150000000, {
      alasan: 'Penurunan permintaan',
      buktiFile: 's3://b.png',
    });
    expect(await contractDeficit(sql, am(), f.contractId)).toBe(10000000);
    // Once approved, its Rp 50jt joins the deficit.
    await approveTargetAdjustment(sql, spv(), p2, 'Shopee', 'gmv');
    expect(await contractDeficit(sql, am(), f.contractId)).toBe(60000000);
  });
});

// ---------------------------------------------------------------------------
// B-05 — derived weekly distribution (Rule 7)
// ---------------------------------------------------------------------------

/** Seed one monthly work-row (the shape Briefs are created from). */
async function seedRow(planId: string, kuota = 100): Promise<number> {
  const r = await sql<{ id: string | number }[]>`
    insert into plan_row
      (plan_id, channel, pilar, kuota, satuan, divisi_pic, hasil_diharapkan,
       di_luar_service, di_luar_alasan, created_by)
    values (${planId}, 'Shopee', 'iklan', ${kuota}, 'kampanye', 'Ads', 'ACOS <= 18%',
            true, 'uji', 'ZZ-AM')
    returning id`;
  return Number(r[0].id);
}

async function weeksOf(rowId: number) {
  return sql<{ minggu_no: number; kuota: string | number }[]>`
    select minggu_no, kuota from plan_row_week where plan_row_id = ${rowId} order by minggu_no`;
}

describeDb('plan_row_week sum trigger (Rule 7, DB-enforced)', () => {
  it('rejects weeks that do not sum to the monthly quota, naming the row + delta', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    const rid = await seedRow(p, 100);
    // One 50-week against a 100 quota: the deferred trigger fires at commit.
    await expect(
      sql`insert into plan_row_week (plan_row_id, minggu_no, kuota, created_by)
          values (${rid}, 1, 50, 'ZZ-AM')`,
    ).rejects.toThrow(/distribusi mingguan baris .* selisih/);
  });

  it('accepts a balanced distribution written in one transaction', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    const rid = await seedRow(p, 100);
    await sql.begin(async (tx) => {
      await tx`insert into plan_row_week (plan_row_id, minggu_no, kuota, created_by) values (${rid}, 1, 60, 'ZZ-AM')`;
      await tx`insert into plan_row_week (plan_row_id, minggu_no, kuota, created_by) values (${rid}, 2, 40, 'ZZ-AM')`;
    });
    expect((await weeksOf(rid)).map((w) => Number(w.kuota))).toEqual([60, 40]);
  });

  it('a row with no weeks yet is valid (pre-distribution)', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    const rid = await seedRow(p, 100);
    expect(await weeksOf(rid)).toHaveLength(0);
  });

  it('re-checks when the monthly quota moves under existing weeks', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    const rid = await seedRow(p, 100);
    await sql.begin(async (tx) => {
      await tx`insert into plan_row_week (plan_row_id, minggu_no, kuota, created_by) values (${rid}, 1, 60, 'ZZ-AM')`;
      await tx`insert into plan_row_week (plan_row_id, minggu_no, kuota, created_by) values (${rid}, 2, 40, 'ZZ-AM')`;
    });
    // Lowering the quota to 90 leaves the weeks summing to 100 → rejected.
    await expect(sql`update plan_row set kuota = 90 where id = ${rid}`).rejects.toThrow(
      /distribusi mingguan/,
    );
  });
});

describeDb('deriveWeeklyDistribution (on activation)', () => {
  it('splits every monthly row across the weeks on activation, summing to quota', async () => {
    const f = await seedContractStrategi();
    // Big date in week 3 of the period (2026-08-12 start, 5 weeks).
    await sql`insert into strategi_tanggal_besar (strategi_id, tanggal, nama, peran, created_by)
              values (${f.strategiId}, '2026-08-26', '9.9', 'puncak kampanye', 'ZZ-AM')`;
    const p = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    const rid = await seedRow(p, 100);
    const plan = await activatePlanPeriode(sql, am(), p);
    expect(plan.status).toBe('Aktif');
    const w = await weeksOf(rid);
    expect(w).toHaveLength(5);
    expect(w.reduce((a, x) => a + Number(x.kuota), 0)).toBe(100);
    // The big-date week (no. 3) carries the heaviest share (Rule 7 re-weight).
    const kuotas = w.map((x) => Number(x.kuota));
    expect(kuotas[2]).toBe(Math.max(...kuotas));
  });

  it('is idempotent — a row already split is left untouched by a re-run', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    const rid = await seedRow(p, 100);
    await activatePlanPeriode(sql, am(), p); // first split
    const before = await weeksOf(rid);
    // A hand re-drag; a second derivation must NOT overwrite it.
    await setWeeklyDistribution(sql, am(), rid, [
      { mingguNo: 1, kuota: 100 },
      { mingguNo: 2, kuota: 0 },
      { mingguNo: 3, kuota: 0 },
      { mingguNo: 4, kuota: 0 },
      { mingguNo: 5, kuota: 0 },
    ]);
    // getPlanDetail bundles the weeks — prove the re-drag stuck.
    const detail = await getPlanDetail(sql, am(), p);
    const forRow = detail.weeks.filter((x) => x.planRowId === rid);
    expect(forRow.find((x) => x.mingguNo === 1)?.kuota).toBe(100);
    expect(before).toHaveLength(5);
  });
});

describeDb('setWeeklyDistribution (AM re-drag, Rule 7/18)', () => {
  async function activePeriodWithRow(kuota = 100) {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 1, status: 'Aktif' });
    const rid = await seedRow(p, kuota);
    return { f, p, rid };
  }

  it('replaces the split when the AM re-drags, and it must sum to the quota', async () => {
    const { rid } = await activePeriodWithRow(100);
    const weeks = await setWeeklyDistribution(sql, am(), rid, [
      { mingguNo: 1, kuota: 70 },
      { mingguNo: 2, kuota: 30 },
    ]);
    expect(weeks.map((w) => w.kuota)).toEqual([70, 30]);
    // A short split is rejected with a clean message (before the DB trigger).
    await expect(
      setWeeklyDistribution(sql, am(), rid, [
        { mingguNo: 1, kuota: 70 },
        { mingguNo: 2, kuota: 20 },
      ]),
    ).rejects.toThrow(MSG_PLAN_WEEK_SUM_MISMATCH);
  });

  it('refuses a week outside the period, a non-active period, an unrelated AM, a missing row', async () => {
    const { f, p, rid } = await activePeriodWithRow(100);
    // Period has 5 weeks → week 9 is out of range.
    await expect(
      setWeeklyDistribution(sql, am(), rid, [{ mingguNo: 9, kuota: 100 }]),
    ).rejects.toThrow(MSG_PLAN_WEEK_NO_INVALID);
    await expect(setWeeklyDistribution(sql, otherAm(), rid, [{ mingguNo: 1, kuota: 100 }])).rejects.toThrow(
      MSG_PLAN_FORBIDDEN,
    );
    // A scheduled (not yet active) period cannot be re-dragged.
    const sched = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    const rid2 = await seedRow(sched, 50);
    await expect(setWeeklyDistribution(sql, am(), rid2, [{ mingguNo: 1, kuota: 50 }])).rejects.toThrow(
      MSG_PLAN_WEEK_STATUS,
    );
    await expect(setWeeklyDistribution(sql, am(), 99999999, [{ mingguNo: 1, kuota: 1 }])).rejects.toThrow(
      MSG_PLAN_ROW_NOT_FOUND,
    );
    expect(p).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// B-06 — hybrid actuals (Rule 10/11, Section P-E)
// ---------------------------------------------------------------------------

describe('MANUAL_METRICS (X-08 — explicit, not silently mixed)', () => {
  it('names exactly GMV, and not the auto metrics', () => {
    expect(MANUAL_METRICS).toEqual(['gmv']);
    expect(MANUAL_METRICS).not.toContain('roas_min');
    expect(MANUAL_METRICS).not.toContain('jam_live'); // conditional (PA-4/X-08), not yet
  });
});

describeDb('recordManualActual (PE-1/PE-2, Rule 10/11)', () => {
  const BUKTI = { fileBukti: 'export-shopee.pdf', tanggalAmbil: '2026-09-12' };

  it('writes a manual GMV row with its proof, and is idempotent (a correction)', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { status: 'Aktif' });
    const a = await recordManualActual(sql, am(), p, 'Shopee', 'gmv', 188000000, BUKTI);
    expect(a.sumber).toBe('manual');
    expect(a.nilai).toBe(188000000);
    expect(a.fileBukti).toBe('export-shopee.pdf');
    expect(a.tanggalAmbil).toBe('2026-09-12');
    // A re-entry overwrites the figure (no second row).
    const a2 = await recordManualActual(sql, am(), p, 'Shopee', 'gmv', 190000000, BUKTI);
    expect(a2.nilai).toBe(190000000);
    const detail = await getPlanDetail(sql, am(), p);
    expect(detail.actuals.filter((x) => x.metric === 'gmv')).toHaveLength(1);
  });

  it('rejects a non-manual metric, missing proof, a negative figure, and an unrelated AM', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { status: 'Aktif' });
    await expect(
      recordManualActual(sql, am(), p, 'Shopee', 'roas_min', 4.6, BUKTI),
    ).rejects.toThrow(MSG_ACTUAL_METRIC_NOT_MANUAL);
    await expect(
      recordManualActual(sql, am(), p, 'Shopee', 'gmv', 1, { fileBukti: '', tanggalAmbil: '2026-09-12' }),
    ).rejects.toThrow(MSG_ACTUAL_BUKTI_REQUIRED);
    await expect(
      recordManualActual(sql, am(), p, 'Shopee', 'gmv', -1, BUKTI),
    ).rejects.toThrow(MSG_ACTUAL_NILAI_INVALID);
    await expect(
      recordManualActual(sql, otherAm(), p, 'Shopee', 'gmv', 1, BUKTI),
    ).rejects.toThrow(MSG_PLAN_FORBIDDEN);
  });

  it('accepts a post-close entry and logs it as an amendment (X-07: no lock)', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { status: 'Ditutup' });
    const a = await recordManualActual(sql, am(), p, 'Shopee', 'gmv', 188000000, BUKTI);
    expect(a.nilai).toBe(188000000);
    const log = await sql<{ action: string }[]>`
      select action from audit_log where entity_id = ${p} order by id desc limit 1`;
    expect(log[0].action).toBe('realisasi_amandemen');
  });

  it('logs a within-period entry as an ordinary realisasi', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { status: 'Aktif' });
    await recordManualActual(sql, am(), p, 'Shopee', 'gmv', 188000000, BUKTI);
    const log = await sql<{ action: string }[]>`
      select action from audit_log where entity_id = ${p} order by id desc limit 1`;
    expect(log[0].action).toBe('realisasi_manual');
  });
});

describeDb('fileSengketa (PE-6 — dispute an auto metric)', () => {
  async function seedAuto(planId: string, metric = 'roas_min', nilai = 4.6): Promise<void> {
    await sql`insert into plan_actual (plan_id, channel, metric, sumber, nilai, created_by)
              values (${planId}, 'Shopee', ${metric}, 'otomatis', ${nilai}, 'SYSTEM')`;
  }

  it('records the note on an auto row without touching its value', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { status: 'Aktif' });
    await seedAuto(p);
    const a = await fileSengketa(sql, am(), p, 'Shopee', 'roas_min', 'tidak cocok dashboard iklan');
    expect(a.sengketa).toBe('tidak cocok dashboard iklan');
    expect(a.nilai).toBe(4.6);
    expect(a.sumber).toBe('otomatis');
  });

  it('refuses a dispute on a manual metric, an empty reason, and a missing row', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { status: 'Aktif' });
    await recordManualActual(sql, am(), p, 'Shopee', 'gmv', 1, {
      fileBukti: 'x.pdf',
      tanggalAmbil: '2026-09-12',
    });
    await expect(fileSengketa(sql, am(), p, 'Shopee', 'gmv', 'alasan')).rejects.toThrow(
      MSG_SENGKETA_NOT_AUTO,
    );
    await seedAuto(p, 'jumlah_video', 11);
    await expect(fileSengketa(sql, am(), p, 'Shopee', 'jumlah_video', '  ')).rejects.toThrow(
      MSG_SENGKETA_ALASAN_REQUIRED,
    );
    await expect(fileSengketa(sql, am(), p, 'TikTok Shop', 'roas_min', 'alasan')).rejects.toThrow(
      MSG_ACTUAL_NOT_FOUND,
    );
  });
});

describeDb('recordAutoActual (system ingestion, PE-3)', () => {
  it('writes an auto row that reads back through getPlanDetail', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { status: 'Aktif' });
    const a = await recordAutoActual(sql, p, 'Shopee', 'roas_min', 4.6, 'SYSTEM');
    expect(a.sumber).toBe('otomatis');
    expect(a.nilai).toBe(4.6);
    const detail = await getPlanDetail(sql, am(), p);
    expect(detail.actuals.find((x) => x.metric === 'roas_min')?.sumber).toBe('otomatis');
  });
});

// ---------------------------------------------------------------------------
// B-07 — transactional period close (Rule 15)
// ---------------------------------------------------------------------------

const BUKTI_CLOSE = { fileBukti: 'export.pdf', tanggalAmbil: '2026-09-12' };
const REVIEW_OK = {
  yangJalan: 'iklan Shopee naik',
  yangTidakJalan: 'live vendor telat',
  rekomendasi: 'geser budget ke konten',
  perluRevisi: false,
  materiKlien: 'ROAS 4.6, GMV di atas target',
};

describeDb('setRowStatus (PC-14, W saat tutup)', () => {
  async function activeRow() {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 1, status: 'Aktif' });
    const rid = await seedRow(p, 100);
    return { f, p, rid };
  }

  it('marks a row Selesai (no reason needed) and reads it back', async () => {
    const { rid } = await activeRow();
    const row = await setRowStatus(sql, am(), rid, 'Selesai');
    expect(row.statusBaris).toBe('Selesai');
    expect(row.statusBarisAlasan).toBeNull();
  });

  it('requires a reason for Sebagian / Tidak Dikerjakan, and stores it', async () => {
    const { rid } = await activeRow();
    await expect(setRowStatus(sql, am(), rid, 'Sebagian')).rejects.toThrow(MSG_ROW_STATUS_ALASAN_REQUIRED);
    const row = await setRowStatus(sql, am(), rid, 'Tidak Dikerjakan', 'aset dari klien tak kunjung datang');
    expect(row.statusBaris).toBe('Tidak Dikerjakan');
    expect(row.statusBarisAlasan).toContain('aset');
  });

  it('clears a stale reason when moving back to a non-terminal / Selesai status', async () => {
    const { rid } = await activeRow();
    await setRowStatus(sql, am(), rid, 'Sebagian', 'separuh jalan');
    const row = await setRowStatus(sql, am(), rid, 'Selesai');
    expect(row.statusBarisAlasan).toBeNull();
  });

  it('rejects an invalid status, an unrelated AM, and a non-active period', async () => {
    const { p, rid } = await activeRow();
    await expect(
      setRowStatus(sql, am(), rid, 'Beres' as unknown as 'Selesai'),
    ).rejects.toThrow(MSG_ROW_STATUS_INVALID);
    await expect(setRowStatus(sql, otherAm(), rid, 'Selesai')).rejects.toThrow(MSG_PLAN_FORBIDDEN);
    // a Terjadwal period's row cannot be moved (weeks/execution only exist Aktif)
    const f2 = await seedContractStrategi();
    const sched = await seedPeriod(f2, { periodeNo: 2, status: 'Terjadwal' });
    const rid2 = await seedRow(sched, 10);
    await expect(setRowStatus(sql, am(), rid2, 'Selesai')).rejects.toThrow(MSG_ROW_STATUS_PERIOD);
    expect(p).toBeTruthy();
  });

  it('404s a missing row', async () => {
    await expect(setRowStatus(sql, am(), 999999999, 'Selesai')).rejects.toThrow(MSG_PLAN_ROW_NOT_FOUND);
  });
});

describeDb('savePlanReview (Section P-F)', () => {
  async function activePeriod() {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 1, status: 'Aktif' });
    return { f, p };
  }

  it('upserts the review and reads it back through getPlanDetail', async () => {
    const { p } = await activePeriod();
    const r = await savePlanReview(sql, am(), p, REVIEW_OK);
    expect(r.yangJalan).toContain('Shopee');
    expect(r.perluRevisi).toBe(false);
    const detail = await getPlanDetail(sql, am(), p);
    expect(detail.review?.rekomendasi).toContain('budget');
  });

  it('is a full replace — an omitted field is stored null, not merged', async () => {
    const { p } = await activePeriod();
    await savePlanReview(sql, am(), p, { ...REVIEW_OK, materiKlien: 'draft satu' });
    const r2 = await savePlanReview(sql, am(), p, { yangJalan: 'revisi' });
    expect(r2.yangJalan).toBe('revisi');
    expect(r2.materiKlien).toBeNull(); // the earlier value is not retained
  });

  it('rejects an invalid diagnosa, an unrelated AM, and a non-active period', async () => {
    const { p } = await activePeriod();
    await expect(
      savePlanReview(sql, am(), p, { diagnosaGap: 'salah' as unknown as 'strategi_salah' }),
    ).rejects.toThrow(MSG_REVIEW_DIAGNOSA_INVALID);
    await expect(savePlanReview(sql, otherAm(), p, REVIEW_OK)).rejects.toThrow(MSG_PLAN_FORBIDDEN);
    const f2 = await seedContractStrategi();
    const sched = await seedPeriod(f2, { periodeNo: 2, status: 'Terjadwal' });
    await expect(savePlanReview(sql, am(), sched, REVIEW_OK)).rejects.toThrow(MSG_REVIEW_PERIOD);
  });
});

describeDb('closePlanPeriode (Aktif → Ditutup, transactional Rule 15)', () => {
  /** Build an Aktif period that satisfies all three close preconditions. */
  async function closeable(opts: { targetGmv?: number; actualGmv?: number } = {}) {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 1, status: 'Aktif' });
    const rid = await seedRow(p, 100);
    await seedTarget(p, { nilaiStrategi: opts.targetGmv ?? 100000000 });
    await setRowStatus(sql, am(), rid, 'Selesai');
    await recordManualActual(sql, am(), p, 'Shopee', 'gmv', opts.actualGmv ?? 120000000, BUKTI_CLOSE);
    await savePlanReview(sql, am(), p, REVIEW_OK);
    return { f, p, rid };
  }

  it('closes when every precondition holds', async () => {
    const { p } = await closeable();
    const plan = await closePlanPeriode(sql, am(), p);
    expect(plan.status).toBe('Ditutup');
  });

  it('refuses (nothing moves) when a channel is missing its manual GMV', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 1, status: 'Aktif' });
    const rid = await seedRow(p, 100);
    await seedTarget(p, { nilaiStrategi: 100000000 });
    await setRowStatus(sql, am(), rid, 'Selesai');
    await savePlanReview(sql, am(), p, REVIEW_OK);
    await expect(closePlanPeriode(sql, am(), p)).rejects.toThrow(MSG_CLOSE_GMV_INCOMPLETE);
    expect(await statusOf(p)).toBe('Aktif'); // still open — partial close is not a state
  });

  it('refuses when a row is not terminal', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 1, status: 'Aktif' });
    await seedRow(p, 100); // left at 'Rencana'
    await seedTarget(p, { nilaiStrategi: 100000000 });
    await recordManualActual(sql, am(), p, 'Shopee', 'gmv', 120000000, BUKTI_CLOSE);
    await savePlanReview(sql, am(), p, REVIEW_OK);
    await expect(closePlanPeriode(sql, am(), p)).rejects.toThrow(MSG_CLOSE_ROWS_NOT_TERMINAL);
    expect(await statusOf(p)).toBe('Aktif');
  });

  it('refuses when the review is incomplete, and when variance is negative without a diagnosa', async () => {
    // review absent entirely
    const a = await closeable();
    await sql`delete from plan_review where plan_id = ${a.p}`;
    await expect(closePlanPeriode(sql, am(), a.p)).rejects.toThrow(MSG_CLOSE_REVIEW_INCOMPLETE);
    // variance negative (actual < target) → PF-3 diagnosa becomes mandatory
    const b = await closeable({ targetGmv: 200000000, actualGmv: 150000000 });
    await expect(closePlanPeriode(sql, am(), b.p)).rejects.toThrow(MSG_CLOSE_REVIEW_INCOMPLETE);
    // supplying the diagnosa + evidence unblocks it
    await savePlanReview(sql, am(), b.p, {
      ...REVIEW_OK,
      diagnosaGap: 'eksekusi_tidak_jalan',
      diagnosaGapBukti: '71% baris Selesai (PE-8)',
    });
    const plan = await closePlanPeriode(sql, am(), b.p);
    expect(plan.status).toBe('Ditutup');
  });

  it('refuses an unrelated AM and a period that is not Aktif', async () => {
    const { p } = await closeable();
    await expect(closePlanPeriode(sql, otherAm(), p)).rejects.toThrow(MSG_PLAN_FORBIDDEN);
    const f2 = await seedContractStrategi();
    const sched = await seedPeriod(f2, { periodeNo: 2, status: 'Terjadwal' });
    await expect(closePlanPeriode(sql, am(), sched)).rejects.toThrow(MSG_CLOSE_STATUS);
  });

  it('accepts a late GMV amendment AFTER close (X-07 — close does not lock)', async () => {
    const { p } = await closeable();
    await closePlanPeriode(sql, am(), p);
    // recordManualActual is not status-gated: a post-close correction is logged
    // as an amendment (B-06), not blocked.
    const a = await recordManualActual(sql, am(), p, 'Shopee', 'gmv', 130000000, BUKTI_CLOSE);
    expect(a.nilai).toBe(130000000);
    expect(await statusOf(p)).toBe('Ditutup');
  });
});

describeDb('forceClosePlanPeriode (Aktif → Ditutup Otomatis, Rule 5/15)', () => {
  async function rowStatus(rid: number): Promise<{ status: string; alasan: string | null }> {
    const r = await sql<{ status_baris: string; status_baris_alasan: string | null }[]>`
      select status_baris, status_baris_alasan from plan_row where id = ${rid}`;
    return { status: r[0].status_baris, alasan: r[0].status_baris_alasan };
  }

  it('closes regardless of preconditions, coercing non-terminal rows to the ugly marker', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 1, status: 'Aktif' });
    const unresolved = await seedRow(p, 100); // stays 'Rencana'
    const done = await seedRow(p, 50);
    await setRowStatus(sql, am(), done, 'Selesai');
    // No GMV, no review — the AM abandoned the loop.
    const plan = await forceClosePlanPeriode(sql, am(), p);
    expect(plan.status).toBe('Ditutup Otomatis');
    // the unresolved row is forced; the resolved one keeps its real status
    const u = await rowStatus(unresolved);
    expect(u.status).toBe('Tidak Dikerjakan');
    expect(u.alasan).toBe(FORCE_CLOSE_ALASAN);
    expect((await rowStatus(done)).status).toBe('Selesai');
  });

  it('does not touch a real Sebagian reason already set by the AM', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 1, status: 'Aktif' });
    const partial = await seedRow(p, 100);
    await setRowStatus(sql, am(), partial, 'Sebagian', 'setengah kuota tercapai');
    await forceClosePlanPeriode(sql, am(), p);
    const s = await rowStatus(partial);
    expect(s.status).toBe('Sebagian');
    expect(s.alasan).toBe('setengah kuota tercapai'); // preserved, not overwritten
  });

  it('refuses an unrelated account and a non-active period', async () => {
    const f = await seedContractStrategi();
    const p = await seedPeriod(f, { periodeNo: 1, status: 'Aktif' });
    await expect(forceClosePlanPeriode(sql, otherAm(), p)).rejects.toThrow(MSG_PLAN_FORBIDDEN);
    const sched = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
    await expect(forceClosePlanPeriode(sql, am(), sched)).rejects.toThrow(MSG_CLOSE_STATUS);
  });
});

// ---------------------------------------------------------------------------
// B-08 — explicit carry-over (Rule 16 / PF-5)
// ---------------------------------------------------------------------------

/** Set a row's terminal status directly (the DB state after a close). */
async function setRowStatusRaw(
  rid: number,
  status: 'Sebagian' | 'Tidak Dikerjakan' | 'Selesai',
): Promise<void> {
  const alasan = status === 'Selesai' ? null : 'separuh kuota tercapai';
  await sql`update plan_row set status_baris = ${status}, status_baris_alasan = ${alasan} where id = ${rid}`;
}

/** A closed period-1 + a scheduled period-2 in the same contract chain, with a
 * period-1 row in `status`. Mirrors the state after close, before the decision. */
async function closedChainWithRow(
  status: 'Sebagian' | 'Tidak Dikerjakan' | 'Selesai' = 'Sebagian',
  p1Status = 'Ditutup',
): Promise<{ f: Awaited<ReturnType<typeof seedContractStrategi>>; p1: string; p2: string; rid: number }> {
  const f = await seedContractStrategi();
  const p1 = await seedPeriod(f, { periodeNo: 1, status: p1Status });
  const p2 = await seedPeriod(f, { periodeNo: 2, status: 'Terjadwal' });
  const rid = await seedRow(p1, 100);
  await setRowStatusRaw(rid, status);
  return { f, p1, p2, rid };
}

async function rowsOf(planId: string) {
  return sql<Record<string, unknown>[]>`select * from plan_row where plan_id = ${planId} order by id`;
}

describeDb('decideCarryOver (PF-5 / Rule 16)', () => {
  it('dibawa creates a Terbawa copy in the next period, tagged with its origin', async () => {
    const { p1, p2, rid } = await closedChainWithRow('Sebagian');
    // Give the row real jsonb payloads so the copy proves they round-trip.
    await sql`update plan_row
                 set sku_sasaran = ${sql.json(['SKU-1', 'SKU-2'])},
                     minggu_sasaran = ${sql.json([2, 3])}
               where id = ${rid}`;
    const res = await decideCarryOver(sql, am(), rid, 'dibawa');

    expect(res.row.keputusanCarryover).toBe('dibawa');
    expect(res.carried).not.toBeNull();
    const carried = res.carried!;
    expect(carried.planId).toBe(p2);
    expect(carried.terbawa).toBe(true);
    expect(carried.periodeAsalId).toBe(p1);
    expect(carried.statusBaris).toBe('Rencana'); // reset — fresh in the new period
    expect(carried.statusBarisAlasan).toBeNull();
    expect(carried.keputusanCarryover).toBeNull(); // itself undecided
    // The definition carries over unchanged (no invented "remaining" math).
    expect(carried.channel).toBe('Shopee');
    expect(carried.kuota).toBe(100);
    expect(carried.keberatanKapasitas).toBe(false);
    // jsonb payloads survive the copy intact (no double-encoding).
    expect(carried.skuSasaran).toEqual(['SKU-1', 'SKU-2']);
    expect(carried.mingguSasaran).toEqual([2, 3]);

    // The next period now holds exactly the one carried row.
    const p2rows = await rowsOf(p2);
    expect(p2rows).toHaveLength(1);
    expect(Number(p2rows[0].id)).toBe(carried.id);
  });

  it('dibatalkan records the decision and carries nothing', async () => {
    const { p2, rid } = await closedChainWithRow('Tidak Dikerjakan');
    const res = await decideCarryOver(sql, am(), rid, 'dibatalkan');
    expect(res.row.keputusanCarryover).toBe('dibatalkan');
    expect(res.carried).toBeNull();
    expect(await rowsOf(p2)).toHaveLength(0);
  });

  it('revisi records the decision and carries nothing', async () => {
    const { p2, rid } = await closedChainWithRow('Sebagian');
    const res = await decideCarryOver(sql, am(), rid, 'revisi');
    expect(res.row.keputusanCarryover).toBe('revisi');
    expect(res.carried).toBeNull();
    expect(await rowsOf(p2)).toHaveLength(0);
  });

  it('carries over an Auto-closed (Ditutup Otomatis) period too', async () => {
    const { p2, rid } = await closedChainWithRow('Tidak Dikerjakan', 'Ditutup Otomatis');
    const res = await decideCarryOver(sql, am(), rid, 'dibawa');
    expect(res.carried?.planId).toBe(p2);
  });

  it('writes an immutable audit row naming the decision and its outcome', async () => {
    const { p1, rid } = await closedChainWithRow('Sebagian');
    const res = await decideCarryOver(sql, am(), rid, 'dibawa');
    const log = await sql<{ action: string; after_json: Record<string, unknown> }[]>`
      select action, after_json from audit_log
       where entity_type = 'plan' and entity_id = ${p1} and action = 'keputusan_carryover'`;
    expect(log).toHaveLength(1);
    expect(log[0].after_json.keputusan_carryover).toBe('dibawa');
    expect(log[0].after_json.baris_terbawa_id).toBe(res.carried!.id);
  });

  it('lets a carried row be carried again from the next period', async () => {
    const { f, p2, rid } = await closedChainWithRow('Sebagian');
    const p3 = await seedPeriod(f, { periodeNo: 3, status: 'Terjadwal' });
    const first = await decideCarryOver(sql, am(), rid, 'dibawa');
    // Close p2 and leave the carried row unfinished again.
    await sql`update plan set status = 'Ditutup' where id = ${p2}`;
    await setRowStatusRaw(first.carried!.id, 'Sebagian');
    const second = await decideCarryOver(sql, am(), first.carried!.id, 'dibawa');
    expect(second.carried?.planId).toBe(p3);
    expect(second.carried?.periodeAsalId).toBe(p2);
  });

  it('carries a Plan Satuan row along the client chain (lingkup=klien)', async () => {
    const clientId = await seedClient();
    const p1 = await seedPeriod(
      { clientId, contractId: null, strategiId: null },
      { periodeNo: 1, status: 'Ditutup', lingkup: 'klien' },
    );
    const p2 = await seedPeriod(
      { clientId, contractId: null, strategiId: null },
      { periodeNo: 2, status: 'Terjadwal', lingkup: 'klien' },
    );
    const rid = await seedRow(p1, 40);
    await setRowStatusRaw(rid, 'Sebagian');
    const res = await decideCarryOver(sql, am(), rid, 'dibawa');
    expect(res.carried?.planId).toBe(p2);
  });

  it('refuses a decision while the period is not yet closed', async () => {
    const { rid } = await closedChainWithRow('Sebagian', 'Aktif');
    await expect(decideCarryOver(sql, am(), rid, 'dibawa')).rejects.toThrow(MSG_CARRYOVER_PERIOD);
  });

  it('refuses a row that is not Sebagian / Tidak Dikerjakan', async () => {
    const { rid } = await closedChainWithRow('Selesai');
    await expect(decideCarryOver(sql, am(), rid, 'dibawa')).rejects.toThrow(MSG_CARRYOVER_ROW_STATUS);
  });

  it('refuses a second decision on the same row', async () => {
    const { rid } = await closedChainWithRow('Sebagian');
    await decideCarryOver(sql, am(), rid, 'dibatalkan');
    await expect(decideCarryOver(sql, am(), rid, 'dibawa')).rejects.toThrow(
      MSG_CARRYOVER_ALREADY_DECIDED,
    );
  });

  it('refuses dibawa when there is no next period', async () => {
    // Last period of the chain: no period 2 exists.
    const f = await seedContractStrategi();
    const last = await seedPeriod(f, { periodeNo: 1, status: 'Ditutup' });
    const rid = await seedRow(last, 100);
    await setRowStatusRaw(rid, 'Sebagian');
    await expect(decideCarryOver(sql, am(), rid, 'dibawa')).rejects.toThrow(MSG_CARRYOVER_NO_TARGET);
  });

  it('refuses dibawa when the next period has already closed, but still allows dibatalkan', async () => {
    const chain = await closedChainWithRow('Sebagian');
    await sql`update plan set status = 'Ditutup' where id = ${chain.p2}`;
    await expect(decideCarryOver(sql, am(), chain.rid, 'dibawa')).rejects.toThrow(
      MSG_CARRYOVER_NO_TARGET,
    );
    // A drop needs no target — it still records the decision.
    expect((await decideCarryOver(sql, am(), chain.rid, 'dibatalkan')).row.keputusanCarryover).toBe(
      'dibatalkan',
    );
  });

  it('rejects an out-of-vocabulary decision', async () => {
    const { rid } = await closedChainWithRow('Sebagian');
    await expect(
      decideCarryOver(sql, am(), rid, 'buang' as unknown as 'dibawa'),
    ).rejects.toThrow(MSG_CARRYOVER_KEPUTUSAN_INVALID);
  });

  it('refuses an unrelated account and 404s a missing row', async () => {
    const { rid } = await closedChainWithRow('Sebagian');
    await expect(decideCarryOver(sql, otherAm(), rid, 'dibawa')).rejects.toThrow(MSG_PLAN_FORBIDDEN);
    await expect(decideCarryOver(sql, am(), 999999999, 'dibawa')).rejects.toThrow(
      MSG_PLAN_ROW_NOT_FOUND,
    );
  });
});

describeDb('listCarryOverPending (rows awaiting a decision)', () => {
  it('returns only undecided Sebagian / Tidak Dikerjakan rows', async () => {
    const { p1, rid } = await closedChainWithRow('Sebagian');
    // A decided row, a Selesai row, and a still-Rencana row must all be excluded.
    const decided = await seedRow(p1, 20);
    await setRowStatusRaw(decided, 'Tidak Dikerjakan');
    await decideCarryOver(sql, am(), decided, 'dibatalkan');
    const doneRow = await seedRow(p1, 30);
    await setRowStatusRaw(doneRow, 'Selesai');
    await seedRow(p1, 40); // stays Rencana

    const pending = await listCarryOverPending(sql, am(), p1);
    expect(pending.map((r) => r.id)).toEqual([rid]);
  });

  it('honours read scope', async () => {
    const { p1 } = await closedChainWithRow('Sebagian');
    await expect(listCarryOverPending(sql, otherAm(), p1)).rejects.toThrow(MSG_PLAN_FORBIDDEN);
  });
});
