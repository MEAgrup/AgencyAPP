/**
 * Daily activity log (DACT-) — F-6, feedback lapangan 2026-09-14 (Account):
 * riwayat aktivitas harian karyawan — meeting klien/internal, training,
 * webinar, input data — dengan waktu dan bukti pelaksanaan, nyambung ke M14
 * Team Performance.
 *
 * DEVIASI PRD — tidak ada modul PRD yang mendefinisikan entitas ini. Pemilik
 * menjawab lewat `AskUserQuestion` (2026-09-14): ini KELUARAN KERJA, bukan
 * absensi — CDPS bukan HRIS (CLAUDE.md), jadi jam masuk/pulang tetap milik
 * HRIS. Dicatat di `docs/DECISIONS.md`.
 *
 * Bentuknya meniru `activity.ts` (`prospect_activities`, O 2026-08-06):
 *   - LOG, bukan lifecycle — nol status, mencatat aktivitas bukan transisi.
 *   - APPEND-ONLY — `daily_activities` menolak UPDATE/DELETE (trigger). Salah
 *     catat diperbaiki dengan mencatat lagi, bukan mengedit.
 *   - Row-scope adalah RLS's (`daily_activities_select`, migrasi
 *     20261021010000): staff hanya miliknya, Lead/SPV se-divisi (lewat
 *     `divisi` yang didenormalisasi saat mencatat), OD/Director penuh. Modul
 *     ini tidak menduplikasi predikat itu — `list` hanya membaca lewat
 *     `readAsActor` dan mempercayai RLS.
 */

import { bi, ident, permission } from '@cdps/core';
import { executors, type Queryable, type Sql } from '@cdps/db';

export type Actor = permission.Actor;

/**
 * The CLOSED activity taxonomy (feedback lapangan 2026-09-14, permintaan
 * Account). Mirrored by the `ck_dact_type` CHECK constraint in migration
 * 20261021010000 — the DB is the authority. Adding a type means a migration
 * AND a DECISIONS entry, exactly like `activity.ACTIVITY_TYPES`.
 */
export const ACTIVITY_TYPES: readonly string[] = [
  'Meeting Klien',
  'Meeting Internal',
  'Training',
  'Webinar',
  'Input Data',
  'Lainnya',
];

/** Mandatory-field gate failure (carries the exact global BI message). */
export class IncompleteError extends Error {
  constructor() {
    super(bi.INCOMPLETE_DATA);
    this.name = 'DailyActivityIncompleteError';
  }
}

/** One logged daily activity. */
export interface DailyActivity {
  id: string;
  employeeId: string;
  employeeNama: string;
  divisi: string;
  activityType: string;
  activityDate: string;
  jamMulai: string;
  jamSelesai: string | null;
  keterangan: string;
  buktiPelaksanaan: string | null;
  createdAt: Date;
}

/** Fields an employee supplies when logging one activity. */
export interface LogInput {
  activityType: string;
  /** YYYY-MM-DD. */
  activityDate: string;
  /** HH:MM. */
  jamMulai: string;
  /** HH:MM, optional. */
  jamSelesai?: string;
  keterangan: string;
  buktiPelaksanaan?: string;
}

