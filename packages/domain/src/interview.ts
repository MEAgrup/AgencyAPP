/**
 * Modul Interview ("Kelola Klien" tab 1) — the domain layer: validation,
 * permission gating, and orchestration over the `@cdps/db` Interview executors
 * (langkah 4) and the pure `@cdps/core` scorer. The route handlers are a thin
 * shell (resolve actor → validate → call these); the DB CHECKs / RLS / state
 * machine are the second lock.
 *
 * ## The two read surfaces (spec §Permissions)
 *
 *  - **Full interview** (`getInterview`): the record, its answers, and the whole
 *    Blok C qualification (score, verdict, breakdown). Scope = Account: the
 *    assigned AM, an Account lead/SPV, OD, Director. Sales and everyone else are
 *    denied — a `ForbiddenError`, matching the table's RLS default-deny.
 *  - **Verdict only** (`getInterviewVerdict`): verdict + prasyarat status ONLY —
 *    no score, no breakdown, no answers. Scope = the full-read set PLUS Sales
 *    (the closing salesperson, or a Sales lead). This is the additive
 *    `interview_verdict` view's surface; the TS predicate `canReadVerdict` must
 *    agree with that view row-for-row (proved in `interview.rls.test.ts`).
 *
 * ## Writes
 *
 * The Interview tables grant `authenticated` SELECT only; every write runs on the
 * service-role connection and is authorized HERE in TS (the RLS write policies
 * are default-deny by design). Status columns move exclusively through
 * `sm_transition`; the score is written exclusively by the `@cdps/db`
 * `persistKualifikasi` path, which runs the ONE core scorer.
 *
 * ## What does NOT live here
 *
 * The verdict never blocks anything (v5 decision): no Strategi gate, no routing
 * enum, no reject path. `scoreInterview` records the verdict and pings SPV/Head
 * when it is `tidak_siap` — informational only.
 */

