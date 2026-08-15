/**
 * Notification inbox presentation: what a notification SAYS, and where it GOES.
 *
 * ## Why the link is computed here and not read from `deep_link`
 *
 * `notify_emit` (migration 20260723055732) defaults the column to
 * `'/' || entity_type || '/' || entity_id` whenever the emitter passes no
 * explicit link — and almost none do. That default is not a route in this app:
 * a published Performance Score arrives as `/performance_snapshot/PERF-…`, so
 * clicking the only notification a fresh staff account ever receives lands on a
 * 404. The two emitters that DO pass a link pass Go-era paths that were never
 * ported (`/transactions/{id}` — this app serves `/finance/transactions/{id}`;
 * `/attempts/{id}` — this app serves `/sales/{id}`), so they 404 as well.
 *
 * So `deep_link` is deliberately IGNORED here and the target is derived from
 * `(entity_type, entity_id)`, which are the durable facts. This also repairs the
 * rows already in the table: notifications are append-only (Phase 0 §8 — never
 * deletable, only read/unread), so a fix that only touched future emissions
 * would leave every existing inbox broken.
 *
 * An entity with no page in `web-internal` resolves to `null` — the row renders
 * unclickable rather than pretending to be a link. That is the honest failure
 * mode; a 404 is not.
 */
import type { NotificationItem } from '@/lib/types';

/**
 * Entity type → route template, `{}` standing in for the id. Keys are the
 * `entityType` values the domain actually emits (grep `notification.emit`), not a
 * guess at the table list.
 *
 * `null` = no page for this entity in web-internal:
 *   - `installment`: the schedule lives under its parent transaction and the
 *     notification carries only the INST- id, so there is nothing to link to.
 *   - `dependency`: M11 dependencies are edges on the board, with no detail page.
 *   - `client_health_snapshot`: `/health/{clientId}` is keyed by CLIENT, and the
 *     notification carries the CHR- id.
 * Each of these is a candidate for a real deep link once the emitter carries the
 * parent id; leaving them null keeps the gap visible instead of routing to a lie.
 */
const ENTITY_ROUTES: Record<string, string | null> = {
  // M0 Sales — the negotiation approval loop.
  prospect_attempt: '/sales/{}',
  // M1 Leads — co-pursuit + the delete-approval queue.
  lead: '/leads/{}',
  // M5 Finance.
  transaction: '/finance/transactions/{}',
  installment: null,
  // M6 Account & Service.
  complaint: '/account/complaints/{}',
  // M12 Task Execution — `/tasks/{id}` resolves BRF-/AST- by prefix (sourceOf).
  brief: '/tasks/{}',
  asset: '/tasks/{}',
  demo_task: '/demo-tasks/{}',
  // Penugasan Internal — a SECOND task entity, and a separate page from `/tasks`
  // (M12). Without this row every penugasan notification renders unclickable,
  // which is the same dead end as the 404 logged on 2026-08-05.
  internal_task: '/penugasan/{}',
  // M10 Live Stream.
  live_stream_session: '/livestream/sessions/{}',
  // M13 / M14 snapshots.
  client_health_snapshot: null,
  // performance_snapshot is NOT here: `/performance/{id}` is keyed by STAFF id
  // (getStaffPerformance → /staff/{id}/performance), while the notification
  // carries the PERF- snapshot id. Resolved below from the viewer instead.
  // M11 board dependencies.
  dependency: null,
};

/**
 * Entities whose page is keyed by the VIEWER, not by the notification's entity.
 * `m14.performance.published` goes to each staff member about their OWN score
 * (catalog resolver = explicit), and the inbox is per-recipient by construction,
 * so the viewer IS the subject — `/performance/{ownEmployeeId}` is the page they
 * mean. Without an employee id the landing page is the honest fallback.
 */
const VIEWER_KEYED = new Set(['performance_snapshot']);

/**
 * Human-readable event labels (Bahasa Indonesia). The raw `event_type`
 * (`m14.performance.published`) is a stable machine identifier from the FROZEN
 * Phase 0 §9 catalog — it is not a sentence, and the inbox was showing it as one.
 * These are display strings, NOT the `[...]` validation messages, so they carry
 * no brackets.
 */
const EVENT_LABELS: Record<string, string> = {
  'm0.negotiation.pending_approval': 'Negosiasi menunggu persetujuan',
  'm0.negotiation.decision': 'Keputusan negosiasi',
  'm0m5.installment.due': 'Termin pembayaran jatuh tempo',
  'm5.contract.not_received': 'Kontrak belum diterima',
  'm6.complaint.logged': 'Komplain baru dicatat',
  'm9.kol.qc_failed_or_escalated': 'QC kreator gagal / booking dieskalasi',
  'm10.session.discrepancy_flagged': 'Sesi live stream ditandai bermasalah',
  'm11.dependency.satisfied': 'Dependency blocking sudah terpenuhi',
  'm12.block_request.submitted': 'Permintaan block diajukan',
  'm12.block_request.decided': 'Permintaan block diputuskan',
  'm12.revision_count.flag': 'Revisi ≥ 3 — flag kualitas',
  'm13.client.band_drop': 'Health band klien turun',
  'm14.performance.published': 'Skor performa bulanan dipublikasikan',
  'm1.lead.co_pursuit': 'Lead dikerjakan lebih dari satu sales',
  'm7.hours_logged.reminder': 'Pengingat Hours Logged',
  'm1.lead.delete_requested': 'Permintaan hapus lead diajukan',
  'm1.lead.delete_decided': 'Permintaan hapus lead diputuskan',
  // Penugasan Internal (katalog v9 + v10). The raw identifiers read as
  // machine strings in an inbox, and this is the one module whose notifications
  // go to people who never touch a Brief.
  penugasan_ditugaskan: 'Anda mendapat penugasan baru',
  penugasan_selesai: 'Penugasan ditandai selesai',
  penugasan_mendekati_jatuh_tempo: 'Penugasan jatuh tempo besok',
  penugasan_jatuh_tempo: 'Penugasan lewat jatuh tempo',
  penugasan_dibatalkan: 'Penugasan dibatalkan',
};

/**
 * eventLabel renders an event type for humans, falling back to the raw
 * identifier for an event this build does not know (a newer API should not make
 * the inbox render blank).
 */
export function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType;
}

/**
 * notificationHref resolves where a notification opens, or `null` when this app
 * has no page for that entity. `viewerEmployeeId` is the logged-in employee, used
 * only by the viewer-keyed entities above. See the file header for why
 * `deep_link` is not used.
 */
export function notificationHref(
  n: Pick<NotificationItem, 'entity_type' | 'entity_id'>,
  viewerEmployeeId?: string | null,
): string | null {
  if (VIEWER_KEYED.has(n.entity_type)) {
    const me = (viewerEmployeeId ?? '').trim();
    return me === '' ? '/performance' : `/performance/${encodeURIComponent(me)}`;
  }
  const template = ENTITY_ROUTES[n.entity_type];
  if (!template) {
    return null;
  }
  const id = (n.entity_id ?? '').trim();
  if (id === '') {
    return null;
  }
  return template.replace('{}', encodeURIComponent(id));
}
