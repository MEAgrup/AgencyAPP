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

import { ident, permission, statemachine } from '@cdps/core';
import {
  executors,
  withTransaction,
  type Queryable,
  type Sql,
  type TransactionSql,
} from '@cdps/db';
import {
  ACCOUNT_DIVISION,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
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
/** Approve / return of period 1 is SPV / Head of Account authority (Rule 3). */
export const MSG_PLAN_APPROVE_FORBIDDEN =
  '[anda tidak memiliki akses untuk menyetujui atau mengembalikan periode Plan]';
/** Rule 3 — returning period 1 requires a written note. */
export const MSG_PLAN_RETURN_NOTES_REQUIRED =
  '[catatan wajib diisi saat mengembalikan periode Plan]';
/** PA-7 — the opening note is mandatory before a period may be submitted. */
export const MSG_PLAN_CATATAN_PEMBUKA_REQUIRED =
  '[catatan pembuka wajib diisi sebelum periode Plan diajukan]';

// --- B-04: Rule 9 asymmetric target adjustment ---------------------------

/** The target (plan_id, channel, metric) does not resolve. */
export const MSG_PLAN_TARGET_NOT_FOUND = '[target periode Plan tidak ditemukan]';
/** A target may only be adjusted while the period is Draft / Terjadwal (pre-activation). */
export const MSG_PLAN_ADJUST_STATUS =
  '[target hanya dapat disesuaikan sebelum periode aktif]';
/** Rule 9 — a downward adjustment always needs a written reason (PB-4). */
export const MSG_PLAN_ADJUST_ALASAN_REQUIRED =
  '[alasan wajib diisi untuk penurunan target]';
/** Rule 9 / PB-5 — a downward adjustment > 10% needs supporting evidence. */
export const MSG_PLAN_ADJUST_BUKTI_REQUIRED =
  '[bukti pendukung wajib dilampirkan untuk penurunan target lebih dari 10%]';
/** The used figure is negative. */
export const MSG_PLAN_ADJUST_NILAI_INVALID = '[target dipakai tidak boleh negatif]';
/** approve/reject called on a target with no pending > 10% request. */
export const MSG_PLAN_ADJUST_NOT_PENDING =
  '[tidak ada permintaan penyesuaian target yang menunggu persetujuan]';
/** Rule 19 — rejecting a target adjustment requires a written note. */
export const MSG_PLAN_ADJUST_REJECT_NOTES_REQUIRED =
  '[catatan wajib diisi saat menolak penyesuaian target]';

// --- B-05: derived weekly distribution (Rule 7) --------------------------

/** The work-row (`plan_row`) does not resolve. */
export const MSG_PLAN_ROW_NOT_FOUND = '[baris rencana kerja tidak ditemukan]';
/** Rule 7 — a re-drag whose weekly quotas do not sum to the monthly quota. */
export const MSG_PLAN_WEEK_SUM_MISMATCH =
  '[distribusi mingguan harus berjumlah sama dengan kuota bulanan baris]';
/** A weekly row references a week outside the period (1..jumlah_minggu). */
export const MSG_PLAN_WEEK_NO_INVALID =
  '[nomor minggu di luar rentang periode]';
/** Re-drag is only possible once the period is active (weeks exist). */
export const MSG_PLAN_WEEK_STATUS =
  '[distribusi mingguan hanya dapat diubah saat periode aktif]';

// --- B-06: hybrid actuals (Rule 10/11, Section P-E) ----------------------

/** Only GMV is entered manually (PE-1 / Rule 10); every other metric is auto. */
export const MSG_ACTUAL_METRIC_NOT_MANUAL =
  '[metrik ini bukan metrik manual — hanya GMV aktual yang diinput manual]';
/** PE-2 — a manual GMV entry must carry its source attachment and capture date. */
export const MSG_ACTUAL_BUKTI_REQUIRED =
  '[lampiran sumber dan tanggal ambil data wajib untuk realisasi GMV manual]';
/** A negative actual figure. */
export const MSG_ACTUAL_NILAI_INVALID = '[nilai realisasi tidak boleh negatif]';
/** The actual row (plan_id, channel, metric) does not resolve. */
export const MSG_ACTUAL_NOT_FOUND = '[data realisasi tidak ditemukan]';
/** PE-6 — a Sengketa Angka only makes sense against an auto metric. */
export const MSG_SENGKETA_NOT_AUTO =
  '[sengketa angka hanya dapat diajukan atas metrik otomatis]';
/** PE-6 — the dispute needs a written reason (it is the whole point of the note). */
export const MSG_SENGKETA_ALASAN_REQUIRED = '[alasan sengketa wajib diisi]';

// --- B-07: transactional period close (Rule 15) --------------------------

/** A period may only be closed (manual or forced) while it is Aktif. */
export const MSG_CLOSE_STATUS = '[periode hanya dapat ditutup saat berstatus Aktif]';
/** Rule 15 — close is refused until every channel has its manual GMV entered. */
export const MSG_CLOSE_GMV_INCOMPLETE =
  '[penutupan periode dibatalkan: GMV manual belum diisi untuk semua channel]';
/** Rule 15 — close is refused while a row is not in a terminal state (with reason). */
export const MSG_CLOSE_ROWS_NOT_TERMINAL =
  '[penutupan periode dibatalkan: semua baris kerja harus berstatus akhir (Selesai/Sebagian/Tidak Dikerjakan) dengan alasan]';
/** Rule 15 — close is refused until the P-F review is complete. */
export const MSG_CLOSE_REVIEW_INCOMPLETE =
  '[penutupan periode dibatalkan: review penutup periode (P-F) belum lengkap]';
/** PC-14 — the supplied row status is not one of the five allowed values. */
export const MSG_ROW_STATUS_INVALID = '[status baris tidak valid]';
/** PC-14 — a `Sebagian` / `Tidak Dikerjakan` row needs a written reason. */
export const MSG_ROW_STATUS_ALASAN_REQUIRED =
  '[alasan wajib diisi untuk baris Sebagian atau Tidak Dikerjakan]';
/** PC-14 — row status may only be set while the period is Aktif. */
export const MSG_ROW_STATUS_PERIOD = '[status baris hanya dapat diubah saat periode aktif]';
/** P-F — the review may only be filled while the period is Aktif. */
export const MSG_REVIEW_PERIOD = '[review periode hanya dapat diisi saat periode aktif]';
/** PF-3 — an out-of-vocabulary Diagnosa Gap value. */
export const MSG_REVIEW_DIAGNOSA_INVALID = '[diagnosa gap tidak valid]';

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
  /**
   * PA-6 `defisit_terbawa` — the Rp shortfall carried from every EARLIER period
   * of this chain (Rule 9). Computed, never stored: Σ(`nilai_strategi` −
   * `nilai_dipakai`) over committed downward GMV adjustments of periods before
   * this one. A pending (`Menunggu Persetujuan`) or expired/rejected request
   * contributes nothing — only an adjustment that actually took effect does.
   */
  defisitTerbawa: number;
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

  const defisitTerbawa = await priorPeriodDeficit(sql, plan);

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
    defisitTerbawa,
  };
}

// ---------------------------------------------------------------------------
// defisit_terbawa (Rule 9 / PA-6) — computed at the chain level, never stored
// ---------------------------------------------------------------------------
//
// §3: a downward adjustment lowers the *period* target but never the contract's
// cumulative expectation — the shortfall is carried, not absorbed. The deficit
// is therefore a pure read over `plan_target`: Σ(nilai_strategi − nilai_dipakai)
// for committed downward GMV adjustments. "Committed" excludes a still-pending
// `Menunggu Persetujuan` request (nothing has taken effect yet); an expired /
// rejected one already reverted to `arah='tetap'` (nilai_dipakai=nilai_strategi,
// contribution 0), so filtering on `arah='turun'` alone would also exclude it —
// the explicit pending guard is what keeps a live > 10% request out of the sum.
// GMV only: PA-6 is a rupiah figure, and GMV is the one currency metric.

const DEFICIT_METRIC = 'gmv';

/** The Rp shortfall committed by downward GMV adjustments across a set of periods. */
async function deficitOfChain(
  sql: Queryable,
  plan: Plan,
  onlyBeforePeriodeNo: number | null,
): Promise<number> {
  // Scope to the chain: a full-management chain shares a contract; a Plan Satuan
  // chain (`lingkup='klien'`, no contract) shares the client.
  const scoped =
    plan.contractId !== null
      ? sql<{ d: string | number }[]>`
          select coalesce(sum(pt.nilai_strategi - pt.nilai_dipakai), 0) as d
            from plan p join plan_target pt on pt.plan_id = p.id
           where p.contract_id = ${plan.contractId}
             and pt.metric = ${DEFICIT_METRIC}
             and pt.arah = 'turun'
             and pt.status_persetujuan is distinct from 'Menunggu Persetujuan'
             ${onlyBeforePeriodeNo === null ? sql`` : sql`and p.periode_no < ${onlyBeforePeriodeNo}`}`
      : sql<{ d: string | number }[]>`
          select coalesce(sum(pt.nilai_strategi - pt.nilai_dipakai), 0) as d
            from plan p join plan_target pt on pt.plan_id = p.id
           where p.client_id = ${plan.clientId} and p.lingkup = 'klien'
             and pt.metric = ${DEFICIT_METRIC}
             and pt.arah = 'turun'
             and pt.status_persetujuan is distinct from 'Menunggu Persetujuan'
             ${onlyBeforePeriodeNo === null ? sql`` : sql`and p.periode_no < ${onlyBeforePeriodeNo}`}`;
  const rows = await scoped;
  return num(rows[0].d);
}

