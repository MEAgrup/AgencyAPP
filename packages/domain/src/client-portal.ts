/**
 * Client Portal read-model (M15-C2 — the EXTERNAL half).
 *
 * This is the file the security spec asked for by name
 * (`docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md` §4.3): a domain module of its
 * own, mirroring the shape of `portal.ts` (the internal Team Portal), that
 * returns NARROW DTOs and never a partially-serialised internal object.
 *
 * ## The rule that shapes every function here
 *
 * §6.1 closing requirement: *"Portal's data layer must be a strict allow-list …
 * never a filtered version of the internal Client Board; built as its own narrow
 * view, not a permission-trimmed copy of Module 11."*
 *
 * So this module does NOT call `board.clientBoard()` / `health.portfolio()` /
 * `report.listReports()`. Those take an EMPLOYEE actor and return everything an
 * employee may see; reaching for them and deleting fields afterwards is exactly
 * the pattern the spec forbids, because the next field added upstream leaks by
 * default. What IS reused is the pure MAPPING logic (`board.briefTaskUniversal`,
 * `report.renderReportHtml`) — one definition of the rules, a query written for
 * this audience.
 *
 * ## What each surface may show (§4.2 allow-list, transcribed)
 *
 *  - **Service Progress** — client-friendly service name + the RELABELLED status
 *    (Queued / In Production / Finalizing / In Review / Completed). Never the
 *    internal status names, never `BRF-`/`AST-`/`BKG-`/`TSK-` ids, never the
 *    PIC, never an SLA or internal timestamp.
 *  - **Embedded Report** — the `klien`-mode render of a `[Terbit]` report, using
 *    the PINNED insight revision.
 *  - **Health Summary** — the BAND LABEL only ("On Track" / "Needs Attention" /
 *    "Action Needed"). Never the 0–100 score, never a component breakdown,
 *    never a weight.
 *  - **Complaint form** — WRITE ONLY (M15 Rule 6, confirmed submit-only). There
 *    is deliberately no `listComplaints` in this file.
 *
 * Forbidden outright, on every surface: any invoice/payment detail (OQ-6
 * resolved — v1 has no such surface at all), staff names or workload, M14 team
 * performance, and any other client's data in any form.
 *
 * ## Isolation
 *
 * Every query is scoped by `contactScope(actor)`, which reads the client id from
 * the ACTOR (a JWT claim minted server-side), never from the request. An id that
 * arrives in a URL is only ever used as an additional `and` — it is validated
 * against the session's client, never trusted as the source of truth (§4.3).
 * RLS repeats the same predicate at the row level (migrasi 20260908010000), so a
 * mistake here is caught there and vice versa.
 */
import { permission, report } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import * as board from './board';
import {
  COMPLAINT_SEVERITY_LOW, COMPLAINT_STATUS_OPEN, insertComplaint,
  MSG_INVALID_SEVERITY, isAllowedSeverity,
} from './account';
import { BAND_AT_RISK, BAND_HEALTHY, BAND_WATCH } from './health';

/** A Client Portal contact + the client it is permanently bound to. */
export type Actor = permission.Actor;

// ---------------------------------------------------------------------------
// Messages (BI, house rule #5)
// ---------------------------------------------------------------------------
/** Not a Client Portal contact at all, or a contact reaching outside its client. */
export const MSG_FORBIDDEN = '[anda tidak memiliki akses ke data ini]';
export const MSG_REPORT_NOT_FOUND = '[laporan tidak ditemukan]';
export const MSG_DESKRIPSI_WAJIB = '[deskripsi komplain wajib diisi]';
export const MSG_DESKRIPSI_PANJANG = '[deskripsi komplain melebihi 4000 karakter]';
export const MSG_LAMPIRAN_BUKAN_TAUTAN = '[lampiran harus berupa tautan http/https]';
export const MSG_RATE_LIMITED =
  '[komplain terlalu sering dikirim, coba lagi dalam satu jam atau hubungi Account Manager Anda]';

/** Immediate acknowledgment copy, M15 Rule 5 (confirmed default). */
export const PESAN_ACK_KOMPLAIN =
  'Komplain kamu sudah kami terima, tim akan merespon dalam 1 hari kerja.';

