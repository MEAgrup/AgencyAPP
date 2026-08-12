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

// ---------------------------------------------------------------------------
// BI messages (exact strings; CLAUDE.md §5)
// ---------------------------------------------------------------------------

export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';
export const MSG_FORBIDDEN = '[Anda tidak memiliki akses ke interview ini.]';
export const MSG_NOT_FOUND = '[interview tidak ditemukan]';
export const MSG_CANCEL_REASON = '[alasan pembatalan wajib diisi]';
export const MSG_INVALID_FORMAT = '[format interview tidak valid]';
export const MSG_INVALID_DURASI = '[durasi interview tidak valid]';

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

export interface InterviewDetail {
  interview: Interview;
  jadwal: Jadwal | null;
  kualifikasi: Kualifikasi | null;
  answers: Answer[];
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
    await executors(tx).audit.insertAudit({
      entityType: ENTITY,
      entityId: newId,
      actorEmployeeId: actor.employeeId,
      action: 'create',
      beforeJson: null,
      afterJson: { client_id: input.clientId, versi_no: 1, status: iv.INTERVIEW_STATES.BelumDijadwalkan },
      createdBy: actor.employeeId,
    });
    return newId;
  });

  return getInterview(sql, actor, id);
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
 * scoreInterview computes and persists the qualification (via the ONE core
 * scorer inside `@cdps/db`), then — because the verdict is advisory — pings
 * SPV/Head of Account when it is `tidak_siap`. Nothing blocks.
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

    const { hasil } = await dbi.persistKualifikasi(tx, {
      interviewId: id,
      input,
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
      await runTransition(tx, actor, id, iv.INTERVIEW_STATES.Terjadwal);
    }
    return getInterview(tx, actor, id);
  });
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
    const { ownerAm } = await loadScope(tx, id);
    if (!canWriteInterview(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);

    if (to === iv.INTERVIEW_STATES.Dibatalkan) {
      const reason = (opts.alasanPembatalan ?? '').trim();
      if (reason === '') throw new ValidationError(MSG_CANCEL_REASON);
      await tx`update interview set alasan_pembatalan = ${reason} where id = ${id}`;
    }
    await runTransition(tx, actor, id, to);
    return getInterview(tx, actor, id);
  });
}