/** PA-6 for a period: the deficit accumulated from every period BEFORE it. */
async function priorPeriodDeficit(sql: Queryable, plan: Plan): Promise<number> {
  return deficitOfChain(sql, plan, plan.periodeNo);
}

/**
 * contractDeficit is the chain-level `defisit_terbawa` for the contract rollup
 * (§3: "shows on … the contract-level view") — the sum across ALL periods, not
 * only those before a given one. Read-scoped like the period reads.
 */
export async function contractDeficit(
  sql: Queryable,
  actor: Actor,
  contractId: string,
): Promise<number> {
  const ctr = await sql<{ client_id: string }[]>`
    select client_id from contracts where id = ${contractId}`;
  if (ctr.length === 0) throw new NotFoundError(MSG_CONTRACT_NOT_FOUND);
  const ownerAm = await ownerAmOfClient(sql, ctr[0].client_id);
  if (!canReadPlan(actor, ownerAm)) throw new ForbiddenError(MSG_PLAN_FORBIDDEN);
  // Any period of the contract carries the scope keys the aggregate needs.
  const anyPeriod = await sql<PlanRowDb[]>`
    select * from plan where contract_id = ${contractId} order by periode_no limit 1`;
  if (anyPeriod.length === 0) return 0;
  return deficitOfChain(sql, rowToPlan(anyPeriod[0]), null);
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

// ---------------------------------------------------------------------------
// B-03 — lifecycle (machine #16): the transition gates
// ---------------------------------------------------------------------------
//
// B-01 registered the machine's edges (STATE_MACHINES §6d): the machine knows
// *which* status moves are legal. B-03 adds the domain layer around it — *who*
// may press *which* button, and *when* — the part `sm_edges` cannot express:
//
//   * Period 1 alone walks the human review loop `Draft → Diajukan →
//     (Aktif | Draft)` (Rule 3). Its `Diajukan → Aktif` / `Diajukan → Draft`
//     edges are `require_lead` in the DB, so `sm_transition` already refuses a
//     non-lead — the domain gate narrows that to the *Account* division (an Ads
//     lead is a lead too, but not the SPV / Head of Account Rule 3 means).
//   * Periods 2..n never enter that loop; they auto-activate `Terjadwal → Aktif`
//     at 00:00 WIB (Rule 4). That edge is deliberately NOT `require_lead`: the
//     activation is run by a service-role job (B-09), not a person. The
//     `Menunggu Persetujuan` hold for a pending `Turun >10%` adjustment (Rule
//     4/9) is wired in B-04, which owns the adjustment record; until then a
//     `Terjadwal` period activates straight through.
//
// Notifications (`plan_periode_aktif`, …) are NOT emitted here: the catalog has
// no M6B plan events yet (they await PA-8 / O55 sign-off). Emitting an
// unregistered event would fail `notify_emit`; the events land with their
// ticket, and emission with them.

/** The status column moves ONLY through `sm_transition` on machine #16. */
const MACHINE_PLAN = 'plan';
const ENTITY_PLAN = 'plan';

const PLAN_DRAFT = 'Draft';
const PLAN_DIAJUKAN = 'Diajukan';
const PLAN_AKTIF = 'Aktif';
const PLAN_TERJADWAL = 'Terjadwal';
const PLAN_MENUNGGU = 'Menunggu Persetujuan';
const PLAN_DITUTUP = 'Ditutup';
const PLAN_DITUTUP_OTOMATIS = 'Ditutup Otomatis';

/** A closed period (either terminal state of machine #16). */
const PLAN_TERMINAL: readonly PlanStatus[] = [PLAN_DITUTUP, PLAN_DITUTUP_OTOMATIS];

/**
 * B-06 / X-08 — the metrics an AM enters by hand, as a SINGLE explicit source of
 * truth (X-08: the manual list must be explicit, never silently mixed with the
 * auto ones). PE-1 / Rule 10 names exactly one: GMV per channel. `jam_live` is a
 * *conditional* candidate (PA-4: if the live-stream vendor reports hours outside
 * the system it becomes manual) — deliberately NOT added here without Hans/owner
 * resolving X-08/PA-4, because widening it silently is the very mixing X-08
 * warns against. Everything not in this set is auto and read-only to the AM.
 */
export const MANUAL_METRICS: readonly string[] = ['gmv'];

/** status_persetujuan values (PH-3) — the > 10% approval flow. */
const ADJ_PENDING = 'Menunggu Persetujuan';
const ADJ_APPROVED = 'Disetujui';
const ADJ_REJECTED = 'Ditolak';
const ADJ_EXPIRED = 'Kedaluwarsa';

/**
 * The downward threshold above which an adjustment needs SPV approval + evidence
 * (PA-1: "cheap to tune, worth a deliberate choice" — so it lives here, in one
 * place, not hardcoded in a DB CHECK). Percent of the Strategi figure.
 */
export const DOWNWARD_APPROVAL_THRESHOLD_PCT = 10;

/** transitionError maps an engine rejection to the shared error taxonomy. */
function transitionError(res: statemachine.TransitionResult & { ok: false }): Error {
  if (res.code === 'not_found') return new NotFoundError(MSG_PLAN_NOT_FOUND);
  if (res.code === 'role_denied') return new ForbiddenError(res.message);
  // 'blocked' (illegal edge, incl. the machine's BI block message) and anything
  // else the engine can return are conflicts on the current state.
  return new ConflictError(res.message);
}

/**
 * transitionPlan is the single wrapper every Plan status move goes through — the
 * `strategi.ts` transition pattern applied to machine #16. It forces the move
 * through `sm_transition` (row lock + edge check + `require_lead` gate + the
 * immutable audit row, one transaction) and maps a rejection onto the domain
 * error taxonomy. The division-specific gates live in the named operations that
 * call it; this is the low-level path they (and B-04…B-09) share.
 *
 * Runs inside the caller's transaction so any sibling write (persisting the
 * opening note, appending the return note) commits or rolls back with the move.
 */
export async function transitionPlan(
  tx: TransactionSql,
  actor: Actor,
  planId: string,
  to: PlanStatus,
): Promise<void> {
  const ex = executors(tx);
  const res = await statemachine.transition(ex.sm, {
    machine: MACHINE_PLAN,
    entityType: ENTITY_PLAN,
    table: 'plan',
    entityId: planId,
    to,
    actor,
  });
  if (!res.ok) throw transitionError(res);
}

/** Load a period FOR UPDATE — locks the row so the gate check cannot race the move. */
async function loadPlanForUpdate(tx: TransactionSql, id: string): Promise<Plan> {
  const rows = await tx<PlanRowDb[]>`select * from plan where id = ${id} for update`;
  if (rows.length === 0) throw new NotFoundError(MSG_PLAN_NOT_FOUND);
  return rowToPlan(rows[0]);
}

/** canApprovePlan: SPV / Head of Account (Rule 3). The period-1 approval gate. */
export function canApprovePlan(actor: Actor): boolean {
  return permission.isLead(actor, ACCOUNT_DIVISION);
}

/**
 * submitPlanPeriode drives period 1 `Draft → Diajukan` (Flow step 2): the owning
 * AM hands the filled period to the SPV. The opening note PA-7 is mandatory at
 * submit — the one completeness field the schema carries today; the row/week
 * completeness checks land with their tickets (B-04…B-08) and extend this gate.
 *
 * Only period 1 is ever in `Draft` (generation seeds it there; 2..n start
 * `Terjadwal`), so the machine confines this to period 1 without a separate
 * guard — a `Terjadwal` period has no `→ Diajukan` edge and the engine blocks it.
 */
export async function submitPlanPeriode(sql: Sql, actor: Actor, planId: string): Promise<Plan> {
  return withTransaction(sql, async (tx) => {
    const plan = await loadPlanForUpdate(tx, planId);
    const ownerAm = await ownerAmOfClient(tx, plan.clientId);
    if (!canWritePlan(actor, ownerAm)) throw new ForbiddenError(MSG_PLAN_FORBIDDEN);
    if ((plan.catatanPembuka ?? '').trim() === '') {
      throw new ValidationError(MSG_PLAN_CATATAN_PEMBUKA_REQUIRED);
    }
    await transitionPlan(tx, actor, planId, PLAN_DIAJUKAN);
    return loadPlan(tx, planId);
  });
}

/**
 * approvePlanPeriode drives period 1 `Diajukan → Aktif` (Rule 3) — the SPV's
 * approval, which is what switches the Plan mechanism on for the whole contract.
 * The `require_lead` edge already refuses a non-lead; this narrows it to the
 * Account division (Rule 3's SPV / Head of Account, not any division's lead).
 */
export async function approvePlanPeriode(sql: Sql, actor: Actor, planId: string): Promise<Plan> {
  if (!canApprovePlan(actor)) throw new ForbiddenError(MSG_PLAN_APPROVE_FORBIDDEN);
  return withTransaction(sql, async (tx) => {
    await loadPlanForUpdate(tx, planId); // lock + 404 before the move
    await transitionPlan(tx, actor, planId, PLAN_AKTIF);
    return loadPlan(tx, planId);
  });
}

/**
 * returnPlanPeriode drives period 1 `Diajukan → Draft` (Rule 3): the SPV sends it
 * back with a MANDATORY note. There is no `catatan_reviewer` column on `plan`
 * (B-01 gave it only PA-7's `catatan_pembuka`), so the note lives where Rule 19
 * puts every approval decision — the immutable audit log — as a `dikembalikan`
 * row alongside the `transition:` row `sm_transition` writes.
 */
export async function returnPlanPeriode(
  sql: Sql,
  actor: Actor,
  planId: string,
  catatan: string,
): Promise<Plan> {
  const note = (catatan ?? '').trim();
  if (note === '') throw new ValidationError(MSG_PLAN_RETURN_NOTES_REQUIRED);
  if (!canApprovePlan(actor)) throw new ForbiddenError(MSG_PLAN_APPROVE_FORBIDDEN);
  return withTransaction(sql, async (tx) => {
    const plan = await loadPlanForUpdate(tx, planId);
    await transitionPlan(tx, actor, planId, PLAN_DRAFT);
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_PLAN,
      entityId: planId,
      actorEmployeeId: actor.employeeId,
      action: 'dikembalikan',
      beforeJson: { status: plan.status },
      afterJson: { status: PLAN_DRAFT, catatan: note },
      createdBy: actor.employeeId,
    });
    return loadPlan(tx, planId);
  });
}