export const MAX_DESKRIPSI = 4000;

export class PortalForbiddenError extends Error {
  constructor(message = MSG_FORBIDDEN) {
    super(message);
    this.name = 'ClientPortalForbiddenError';
  }
}
export class PortalNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientPortalNotFoundError';
  }
}
export class PortalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientPortalValidationError';
  }
}
/** Rate limit tripped (→ 429), spec §5.2. */
export class PortalRateLimitedError extends Error {
  constructor(message = MSG_RATE_LIMITED) {
    super(message);
    this.name = 'ClientPortalRateLimitedError';
  }
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------
export interface ContactScope {
  contactId: string;
  clientId: string;
}

/**
 * The single gate for this module. An employee Actor (even a Director) fails it:
 * this realm is not a wider view of the internal one, and an employee wanting to
 * see what a client sees uses the internal preview (`?mode=klien`), not the
 * client's own session.
 */
export function contactScope(actor: Actor): ContactScope {
  if (!permission.isClientContactActor(actor)) throw new PortalForbiddenError();
  const clientId = actor.clientId ?? '';
  const contactId = actor.clientContactId ?? '';
  if (clientId === '' || contactId === '') throw new PortalForbiddenError();
  return { contactId, clientId };
}

// ---------------------------------------------------------------------------
// Access audit (§5.1 — VIEW-level, not just writes)
// ---------------------------------------------------------------------------
/**
 * Append one audit row per contact action, INCLUDING reads.
 *
 * Read logging is unusual in this codebase and deliberate here: this is the only
 * public-facing realm, so if data ever leaks the team must be able to answer
 * "which contact opened what, when" from the audit log instead of reconstructing
 * it from web-server logs that may not exist. `entity_type='client_contact'`
 * mirrors the `employee_credential` precedent the spec points at, and the actor
 * is the CONTACT id — never the client id, which would flatten two contacts of
 * the same client into one indistinguishable actor (§5.1 is explicit about this).
 */
export type PortalAksi =
  | 'view:reports' | 'view:report' | 'view:progress' | 'view:health' | 'submit:complaint';

export async function logAccess(
  sql: Sql, scope: ContactScope, aksi: PortalAksi, objek?: string | null,
): Promise<void> {
  await withTransaction(sql, async (tx) => {
    await executors(tx).audit.insertAudit({
      entityType: 'client_contact',
      entityId: scope.contactId,
      actorEmployeeId: scope.contactId,
      action: aksi,
      beforeJson: null,
      afterJson: { client_id: scope.clientId, objek: objek ?? null },
      createdBy: scope.contactId,
    });
  });
}

// ---------------------------------------------------------------------------
// Laporan (§4.2 Embedded Report)
// ---------------------------------------------------------------------------
/**
 * One row of the client's report list.
 *
 * Note what is ABSENT and why: `skor`/`skor_label`, `gmv_net`, `gmv_kotor`,
 * `gmv_runrate_bulanan`, `benchmark_versi`, `engine_versi`, `kelengkapan_file`
 * and the file provenance all exist on the report row and none of them belong in
 * a list a client reads. The score DOES appear inside the report body — that
 * page is the client-facing artefact and its `klien` mode is built for exactly
 * this audience — but a listing is navigation, not a scoreboard.
 */
export interface PortalReportRow {
  reportId: number;
  platform: string;
  periodeTipe: string;
  periodeMulai: string;
  periodeAkhir: string;
  diterbitkanPada: string | null;
}

const dateStr = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
const isoTs = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

/** Published reports for the session's client, newest period first. */
export async function listReports(sql: Queryable, actor: Actor): Promise<PortalReportRow[]> {
  const scope = contactScope(actor);
  const rows = await sql<Record<string, unknown>[]>`
    select r.id, r.platform, r.periode_tipe, r.periode_mulai, r.periode_akhir,
           p.diterbitkan_pada
      from client_reports r
      join client_report_publikasi p on p.report_id = r.id
     where r.client_id = ${scope.clientId}
       and p.status = ${'[Terbit]'}
       and p.insight_revisi is not null
     order by r.periode_akhir desc, r.id desc`;
  return rows.map((r) => ({
    reportId: Number(r.id),
    platform: r.platform as string,
    periodeTipe: r.periode_tipe as string,
    periodeMulai: dateStr(r.periode_mulai),
    periodeAkhir: dateStr(r.periode_akhir),
    diterbitkanPada: r.diterbitkan_pada == null ? null : isoTs(r.diterbitkan_pada),
  }));
}

/**
 * The report as a standalone HTML document, `klien` mode, pinned revision.
 *
 * `reportId` comes from the URL, so it is filtered BY the session's client
 * rather than used to find one: a contact asking for another client's report id
 * gets "not found", and the same query cannot be coaxed into returning it.
 *
 * The status/pin filter is repeated here even though RLS enforces it, because
 * these reads run as service-role (RLS does not engage) — the predicate must be
 * true in the SQL itself, not merely true somewhere in the system.
 */
export async function reportHtml(sql: Queryable, actor: Actor, reportId: number): Promise<string> {
  const scope = contactScope(actor);
  const rows = await sql<Record<string, unknown>[]>`
    select r.payload, i.ringkasan, i.poin, i.rekomendasi_tinggi, i.rekomendasi_sedang,
           i.outlook, i.indikator
      from client_reports r
      join client_report_publikasi p on p.report_id = r.id
      join client_report_insight i
        on i.report_id = r.id and i.revisi = p.insight_revisi
     where r.id = ${reportId}
       and r.client_id = ${scope.clientId}
       and p.status = ${'[Terbit]'}`;
  if (rows.length === 0) throw new PortalNotFoundError(MSG_REPORT_NOT_FOUND);
  const r = rows[0];
  const insight: report.PayloadInsight = {
    ringkasan: r.ringkasan as string,
    poin: (r.poin ?? []) as string[],
    rekomendasi_tinggi: (r.rekomendasi_tinggi ?? []) as report.PayloadInsight['rekomendasi_tinggi'],
    rekomendasi_sedang: (r.rekomendasi_sedang ?? []) as report.PayloadInsight['rekomendasi_sedang'],
    outlook: r.outlook as string,
    indikator: (r.indikator ?? []) as report.PayloadInsight['indikator'],
  };
  // 'klien' is hardcoded, not a parameter: there is no argument a client request
  // could carry that should ever produce the internal render.
  return report.renderReportHtml(r.payload as report.ReportPayload, 'klien', insight);
}

// ---------------------------------------------------------------------------
// Service Progress (§4.2, M15 Rule 2)
// ---------------------------------------------------------------------------
/** The fixed client-facing relabelling of Module 11's Universal Column (M15 Rule 2). */
export const LABEL_QUEUED = 'Queued';
export const LABEL_IN_PRODUCTION = 'In Production';
export const LABEL_FINALIZING = 'Finalizing';
/** Deliberately softened: "Blocked" alarms a client even when it is routine. */
export const LABEL_IN_REVIEW = 'In Review';
export const LABEL_COMPLETED = 'Completed';

/**
 * Universal Column → client label. A fixed lookup, applied at render time and
 * defined ONCE (M15 §6.1: "no Universal Column relabeling logic duplicated
 * elsewhere"). An unmapped column falls to `Queued`, the least alarming and
 * least informative label — never the raw internal string, which is the one
 * thing this table exists to keep out.
 */
export function labelKlien(universalColumn: string): string {
  switch (universalColumn) {
    case board.UC_TODO: return LABEL_QUEUED;
    case board.UC_IN_PROGRESS: return LABEL_IN_PRODUCTION;
    case board.UC_AWAITING_REV: return LABEL_FINALIZING;
    case board.UC_BLOCKED_REV: return LABEL_IN_REVIEW;
    case board.UC_DONE: return LABEL_COMPLETED;
    default: return LABEL_QUEUED;
  }
}

/**
 * The client-facing progress of one service. `label` is the SERVICE's rolled-up
 * position; `jumlahPekerjaan` says how many pieces of work sit behind it without
 * naming any of them.
 */
export interface PortalServiceProgress {
  namaLayanan: string;
  label: string;
  jumlahPekerjaan: number;
  jumlahSelesai: number;
}

/**
 * Roll a service's briefs up into ONE client-facing label.
 *
 * The rule is "the least-finished piece of work wins", because a client reading
 * "Completed" while two briefs are still in production has been misinformed —
 * and that is worse than reading a conservative label. Order:
 * Queued < In Production < In Review < Finalizing < Completed. `In Review` sits
 * below `Finalizing` on purpose: a revision loop means work went backwards.
 */
const URUTAN_LABEL = [LABEL_QUEUED, LABEL_IN_PRODUCTION, LABEL_IN_REVIEW, LABEL_FINALIZING, LABEL_COMPLETED];

export function gabungLabel(labels: string[]): string {
  if (labels.length === 0) return LABEL_QUEUED;
  let terendah = URUTAN_LABEL.length - 1;
  for (const l of labels) {
    const i = URUTAN_LABEL.indexOf(l);
    if (i >= 0 && i < terendah) terendah = i;
  }
  return URUTAN_LABEL[terendah];
}

/** Service statuses a client is still being delivered on (mirrors isServiceBriefable). */
const STATUS_SERVICE_AKTIF = [
  '[Awaiting Onboarding]', '[Strategy Approved]', '[Briefed]', '[In Execution]',
];

export async function serviceProgress(sql: Queryable, actor: Actor): Promise<PortalServiceProgress[]> {
  const scope = contactScope(actor);
  // One query, two levels: the service (name only) and its briefs' STATUSES.
  // No brief id, no title, no PIC, no division, no due date leaves the DB — not
  // filtered out later in TS, simply never selected, so a future edit to the DTO
  // cannot accidentally surface them.
  const rows = await sql<{ nama: string; service_id: string; status: string | null }[]>`
    select s.name as nama, s.id as service_id, b.status
      from services s
      left join briefs b on b.service_id = s.id
     where s.client_id = ${scope.clientId}
       and s.status = any(${STATUS_SERVICE_AKTIF})
     order by s.name, s.id`;

  const per = new Map<string, { nama: string; labels: string[] }>();
  for (const r of rows) {
    const entry = per.get(r.service_id) ?? { nama: r.nama, labels: [] };
    if (r.status != null) entry.labels.push(labelKlien(board.briefTaskUniversal(r.status)));
    per.set(r.service_id, entry);
  }
  return [...per.values()].map((e) => ({
    namaLayanan: e.nama,
    // A service with no briefs yet is genuinely Queued — nothing has started.
    label: gabungLabel(e.labels),
    jumlahPekerjaan: e.labels.length,
    jumlahSelesai: e.labels.filter((l) => l === LABEL_COMPLETED).length,
  }));
}

// ---------------------------------------------------------------------------
// Health Summary (§4.2, M15 Rule 4)
// ---------------------------------------------------------------------------
export const LABEL_ON_TRACK = 'On Track';
export const LABEL_NEEDS_ATTENTION = 'Needs Attention';
export const LABEL_ACTION_NEEDED = 'Action Needed';

/** Band → client wording (M15 Rule 4, confirmed §7 item 2). Fixed lookup. */
export function labelBand(band: string): string | null {
  switch (band) {
    case BAND_HEALTHY: return LABEL_ON_TRACK;
    case BAND_WATCH: return LABEL_NEEDS_ATTENTION;
    case BAND_AT_RISK: return LABEL_ACTION_NEEDED;
    default: return null;
  }
}

/**
 * The health summary a client may see: A LABEL, and the month it describes.
 *
 * There is no number in this DTO and there must never be one. M15 Rule 4 rules
 * out the raw 0–100 AND the component breakdown AND the weights; the score is
 * operational detail, and a client who learns their own number will negotiate
 * against it rather than about the work. `label: null` means no snapshot exists
 * yet (a new client) — rendered as "belum tersedia", never as a bad band.
 */
export interface PortalHealthSummary {
  label: string | null;
  periodeAkhir: string | null;
}

export async function healthSummary(sql: Queryable, actor: Actor): Promise<PortalHealthSummary> {
  const scope = contactScope(actor);
  // `band` and `period_end` ONLY. `final_health_score` and `components_json` sit
  // in the same row and are never selected — the safest place to enforce "no
  // number ever" is the SELECT list, not the mapper.
  const rows = await sql<{ band: string; period_end: unknown }[]>`
    select band, period_end from client_health_snapshots
     where client_id = ${scope.clientId}
     order by period_end desc, id desc limit 1`;
  if (rows.length === 0) return { label: null, periodeAkhir: null };
  return { label: labelBand(rows[0].band), periodeAkhir: dateStr(rows[0].period_end) };
}

// ---------------------------------------------------------------------------
// Complaint form — WRITE ONLY (M15 Rule 5/6)
// ---------------------------------------------------------------------------
export interface PortalComplaintInput {
  deskripsi: string;
  /** Client-chosen severity tag, OPTIONAL (M15 §6.1). Absent ⇒ Low. */
  severity?: string | null;
  /** Optional attachment as a link — no binary upload exists in CDPS yet. */
  lampiran?: string | null;
  /** Caller-supplied client IP for the per-IP limb of the rate limit (spec §5.2). */
  ip?: string | null;
}

export interface PortalComplaintAck {
  complaintId: string;
  pesan: string;
}

const isHttpUrl = (v: string): boolean => /^https?:\/\//i.test(v);

/**
 * Submit a complaint from the portal. Creates a standard `CPL-` with
 * `source='Client Portal'` and the submitting contact recorded, routed to the AM
 * exactly like a WhatsApp-logged one (M15 Rule 5) — the same `insertComplaint`
 * the internal door uses, so there is one set of complaint rules and one
 * notification path, not a parallel workflow.
 *
 * Returns the acknowledgment immediately (Rule 5). Deliberately returns NO
 * status and offers no way to read it back: Rule 6 confirmed submit-only, and
 * follow-up stays with the AM.
 */
export async function submitComplaint(
  sql: Sql, actor: Actor, input: PortalComplaintInput,
): Promise<PortalComplaintAck> {
  const scope = contactScope(actor);
  const deskripsi = (input.deskripsi ?? '').trim();
  if (deskripsi === '') throw new PortalValidationError(MSG_DESKRIPSI_WAJIB);
  if (deskripsi.length > MAX_DESKRIPSI) throw new PortalValidationError(MSG_DESKRIPSI_PANJANG);

  const severity = (input.severity ?? '').trim() === '' ? COMPLAINT_SEVERITY_LOW : (input.severity as string).trim();
  if (!isAllowedSeverity(severity)) throw new PortalValidationError(MSG_INVALID_SEVERITY);

  const lampiran = (input.lampiran ?? '').trim();
  // A non-URL "attachment" is the `reference_attachments = 'text'` bug all over
  // again (DECISIONS 2026-09-02): a value that is not a link renders as a broken
  // relative path. Refuse it at the door rather than storing it.
  if (lampiran !== '' && !isHttpUrl(lampiran)) {
    throw new PortalValidationError(MSG_LAMPIRAN_BUKAN_TAUTAN);
  }

  return withTransaction(sql, async (tx) => {
    const allowed = await tx<{ ok: boolean }[]>`
      select public.check_complaint_rate_limit(
        ${scope.contactId}::uuid, ${input.ip == null || input.ip === '' ? null : input.ip}::inet) as ok`;
    if (!allowed[0]?.ok) throw new PortalRateLimitedError();

    const id = await insertComplaint(tx, {
      clientId: scope.clientId,
      source: 'Client Portal',
      description: deskripsi,
      severity,
      status: COMPLAINT_STATUS_OPEN,
      relatedRef: lampiran === '' ? null : lampiran,
      submittingContactId: scope.contactId,
      actorId: scope.contactId,
    });
    await executors(tx).audit.insertAudit({
      entityType: 'client_contact',
      entityId: scope.contactId,
      actorEmployeeId: scope.contactId,
      action: 'submit:complaint',
      beforeJson: null,
      afterJson: { client_id: scope.clientId, complaint_id: id, severity },
      createdBy: scope.contactId,
    });
    return { complaintId: id, pesan: PESAN_ACK_KOMPLAIN };
  });
}
