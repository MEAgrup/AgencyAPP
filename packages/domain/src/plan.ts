/**
 * M6B / backlog B-01 — the `PLAN-` entity: a Plan period and its six child
 * tables (`plan_target`, `plan_row`, `plan_row_week`, `plan_actual`,
 * `plan_review`, `plan_flag`).
 *
 * **What this module is, and is deliberately not (yet).** This is the read +
 * shape layer that lands with the schema, the same role `strategi.ts` played
 * before its Section forms. It exposes the types every later M6B ticket writes
 * against and the reads a Plan page consumes. It has **no write path**, on
 * purpose:
 *
 *   * Periods are **generated, never created manually** (Rule 1: a Plan is born
 *     only on Strategi approval, n periods = n contract months). That generator
 *     is B-02.
 *   * Status moves only through `sm_transition` on machine #16; the domain gates
 *     around it (period 1 needs SPV, 2..n auto at 00:00 WIB, `Menunggu
 *     Persetujuan` only for a `Turun >10%` adjustment) are B-03.
 *   * Target adjustment (Rule 9), weekly distribution (Rule 7), hybrid actuals
 *     (Rule 10), period close (Rule 15), carry-over (Rule 16) each own their
 *     writes in B-04…B-08.
 *
 * **Who may read.** The owning AM of the period's client, an Account lead / Head
 * of Account, or a read-all role (OD / Director). This mirrors `contract` and
 * the RLS `plan_select` policy — reads follow the client's scope because a Plan
 * hangs off a Contract (full-management) or straight off a client (Plan Satuan),
 * and both Sales and Finance have a stake in the window. Division-lead access to
 * *their own rows* is an RLS arm on `plan_row`, not a whole-Plan grant.
 */

import { ident, permission } from '@cdps/core';
import { executors, type Queryable, type TransactionSql } from '@cdps/db';
import {
  ACCOUNT_DIVISION,
  ForbiddenError,
  NotFoundError,
  type Actor,
} from './account';

// ---------------------------------------------------------------------------
// BI messages (CLAUDE.md #5)
// ---------------------------------------------------------------------------

/** The plan id does not resolve. */
export const MSG_PLAN_NOT_FOUND = '[periode Plan tidak ditemukan]';
/** Actor is neither the owning AM, an Account lead, nor a read-all role. */
export const MSG_PLAN_FORBIDDEN = '[anda tidak memiliki akses untuk melihat periode Plan ini]';
/** The client id does not resolve. */
export const MSG_CLIENT_NOT_FOUND = '[klien tidak ditemukan]';
/** The contract id does not resolve. */
export const MSG_CONTRACT_NOT_FOUND = '[kontrak tidak ditemukan]';

// ---------------------------------------------------------------------------
// Shape — one interface per table, camelCase (the wire boundary snake_cases)
// ---------------------------------------------------------------------------

export type PlanLingkup = 'kontrak' | 'klien';
export type PlanStatus =
  | 'Terjadwal'
  | 'Draft'
  | 'Diajukan'
  | 'Menunggu Persetujuan'
  | 'Aktif'
  | 'Ditutup'
  | 'Ditutup Otomatis';