/**
 * activatePlanPeriode drives a scheduled period `Terjadwal → Aktif` (Rule 4) —
 * the auto-activation the 00:00 WIB job (B-09) calls for every period whose start
 * date is today. It is NOT lead-gated (the edge carries no `require_lead`,
 * matching the service-role job that runs it); the guard here is only that the
 * caller has Plan write scope, so the function cannot be driven by an unrelated
 * account.
 *
 * Rule 5 (one `Aktif` per chain) is held by the partial unique index
 * `uq_plan_aktif_*`: activating period n+1 while period n is still `Aktif` is
 * refused by the DB. The job force-closes the overdue predecessor first (B-09).
 *
 * **The `Menunggu Persetujuan` hold (Rule 4/9).** A period reaches this function
 * in one of two states. `Terjadwal` → activate straight through. `Menunggu
 * Persetujuan` means a `Turun >10%` request was still pending at the start date:
 * Rule 4 says the period then activates on the **original** Strategi target and
 * the request is marked `Kedaluwarsa`. So before the move, any target still
 * `Menunggu Persetujuan` is reverted to its Strategi figure and expired (an
 * already-`Disetujui` request keeps its reduced figure; a `Ditolak` one already
 * reverted). Execution is never blocked by an unanswered approval.
 */
export async function activatePlanPeriode(sql: Sql, actor: Actor, planId: string): Promise<Plan> {
  return withTransaction(sql, async (tx) => {
    const plan = await loadPlanForUpdate(tx, planId);
    const ownerAm = await ownerAmOfClient(tx, plan.clientId);
    if (!canWritePlan(actor, ownerAm)) throw new ForbiddenError(MSG_PLAN_FORBIDDEN);
    if (plan.status === PLAN_MENUNGGU) {
      await expirePendingAdjustments(tx, actor, planId);
    }
    await transitionPlan(tx, actor, planId, PLAN_AKTIF);
    // Rule 7 (P1): on activation the monthly rows are split across the period's
    // weeks. B-05 derivation — no-op for a period with no rows yet.
    await deriveWeeklyDistribution(tx, actor, plan);
    return loadPlan(tx, planId);
  });
}

// ---------------------------------------------------------------------------
// B-04 — Rule 9 asymmetric target adjustment + defisit_terbawa
// ---------------------------------------------------------------------------
//
// §3 names the hole this closes: periods 2..n activate with no approval AND the
// AM can edit the period target, so nothing stops an AM re-baselining a month
// down to what is already achievable. The guardrail is asymmetric (§3 table):
//
//   * Upward           → free (reason optional), applies immediately.
//   * Downward ≤ 10%   → mandatory reason, notifies SPV, applies immediately.
//   * Downward > 10%   → mandatory reason + evidence, and HOLDS the period in
//                        `Menunggu Persetujuan` until an SPV resolves it (Rule 4).
//   * Any downward     → the shortfall is carried (defisit_terbawa), not deleted.
//
// nilai_strategi is never touched (the frozen PE-5 anchor); only nilai_dipakai
// and its adjustment trail (arah / persen / alasan / bukti / status_persetujuan)
// move. Notifications are NOT emitted — the M6B catalog is not registered yet
// (same seam as B-03); the SPV-notify / approval-request events land with it.

/** The classification of a proposed adjustment — pure, so it is unit-testable. */
export interface AdjustmentClass {
  arah: 'naik' | 'turun' | 'tetap';
  /** Absolute magnitude of the change, percent of nilai_strategi, 2 dp. */
  persenPerubahan: number;
  /** Downward adjustments require a written reason (PB-4). */
  requiresReason: boolean;
  /** Downward > 10% requires supporting evidence (PB-5). */
  requiresBukti: boolean;
  /** Downward > 10% requires SPV approval and holds the period (Rule 4/9). */
  requiresApproval: boolean;
}

/**
 * classifyAdjustment decides direction, magnitude, and which guardrails apply,
 * from the two figures alone. The threshold is `DOWNWARD_APPROVAL_THRESHOLD_PCT`.
 * When nilai_strategi is 0 an upward move has no defined percentage (division by
 * zero → 0, rendered `—` upstream per house rule #7); a downward move from 0 is
 * impossible (the non-negative CHECK forbids it).
 */
export function classifyAdjustment(nilaiStrategi: number, nilaiDipakai: number): AdjustmentClass {
  if (nilaiDipakai === nilaiStrategi) {
    return { arah: 'tetap', persenPerubahan: 0, requiresReason: false, requiresBukti: false, requiresApproval: false };
  }
  const pct =
    nilaiStrategi === 0
      ? 0
      : Math.round((Math.abs(nilaiDipakai - nilaiStrategi) / nilaiStrategi) * 10000) / 100;
  if (nilaiDipakai > nilaiStrategi) {
    return { arah: 'naik', persenPerubahan: pct, requiresReason: false, requiresBukti: false, requiresApproval: false };
  }
  const big = pct > DOWNWARD_APPROVAL_THRESHOLD_PCT;
  return { arah: 'turun', persenPerubahan: pct, requiresReason: true, requiresBukti: big, requiresApproval: big };
}

interface PlanTargetDbRow {
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
}

function rowToPlanTarget(t: PlanTargetDbRow): PlanTarget {
  return {
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
  };
}

/** Load one target FOR UPDATE — locks it so the classify/write cannot race. */
async function loadTargetForUpdate(
  tx: TransactionSql,
  planId: string,
  channel: string,
  metric: string,
): Promise<PlanTargetDbRow> {
  const rows = await tx<PlanTargetDbRow[]>`
    select * from plan_target
     where plan_id = ${planId} and channel = ${channel} and metric = ${metric}
     for update`;
  if (rows.length === 0) throw new NotFoundError(MSG_PLAN_TARGET_NOT_FOUND);
  return rows[0];
}

/**
 * adjustPlanTarget is the single Rule 9 write path (PB-2..PB-5). The owning AM
 * sets `nilaiDipakai` for one channel×metric; direction and guardrails follow
 * from `classifyAdjustment`. Allowed only while the period is `Draft` (period 1)
 * or `Terjadwal` (2..n) — a period that is `Aktif`/held/closed is past the point
 * where its target may move.
 *
 * A downward > 10% adjustment on a *scheduled* period (`Terjadwal`) also holds
 * the period: it files the request as `Menunggu Persetujuan` and moves the period
 * to that state (Rule 4). On period 1 (`Draft`) there is no separate hold — the
 * whole period already goes to the SPV via `submitPlanPeriode`/`approvePlanPeriode`,
 * so the > 10% figure just needs its reason + evidence and rides that approval.
 */