import { ident, interview as iv, permission, statemachine } from '@cdps/core';
import { executors, interview as dbi, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { ACCOUNT_DIVISION, ConflictError, ForbiddenError, NotFoundError, ValidationError, type Actor } from './account';

export { ConflictError, ForbiddenError, NotFoundError, ValidationError };

const SALES_DIVISION = 'Sales';
const ENTITY = 'interview';
/** Audit `entity_type` for langkah 1. Its `entity_id` is the ITV it belongs to. */
const RISET_AWAL_ENTITY = 'riset_awal';

// ---------------------------------------------------------------------------
// BI messages (exact strings; CLAUDE.md §5)
// ---------------------------------------------------------------------------

export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';
export const MSG_FORBIDDEN = '[Anda tidak memiliki akses ke interview ini.]';
export const MSG_NOT_FOUND = '[interview tidak ditemukan]';
export const MSG_CANCEL_REASON = '[alasan pembatalan wajib diisi]';
export const MSG_INVALID_FORMAT = '[format interview tidak valid]';
export const MSG_INVALID_DURASI = '[durasi interview tidak valid]';
export const MSG_RISET_AWAL_NOT_FOUND = '[riset awal tidak ditemukan]';
export const MSG_RISET_AWAL_SUDAH_SUBMIT = '[riset awal sudah disubmit]';
export const MSG_RISET_AWAL_BELUM_LENGKAP =
  '[riset awal belum selesai — setiap platform aktif wajib punya baseline yang terkonfirmasi dan riset awal disubmit sebelum interview dimulai]';

/**
 * The closed set of jadwal formats (IA-5). MIRRORS the `ck_jadwal_format` CHECK
 * in `20260811030000_interview.sql`; validating here turns a would-be opaque 500
 * (a raw constraint violation) into a 400 with the exact BI message. The
 * "Kelola Klien" schedule form renders these as a <select>, so a real request can
 * never send anything else — this guard covers direct API callers.
 */
export const JADWAL_FORMATS = ['Onsite', 'Video Call', 'Telepon', 'Chat'] as const;

// ---------------------------------------------------------------------------
// Permission predicates — the TS half of the 7-role scope (mirrors RLS)
// ---------------------------------------------------------------------------

/** The assigned AM for the client owns write + full read. */
function ownsAm(actor: Actor, ownerAm: string | null): boolean {
  return ownerAm != null && actor.employeeId === ownerAm && actor.role.division === ACCOUNT_DIVISION;
}

/** Account lead/SPV authority (division-wide within Account). */
function isAccountLead(actor: Actor): boolean {
  return permission.isLead(actor, ACCOUNT_DIVISION);
}

/**
 * canWriteInterview: the assigned AM, an Account lead/SPV (acting-for), or a
 * Director. OD is read-only everywhere and never writes.
 */
export function canWriteInterview(actor: Actor, ownerAm: string | null): boolean {
  return ownsAm(actor, ownerAm) || isAccountLead(actor) || actor.role.director;
}

/**
 * canReadInterview (full record incl. Blok C): the write set plus OD/Director
 * read-all plus Account lead. Deliberately NOT Sales — the full record is
 * hard-internal to Account.
 */
export function canReadInterview(actor: Actor, ownerAm: string | null): boolean {
  return canWriteInterview(actor, ownerAm) || permission.canReadAll(actor) || isAccountLead(actor);
}

/**
 * canReadVerdict (verdict + prasyarat only): the full-read set PLUS Sales — a
 * Sales lead (division-wide) or the closing salesperson for this interview.
 * Mirrors `interview_verdict`'s WHERE exactly.
 */
export function canReadVerdict(actor: Actor, ownerAm: string | null, salesClosingId: string | null): boolean {
  if (canReadInterview(actor, ownerAm)) return true;
  if (permission.isLead(actor, SALES_DIVISION)) return true;
  return actor.role.division === SALES_DIVISION && salesClosingId != null && actor.employeeId === salesClosingId;
}

// ---------------------------------------------------------------------------
// Domain shapes (camelCase; the wire boundary snake_cases in apps/api)
// ---------------------------------------------------------------------------

export interface Interview {
  id: string;
  clientId: string;
  contractId: string | null;
  serviceId: string | null;
  amPengisiId: string;
  actingForAmId: string | null;
  salesClosingId: string | null;
  status: string;
  versiNo: number;
  interviewIndukId: string | null;
  versiSebelumnyaId: string | null;
  interviewProfile: string;
  retroaktif: boolean;
  alasanKekosongan: string | null;
  alasanPembatalan: string | null;
  createdAt: string;
  createdBy: string;
}

export interface Jadwal {
  tanggalWaktu: string | null;
  durasiMenit: number | null;
  format: string | null;
  lokasiLink: string | null;
  pesertaKlien: unknown;
  pesertaMea: unknown;
  catatanPersiapan: string | null;
  dataDiminta: unknown;
}

export interface Kualifikasi {
  skorKualifikasi: number;
  skorPerBlok: unknown;
  verdictKualifikasi: string;
  hambatanMendasar: unknown;
  prasyaratStatus: string;
  marginBersih: number | null;
  marginBersihBasis: string;
  marginKotor: number | null;
  marginDerivasiInput: unknown;
  kualitasData: string;
  bepRoas: number | null;
  rasioTarget: number | null;
  dihitungPada: string;
}

export interface Answer {
  section: string;
  fieldKey: string;
  nilaiTeks: string | null;
  nilaiAngka: number | null;
  nilaiUang: string | null;
  nilaiBool: boolean | null;
  nilaiEnum: string | null;
  nilaiJsonb: unknown;
  sumberAngka: string | null;
  dasarEstimasi: string | null;
}

/**
 * Riset Awal — langkah 1 of "Kelola Klien" (owner QA 2026-08-12). The AM logs
 * into the client's store and records the baseline; the system's job in this
 * first part is to measure how long that took.
 *
 * `durasiMenit` is DERIVED at read from the two anchors by the one core helper —
 * there is no duration column. It is `null` while the work is still running (the
 * UI renders `—`, house rule #7), never `0`.
 */
export interface RisetAwal {
  interviewId: string;
  status: string;
  dimulaiPada: string;
  dimulaiOleh: string;
  disubmitPada: string | null;
  disubmitOleh: string | null;
  durasiMenit: number | null;
  /**
   * Recorded after the fact rather than measured live — the sessions that already
   * existed when this step was introduced. Their duration is shown but NEVER
   * judged: an AM cannot be late for a step that did not exist while they worked.
   * Mirrors `interview.retroaktif` (I19).
   */
  retroaktif: boolean;
}

export interface InterviewDetail {
  interview: Interview;
  risetAwal: RisetAwal | null;
  jadwal: Jadwal | null;
  kualifikasi: Kualifikasi | null;
  answers: Answer[];
}

/**
 * One measured step of the "Kelola Klien" timeline (owner decision 2026-08-13).
 *
 * `hariKerja` is working days (Mon–Fri minus `hari_libur`) from `mulaiPada` to
 * `selesaiPada` — or to today while the step is still running, which is what makes
 * a step that has already blown its limit read as late before it finishes.
 * `null` means the step has not started; the UI renders `—`.
 */
export interface TimelineStep {
  langkah: number;
  nama: string;
  mulaiPada: string | null;
  selesaiPada: string | null;
  hariKerja: number | null;
  targetHari: number;
  batasHari: number;
  status: string;
  /** True once the step's end anchor exists — the duration is final. */
  selesai: boolean;
}

/** The whole three-step timeline for one Kelola Klien session. */
export interface KelolaKlienTimeline {
  interviewId: string;
  configVersion: number;
  langkah: TimelineStep[];
}

/** The Sales-facing surface — verdict + prasyarat only, nothing else. */
export interface InterviewVerdict {
  interviewId: string;
  verdict: string;
  prasyaratStatus: string;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

interface InterviewRow {
  id: string;
  client_id: string;
  contract_id: string | null;
  service_id: string | null;
  am_pengisi_id: string;
  acting_for_am_id: string | null;
  sales_closing_id: string | null;
  status: string;
  versi_no: number;
  interview_induk_id: string | null;
  versi_sebelumnya_id: string | null;
  interview_profile: string;
  retroaktif: boolean;
  alasan_kekosongan: string | null;
  alasan_pembatalan: string | null;
  created_at: string | Date;
  created_by: string;
}

const iso = (v: string | Date | null): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : v);

function rowToInterview(r: InterviewRow): Interview {
  return {
    id: r.id,
    clientId: r.client_id,
    contractId: r.contract_id,
    serviceId: r.service_id,
    amPengisiId: r.am_pengisi_id,
    actingForAmId: r.acting_for_am_id,
    salesClosingId: r.sales_closing_id,
    status: r.status,
    versiNo: r.versi_no,
    interviewIndukId: r.interview_induk_id,
    versiSebelumnyaId: r.versi_sebelumnya_id,
    interviewProfile: r.interview_profile,
    retroaktif: r.retroaktif,
    alasanKekosongan: r.alasan_kekosongan,
    alasanPembatalan: r.alasan_pembatalan,
    createdAt: iso(r.created_at)!,
    createdBy: r.created_by,
  };
}

const numOrNull = (v: string | number | null): number | null => (v == null ? null : Number(v));

/**
 * rowToRisetAwal maps the 1:1 Riset Awal row and DERIVES the duration from its
 * two anchors — the only place the wire value is produced, and never a stored
 * column (house rule #4: recomputable from the log at any time).
 */
function rowToRisetAwal(r: Record<string, unknown>): RisetAwal {
  const dimulaiPada = iso(r.dimulai_pada as string | Date)!;
  const disubmitPada = iso(r.disubmit_pada as string | Date | null);
  return {
    interviewId: r.interview_id as string,
    status: r.status as string,
    dimulaiPada,
    dimulaiOleh: r.dimulai_oleh as string,
    disubmitPada,
    disubmitOleh: (r.disubmit_oleh as string | null) ?? null,
    durasiMenit: iv.durasiRisetAwalMenit(dimulaiPada, disubmitPada),
    retroaktif: r.retroaktif === true,
  };
}

// ---------------------------------------------------------------------------
// Scope loader (owner AM + closing sales) — the permission inputs
// ---------------------------------------------------------------------------

interface Scope {
  interview: Interview;
  ownerAm: string | null;
}

/** Loads the interview + its client's assigned AM, or throws NotFound. */
async function loadScope(sql: Queryable, id: string): Promise<Scope> {
  const rows = await sql<(InterviewRow & { assigned_am_id: string | null })[]>`
    select i.*, c.assigned_am_id
      from interview i
      join clients c on c.id = i.client_id
     where i.id = ${id}`;
  if (rows.length === 0) throw new NotFoundError(MSG_NOT_FOUND);
  return { interview: rowToInterview(rows[0]), ownerAm: rows[0].assigned_am_id };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** getInterview loads the full record; Account-scope only (Sales denied). */
export async function getInterview(sql: Queryable, actor: Actor, id: string): Promise<InterviewDetail> {
  const { interview, ownerAm } = await loadScope(sql, id);
  if (!canReadInterview(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);

  const risetRows = await sql<Record<string, unknown>[]>`
    select interview_id, status, dimulai_pada, dimulai_oleh, disubmit_pada, disubmit_oleh, retroaktif
      from interview_riset_awal where interview_id = ${id}`;
  const jadwalRows = await sql<Record<string, unknown>[]>`
    select tanggal_waktu, durasi_menit, format, lokasi_link, peserta_klien, peserta_mea,
           catatan_persiapan, data_diminta
      from interview_jadwal where interview_id = ${id}`;
  const kualRows = await sql<Record<string, unknown>[]>`
    select skor_kualifikasi, skor_per_blok, verdict_kualifikasi, hambatan_mendasar, prasyarat_status,
           margin_bersih, margin_bersih_basis, margin_kotor, margin_derivasi_input, kualitas_data,
           bep_roas, rasio_target, dihitung_pada
      from interview_kualifikasi where interview_id = ${id}`;
  const answerRows = await sql<Record<string, unknown>[]>`
    select section, field_key, nilai_teks, nilai_angka, nilai_uang, nilai_bool, nilai_enum,
           nilai_jsonb, sumber_angka, dasar_estimasi
      from interview_answer where interview_id = ${id}
     order by section, field_key`;

  const j = jadwalRows[0];
  const k = kualRows[0];
  return {
    interview,
    risetAwal: risetRows.length > 0 ? rowToRisetAwal(risetRows[0]) : null,
    jadwal: j
      ? {
          tanggalWaktu: iso(j.tanggal_waktu as string | Date | null),
          durasiMenit: (j.durasi_menit as number | null) ?? null,
          format: (j.format as string | null) ?? null,
          lokasiLink: (j.lokasi_link as string | null) ?? null,
          pesertaKlien: j.peserta_klien ?? [],
          pesertaMea: j.peserta_mea ?? [],
          catatanPersiapan: (j.catatan_persiapan as string | null) ?? null,
          dataDiminta: j.data_diminta ?? [],
        }
      : null,
    kualifikasi: k
      ? {
          skorKualifikasi: Number(k.skor_kualifikasi),
          skorPerBlok: k.skor_per_blok,
          verdictKualifikasi: k.verdict_kualifikasi as string,
          hambatanMendasar: k.hambatan_mendasar,
          prasyaratStatus: k.prasyarat_status as string,
          marginBersih: numOrNull(k.margin_bersih as string | null),
          marginBersihBasis: k.margin_bersih_basis as string,
          marginKotor: numOrNull(k.margin_kotor as string | null),
          marginDerivasiInput: k.margin_derivasi_input ?? null,
          kualitasData: k.kualitas_data as string,
          bepRoas: numOrNull(k.bep_roas as string | null),
          rasioTarget: numOrNull(k.rasio_target as string | null),
          dihitungPada: iso(k.dihitung_pada as string | Date)!,
        }
      : null,
    answers: answerRows.map((a) => ({
      section: a.section as string,
      fieldKey: a.field_key as string,
      nilaiTeks: (a.nilai_teks as string | null) ?? null,
      nilaiAngka: numOrNull(a.nilai_angka as string | null),
      nilaiUang: a.nilai_uang == null ? null : String(a.nilai_uang),
      nilaiBool: (a.nilai_bool as boolean | null) ?? null,
      nilaiEnum: (a.nilai_enum as string | null) ?? null,
      nilaiJsonb: a.nilai_jsonb ?? null,
      sumberAngka: (a.sumber_angka as string | null) ?? null,
      dasarEstimasi: (a.dasar_estimasi as string | null) ?? null,
    })),
  };
}

/**
 * getInterviewVerdict returns verdict + prasyarat ONLY. The Account-scope + Sales
 * predicate is checked in TS; the `interview_verdict` view is the RLS mirror.
 * Returns null when no qualification has been computed yet.
 */
export async function getInterviewVerdict(sql: Queryable, actor: Actor, id: string): Promise<InterviewVerdict | null> {
  const { ownerAm, interview } = await loadScope(sql, id);
  if (!canReadVerdict(actor, ownerAm, interview.salesClosingId)) throw new ForbiddenError(MSG_FORBIDDEN);
  const rows = await sql<{ verdict_kualifikasi: string; prasyarat_status: string }[]>`
    select verdict_kualifikasi, prasyarat_status from interview_kualifikasi where interview_id = ${id}`;
  if (rows.length === 0) return null;
  return { interviewId: id, verdict: rows[0].verdict_kualifikasi, prasyaratStatus: rows[0].prasyarat_status };
}

/**
 * getKelolaKlienTimeline computes the three-step SLA for one session.
 *
 * All of the arithmetic — working days, holiday exclusion, which strategy
 * document applies — runs in SQL, on purpose: the holiday calendar is a table and
 * the applicable-strategy rule is a function the daily flag job uses too. A TS
 * copy of either would be a second definition that drifts from the one the flags
 * are raised on, and then the page and the flag would disagree about whether an
 * AM is late.
 *
 * Read scope = the full record's scope (Account only). The timeline exposes how
 * fast an AM worked, which is the same hard-internal class as Blok B.
 */
export async function getKelolaKlienTimeline(
  sql: Queryable,
  actor: Actor,
  id: string,
): Promise<KelolaKlienTimeline> {
  const { ownerAm } = await loadScope(sql, id);
  if (!canReadInterview(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);

  const rows = await sql<Record<string, unknown>[]>`
    select cfg.version,
           cfg.riset_awal_target_hari, cfg.riset_awal_batas_hari,
           cfg.meeting_target_hari,    cfg.meeting_batas_hari,
           cfg.strategi_target_hari,   cfg.strategi_batas_hari,
           ra.dimulai_pada, ra.disubmit_pada, ra.retroaktif as riset_retroaktif,
           i.meeting_diamankan_pada, i.selesai_pada,
           kelola_klien_strategi_berlaku(i.id)       as strategi_berlaku,
           kelola_klien_strategi_diajukan_pada(i.id) as strategi_diajukan_pada,
           case when ra.dimulai_pada is null then null else
             working_days_between(wib_date(ra.dimulai_pada),
                                  wib_date(coalesce(ra.disubmit_pada, now()))) end as hk_riset,
           case when ra.disubmit_pada is null then null else
             working_days_between(wib_date(ra.disubmit_pada),
                                  wib_date(coalesce(i.meeting_diamankan_pada, now()))) end as hk_meeting,
           case when i.selesai_pada is null then null else
             working_days_between(wib_date(i.selesai_pada),
                                  wib_date(coalesce(kelola_klien_strategi_diajukan_pada(i.id), now()))) end as hk_strategi
      from interview i
      left join interview_riset_awal ra on ra.interview_id = i.id
      cross join lateral (
        select * from kelola_klien_sla_config where aktif = true order by version desc limit 1
      ) cfg
     where i.id = ${id}`;
  if (rows.length === 0) throw new NotFoundError(MSG_NOT_FOUND);
  const r = rows[0];

  const num = (v: unknown): number => Number(v);
  const hk = (v: unknown): number | null => (v == null ? null : Number(v));
  const strategiBerlaku = r.strategi_berlaku !== false;
  // A backfilled (pre-feature) riset awal is shown but not judged — see RisetAwal.
  const risetBerlaku = r.riset_retroaktif !== true;
  const strategiDiajukan = iso(r.strategi_diajukan_pada as string | Date | null);

  const step = (
    langkah: number,
    mulaiPada: string | null,
    selesaiPada: string | null,
    hariKerja: number | null,
    ambang: iv.SlaAmbang,
    berlaku = true,
  ): TimelineStep => ({
    langkah,
    nama: iv.KELOLA_KLIEN_LANGKAH_LABEL[langkah as iv.KelolaKlienLangkah],
    mulaiPada,
    selesaiPada,
    hariKerja: berlaku ? hariKerja : null,
    targetHari: ambang.targetHari,
    batasHari: ambang.batasHari,
    status: berlaku ? iv.statusSla(hariKerja, ambang) : iv.SLA_STATUS.TidakBerlaku,
    selesai: berlaku && selesaiPada !== null,
  });

  return {
    interviewId: id,
    configVersion: num(r.version),
    langkah: [
      step(
        iv.KELOLA_KLIEN_LANGKAH.RisetAwal,
        iso(r.dimulai_pada as string | Date | null),
        iso(r.disubmit_pada as string | Date | null),
        hk(r.hk_riset),
        { targetHari: num(r.riset_awal_target_hari), batasHari: num(r.riset_awal_batas_hari) },
        risetBerlaku,
      ),
      step(
        iv.KELOLA_KLIEN_LANGKAH.InterviewMeeting,
        iso(r.disubmit_pada as string | Date | null),
        iso(r.meeting_diamankan_pada as string | Date | null),
        hk(r.hk_meeting),
        { targetHari: num(r.meeting_target_hari), batasHari: num(r.meeting_batas_hari) },
      ),
      step(
        iv.KELOLA_KLIEN_LANGKAH.BrandStrategy,
        iso(r.selesai_pada as string | Date | null),
        strategiDiajukan,
        hk(r.hk_strategi),
        { targetHari: num(r.strategi_target_hari), batasHari: num(r.strategi_batas_hari) },
        strategiBerlaku,
      ),
    ],
  };
}

/** One row of the client's interview log (list surface). */
export interface InterviewListRow {
  id: string;
  clientId: string;
  serviceId: string | null;
  status: string;
  versiNo: number;
  interviewProfile: string;
  retroaktif: boolean;
  verdict: string | null;
  prasyaratStatus: string | null;
  skorKualifikasi: number | null;
  /** Langkah 1 — status + derived duration, so the log shows the whole timeline. */
  risetAwalStatus: string | null;
  risetAwalDimulaiPada: string | null;
  risetAwalDisubmitPada: string | null;
  risetAwalDurasiMenit: number | null;
  createdAt: string;
}

/**
 * listInterviewsByClient returns the client's interview LOG (newest first), with
 * the qualification verdict/score joined in once scored. Account-scope — the SAME
 * read gate as getInterview (Sales denied; the scope is per-client, so checked
 * once against the client's assigned AM).
 *
 * Interviews still at `Belum Dijadwalkan` are EXCLUDED (QA 2026-08-12): opening
 * the Kelola Klien page mints an ITV before anything is entered, so a client
 * accumulates blank never-scheduled attempts. The log is meant to record work
 * that was actually saved — a schedule set, an interview started/submitted, or a
 * cancellation — not those empty drafts. Every non-`Belum Dijadwalkan` state is
 * kept (Terjadwal … Selesai, plus Dibatalkan as a deliberate audited outcome).
 *
 * A SUBMITTED Riset Awal (langkah 1) counts as work actually saved, so such a row
 * shows even while the interview itself is still `Belum Dijadwalkan` — otherwise
 * the very step this log is supposed to make visible would be the one it hides.
 * A riset awal still running stays hidden by the same rule as before; the AM
 * returns to it through "Kelola Klien", which resumes rather than re-opens
 * (`openKelolaKlien`).
 */
export async function listInterviewsByClient(sql: Queryable, actor: Actor, clientId: string): Promise<InterviewListRow[]> {
  const clientRows = await sql<{ assigned_am_id: string | null }[]>`
    select assigned_am_id from clients where id = ${clientId}`;
  if (clientRows.length === 0) throw new NotFoundError(MSG_NOT_FOUND);
  if (!canReadInterview(actor, clientRows[0].assigned_am_id)) throw new ForbiddenError(MSG_FORBIDDEN);

  const rows = await sql<Record<string, unknown>[]>`
    select i.id, i.client_id, i.service_id, i.status, i.versi_no, i.interview_profile, i.retroaktif, i.created_at,
           k.verdict_kualifikasi, k.prasyarat_status, k.skor_kualifikasi,
           ra.status as riset_awal_status, ra.dimulai_pada, ra.disubmit_pada
      from interview i
      left join interview_kualifikasi k on k.interview_id = i.id
      left join interview_riset_awal ra on ra.interview_id = i.id
     where i.client_id = ${clientId}
       and (i.status <> ${iv.INTERVIEW_STATES.BelumDijadwalkan} or ra.disubmit_pada is not null)
     order by i.created_at desc, i.id desc`;
  return rows.map((r) => {
    const dimulaiPada = iso(r.dimulai_pada as string | Date | null);
    const disubmitPada = iso(r.disubmit_pada as string | Date | null);
    return {
      id: r.id as string,
      clientId: r.client_id as string,
      serviceId: (r.service_id as string | null) ?? null,
      status: r.status as string,
      versiNo: Number(r.versi_no),
      interviewProfile: r.interview_profile as string,
      retroaktif: r.retroaktif as boolean,
      verdict: (r.verdict_kualifikasi as string | null) ?? null,
      prasyaratStatus: (r.prasyarat_status as string | null) ?? null,
      skorKualifikasi: r.skor_kualifikasi == null ? null : Number(r.skor_kualifikasi),
      risetAwalStatus: (r.riset_awal_status as string | null) ?? null,
      risetAwalDimulaiPada: dimulaiPada,
      risetAwalDisubmitPada: disubmitPada,
      risetAwalDurasiMenit: iv.durasiRisetAwalMenit(dimulaiPada, disubmitPada),
      createdAt: iso(r.created_at as string | Date)!,
    };
  });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateInterviewInput {
  clientId: string;
  contractId?: string | null;
  serviceId?: string | null;
  actingForAmId?: string | null;
  salesClosingId?: string | null;
  interviewProfile?: string;
  retroaktif?: boolean;
}

/**
 * createInterview mints the ITV and inserts the record. The filler is the acting
 * actor (the assigned AM, or a lead/SPV acting for them — recorded in
 * `actingForAmId`). Only the client's assigned AM, an Account lead, or a Director
 * may open one.
 *
 * It also opens **Riset Awal** (langkah 1) in the same transaction, anchored to
 * the same instant: opening "Kelola Klien" IS the start of the research, so the
 * start anchor cannot be a later, separate click. Rolling back the interview
 * rolls back its riset awal with it.
 */
export async function createInterview(sql: Sql, actor: Actor, input: CreateInterviewInput): Promise<InterviewDetail> {
  if (!input.clientId || input.clientId.trim() === '') throw new ValidationError(MSG_INCOMPLETE);
  const now = new Date();

  const id = await withTransaction(sql, async (tx) => {
    const clientRows = await tx<{ assigned_am_id: string | null }[]>`
      select assigned_am_id from clients where id = ${input.clientId}`;
    if (clientRows.length === 0) throw new NotFoundError(MSG_NOT_FOUND);
    const ownerAm = clientRows[0].assigned_am_id;
    if (!canWriteInterview(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);

    const newId = await dbi.createInterview(tx, {
      clientId: input.clientId,
      contractId: input.contractId ?? null,
      serviceId: input.serviceId ?? null,
      amPengisiId: actor.employeeId,
      actingForAmId: input.actingForAmId ?? (ownerAm && ownerAm !== actor.employeeId ? ownerAm : null),
      salesClosingId: input.salesClosingId ?? null,
      interviewProfile: input.interviewProfile,
      retroaktif: input.retroaktif,
      createdBy: actor.employeeId,
      at: now,
    });
    await dbi.startRisetAwal(tx, { interviewId: newId, dimulaiOleh: actor.employeeId, at: now });
    await executors(tx).audit.insertAudit({
      entityType: ENTITY,
      entityId: newId,
      actorEmployeeId: actor.employeeId,
      action: 'create',
      beforeJson: null,
      afterJson: { client_id: input.clientId, versi_no: 1, status: iv.INTERVIEW_STATES.BelumDijadwalkan },
      createdBy: actor.employeeId,
    });
    await executors(tx).audit.insertAudit({
      entityType: RISET_AWAL_ENTITY,
      entityId: newId,
      actorEmployeeId: actor.employeeId,
      action: 'mulai',
      beforeJson: null,
      afterJson: { status: iv.RISET_AWAL_STATES.Berjalan, dimulai_pada: now.toISOString() },
      createdBy: actor.employeeId,
    });
    return newId;
  });

  return getInterview(sql, actor, id);
}

/**
 * openKelolaKlien is what the "Kelola Klien" button calls: it RESUMES the
 * client's open session when there is one, and only mints a new ITV when there is
 * not.
 *
 * This is a requirement of the measurement, not a convenience. Riset Awal starts
 * the moment the page is opened; if a second click minted a second interview, the
 * AM who comes back after doing the actual research — logging into the client's
 * store takes hours or days — would land on a fresh row with a fresh start anchor,
 * and the recorded duration would be the time spent walking back to the page. It
 * also stops the blank-ITV accumulation that made the log filter necessary in the
 * first place.
 *
 * "Open" = a non-terminal interview for the same client and the same service
 * (`serviceId` null and a specific service are different sessions; a client can
 * have one per service). Newest wins if history left more than one.
 */
export async function openKelolaKlien(sql: Sql, actor: Actor, input: CreateInterviewInput): Promise<InterviewDetail> {
  if (!input.clientId || input.clientId.trim() === '') throw new ValidationError(MSG_INCOMPLETE);

  const clientRows = await sql<{ assigned_am_id: string | null }[]>`
    select assigned_am_id from clients where id = ${input.clientId}`;
  if (clientRows.length === 0) throw new NotFoundError(MSG_NOT_FOUND);
  if (!canWriteInterview(actor, clientRows[0].assigned_am_id)) throw new ForbiddenError(MSG_FORBIDDEN);

  const serviceId = input.serviceId ?? null;
  const open = await sql<{ id: string }[]>`
    select id from interview
     where client_id = ${input.clientId}
       and service_id is not distinct from ${serviceId}
       and status not in (${iv.INTERVIEW_STATES.Selesai}, ${iv.INTERVIEW_STATES.SelesaiDenganCatatan},
                          ${iv.INTERVIEW_STATES.Dibatalkan})
     order by created_at desc, id desc
     limit 1`;
  if (open.length > 0) return getInterview(sql, actor, open[0].id);

  return createInterview(sql, actor, input);
}

// ---------------------------------------------------------------------------
// Answers (draft) — the write path for Blok B
// ---------------------------------------------------------------------------

export type AnswerInput = Omit<dbi.AnswerUpsert, 'interviewId' | 'updatedBy'>;

/** saveAnswers upserts Blok B answers. DB CHECKs reject a blank scored field
 *  and a baseless estimate with their own messages. */
export async function saveAnswers(sql: Sql, actor: Actor, id: string, answers: AnswerInput[]): Promise<InterviewDetail> {
  return withTransaction(sql, async (tx) => {
    const { ownerAm } = await loadScope(tx, id);
    if (!canWriteInterview(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);
    for (const a of answers) {
      await dbi.upsertAnswer(tx, { ...a, interviewId: id, updatedBy: actor.employeeId });
    }
    return getInterview(tx, actor, id);
  });
}

// ---------------------------------------------------------------------------
// Scoring (Blok C) — the single scoring write path + advisory notifications
// ---------------------------------------------------------------------------

/**
 * The riset-awal isian keys that also feed the Blok C score (RAB-06, extended by
 * QA pemilik 2026-08-20). Each names the `KualifikasiInput` field it is the
 * authoritative source for ONCE the AM has confirmed it:
 *  - B2-9 (AOV, money → `aov`)
 *  - B2-3 (SKU siap, count → `skuSiap`)
 *  - B1-5 (omzet 3 bulan, money → `omzet`; C-A1 + denominator of C-E1)
 *  - B6-3 (target omzet 3 bulan, money → `targetOmzet`; numerator of C-E1)
 * The score/verdict itself lives entirely in the ONE core scorer — this list only
 * decides where those inputs are read FROM. B1-5/B6-3 are auto-filled upstream
 * (baseline runrate_3m×3 / client target_gmv×3, both resolved to a 3-month TOTAL in
 * `riset-awal.ts`), so the value is already in the right unit when it lands here.
 */
export const RISET_AWAL_SCORED_KEYS = ['B2-9', 'B2-3', 'B1-5', 'B6-3'] as const;

/**
 * mergeRisetAwalScoredInputs closes the provenance leak (RAB-06). These keys enter
 * qualification, and once the AM has CONFIRMED the riset-awal isian for them, that
 * confirmed number is the source of truth — the value the caller put in the score
 * body for the same key is ignored, so a hand-posted AOV/SKU/omzet/target cannot
 * move the verdict away from the baseline the AM signed off on. Keys with no
 * confirmed isian fall through to the body unchanged, so an interview without riset
 * awal (e.g. the Alpha Digital fixture) scores exactly as before.
 */
async function mergeRisetAwalScoredInputs(
  sql: Queryable,
  id: string,
  input: iv.KualifikasiInput,
): Promise<iv.KualifikasiInput> {
  const rows = await sql<{ field_key: string; nilai_angka: string | number | null; nilai_uang: string | null }[]>`
    select field_key, nilai_angka, nilai_uang
      from interview_riset_awal_isian
     where interview_id = ${id} and dikonfirmasi = true
       and field_key = any(${[...RISET_AWAL_SCORED_KEYS]})`;
  if (rows.length === 0) return input;
  const merged: iv.KualifikasiInput = { ...input };
  for (const r of rows) {
    if (r.field_key === 'B2-9' && r.nilai_uang != null) merged.aov = BigInt(r.nilai_uang);
    if (r.field_key === 'B2-3' && r.nilai_angka != null) merged.skuSiap = Number(r.nilai_angka);
    if (r.field_key === 'B1-5' && r.nilai_uang != null) merged.omzet = BigInt(r.nilai_uang);
    if (r.field_key === 'B6-3' && r.nilai_uang != null) merged.targetOmzet = BigInt(r.nilai_uang);
  }
  return merged;
}

/**
 * scoreInterview computes and persists the qualification (via the ONE core
 * scorer inside `@cdps/db`), then — because the verdict is advisory — pings
 * SPV/Head of Account when it is `tidak_siap`. Nothing blocks.
 *
 * The riset-awal-derived inputs (B2-9/B2-3) are server-merged from the confirmed
 * isian before scoring (RAB-06) — the request body cannot override them.
 */
export async function scoreInterview(
  sql: Sql,
  actor: Actor,
  id: string,
  input: iv.KualifikasiInput,
  opts: { configVersion?: number; prasyaratStatus?: iv.PrasyaratStatus } = {},
): Promise<Kualifikasi> {
  return withTransaction(sql, async (tx) => {
    const { ownerAm } = await loadScope(tx, id);
    if (!canWriteInterview(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);

    const merged = await mergeRisetAwalScoredInputs(tx, id, input);
    const { hasil } = await dbi.persistKualifikasi(tx, {
      interviewId: id,
      input: merged,
      dihitungOleh: actor.employeeId,
      configVersion: opts.configVersion,
      prasyaratStatus: opts.prasyaratStatus,
    });

    if (hasil.verdict === iv.VERDICT.TidakSiap) {
      await executors(tx).notify.notifyEmit({
        event: 'kualifikasi_tidak_siap',
        entityType: ENTITY,
        entityId: id,
        actor: actor.employeeId,
        deepLink: '',
        division: ACCOUNT_DIVISION,
        explicit: [],
        notifyActor: false,
      });
    }

    const rows = await tx<Record<string, unknown>[]>`
      select skor_kualifikasi, skor_per_blok, verdict_kualifikasi, hambatan_mendasar, prasyarat_status,
             margin_bersih, margin_bersih_basis, margin_kotor, margin_derivasi_input, kualitas_data,
             bep_roas, rasio_target, dihitung_pada
        from interview_kualifikasi where interview_id = ${id}`;
    const k = rows[0];
    return {
      skorKualifikasi: Number(k.skor_kualifikasi),
      skorPerBlok: k.skor_per_blok,
      verdictKualifikasi: k.verdict_kualifikasi as string,
      hambatanMendasar: k.hambatan_mendasar,
      prasyaratStatus: k.prasyarat_status as string,
      marginBersih: numOrNull(k.margin_bersih as string | null),
      marginBersihBasis: k.margin_bersih_basis as string,
      marginKotor: numOrNull(k.margin_kotor as string | null),
      marginDerivasiInput: k.margin_derivasi_input ?? null,
      kualitasData: k.kualitas_data as string,
      bepRoas: numOrNull(k.bep_roas as string | null),
      rasioTarget: numOrNull(k.rasio_target as string | null),
      dihitungPada: iso(k.dihitung_pada as string | Date)!,
    };
  });
}

/**
 * resolvePrasyarat marks the client-side prerequisite done (owner decision
 * 2026-08-11, bagian 2). It is the write behind the "tandai prasyarat selesai"
 * button: the assigned AM (or an Account lead/Director) flips `prasyarat_status`
 * to 'selesai', which stops the daily overdue flag and drops the AM out of the
 * hanging-prerequisite escalation count. The completion is logged as an immutable
 * `prasyarat_selesai` flag (its timestamp is the duration anchor). Idempotent and
 * advisory — nothing about the verdict is touched or blocked. Returns the updated
 * verdict (verdict + prasyarat_status), or null when no qualification exists yet.
 */
export async function resolvePrasyarat(sql: Sql, actor: Actor, id: string): Promise<InterviewVerdict | null> {
  return withTransaction(sql, async (tx) => {
    const { ownerAm } = await loadScope(tx, id);
    if (!canWriteInterview(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);
    await dbi.markPrasyaratSelesai(tx, { interviewId: id, oleh: actor.employeeId });
    return getInterviewVerdict(tx, actor, id);
  });
}

// ---------------------------------------------------------------------------
// Schedule (Blok A) + lifecycle transitions
// ---------------------------------------------------------------------------

export interface JadwalInput {
  tanggalWaktu?: string | null;
  durasiMenit?: number | null;
  format?: string | null;
  lokasiLink?: string | null;
  catatanPersiapan?: string | null;
}

/**
 * scheduleInterview upserts the jadwal (IA-3) and moves the interview to
 * `Terjadwal` in the same transaction. Rescheduling later replaces the reminder
 * markers automatically (the DB reset trigger, langkah 5).
 */
export async function scheduleInterview(sql: Sql, actor: Actor, id: string, jadwal: JadwalInput): Promise<InterviewDetail> {
  return withTransaction(sql, async (tx) => {
    const { ownerAm, interview } = await loadScope(tx, id);
    if (!canWriteInterview(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);
    if (!jadwal.tanggalWaktu) throw new ValidationError(MSG_INCOMPLETE);
    // Guard the two DB CHECKs (ck_jadwal_format / ck_jadwal_durasi) BEFORE the
    // insert so an out-of-set value returns 400 with a BI message instead of a
    // raw constraint violation surfacing as a 500.
    const fmt = jadwal.format?.trim() ?? '';
    if (fmt !== '' && !(JADWAL_FORMATS as readonly string[]).includes(fmt)) {
      throw new ValidationError(MSG_INVALID_FORMAT);
    }
    if (jadwal.durasiMenit != null && !(Number.isInteger(jadwal.durasiMenit) && jadwal.durasiMenit > 0)) {
      throw new ValidationError(MSG_INVALID_DURASI);
    }

    await tx`
      insert into interview_jadwal (interview_id, tanggal_waktu, durasi_menit, format, lokasi_link, catatan_persiapan, updated_at)
      values (${id}, ${jadwal.tanggalWaktu}, ${jadwal.durasiMenit ?? null}, ${fmt === '' ? null : fmt},
              ${jadwal.lokasiLink ?? null}, ${jadwal.catatanPersiapan ?? null}, now())
      on conflict (interview_id) do update set
        tanggal_waktu = excluded.tanggal_waktu,
        durasi_menit = excluded.durasi_menit,
        format = excluded.format,
        lokasi_link = excluded.lokasi_link,
        catatan_persiapan = excluded.catatan_persiapan,
        updated_at = now()`;

    // Only move to Terjadwal from a pre-scheduled state; a reschedule of an
    // already-Terjadwal interview keeps its status (the jadwal update stands).
    if (interview.status === iv.INTERVIEW_STATES.BelumDijadwalkan || interview.status === iv.INTERVIEW_STATES.DijadwalkanUlang) {
      // RAB-07 prerequisite: riset awal must be complete before the interview starts.
      await assertRisetAwalGate(tx, id, interview.clientId);
      await runTransition(tx, actor, id, iv.INTERVIEW_STATES.Terjadwal);
    }
    return getInterview(tx, actor, id);
  });
}

/**
 * assertRisetAwalGate blocks starting the interview until riset awal is genuinely
 * done (RAB-07 · prasyarat). "Done" is per-PLATFORM, never per-analysis: EVERY
 * active `client_platforms` row of the client must carry a baseline (analisa OR
 * manual), every auto-filled isian must be confirmed (`semua_terkonfirmasi`), and
 * the riset awal step itself must be submitted (its timing anchor closed).
 *
 * The per-platform rule is what makes the gate deadlock-free: a Shopee-only client
 * (Shopee has no analysis engine → manual baseline) can satisfy it, so the gate
 * never waits on a TikTok analysis it can't produce. Tying it to TikTok analysis
 * would lock out the majority of clients (Shopee 156× vs TikTok 16× at seed) —
 * that is the anti-deadlock case the RAB-07 DoD tests.
 *
 * `submitBaseline`/`confirmIsian`/`submitRisetAwal` are all independent of the
 * interview status, so a blocked AM is never stuck: they finish riset awal, then
 * the same start transition passes.
 */
async function assertRisetAwalGate(sql: Queryable, id: string, clientId: string): Promise<void> {
  // (1) the riset awal step is submitted — the timing anchor is closed (langkah 1).
  const ra = await sql<{ status: string }[]>`
    select status from interview_riset_awal where interview_id = ${id}`;
  const submitted = ra.length > 0 && ra[0].status === iv.RISET_AWAL_STATES.Selesai;

  // (2) every ACTIVE platform of the client has a baseline row for this interview.
  const cov = await sql<{ aktif: string; tertutup: string }[]>`
    select
      count(*) filter (where cp.active) as aktif,
      count(*) filter (where cp.active and a.id is not null) as tertutup
    from client_platforms cp
    left join riset_awal_analisa a
      on a.client_platform_id = cp.id and a.interview_id = ${id}
    where cp.client_id = ${clientId}`;
  const aktif = Number(cov[0]?.aktif ?? 0);
  const tertutup = Number(cov[0]?.tertutup ?? 0);
  const semuaPlatform = aktif > 0 && aktif === tertutup;

  // (3) every auto-filled isian confirmed (the getBaseline().semua_terkonfirmasi gate).
  const isian = await sql<{ total: string; konfirmasi: string }[]>`
    select count(*) as total, count(*) filter (where dikonfirmasi) as konfirmasi
      from interview_riset_awal_isian where interview_id = ${id}`;
  const total = Number(isian[0]?.total ?? 0);
  const konfirmasi = Number(isian[0]?.konfirmasi ?? 0);
  const semuaTerkonfirmasi = total > 0 && total === konfirmasi;

  if (!(submitted && semuaPlatform && semuaTerkonfirmasi)) {
    throw new ValidationError(MSG_RISET_AWAL_BELUM_LENGKAP);
  }
}

/** runTransition applies an edge via `sm_transition`, mapping a rejection to the
 *  taxonomy the routes turn into HTTP codes. */
async function runTransition(sql: Queryable, actor: Actor, id: string, to: string): Promise<void> {
  const res = await statemachine.transition(executors(sql).sm, {
    machine: iv.INTERVIEW_MACHINE,
    entityType: ENTITY,
    table: 'interview',
    entityId: id,
    to,
    actor,
  });
  if (!res.ok) {
    throw res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
  }
}

/**
 * submitRisetAwal closes langkah 1: it stamps the submit anchors and moves the
 * riset awal to `Selesai` through `sm_transition`, in one transaction. The
 * transition row in `audit_log` carries the completion timestamp, so the duration
 * is reconstructible from the log alone — the stored anchors are the fast path,
 * not the only record (house rules #3/#4).
 *
 * Not idempotent by design: a second submit is a `ConflictError`, not a silent
 * no-op, because the second click would otherwise look like it moved the finish
 * line. The DB trigger `trg_riset_awal_jangkar` refuses the overwrite as well.
 *
 * Note this runs on the `riset_awal` machine over a table keyed by
 * `interview_id` — `sm_transition` takes the id column as a parameter, so no
 * surrogate key is invented just to satisfy the engine.
 */
export async function submitRisetAwal(sql: Sql, actor: Actor, id: string): Promise<RisetAwal> {
  return withTransaction(sql, async (tx) => {
    const { ownerAm } = await loadScope(tx, id);
    if (!canWriteInterview(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);

    const rows = await tx<{ status: string }[]>`
      select status from interview_riset_awal where interview_id = ${id} for update`;
    if (rows.length === 0) throw new NotFoundError(MSG_RISET_AWAL_NOT_FOUND);
    if (rows[0].status === iv.RISET_AWAL_STATES.Selesai) throw new ConflictError(MSG_RISET_AWAL_SUDAH_SUBMIT);

    const stamped = await dbi.stampRisetAwalSubmit(tx, { interviewId: id, oleh: actor.employeeId });
    if (!stamped) throw new ConflictError(MSG_RISET_AWAL_SUDAH_SUBMIT);

    const res = await statemachine.transition(executors(tx).sm, {
      machine: iv.RISET_AWAL_MACHINE,
      entityType: RISET_AWAL_ENTITY,
      table: 'interview_riset_awal',
      idColumn: 'interview_id',
      entityId: id,
      to: iv.RISET_AWAL_STATES.Selesai,
      actor,
    });
    if (!res.ok) {
      throw res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
    }

    const after = await tx<Record<string, unknown>[]>`
      select interview_id, status, dimulai_pada, dimulai_oleh, disubmit_pada, disubmit_oleh, retroaktif
        from interview_riset_awal where interview_id = ${id}`;
    return rowToRisetAwal(after[0]);
  });
}

/**
 * transitionInterview moves the interview to `to` via `sm_transition`. Reviewer
 * edges (`Selesai Dengan Catatan`, `Dikembalikan`) require Account-lead/Director
 * authority — enforced both here (TS) and by the edge's `require_lead` gate.
 * `Dibatalkan` requires a reason, written before the transition in the same tx.
 */
export async function transitionInterview(
  sql: Sql,
  actor: Actor,
  id: string,
  to: string,
  opts: { alasanPembatalan?: string } = {},
): Promise<InterviewDetail> {
  return withTransaction(sql, async (tx) => {
    const { ownerAm, interview } = await loadScope(tx, id);
    if (!canWriteInterview(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);

    if (to === iv.INTERVIEW_STATES.Dibatalkan) {
      const reason = (opts.alasanPembatalan ?? '').trim();
      if (reason === '') throw new ValidationError(MSG_CANCEL_REASON);
      await tx`update interview set alasan_pembatalan = ${reason} where id = ${id}`;
    }
    // RAB-07 prerequisite: the meeting cannot start (direct start, or start after a
    // schedule) until riset awal is complete for every active platform.
    if (to === iv.INTERVIEW_STATES.SedangBerlangsung) {
      await assertRisetAwalGate(tx, id, interview.clientId);
    }
    await runTransition(tx, actor, id, to);
    return getInterview(tx, actor, id);
  });
}
