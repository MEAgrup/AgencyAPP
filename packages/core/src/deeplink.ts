/**
 * deeplink — the ONE place that knows where an entity lives in `web-internal`.
 *
 * Phase 0 §9.2 requires every notification to carry a "deep-link to the entity".
 * It does not say what the paths are, because the paths are a frontend fact —
 * which is exactly why they drifted (DECISIONS **O51**): emitters that passed no
 * `deepLink` fell back to `notify_emit`'s generic default
 * (`'/' || entity_type || '/' || entity_id`, migration 20260723055732), and
 * emitters that DID pass one guessed a flat path. Both produced 404s:
 *
 *   sent /performance_snapshot/PERF-…   route is /performance/[id]
 *   sent /transactions/TRX-…            route is /finance/transactions/[id]
 *   sent /attempts/PRSP-…               route is /sales/[id]
 *
 * The route shape the guesses missed: entity types are snake_case singulars,
 * while the pages are plural AND nested under the owning division. No generic
 * default can derive that, so the fix is an explicit builder per entity — here —
 * and a parity gate that compares what these functions return against the pages
 * that actually exist (`apps/api/src/lib/deeplink-parity.test.ts`).
 *
 * Rule for anything added later: a new emitter passes `deepLink` built from this
 * module. Never hand-write a path at the call site, and never rely on the SQL
 * default — the gate fails the build for both.
 */

/**
 * Divisions a Brief can be dispatched to (M6 §2 `ALLOWED_DIVISIONS`). Kept as a
 * local literal so `core` stays free of `domain` imports; the parity gate proves
 * the two lists agree.
 */
const DIV_CREATIVE = 'Creative';
const DIV_ADS = 'Ads';
const DIV_KOL = 'KOL';
const DIV_LIVE_STREAM = 'Live Stream';

/**
 * Brief detail pages are per-division: the same Brief renders a different action
 * set for Creative, KOL and Live Stream, and the recipient of every Brief-scoped
 * notification is a member of the owning division.
 *
 * ⚠️ **Ads has no per-Brief page** (`/ads/[id]` takes a CAMPAIGN id, not a Brief
 * id), so an Ads Brief links to the division queue `/ads`, which lists it. That
 * is a deliberate, documented degradation — a link that lands one click away
 * beats a 404 — and the real fix (an `/ads/briefs/[id]` page) stays open in O51.
 * Do not "improve" this by pointing Ads at `/account/briefs/…`: that page is the
 * AM-side view, gated for Account, so the Ads lead who receives the notification
 * would land on a page built for someone else.
 */
export function brief(briefId: string, division: string): string {
  switch (division) {
    case DIV_CREATIVE:
      return `/creative/briefs/${briefId}`;
    case DIV_KOL:
      return `/kol/briefs/${briefId}`;
    case DIV_LIVE_STREAM:
      return `/livestream/briefs/${briefId}`;
    case DIV_ADS:
      return '/ads';
    default:
      // An unknown division means the Brief was dispatched somewhere this map
      // has not caught up with. The Board is the one page that lists work across
      // divisions, so it degrades to "findable" rather than to a 404.
      return '/board';
  }
}

/** Creative Asset detail (M7). */
export function asset(assetId: string): string {
  return `/creative/assets/${assetId}`;
}

/**
 * A Brief-as-task or an Asset-as-task (M12 block requests fire on both).
 * `entityType` is `TaskSource.entityType` — 'brief' | 'asset'.
 */
export function task(entityType: string, entityId: string, division: string): string {
  return entityType === 'asset' ? asset(entityId) : brief(entityId, division);
}

/** Account complaint detail (M6). */
export function complaint(complaintId: string): string {
  return `/account/complaints/${complaintId}`;
}

/**
 * Client health detail (M13). Takes the **client** id, not the snapshot id: the
 * page is `/health/[clientId]` and shows that client's snapshot history. Passing
 * the `CHR-…` snapshot id here — the shape the old default produced — renders an
 * empty page for a client that does not exist.
 */
export function clientHealth(clientId: string): string {
  return `/health/${clientId}`;
}

/** Live-stream session detail (M10). */
export function liveStreamSession(sessionId: string): string {
  return `/livestream/sessions/${sessionId}`;
}

/** Monthly performance snapshot detail (M14). */
export function performanceSnapshot(snapshotId: string): string {
  return `/performance/${snapshotId}`;
}

/** Transaction detail (M5) — nested under Finance, which owns the page. */
export function transaction(transactionId: string): string {
  return `/finance/transactions/${transactionId}`;
}

/**
 * Prospect-attempt detail (M0). The page is `/sales/[id]` — the Sales workspace
 * detail view IS the attempt view; there is no `/attempts/…`.
 */
export function attempt(attemptId: string): string {
  return `/sales/${attemptId}`;
}

/** Lead detail (M1). */
export function lead(leadId: string): string {
  return `/leads/${leadId}`;
}

/** Demo-task detail (M12 harness). */
export function demoTask(taskId: string): string {
  return `/demo-tasks/${taskId}`;
}