export async function adjustPlanTarget(
  sql: Sql,
  actor: Actor,
  planId: string,
  channel: string,
  metric: string,
  nilaiDipakai: number,
  opts: { alasan?: string; buktiFile?: string } = {},
): Promise<PlanTarget> {
  if (!Number.isFinite(nilaiDipakai) || nilaiDipakai < 0) {
    throw new ValidationError(MSG_PLAN_ADJUST_NILAI_INVALID);
  }
  return withTransaction(sql, async (tx) => {
    const plan = await loadPlanForUpdate(tx, planId);
    const ownerAm = await ownerAmOfClient(tx, plan.clientId);
    if (!canWritePlan(actor, ownerAm)) throw new ForbiddenError(MSG_PLAN_FORBIDDEN);
    if (plan.status !== PLAN_DRAFT && plan.status !== PLAN_TERJADWAL) {
      throw new ConflictError(MSG_PLAN_ADJUST_STATUS);
    }
    const before = await loadTargetForUpdate(tx, planId, channel, metric);
    const nilaiStrategi = num(before.nilai_strategi);
    const cls = classifyAdjustment(nilaiStrategi, nilaiDipakai);

    const alasan = (opts.alasan ?? '').trim() || null;
    const buktiFile = (opts.buktiFile ?? '').trim() || null;
    if (cls.requiresReason && alasan === null) {
      throw new ValidationError(MSG_PLAN_ADJUST_ALASAN_REQUIRED);
    }
    if (cls.requiresBukti && buktiFile === null) {
      throw new ValidationError(MSG_PLAN_ADJUST_BUKTI_REQUIRED);
    }

    // A > 10% downward request on a scheduled period is the only case that holds
    // the period; period 1 rides its own SPV loop, so it is not marked pending.
    const holds = cls.requiresApproval && plan.status === PLAN_TERJADWAL;
    const statusPersetujuan = holds ? ADJ_PENDING : null;

    await tx`
      update plan_target
         set nilai_dipakai = ${nilaiDipakai},
             arah = ${cls.arah},
             persen_perubahan = ${cls.persenPerubahan},
             alasan = ${alasan},
             bukti_file = ${cls.arah === 'turun' ? buktiFile : null},
             status_persetujuan = ${statusPersetujuan}
       where plan_id = ${planId} and channel = ${channel} and metric = ${metric}`;

    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_PLAN,
      entityId: planId,
      actorEmployeeId: actor.employeeId,
      action: 'penyesuaian_target',
      beforeJson: {
        channel,
        metric,
        nilai_dipakai: num(before.nilai_dipakai),
        arah: before.arah,
      },
      afterJson: {
        channel,
        metric,
        nilai_strategi: nilaiStrategi,
        nilai_dipakai: nilaiDipakai,
        arah: cls.arah,
        persen_perubahan: cls.persenPerubahan,
        alasan,
        status_persetujuan: statusPersetujuan,
      },
      createdBy: actor.employeeId,
    });

    if (holds) await transitionPlan(tx, actor, planId, PLAN_MENUNGGU);

    const after = await loadTargetForUpdate(tx, planId, channel, metric);
    return rowToPlanTarget(after);
  });
}

/**
 * approveTargetAdjustment records the SPV's approval of a pending `Turun >10%`
 * request (PH-3): the reduced figure stands. It does NOT activate the period —
 * activation is the 00:00 WIB job's job (B-09); a period whose request is settled
 * simply keeps its `Disetujui` figure when that job runs. SPV / Head of Account
 * only (the same gate as period-1 approval).
 */
export async function approveTargetAdjustment(
  sql: Sql,
  actor: Actor,
  planId: string,
  channel: string,
  metric: string,
): Promise<PlanTarget> {
  if (!canApprovePlan(actor)) throw new ForbiddenError(MSG_PLAN_APPROVE_FORBIDDEN);
  return withTransaction(sql, async (tx) => {
    await loadPlanForUpdate(tx, planId); // lock + 404
    const t = await loadTargetForUpdate(tx, planId, channel, metric);
    if (t.status_persetujuan !== ADJ_PENDING) throw new ConflictError(MSG_PLAN_ADJUST_NOT_PENDING);
    await tx`
      update plan_target set status_persetujuan = ${ADJ_APPROVED}
       where plan_id = ${planId} and channel = ${channel} and metric = ${metric}`;
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_PLAN,
      entityId: planId,
      actorEmployeeId: actor.employeeId,
      action: 'penyesuaian_disetujui',
      beforeJson: { channel, metric, status_persetujuan: ADJ_PENDING },
      afterJson: { channel, metric, status_persetujuan: ADJ_APPROVED, nilai_dipakai: num(t.nilai_dipakai) },
      createdBy: actor.employeeId,
    });
    const after = await loadTargetForUpdate(tx, planId, channel, metric);
    return rowToPlanTarget(after);
  });
}

/**
 * rejectTargetAdjustment records the SPV's rejection of a pending `Turun >10%`
 * request: the target reverts to its original Strategi figure (`arah='tetap'`),
 * with a mandatory note in the immutable log (Rule 19). Like approval it does
 * not move the period — the start-date job activates it on the restored figure.
 */
export async function rejectTargetAdjustment(
  sql: Sql,
  actor: Actor,
  planId: string,
  channel: string,
  metric: string,
  catatan: string,
): Promise<PlanTarget> {
  const note = (catatan ?? '').trim();
  if (note === '') throw new ValidationError(MSG_PLAN_ADJUST_REJECT_NOTES_REQUIRED);
  if (!canApprovePlan(actor)) throw new ForbiddenError(MSG_PLAN_APPROVE_FORBIDDEN);
  return withTransaction(sql, async (tx) => {
    await loadPlanForUpdate(tx, planId);
    const t = await loadTargetForUpdate(tx, planId, channel, metric);
    if (t.status_persetujuan !== ADJ_PENDING) throw new ConflictError(MSG_PLAN_ADJUST_NOT_PENDING);
    await tx`
      update plan_target
         set nilai_dipakai = nilai_strategi, arah = 'tetap', persen_perubahan = 0,
             status_persetujuan = ${ADJ_REJECTED}
       where plan_id = ${planId} and channel = ${channel} and metric = ${metric}`;
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_PLAN,
      entityId: planId,
      actorEmployeeId: actor.employeeId,
      action: 'penyesuaian_ditolak',
      beforeJson: { channel, metric, nilai_dipakai: num(t.nilai_dipakai), status_persetujuan: ADJ_PENDING },
      afterJson: { channel, metric, nilai_dipakai: num(t.nilai_strategi), status_persetujuan: ADJ_REJECTED, catatan: note },
      createdBy: actor.employeeId,
    });
    const after = await loadTargetForUpdate(tx, planId, channel, metric);
    return rowToPlanTarget(after);
  });
}

/**
 * expirePendingAdjustments reverts every still-pending `Turun >10%` request on a
 * held period to its Strategi figure and marks it `Kedaluwarsa` (Rule 4: an
 * unanswered request expires and the period activates on the original target).
 * Runs inside `activatePlanPeriode`'s transaction, just before the move.
 */
async function expirePendingAdjustments(tx: TransactionSql, actor: Actor, planId: string): Promise<void> {
  const expired = await tx<{ channel: string; metric: string; nilai_dipakai: string | number; nilai_strategi: string | number }[]>`
    update plan_target
       set nilai_dipakai = nilai_strategi, arah = 'tetap', persen_perubahan = 0,
           status_persetujuan = ${ADJ_EXPIRED}
     where plan_id = ${planId} and status_persetujuan = ${ADJ_PENDING}
     returning channel, metric, nilai_dipakai, nilai_strategi`;
  const ex = executors(tx);
  for (const e of expired) {
    await ex.audit.insertAudit({
      entityType: ENTITY_PLAN,
      entityId: planId,
      actorEmployeeId: actor.employeeId,
      action: 'penyesuaian_kedaluwarsa',
      beforeJson: { channel: e.channel, metric: e.metric, status_persetujuan: ADJ_PENDING },
      afterJson: { channel: e.channel, metric: e.metric, nilai_dipakai: num(e.nilai_strategi), status_persetujuan: ADJ_EXPIRED },
      createdBy: actor.employeeId,
    });
  }
}

// ---------------------------------------------------------------------------
// B-05 — derived weekly distribution (Rule 7 / P1)
// ---------------------------------------------------------------------------
//
// Weekly rows are DERIVED, never typed. On activation each monthly `plan_row` is
// split across the period's weeks; the split is even, then re-weighted toward
// weeks that contain a Strategi G-2 big date (those weeks carry heavier load).
// The AM may re-drag afterwards (`setWeeklyDistribution`), but the weekly total
// must always equal the monthly quota — enforced by the deferred constraint
// trigger `trg_plan_row_week_sum`, with this TS layer giving a clean message
// before the DB does. A weekly row can never exist without its monthly parent
// (FK), so "no orphan week" needs no separate guard.

/** A big-date week carries this many times a plain week's share (Rule 7 re-weight). */
export const BIG_DATE_WEIGHT = 2;

/**
 * distributeWeeks splits `kuota` across `weeks` weeks, summing back to `kuota`
 * EXACTLY (worked in integer cents so 2-dp quotas never drift). Weeks listed in
 * `emphasize` (1-based) get `BIG_DATE_WEIGHT`× the share of a plain week; the
 * rounding remainder lands on the emphasized weeks first, else the last weeks
 * (which already absorb the period's 8-10 day tail, B-02) — never a stub week.
 */