export interface Plan {
  id: string;
  lingkup: PlanLingkup;
  contractId: string | null;
  clientId: string;
  strategiId: string | null;
  periodeNo: number;
  tanggalMulai: string;
  tanggalAkhir: string;
  jumlahMinggu: number;
  status: PlanStatus;
  catatanPembuka: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface PlanTarget {
  planId: string;
  channel: string;
  metric: string;
  nilaiStrategi: number;
  nilaiDipakai: number;
  arah: 'naik' | 'turun' | 'tetap';
  persenPerubahan: number;
  alasan: string | null;
  buktiFile: string | null;
  statusPersetujuan: string | null;
}

export interface PlanRow {
  id: number;
  planId: string;
  channel: string;
  pilar: string;
  strategiPillarId: number | null;
  serviceId: string | null;
  diLuarStrategi: boolean;
  diLuarService: boolean;
  diLuarAlasan: string | null;
  aksi: string;
  skuSasaran: unknown[];
  kuota: number;
  satuan: string;
  budget: number | null;
  divisiPic: string;
  mingguSasaran: number[];
  prioritas: 'Wajib' | 'Penting' | 'Kalau Sempat';
  hasilDiharapkan: string;
  prasyarat: string | null;
  statusBaris: 'Rencana' | 'Jalan' | 'Selesai' | 'Sebagian' | 'Tidak Dikerjakan';
  statusBarisAlasan: string | null;
  visibilitas: 'Bagikan ke Klien' | 'Internal Saja';
  keberatanKapasitas: boolean;
  keberatanAlasan: string | null;
  terbawa: boolean;
  periodeAsalId: string | null;
}

export interface PlanRowWeek {
  id: number;
  planRowId: number;
  mingguNo: number;
  kuota: number;
}

export interface PlanActual {
  planId: string;
  channel: string;
  metric: string;
  sumber: 'manual' | 'otomatis';
  nilai: number;
  fileBukti: string | null;
  tanggalAmbil: string | null;
  sengketa: string | null;
}

export interface PlanReview {
  planId: string;
  yangJalan: string | null;
  yangTidakJalan: string | null;
  diagnosaGap: 'strategi_salah' | 'eksekusi_tidak_jalan' | null;
  diagnosaGapBukti: string | null;
  rekomendasi: string | null;
  perluRevisi: boolean | null;
  materiKlien: string | null;
}

export interface PlanFlag {
  id: number;
  planId: string;
  planRowId: number | null;
  jenis: string;
  detail: string | null;
  ackSpvOleh: string | null;
  ackSpvPada: string | null;
}

/** The whole period, ready for a page: header + every child list. */
export interface PlanDetail {
  plan: Plan;
  targets: PlanTarget[];
  rows: PlanRow[];
  weeks: PlanRowWeek[];
  actuals: PlanActual[];
  review: PlanReview | null;
  flags: PlanFlag[];
}

// ---------------------------------------------------------------------------
// Row shapes + coercion (numeric/date come back as string|number|Date)
// ---------------------------------------------------------------------------

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : String(v));
const isoDate = (v: string | Date): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
const num = (v: string | number): number => (typeof v === 'number' ? v : Number(v));
const optIso = (v: string | Date | null): string | null => (v == null ? null : iso(v));
const optDate = (v: string | Date | null): string | null => (v == null ? null : isoDate(v));

interface PlanRowDb {
  id: string;
  lingkup: PlanLingkup;
  contract_id: string | null;
  client_id: string;
  strategi_id: string | null;
  periode_no: number | string;
  tanggal_mulai: string | Date;
  tanggal_akhir: string | Date;
  jumlah_minggu: number | string;
  status: PlanStatus;
  catatan_pembuka: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  created_by: string;
}

function rowToPlan(r: PlanRowDb): Plan {
  return {
    id: r.id,
    lingkup: r.lingkup,
    contractId: r.contract_id,
    clientId: r.client_id,
    strategiId: r.strategi_id,
    periodeNo: num(r.periode_no),
    tanggalMulai: isoDate(r.tanggal_mulai),
    tanggalAkhir: isoDate(r.tanggal_akhir),
    jumlahMinggu: num(r.jumlah_minggu),
    status: r.status,
    catatanPembuka: r.catatan_pembuka,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    createdBy: r.created_by,
  };
}

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

/** canWritePlan: the owning AM, an Account lead/Head, or a Director. */
export function canWritePlan(actor: Actor, ownerAm: string | null): boolean {
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true;
  return ownerAm !== null && ownerAm === actor.employeeId;
}