/** isKnownType reports whether `t` is in the closed taxonomy. */
export function isKnownType(t: string): boolean {
  return ACTIVITY_TYPES.includes((t ?? '').trim());
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YYYYMMDD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * log records one activity for the actor themselves (there is no "log on
 * behalf of someone else" — every write is `employee_id = actor.employeeId`,
 * matching the RLS own-row arm). `divisi` is stamped from the actor's OWN
 * resolved CDPS role division at the moment of writing (same pattern as
 * `internal_tasks.assignee_division`) so the Lead/SPV RLS arm can filter
 * without joining `employees` (whose `divisi` column is the raw HRIS one,
 * not the CDPS division — see migration header).
 */
export async function log(
  sql: Sql,
  actor: Actor,
  input: LogInput,
  now: Date = new Date(),
): Promise<DailyActivity> {
  const activityType = (input.activityType ?? '').trim();
  const activityDate = (input.activityDate ?? '').trim();
  const jamMulai = (input.jamMulai ?? '').trim();
  const jamSelesai = (input.jamSelesai ?? '').trim();
  const keterangan = (input.keterangan ?? '').trim();
  const buktiPelaksanaan = (input.buktiPelaksanaan ?? '').trim();

  if (
    activityType === '' || !isKnownType(activityType) ||
    !YYYYMMDD.test(activityDate) ||
    !HHMM.test(jamMulai) ||
    (jamSelesai !== '' && !HHMM.test(jamSelesai)) ||
    keterangan === ''
  ) {
    throw new IncompleteError();
  }
  if (jamSelesai !== '' && jamSelesai < jamMulai) {
    throw new IncompleteError();
  }

  const divisi = actor.role.division;
  const ex = executors(sql);
  const id = await ident.nextId(ex.ident, 'DACT', now);
  await sql`
    insert into daily_activities
      (id, employee_id, divisi, activity_type, activity_date, jam_mulai, jam_selesai,
       keterangan, bukti_pelaksanaan, created_by)
    values
      (${id}, ${actor.employeeId}, ${divisi}, ${activityType}, ${activityDate}, ${jamMulai},
       ${jamSelesai === '' ? null : jamSelesai}, ${keterangan},
       ${buktiPelaksanaan === '' ? null : buktiPelaksanaan}, ${actor.employeeId})`;

  const nameRows = await sql<{ nama: string }[]>`
    select nama from employees where employee_id = ${actor.employeeId}`;
  return {
    id, employeeId: actor.employeeId,
    employeeNama: nameRows.length > 0 ? nameRows[0].nama : actor.employeeId,
    divisi, activityType, activityDate, jamMulai,
    jamSelesai: jamSelesai === '' ? null : jamSelesai,
    keterangan, buktiPelaksanaan: buktiPelaksanaan === '' ? null : buktiPelaksanaan,
    createdAt: now,
  };
}

interface DailyActivityRow {
  id: string; employee_id: string; employee_nama: string; divisi: string;
  activity_type: string; activity_date: string; jam_mulai: string; jam_selesai: string | null;
  keterangan: string; bukti_pelaksanaan: string | null; created_at: Date;
}

function toDailyActivity(r: DailyActivityRow): DailyActivity {
  return {
    id: r.id, employeeId: r.employee_id, employeeNama: r.employee_nama, divisi: r.divisi,
    activityType: r.activity_type, activityDate: r.activity_date, jamMulai: r.jam_mulai,
    jamSelesai: r.jam_selesai, keterangan: r.keterangan, buktiPelaksanaan: r.bukti_pelaksanaan,
    createdAt: r.created_at,
  };
}

/** Optional narrowing for `list` — an empty filter reads everything RLS allows. */
export interface ListFilter {
  employeeId?: string;
  from?: string;
  to?: string;
}

/**
 * list returns activities newest-first. Row scope is RLS's
 * (`daily_activities_select`) — an actor who may not see a row simply never
 * receives it; this function does not re-implement that predicate. Call
 * through `readAsActor` (apps/api/src/lib/db.ts), same as every other
 * RLS-gated read in this codebase.
 */
export async function list(sql: Queryable, filter: ListFilter = {}): Promise<DailyActivity[]> {
  const employeeId = (filter.employeeId ?? '').trim();
  // `from`/`to` go in as `date | null`, never `''` — an empty string bound
  // against a `::date` cast is what made postgres.js try to serialize "" as a
  // date and throw `Invalid time value` before the query ever reached the DB.
  const fromDate = (filter.from ?? '').trim() || null;
  const toDate = (filter.to ?? '').trim() || null;
  const rows = await sql<DailyActivityRow[]>`
    select a.id, a.employee_id, private.employee_display_name(a.employee_id) as employee_nama,
           a.divisi, a.activity_type, a.activity_date, a.jam_mulai, a.jam_selesai,
           a.keterangan, a.bukti_pelaksanaan, a.created_at
    from daily_activities a
    where (${employeeId} = '' or a.employee_id = ${employeeId})
      and (${fromDate}::date is null or a.activity_date >= ${fromDate}::date)
      and (${toDate}::date is null or a.activity_date <= ${toDate}::date)
    order by a.activity_date desc, a.jam_mulai desc, a.id desc`;
  return rows.map(toDailyActivity);
}