export function distributeWeeks(kuota: number, weeks: number, emphasize: number[] = []): number[] {
  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new Error(`distributeWeeks: weeks harus bilangan bulat >= 1: ${weeks}`);
  }
  if (!Number.isFinite(kuota) || kuota < 0) {
    throw new Error(`distributeWeeks: kuota harus >= 0: ${kuota}`);
  }
  const emphasized = new Set(emphasize.filter((w) => w >= 1 && w <= weeks));
  const weights = Array.from({ length: weeks }, (_, i) =>
    emphasized.has(i + 1) ? BIG_DATE_WEIGHT : 1,
  );
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const cents = Math.round(kuota * 100);
  const raw = weights.map((w) => Math.floor((cents * w) / totalWeight));
  let rem = cents - raw.reduce((a, b) => a + b, 0);
  // Remainder cents: emphasized weeks first (in order), then the last weeks back
  // to front. Deterministic, and it keeps the extra where the load belongs.
  const order = [
    ...[...emphasized].sort((a, b) => a - b).map((w) => w - 1),
    ...Array.from({ length: weeks }, (_, i) => weeks - 1 - i).filter((i) => !emphasized.has(i + 1)),
  ];
  for (let k = 0; rem > 0; k += 1, rem -= 1) raw[order[k % order.length]] += 1;
  return raw.map((c) => c / 100);
}

/** The week (1..jumlahMinggu) that a date falls in, clamped to the period. */
function weekOfDate(dateStr: string, periodeMulai: string, jumlahMinggu: number): number {
  const offset = daysInclusive(periodeMulai, dateStr) - 1; // 0-based day offset
  if (offset < 0) return 1;
  return Math.min(jumlahMinggu, Math.floor(offset / 7) + 1);
}

/**
 * deriveWeeklyDistribution lays down the weekly rows for every monthly row of a
 * period that has none yet (idempotent — a row already split is left alone, so a
 * re-run never doubles or overwrites an AM's re-drag). Big-date weeks come from
 * the parent Strategi's G-2 dates that fall inside the period; a Plan Satuan
 * period (no Strategi) simply splits evenly. Runs inside the activation tx.
 */
export async function deriveWeeklyDistribution(
  tx: TransactionSql,
  actor: Actor,
  plan: Plan,
): Promise<void> {
  const rows = await tx<{ id: string | number; kuota: string | number }[]>`
    select pr.id, pr.kuota from plan_row pr
     where pr.plan_id = ${plan.id}
       and not exists (select 1 from plan_row_week w where w.plan_row_id = pr.id)`;
  if (rows.length === 0) return;

  // Which weeks of THIS period contain a Strategi G-2 big date.
  const emphasize: number[] = [];
  if (plan.strategiId !== null) {
    const bigDates = await tx<{ tanggal: string | Date }[]>`
      select tanggal from strategi_tanggal_besar
       where strategi_id = ${plan.strategiId}
         and tanggal between ${plan.tanggalMulai} and ${plan.tanggalAkhir}`;
    for (const b of bigDates) {
      emphasize.push(weekOfDate(isoDate(b.tanggal), plan.tanggalMulai, plan.jumlahMinggu));
    }
  }

  for (const r of rows) {
    const per = distributeWeeks(num(r.kuota), plan.jumlahMinggu, emphasize);
    for (let i = 0; i < per.length; i += 1) {
      await tx`
        insert into plan_row_week (plan_row_id, minggu_no, kuota, created_by)
        values (${r.id}, ${i + 1}, ${per[i]}, ${actor.employeeId})`;
    }
  }
}

/**
 * setWeeklyDistribution replaces a work-row's weekly split with an AM-supplied
 * one (Rule 7 "the AM can re-drag"). AM-only authorship (Rule 18); the period
 * must be `Aktif` (weeks only exist after activation). Each week must be inside
 * the period and appear once, and the quotas must sum to the monthly quota — the
 * deferred trigger is the final word, this gives the friendly message first.
 */
export async function setWeeklyDistribution(
  sql: Sql,
  actor: Actor,
  planRowId: number,
  perWeek: { mingguNo: number; kuota: number }[],
): Promise<PlanRowWeek[]> {
  return withTransaction(sql, async (tx) => {
    const rowRes = await tx<{ id: string | number; plan_id: string; kuota: string | number }[]>`
      select id, plan_id, kuota from plan_row where id = ${planRowId} for update`;
    if (rowRes.length === 0) throw new NotFoundError(MSG_PLAN_ROW_NOT_FOUND);
    const planId = rowRes[0].plan_id;
    const kuota = num(rowRes[0].kuota);

    const plan = await loadPlanForUpdate(tx, planId);
    const ownerAm = await ownerAmOfClient(tx, plan.clientId);
    if (!canWritePlan(actor, ownerAm)) throw new ForbiddenError(MSG_PLAN_FORBIDDEN);
    if (plan.status !== PLAN_AKTIF) throw new ConflictError(MSG_PLAN_WEEK_STATUS);

    const seen = new Set<number>();
    for (const w of perWeek) {
      if (!Number.isInteger(w.mingguNo) || w.mingguNo < 1 || w.mingguNo > plan.jumlahMinggu) {
        throw new ValidationError(MSG_PLAN_WEEK_NO_INVALID);
      }
      if (seen.has(w.mingguNo)) throw new ValidationError(MSG_PLAN_WEEK_NO_INVALID);
      seen.add(w.mingguNo);
      if (!Number.isFinite(w.kuota) || w.kuota < 0) throw new ValidationError(MSG_PLAN_WEEK_SUM_MISMATCH);
    }
    const sum = perWeek.reduce((a, w) => a + w.kuota, 0);
    // Compare in cents so 2-dp quotas do not fail on a float epsilon.
    if (Math.round(sum * 100) !== Math.round(kuota * 100)) {
      throw new ValidationError(MSG_PLAN_WEEK_SUM_MISMATCH);
    }

    await tx`delete from plan_row_week where plan_row_id = ${planRowId}`;
    for (const w of perWeek) {
      await tx`
        insert into plan_row_week (plan_row_id, minggu_no, kuota, created_by)
        values (${planRowId}, ${w.mingguNo}, ${w.kuota}, ${actor.employeeId})`;
    }

    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_PLAN,
      entityId: planId,
      actorEmployeeId: actor.employeeId,
      action: 'distribusi_mingguan',
      beforeJson: { plan_row_id: planRowId },
      afterJson: { plan_row_id: planRowId, minggu: perWeek },
      createdBy: actor.employeeId,
    });

    const out = await tx<{ id: string | number; plan_row_id: string | number; minggu_no: number; kuota: string | number }[]>`
      select id, plan_row_id, minggu_no, kuota from plan_row_week
       where plan_row_id = ${planRowId} order by minggu_no`;
    return out.map((w) => ({
      id: num(w.id),
      planRowId: num(w.plan_row_id),
      mingguNo: num(w.minggu_no),
      kuota: num(w.kuota),
    }));
  });
}

// ---------------------------------------------------------------------------
// B-06 — hybrid actuals (Rule 10/11, Section P-E)
// ---------------------------------------------------------------------------
//
// Actuals are HYBRID (P5): GMV per channel is entered manually by the owning AM
// with a source attachment + capture date (PE-1/PE-2); every other metric is
// pulled from the execution modules by the system and is read-only to the AM
// (PE-3). The AM cannot overwrite an auto metric — Rule 10 — they can only file
// a `Sengketa Angka` note against it (PE-6), which is meant to route to the SPV
// (the notification is deferred until the catalog is raised — PA-8/O55, so this
// records the dispute but emits nothing yet, exactly like B-03…B-05).
//
// The AM-cannot-write-auto rule is a FROZEN INVARIANT enforced in three agreeing
// places (`plan.reals.test.ts` proves they don't diverge): this TS write path,
// the RLS `WITH CHECK`, and the `trg_plan_actual_no_manual_auto` trigger. The TS
// side simply offers NO path for an actor to set an `otomatis` value: the manual
// path below is `sumber='manual'` only, and disputing is a note, not a rewrite.
// Auto ingestion is a system path (`recordAutoActual`, no Actor — service-role,
// used by B-09 / the execution modules).
//
// Close does NOT lock (X-07 deviation, owner 2026-08-07): a manual GMV entered
// after the period closed is accepted and recorded as an AMENDMENT in the
// immutable log (Rule 11 "post-close correction creates an audit-logged
// amendment visible on the period view"), rather than blocked — blocking a late
// number does not make it exist, it only loses it forever (house rule #3). The
// lateness *signal* (the "bad performance log point" X-07 wants, and the +5-day
// `plan_realisasi_belum_lengkap` warning) is the B-09 job's, not this write's —
// and it may not claim a KPI weight until X-12 gives it one.