/** canReadPlan: the write set, plus every read-all role (OD / Director). */
export function canReadPlan(actor: Actor, ownerAm: string | null): boolean {
  return canWritePlan(actor, ownerAm) || permission.canReadAll(actor);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function ownerAmOfClient(sql: Queryable, clientId: string): Promise<string | null> {
  const rows = await sql<{ assigned_am_id: string | null }[]>`
    select assigned_am_id from clients where id = ${clientId}`;
  if (rows.length === 0) throw new NotFoundError(MSG_CLIENT_NOT_FOUND);
  return rows[0].assigned_am_id;
}

async function loadPlan(sql: Queryable, id: string): Promise<Plan> {
  const rows = await sql<PlanRowDb[]>`select * from plan where id = ${id}`;
  if (rows.length === 0) throw new NotFoundError(MSG_PLAN_NOT_FOUND);
  return rowToPlan(rows[0]);
}

/** getPlan loads one period header after a read check. */
export async function getPlan(sql: Queryable, actor: Actor, id: string): Promise<Plan> {
  const plan = await loadPlan(sql, id);
  const ownerAm = await ownerAmOfClient(sql, plan.clientId);
  if (!canReadPlan(actor, ownerAm)) throw new ForbiddenError(MSG_PLAN_FORBIDDEN);
  return plan;
}

/**
 * listPlansForContract returns every period of a full-management contract,
 * ordered by period number — the shape a contract-level Plan view needs.
 */
export async function listPlansForContract(
  sql: Queryable,
  actor: Actor,
  contractId: string,
): Promise<Plan[]> {
  const ctr = await sql<{ client_id: string }[]>`
    select client_id from contracts where id = ${contractId}`;
  if (ctr.length === 0) throw new NotFoundError(MSG_CONTRACT_NOT_FOUND);
  const ownerAm = await ownerAmOfClient(sql, ctr[0].client_id);
  if (!canReadPlan(actor, ownerAm)) throw new ForbiddenError(MSG_PLAN_FORBIDDEN);
  const rows = await sql<PlanRowDb[]>`
    select * from plan where contract_id = ${contractId} order by periode_no`;
  return rows.map(rowToPlan);
}

/**
 * listPlansForClient returns every period scoped straight to a client — the
 * Plan Satuan chain (`lingkup='klien'`), and the reach a client-level view uses.
 */
export async function listPlansForClient(
  sql: Queryable,
  actor: Actor,
  clientId: string,
): Promise<Plan[]> {
  const ownerAm = await ownerAmOfClient(sql, clientId);
  if (!canReadPlan(actor, ownerAm)) throw new ForbiddenError(MSG_PLAN_FORBIDDEN);
  const rows = await sql<PlanRowDb[]>`
    select * from plan where client_id = ${clientId} order by periode_no, id`;
  return rows.map(rowToPlan);
}

/**
 * getPlanDetail loads a period with all of its child rows in one shot — the
 * bundle a Plan page renders.
 */
export async function getPlanDetail(
  sql: Queryable,
  actor: Actor,
  id: string,
): Promise<PlanDetail> {
  const plan = await getPlan(sql, actor, id);

  const targets = await sql<
    {
      plan_id: string;
      channel: string;
      metric: string;
      nilai_strategi: string | number;
      nilai_dipakai: string | number;
      arah: 'naik' | 'turun' | 'tetap';
      persen_perubahan: string | number;
      alasan: string | null;
      bukti_file: string | null;
      status_persetujuan: string | null;
    }[]
  >`select * from plan_target where plan_id = ${id} order by channel, metric`;

  const rows = await sql<Record<string, unknown>[]>`
    select * from plan_row where plan_id = ${id} order by id`;
  const rowIds = rows.map((r) => r.id as number);

  const weeks =
    rowIds.length === 0
      ? []
      : await sql<{ id: number; plan_row_id: number; minggu_no: number; kuota: string | number }[]>`
          select * from plan_row_week
           where plan_row_id = any(${rowIds})
           order by plan_row_id, minggu_no`;

  const actuals = await sql<
    {
      plan_id: string;
      channel: string;
      metric: string;
      sumber: 'manual' | 'otomatis';
      nilai: string | number;
      file_bukti: string | null;
      tanggal_ambil: string | Date | null;
      sengketa: string | null;
    }[]
  >`select * from plan_actual where plan_id = ${id} order by channel, metric`;

  const reviewRows = await sql<
    {
      plan_id: string;
      yang_jalan: string | null;
      yang_tidak_jalan: string | null;
      diagnosa_gap: 'strategi_salah' | 'eksekusi_tidak_jalan' | null;
      diagnosa_gap_bukti: string | null;
      rekomendasi: string | null;
      perlu_revisi: boolean | null;
      materi_klien: string | null;
    }[]
  >`select * from plan_review where plan_id = ${id}`;

  const flags = await sql<
    {
      id: number;
      plan_id: string;
      plan_row_id: number | null;
      jenis: string;
      detail: string | null;
      ack_spv_oleh: string | null;
      ack_spv_pada: string | Date | null;
    }[]
  >`select * from plan_flag where plan_id = ${id} order by id`;

  return {
    plan,
    targets: targets.map((t) => ({
      planId: t.plan_id,
      channel: t.channel,
      metric: t.metric,
      nilaiStrategi: num(t.nilai_strategi),
      nilaiDipakai: num(t.nilai_dipakai),
      arah: t.arah,
      persenPerubahan: num(t.persen_perubahan),
      alasan: t.alasan,
      buktiFile: t.bukti_file,
      statusPersetujuan: t.status_persetujuan,
    })),
    rows: rows.map(rowToPlanRow),
    weeks: weeks.map((w) => ({
      id: num(w.id),
      planRowId: num(w.plan_row_id),
      mingguNo: num(w.minggu_no),
      kuota: num(w.kuota),
    })),
    actuals: actuals.map((a) => ({
      planId: a.plan_id,
      channel: a.channel,
      metric: a.metric,
      sumber: a.sumber,
      nilai: num(a.nilai),
      fileBukti: a.file_bukti,
      tanggalAmbil: optDate(a.tanggal_ambil),
      sengketa: a.sengketa,
    })),
    review:
      reviewRows.length === 0
        ? null
        : {
            planId: reviewRows[0].plan_id,
            yangJalan: reviewRows[0].yang_jalan,
            yangTidakJalan: reviewRows[0].yang_tidak_jalan,
            diagnosaGap: reviewRows[0].diagnosa_gap,
            diagnosaGapBukti: reviewRows[0].diagnosa_gap_bukti,
            rekomendasi: reviewRows[0].rekomendasi,
            perluRevisi: reviewRows[0].perlu_revisi,
            materiKlien: reviewRows[0].materi_klien,
          },
    flags: flags.map((f) => ({
      id: num(f.id),
      planId: f.plan_id,
      planRowId: f.plan_row_id === null ? null : num(f.plan_row_id),
      jenis: f.jenis,
      detail: f.detail,
      ackSpvOleh: f.ack_spv_oleh,
      ackSpvPada: optIso(f.ack_spv_pada),
    })),
  };
}

function rowToPlanRow(r: Record<string, unknown>): PlanRow {
  return {
    id: num(r.id as number),
    planId: r.plan_id as string,
    channel: r.channel as string,
    pilar: r.pilar as string,
    strategiPillarId: r.strategi_pillar_id === null ? null : num(r.strategi_pillar_id as number),
    serviceId: (r.service_id as string | null) ?? null,
    diLuarStrategi: r.di_luar_strategi as boolean,
    diLuarService: r.di_luar_service as boolean,
    diLuarAlasan: (r.di_luar_alasan as string | null) ?? null,
    aksi: r.aksi as string,
    skuSasaran: (r.sku_sasaran as unknown[]) ?? [],
    kuota: num(r.kuota as number),
    satuan: r.satuan as string,
    budget: r.budget === null ? null : num(r.budget as number),
    divisiPic: r.divisi_pic as string,
    mingguSasaran: (r.minggu_sasaran as number[]) ?? [],
    prioritas: r.prioritas as PlanRow['prioritas'],
    hasilDiharapkan: r.hasil_diharapkan as string,
    prasyarat: (r.prasyarat as string | null) ?? null,
    statusBaris: r.status_baris as PlanRow['statusBaris'],
    statusBarisAlasan: (r.status_baris_alasan as string | null) ?? null,
    visibilitas: r.visibilitas as PlanRow['visibilitas'],
    keberatanKapasitas: r.keberatan_kapasitas as boolean,
    keberatanAlasan: (r.keberatan_alasan as string | null) ?? null,
    terbawa: r.terbawa as boolean,
    periodeAsalId: (r.periode_asal_id as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// B-02 — period generation
// ---------------------------------------------------------------------------
//
// Rule 1 / P7: periods are generated on Strategi approval, n = contract months,
// anniversary-month boundaries from `tanggal_mulai_siklus` (M6A G-0/Rule 17).
// There is NO manual create path — `generatePlanPeriods` is called from
// `approveStrategi`, in its transaction.

/** One computed period window — the boundary math kept pure and testable. */
export interface PeriodBoundary {
  periodeNo: number;
  tanggalMulai: string;
  tanggalAkhir: string;
  jumlahMinggu: number;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const fmt = (y: number, m: number, d: number): string => `${y}-${pad2(m)}-${pad2(d)}`;

/** Days in month `m` (1-12) of year `y`. */
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The date one day before `dateStr` ('YYYY-MM-DD'), as 'YYYY-MM-DD'. */
function dayBefore(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - 1);
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Inclusive day count between two 'YYYY-MM-DD' dates. */
function daysInclusive(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86400000) + 1;
}

/**
 * computePeriods lays out `n` anniversary-month periods from `cycleStart`.
 *
 * The intended day-of-month is `cycleStart`'s day, and **every** period start is
 * recomputed from it — not walked forward from the previous (clamped) start. A
 * cycle starting the 31st therefore reads Jan 31 → Feb 28 → **Mar 31** (not Mar
 * 28): February clamps, but March recovers the intended day. Walking from the
 * clamped date would drift it to the 28th permanently — the failure B-02 calls
 * out by name. This is why nothing stores a per-period "intended day": the one
 * source is `cycleStart`, immutable once the first period closes (Rule 17).
 */
export function computePeriods(cycleStart: string, n: number): PeriodBoundary[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cycleStart)) {
    throw new Error(`computePeriods: cycleStart bukan YYYY-MM-DD: ${cycleStart}`);
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`computePeriods: n harus bilangan bulat >= 1: ${n}`);
  }
  const [cy, cm, cd] = cycleStart.split('-').map(Number);
  // n+1 starts: period i runs from starts[i] to the day before starts[i+1].
  const starts: string[] = [];
  for (let i = 0; i <= n; i += 1) {
    const monthZero = cm - 1 + i;
    const y = cy + Math.floor(monthZero / 12);
    const m = (((monthZero % 12) + 12) % 12) + 1;
    const d = Math.min(cd, daysInMonth(y, m));
    starts.push(fmt(y, m, d));
  }
  const periods: PeriodBoundary[] = [];
  for (let i = 0; i < n; i += 1) {
    const tanggalMulai = starts[i];
    const tanggalAkhir = dayBefore(starts[i + 1]);
    const days = daysInclusive(tanggalMulai, tanggalAkhir);
    // A calendar month is 28-31 days → 4 full weeks with the last absorbing the
    // 0-3 day remainder (PD-4). Clamp to the plan CHECK's [4,6] as a guardrail.
    const jumlahMinggu = Math.min(6, Math.max(4, Math.floor(days / 7)));
    periods.push({ periodeNo: i + 1, tanggalMulai, tanggalAkhir, jumlahMinggu });
  }
  return periods;
}

/** The strategi header fields the generator consumes. */
export interface GenerateSource {
  id: string;
  contractId: string;
  clientId: string;
  tanggalMulaiSiklus: string | null;
  durasiKontrakBulan: number;
}

/**
 * generatePlanPeriods creates the `n` periods of a freshly-approved Strategi:
 * period 1 in `Draft`, periods 2..n in `Terjadwal`, each pre-filled with the
 * month's targets from Strategi D-2 (`plan_target`, `arah='tetap'`,
 * `nilai_dipakai = nilai_strategi`).
 *
 * **Idempotent by contract.** If the contract already carries periods it does
 * nothing and returns `[]` — so approving a *revision* does not mint a second
 * chain. Regenerating the still-`Terjadwal` periods of a revised Strategi (Rule
 * 17: unstarted periods only) is a later ticket; this is initial generation.
 *
 * **No row skeleton yet.** Flow step 1 mentions seeding rows from E+F, but every
 * P-C field an AM must fill (`aksi`, `hasil_diharapkan`, `divisi_pic`) is `W`
 * with no PRD default, and `divisi_pic` is NOT NULL — auto-assigning a division
 * per pillar would be invented data. Left to the row form / an owner decision;
 * targets, which ARE fully specified by D-2, are seeded here.
 *
 * Runs inside the approval transaction (`approveStrategi`), so a failed
 * generation rolls the approval back with it.
 */
export async function generatePlanPeriods(
  tx: TransactionSql,
  actor: Actor,
  s: GenerateSource,
): Promise<string[]> {
  const existing = await tx`select 1 from plan where contract_id = ${s.contractId} limit 1`;
  if (existing.length > 0) return [];

  if (s.tanggalMulaiSiklus === null) {
    // Should not happen: createStrategi defaults the cycle start to the contract
    // start. Fail loudly rather than mint periods off a guessed date.
    throw new Error('generatePlanPeriods: tanggal_mulai_siklus belum ditetapkan');
  }
  const periods = computePeriods(s.tanggalMulaiSiklus, s.durasiKontrakBulan);

  const targets = await tx<
    { channel: string; month_index: number | string; metric: string; nilai_stretch: string | number }[]
  >`select channel, month_index, metric, nilai_stretch
      from strategi_target where strategi_id = ${s.id}`;

  const ex = executors(tx);
  const now = new Date();
  const ids: string[] = [];
  for (const p of periods) {
    const id = await ident.nextId(ex.ident, 'PLAN', now);
    const status = p.periodeNo === 1 ? 'Draft' : 'Terjadwal';
    await tx`
      insert into plan
        (id, lingkup, contract_id, client_id, strategi_id, periode_no,
         tanggal_mulai, tanggal_akhir, jumlah_minggu, status, created_by)
      values
        (${id}, 'kontrak', ${s.contractId}, ${s.clientId}, ${s.id}, ${p.periodeNo},
         ${p.tanggalMulai}, ${p.tanggalAkhir}, ${p.jumlahMinggu}, ${status}, ${actor.employeeId})`;

    for (const t of targets) {
      if (num(t.month_index) !== p.periodeNo) continue;
      await tx`
        insert into plan_target
          (plan_id, channel, metric, nilai_strategi, nilai_dipakai, created_by)
        values
          (${id}, ${t.channel}, ${t.metric}, ${t.nilai_stretch}, ${t.nilai_stretch}, ${actor.employeeId})`;
    }

    await ex.audit.insertAudit({
      entityType: 'plan',
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'generate',
      beforeJson: null,
      afterJson: {
        strategi_id: s.id,
        contract_id: s.contractId,
        periode_no: p.periodeNo,
        tanggal_mulai: p.tanggalMulai,
        tanggal_akhir: p.tanggalAkhir,
        status,
      },
      createdBy: actor.employeeId,
    });
    ids.push(id);
  }
  return ids;
}