function rowToPlanActual(a: PlanActualDbRow): PlanActual {
  return {
    planId: a.plan_id,
    channel: a.channel,
    metric: a.metric,
    sumber: a.sumber,
    nilai: num(a.nilai),
    fileBukti: a.file_bukti,
    tanggalAmbil: optDate(a.tanggal_ambil),
    sengketa: a.sengketa,
  };
}

interface PlanActualDbRow {
  plan_id: string;
  channel: string;
  metric: string;
  sumber: 'manual' | 'otomatis';
  nilai: string | number;
  file_bukti: string | null;
  tanggal_ambil: string | Date | null;
  sengketa: string | null;
}

/** Load one actual FOR UPDATE — locks it so a dispute/write cannot race. */
async function loadActualForUpdate(
  tx: TransactionSql,
  planId: string,
  channel: string,
  metric: string,
): Promise<PlanActualDbRow> {
  const rows = await tx<PlanActualDbRow[]>`
    select * from plan_actual
     where plan_id = ${planId} and channel = ${channel} and metric = ${metric}
     for update`;
  if (rows.length === 0) throw new NotFoundError(MSG_ACTUAL_NOT_FOUND);
  return rows[0];
}

/**
 * recordManualActual is the single write path for a manual actual (PE-1/PE-2):
 * the owning AM sets GMV for one channel, with a source attachment + capture
 * date. `metric` must be a MANUAL_METRICS member (GMV only, X-08) — an attempt
 * to enter an auto metric by hand is rejected here, before it can reach the DB.
 * Idempotent per (plan, channel, metric): a re-entry overwrites the prior manual
 * figure (a correction), and every write appends to the immutable log.
 *
 * Not status-gated (X-07): a figure entered after the period closed is accepted
 * and logged as an amendment (`action='realisasi_amandemen'`), not blocked.
 */
export async function recordManualActual(
  sql: Sql,
  actor: Actor,
  planId: string,
  channel: string,
  metric: string,
  nilai: number,
  opts: { fileBukti: string; tanggalAmbil: string },
): Promise<PlanActual> {
  if (!MANUAL_METRICS.includes(metric)) {
    throw new ValidationError(MSG_ACTUAL_METRIC_NOT_MANUAL);
  }
  if (!Number.isFinite(nilai) || nilai < 0) {
    throw new ValidationError(MSG_ACTUAL_NILAI_INVALID);
  }
  const fileBukti = (opts.fileBukti ?? '').trim();
  const tanggalAmbil = (opts.tanggalAmbil ?? '').trim();
  if (fileBukti === '' || tanggalAmbil === '') {
    throw new ValidationError(MSG_ACTUAL_BUKTI_REQUIRED);
  }
  return withTransaction(sql, async (tx) => {
    const plan = await loadPlanForUpdate(tx, planId);
    const ownerAm = await ownerAmOfClient(tx, plan.clientId);
    if (!canWritePlan(actor, ownerAm)) throw new ForbiddenError(MSG_PLAN_FORBIDDEN);

    const isAmendment = PLAN_TERMINAL.includes(plan.status);
    const before = await tx<PlanActualDbRow[]>`
      select * from plan_actual
       where plan_id = ${planId} and channel = ${channel} and metric = ${metric}
       for update`;

    await tx`
      insert into plan_actual
        (plan_id, channel, metric, sumber, nilai, file_bukti, tanggal_ambil, created_by)
      values (${planId}, ${channel}, ${metric}, 'manual', ${nilai},
              ${fileBukti}, ${tanggalAmbil}, ${actor.employeeId})
      on conflict (plan_id, channel, metric) do update
        set sumber = 'manual', nilai = excluded.nilai,
            file_bukti = excluded.file_bukti, tanggal_ambil = excluded.tanggal_ambil`;

    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_PLAN,
      entityId: planId,
      actorEmployeeId: actor.employeeId,
      // Rule 11 — a post-close correction is an amendment, and the log says so.
      action: isAmendment ? 'realisasi_amandemen' : 'realisasi_manual',
      beforeJson:
        before.length === 0
          ? { channel, metric }
          : { channel, metric, nilai: num(before[0].nilai) },
      afterJson: {
        channel,
        metric,
        nilai,
        file_bukti: fileBukti,
        tanggal_ambil: tanggalAmbil,
        periode_status: plan.status,
      },
      createdBy: actor.employeeId,
    });

    const after = await loadActualForUpdate(tx, planId, channel, metric);
    return rowToPlanActual(after);
  });
}

/**
 * fileSengketa records the AM's `Sengketa Angka` (PE-6): a written challenge to
 * an AUTO metric they believe is wrong. It sets only the `sengketa` note on the
 * existing auto row — it never touches the value (that is the source module's,
 * Rule 10). The dispute is meant to route to the SPV; the notification waits on
 * the catalog (PA-8/O55), so this logs the dispute and emits nothing yet.
 */
export async function fileSengketa(
  sql: Sql,
  actor: Actor,
  planId: string,
  channel: string,
  metric: string,
  alasan: string,
): Promise<PlanActual> {
  const note = (alasan ?? '').trim();
  if (note === '') throw new ValidationError(MSG_SENGKETA_ALASAN_REQUIRED);
  return withTransaction(sql, async (tx) => {
    const plan = await loadPlanForUpdate(tx, planId);
    const ownerAm = await ownerAmOfClient(tx, plan.clientId);
    if (!canWritePlan(actor, ownerAm)) throw new ForbiddenError(MSG_PLAN_FORBIDDEN);

    const before = await loadActualForUpdate(tx, planId, channel, metric);
    if (before.sumber !== 'otomatis') throw new ConflictError(MSG_SENGKETA_NOT_AUTO);

    await tx`
      update plan_actual set sengketa = ${note}
       where plan_id = ${planId} and channel = ${channel} and metric = ${metric}`;

    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_PLAN,
      entityId: planId,
      actorEmployeeId: actor.employeeId,
      action: 'sengketa_angka',
      beforeJson: { channel, metric, sengketa: before.sengketa },
      afterJson: { channel, metric, nilai: num(before.nilai), sengketa: note },
      createdBy: actor.employeeId,
    });

    const after = await loadActualForUpdate(tx, planId, channel, metric);
    return rowToPlanActual(after);
  });
}

/**
 * recordAutoActual is the SYSTEM ingestion path for an auto metric (PE-3): the
 * execution modules / the B-09 close job push a computed figure in. It takes no
 * Actor because it is never a human action — it runs service-role, where the
 * DB guard trigger sees no JWT actor and lets the auto write through. Kept here
 * as the counterpart to the AM block so B-09 has one place to write auto rows;
 * `createdBy` is the system/job identity the caller supplies.
 */
export async function recordAutoActual(
  sql: Sql,
  planId: string,
  channel: string,
  metric: string,
  nilai: number,
  createdBy: string,
): Promise<PlanActual> {
  if (!Number.isFinite(nilai) || nilai < 0) {
    throw new ValidationError(MSG_ACTUAL_NILAI_INVALID);
  }
  return withTransaction(sql, async (tx) => {
    await tx`
      insert into plan_actual (plan_id, channel, metric, sumber, nilai, created_by)
      values (${planId}, ${channel}, ${metric}, 'otomatis', ${nilai}, ${createdBy})
      on conflict (plan_id, channel, metric) do update
        set sumber = 'otomatis', nilai = excluded.nilai`;
    const after = await loadActualForUpdate(tx, planId, channel, metric);
    return rowToPlanActual(after);
  });
}

// ---------------------------------------------------------------------------
// B-07 — transactional period close (Rule 15)
// ---------------------------------------------------------------------------
//
// "Period close is a real step, not a date." Rule 15 / §266: closing a period is
// a TRANSACTION with three preconditions that must ALL hold, or nothing moves —
// partial close is not a state:
//
//   1. manual GMV entered per channel (PE-1);
//   2. every work-row in a terminal state — `Selesai` / `Sebagian` /
//      `Tidak Dikerjakan`, the last two with a reason (PC-14);
//   3. the P-F review complete — the Diagnosa Gap (PF-3) is required only when
//      the period missed target (variance negative).
//
// Two close paths, from the machine's two Aktif→terminal edges:
//   * `closePlanPeriode`  — the AM's `Aktif → Ditutup`. Enforces 1–3; refuses
//     with the exact BI message for the first unmet precondition.
//   * `forceClosePlanPeriode` — the system's `Aktif → Ditutup Otomatis` (the
//     00:00 WIB job, B-09, schedules WHEN). It does NOT enforce 1–3; instead it
//     coerces every non-terminal row to `Tidak Dikerjakan — tanpa keterangan`
//     (deliberately ugly in reports, Rule 15) and closes. It touches NO actual:
//     X-07 (owner 2026-08-07) removed the close LOCK, so a late GMV is still
//     accepted after either close and logged as an amendment (B-06), never lost.
//
// PF-4 (assumption status) writes `strategi_assumption`, and PF-5 (carry-over)
// writes `plan_row.terbawa` — neither is a `plan_review` column, so neither is a
// close precondition here. PF-5's carry-over MECHANISM (moving unfinished rows
// into the next period) is B-08; this ticket closes the period, it does not
// carry rows forward. Notifications (`plan_periode_ditutup`) are NOT emitted —
// the M6B catalog is unregistered (PA-8/O55), same seam as B-03…B-06.

/** The five PC-14 row statuses. */
const ROW_STATUSES: readonly PlanRow['statusBaris'][] = [
  'Rencana',
  'Jalan',
  'Selesai',
  'Sebagian',
  'Tidak Dikerjakan',
];

/** The terminal (closeable) PC-14 row statuses — a row must reach one to close. */
export const ROW_TERMINAL_STATUSES: readonly PlanRow['statusBaris'][] = [
  'Selesai',
  'Sebagian',
  'Tidak Dikerjakan',
];

/** GMV is the one currency metric; targets/actuals key it exactly this way. */
const GMV_METRIC = 'gmv';

/**
 * Force-close reason marker (Rule 15). A row the AM never resolved becomes
 * `Tidak Dikerjakan` with this reason — meant to read `Tidak Dikerjakan — tanpa
 * keterangan` in reports, deliberately ugly so an abandoned period is visible.
 */
export const FORCE_CLOSE_ALASAN = 'tanpa keterangan';

/** A row is terminal AND, for `Sebagian` / `Tidak Dikerjakan`, carries a reason. */
function rowClosed(status: PlanRow['statusBaris'], alasan: string | null): boolean {
  if (status === 'Selesai') return true;
  if (status === 'Sebagian' || status === 'Tidak Dikerjakan') return (alasan ?? '').trim() !== '';
  return false; // Rencana / Jalan are not terminal
}

/** The P-F review carries every own W field, with Diagnosa Gap only when required. */
function reviewComplete(review: PlanReview | null, requireDiagnosa: boolean): boolean {
  if (review === null) return false;
  const filled = (s: string | null): boolean => (s ?? '').trim() !== '';
  if (
    !filled(review.yangJalan) ||
    !filled(review.yangTidakJalan) ||
    !filled(review.rekomendasi) ||
    !filled(review.materiKlien)
  ) {
    return false;
  }
  if (review.perluRevisi === null) return false; // PF-7 — a false answer is still an answer
  if (requireDiagnosa) {
    // PF-3 — "W (kalau variance negatif)": the enum AND its cited PE-8 evidence.
    if (review.diagnosaGap === null || !filled(review.diagnosaGapBukti)) return false;
  }
  return true;
}

/** The three Rule 15 close preconditions, plus the variance flag that drove PF-3. */
export interface CloseReadiness {
  /** Manual GMV present for every channel that carries a GMV target (PE-1). */
  gmvComplete: boolean;
  /** Every work-row terminal, with a reason where PC-14 needs one. */
  rowsTerminal: boolean;
  /** The P-F review complete (diagnosa required only when variance negative). */
  reviewComplete: boolean;
  /** Σ manual GMV actual < Σ used GMV target — makes PF-3 mandatory. */
  varianceNegative: boolean;
  /** All three preconditions hold. */
  ready: boolean;
}

/**
 * checkCloseReadiness is the pure Rule 15 gate, computed from the period's child
 * rows alone — so it is unit-testable without a database and single-sources the
 * definition of "closeable". `closePlanPeriode` reads the rows and calls it.
 */
export function checkCloseReadiness(input: {
  targets: Pick<PlanTarget, 'channel' | 'metric' | 'nilaiDipakai'>[];
  actuals: Pick<PlanActual, 'channel' | 'metric' | 'sumber' | 'nilai'>[];
  rows: Pick<PlanRow, 'statusBaris' | 'statusBarisAlasan'>[];
  review: PlanReview | null;
}): CloseReadiness {
  // 1. Manual GMV per channel: every channel with a GMV target has a manual GMV
  //    actual. A period with no GMV target is vacuously complete.
  const gmvTargetChannels = new Set(
    input.targets.filter((t) => t.metric === GMV_METRIC).map((t) => t.channel),
  );
  const manualGmvChannels = new Set(
    input.actuals
      .filter((a) => a.metric === GMV_METRIC && a.sumber === 'manual')
      .map((a) => a.channel),
  );
  const gmvComplete = [...gmvTargetChannels].every((c) => manualGmvChannels.has(c));

  // 2. Every work-row terminal (reason where PC-14 needs it).
  const rowsTerminal = input.rows.every((r) => rowClosed(r.statusBaris, r.statusBarisAlasan));

  // 3. Variance vs used target (PE-4): drives whether PF-3 is mandatory.
  const targetGmv = input.targets
    .filter((t) => t.metric === GMV_METRIC)
    .reduce((s, t) => s + t.nilaiDipakai, 0);
  const actualGmv = input.actuals
    .filter((a) => a.metric === GMV_METRIC && a.sumber === 'manual')
    .reduce((s, a) => s + a.nilai, 0);
  const varianceNegative = actualGmv < targetGmv;

  const reviewOk = reviewComplete(input.review, varianceNegative);

  return {
    gmvComplete,
    rowsTerminal,
    reviewComplete: reviewOk,
    varianceNegative,
    ready: gmvComplete && rowsTerminal && reviewOk,
  };
}

interface PlanReviewDbRow {
  plan_id: string;
  yang_jalan: string | null;
  yang_tidak_jalan: string | null;
  diagnosa_gap: 'strategi_salah' | 'eksekusi_tidak_jalan' | null;
  diagnosa_gap_bukti: string | null;
  rekomendasi: string | null;
  perlu_revisi: boolean | null;
  materi_klien: string | null;
}

function rowToPlanReview(r: PlanReviewDbRow): PlanReview {
  return {
    planId: r.plan_id,
    yangJalan: r.yang_jalan,
    yangTidakJalan: r.yang_tidak_jalan,
    diagnosaGap: r.diagnosa_gap,
    diagnosaGapBukti: r.diagnosa_gap_bukti,
    rekomendasi: r.rekomendasi,
    perluRevisi: r.perlu_revisi,
    materiKlien: r.materi_klien,
  };
}

/** Read the child rows a close check needs, inside the caller's transaction. */
async function loadCloseReadiness(tx: TransactionSql, planId: string): Promise<CloseReadiness> {
  const targets = await tx<{ channel: string; metric: string; nilai_dipakai: string | number }[]>`
    select channel, metric, nilai_dipakai from plan_target where plan_id = ${planId}`;
  const actuals = await tx<
    { channel: string; metric: string; sumber: 'manual' | 'otomatis'; nilai: string | number }[]
  >`select channel, metric, sumber, nilai from plan_actual where plan_id = ${planId}`;
  const rows = await tx<
    { status_baris: PlanRow['statusBaris']; status_baris_alasan: string | null }[]
  >`select status_baris, status_baris_alasan from plan_row where plan_id = ${planId}`;
  const review = await tx<PlanReviewDbRow[]>`select * from plan_review where plan_id = ${planId}`;
  return checkCloseReadiness({
    targets: targets.map((t) => ({
      channel: t.channel,
      metric: t.metric,
      nilaiDipakai: num(t.nilai_dipakai),
    })),
    actuals: actuals.map((a) => ({
      channel: a.channel,
      metric: a.metric,
      sumber: a.sumber,
      nilai: num(a.nilai),
    })),
    rows: rows.map((r) => ({ statusBaris: r.status_baris, statusBarisAlasan: r.status_baris_alasan })),
    review: review.length === 0 ? null : rowToPlanReview(review[0]),
  });
}

/** Load one work-row by id (post-write read of the whole shape). */
async function loadPlanRow(tx: TransactionSql, planRowId: number): Promise<PlanRow> {
  const rows = await tx<Record<string, unknown>[]>`select * from plan_row where id = ${planRowId}`;
  if (rows.length === 0) throw new NotFoundError(MSG_PLAN_ROW_NOT_FOUND);
  return rowToPlanRow(rows[0]);
}

/**
 * setRowStatus sets a work-row's PC-14 status (`W (saat tutup)`). It is the write
 * path the AM uses to mark each row terminal before closing — `Sebagian` /
 * `Tidak Dikerjakan` carry a mandatory reason; the reason is cleared for the
 * non-terminal / `Selesai` states (a stale reason from an earlier status must not
 * linger). AM/lead write scope, and only while the period is `Aktif` — the window
 * in which rows are executed and resolved.
 */
export async function setRowStatus(
  sql: Sql,
  actor: Actor,
  planRowId: number,
  status: PlanRow['statusBaris'],
  alasan?: string,
): Promise<PlanRow> {
  if (!ROW_STATUSES.includes(status)) throw new ValidationError(MSG_ROW_STATUS_INVALID);
  const note = (alasan ?? '').trim() || null;
  const needsReason = status === 'Sebagian' || status === 'Tidak Dikerjakan';
  if (needsReason && note === null) throw new ValidationError(MSG_ROW_STATUS_ALASAN_REQUIRED);
  return withTransaction(sql, async (tx) => {
    const rr = await tx<{ plan_id: string; status_baris: PlanRow['statusBaris'] }[]>`
      select plan_id, status_baris from plan_row where id = ${planRowId} for update`;
    if (rr.length === 0) throw new NotFoundError(MSG_PLAN_ROW_NOT_FOUND);
    const planId = rr[0].plan_id;

    const plan = await loadPlanForUpdate(tx, planId);
    const ownerAm = await ownerAmOfClient(tx, plan.clientId);
    if (!canWritePlan(actor, ownerAm)) throw new ForbiddenError(MSG_PLAN_FORBIDDEN);
    if (plan.status !== PLAN_AKTIF) throw new ConflictError(MSG_ROW_STATUS_PERIOD);

    const storedAlasan = needsReason ? note : null;
    await tx`
      update plan_row set status_baris = ${status}, status_baris_alasan = ${storedAlasan}
       where id = ${planRowId}`;

    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_PLAN,
      entityId: planId,
      actorEmployeeId: actor.employeeId,
      action: 'status_baris',
      beforeJson: { plan_row_id: planRowId, status_baris: rr[0].status_baris },
      afterJson: { plan_row_id: planRowId, status_baris: status, alasan: storedAlasan },
      createdBy: actor.employeeId,
    });

    return loadPlanRow(tx, planRowId);
  });
}

/** The P-F fields an AM fills before closing (a full replace, autosave-friendly). */
export interface PlanReviewInput {
  yangJalan?: string | null;
  yangTidakJalan?: string | null;
  diagnosaGap?: 'strategi_salah' | 'eksekusi_tidak_jalan' | null;
  diagnosaGapBukti?: string | null;
  rekomendasi?: string | null;
  perluRevisi?: boolean | null;
  materiKlien?: string | null;
}

/** Normalize a text field: undefined/empty → null, else trimmed. */
const optText = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/**
 * savePlanReview upserts the P-F review (Section P-F). It is a FULL replace of the
 * `plan_review` row — the P-F form submits the whole review, so an omitted field
 * is stored as `null` (an unfilled answer), never silently merged. Completeness
 * is NOT enforced here: the review is filled progressively while the period runs
 * (§7 autosave), and the Rule 15 completeness gate lives in `closePlanPeriode`.
 * AM/lead write scope; only while `Aktif` (the review is a closing artifact).
 */
export async function savePlanReview(
  sql: Sql,
  actor: Actor,
  planId: string,
  input: PlanReviewInput,
): Promise<PlanReview> {
  const diagnosa = input.diagnosaGap ?? null;
  if (diagnosa !== null && diagnosa !== 'strategi_salah' && diagnosa !== 'eksekusi_tidak_jalan') {
    throw new ValidationError(MSG_REVIEW_DIAGNOSA_INVALID);
  }
  const perluRevisi = input.perluRevisi ?? null;
  const fields = {
    yang_jalan: optText(input.yangJalan),
    yang_tidak_jalan: optText(input.yangTidakJalan),
    diagnosa_gap: diagnosa,
    diagnosa_gap_bukti: optText(input.diagnosaGapBukti),
    rekomendasi: optText(input.rekomendasi),
    perlu_revisi: perluRevisi,
    materi_klien: optText(input.materiKlien),
  };
  return withTransaction(sql, async (tx) => {
    const plan = await loadPlanForUpdate(tx, planId);
    const ownerAm = await ownerAmOfClient(tx, plan.clientId);
    if (!canWritePlan(actor, ownerAm)) throw new ForbiddenError(MSG_PLAN_FORBIDDEN);
    if (plan.status !== PLAN_AKTIF) throw new ConflictError(MSG_REVIEW_PERIOD);

    const before = await tx<PlanReviewDbRow[]>`select * from plan_review where plan_id = ${planId}`;
    await tx`
      insert into plan_review
        (plan_id, yang_jalan, yang_tidak_jalan, diagnosa_gap, diagnosa_gap_bukti,
         rekomendasi, perlu_revisi, materi_klien, created_by)
      values
        (${planId}, ${fields.yang_jalan}, ${fields.yang_tidak_jalan}, ${fields.diagnosa_gap},
         ${fields.diagnosa_gap_bukti}, ${fields.rekomendasi}, ${fields.perlu_revisi},
         ${fields.materi_klien}, ${actor.employeeId})
      on conflict (plan_id) do update
        set yang_jalan = excluded.yang_jalan,
            yang_tidak_jalan = excluded.yang_tidak_jalan,
            diagnosa_gap = excluded.diagnosa_gap,
            diagnosa_gap_bukti = excluded.diagnosa_gap_bukti,
            rekomendasi = excluded.rekomendasi,
            perlu_revisi = excluded.perlu_revisi,
            materi_klien = excluded.materi_klien`;

    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_PLAN,
      entityId: planId,
      actorEmployeeId: actor.employeeId,
      action: 'review_disimpan',
      beforeJson: before.length === 0 ? null : { review: rowToPlanReview(before[0]) },
      afterJson: { review: fields },
      createdBy: actor.employeeId,
    });

    const after = await tx<PlanReviewDbRow[]>`select * from plan_review where plan_id = ${planId}`;
    return rowToPlanReview(after[0]);
  });
}

/**
 * closePlanPeriode drives the AM's transactional `Aktif → Ditutup` (Rule 15). It
 * enforces the three preconditions atomically — manual GMV per channel, every row
 * terminal, the P-F review complete — refusing with the exact BI message for the
 * first unmet one. Because the whole thing runs in one transaction, a period is
 * never left half-closed. AM/lead write scope; the period must be `Aktif`.
 */
export async function closePlanPeriode(sql: Sql, actor: Actor, planId: string): Promise<Plan> {
  return withTransaction(sql, async (tx) => {
    const plan = await loadPlanForUpdate(tx, planId);
    const ownerAm = await ownerAmOfClient(tx, plan.clientId);
    if (!canWritePlan(actor, ownerAm)) throw new ForbiddenError(MSG_PLAN_FORBIDDEN);
    if (plan.status !== PLAN_AKTIF) throw new ConflictError(MSG_CLOSE_STATUS);

    const r = await loadCloseReadiness(tx, planId);
    if (!r.gmvComplete) throw new ValidationError(MSG_CLOSE_GMV_INCOMPLETE);
    if (!r.rowsTerminal) throw new ValidationError(MSG_CLOSE_ROWS_NOT_TERMINAL);
    if (!r.reviewComplete) throw new ValidationError(MSG_CLOSE_REVIEW_INCOMPLETE);

    await transitionPlan(tx, actor, planId, PLAN_DITUTUP);
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_PLAN,
      entityId: planId,
      actorEmployeeId: actor.employeeId,
      action: 'ditutup',
      beforeJson: { status: plan.status },
      afterJson: { status: PLAN_DITUTUP, variance_negatif: r.varianceNegative },
      createdBy: actor.employeeId,
    });
    return loadPlan(tx, planId);
  });
}

/**
 * forceClosePlanPeriode drives the system's `Aktif → Ditutup Otomatis` (Rule 5/15)
 * — the force-close the 00:00 WIB overrun job (B-09) schedules. Unlike the AM
 * close it enforces NONE of the three preconditions; instead it coerces every
 * still-non-terminal row to `Tidak Dikerjakan` with the reason `tanpa keterangan`
 * (deliberately ugly in reports) and closes. Already-terminal rows keep the AM's
 * real status. It touches NO actual row — X-07 removed the close lock, so a late
 * GMV is still accepted afterward and logged as an amendment (B-06), not lost.
 *
 * Like `activatePlanPeriode` (the other job-driven transition) it is not
 * lead-gated but requires Plan write scope, so it cannot be driven by an
 * unrelated account; which actor the B-09 job runs as is that ticket's decision.
 */
export async function forceClosePlanPeriode(sql: Sql, actor: Actor, planId: string): Promise<Plan> {
  return withTransaction(sql, async (tx) => {
    const plan = await loadPlanForUpdate(tx, planId);
    const ownerAm = await ownerAmOfClient(tx, plan.clientId);
    if (!canWritePlan(actor, ownerAm)) throw new ForbiddenError(MSG_PLAN_FORBIDDEN);
    if (plan.status !== PLAN_AKTIF) throw new ConflictError(MSG_CLOSE_STATUS);

    const coerced = await tx<{ id: string | number }[]>`
      update plan_row
         set status_baris = 'Tidak Dikerjakan', status_baris_alasan = ${FORCE_CLOSE_ALASAN}
       where plan_id = ${planId}
         and status_baris not in ('Selesai', 'Sebagian', 'Tidak Dikerjakan')
       returning id`;

    await transitionPlan(tx, actor, planId, PLAN_DITUTUP_OTOMATIS);
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_PLAN,
      entityId: planId,
      actorEmployeeId: actor.employeeId,
      action: 'ditutup_otomatis',
      beforeJson: { status: plan.status },
      afterJson: { status: PLAN_DITUTUP_OTOMATIS, baris_dipaksa: coerced.length },
      createdBy: actor.employeeId,
    });
    return loadPlan(tx, planId);
  });
}
