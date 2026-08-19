/**
 * POST /api/v1/internal/performance/tick — the monthly Team Performance snapshot
 * sweep (M14 §3 / §5.4), driven by an EXTERNAL cron rather than a logged-in Director.
 *
 * The audit (WAVE3_GAP_AUDIT M14-G1) found the monthly batch had NO scheduler:
 * `runSnapshotJob` is correct + idempotent but its only entry was
 * `POST /performance/snapshots/scan` (actor-gated Director). Without an automatic
 * tick the team dashboards stay empty and the per-staff trend gaps permanently.
 * This route is that tick — paired with `internal/health/tick` under one owner
 * decision (2026-08-19: Pattern A, shared-secret HTTP tick like `internal/plan/tick`;
 * the concrete cron provider is wired at deploy, deferred exactly as plan/tick is).
 *
 * Not a logged-in user, so no JWT: it carries a shared secret in
 * `x-plan-tick-secret`, compared against `PLAN_TICK_SECRET` — the SAME gate the M6B
 * plan tick and the penugasan tick use, deliberately reused rather than minting a
 * second system credential to rotate. An unset secret means the endpoint is CLOSED,
 * never open: a missing env var must not turn a privileged system hook into an
 * anonymous one.
 *
 * The work itself is `performance.runSnapshotJob`, which writes one immutable
 * per-staff snapshot for the most-recently CLOSED WIB calendar month. It is
 * idempotent — a re-run finds the snapshots already present — so a double call is a
 * no-op the second time. `waktu` in the body (RFC3339) overrides "now" for
 * backfill/testing; the default is the wall clock.
 *
 * This route has no `web-internal` caller by design (route-parity is FE→API): the
 * cron is the only client.
 */
import { performance } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

interface Body {
  waktu?: unknown;
}

/** Constant-time-ish equality over two server-held short tokens. */
function secretOk(request: Request): boolean {
  const expected = process.env.PLAN_TICK_SECRET ?? '';
  if (expected === '') return false; // unconfigured = closed
  const got = request.headers.get('x-plan-tick-secret') ?? '';
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    if (!secretOk(request)) return json({ error: 'unauthorized' }, 401);
    const body = await readJson<Body>(request).catch(() => ({}) as Body);
    const at = typeof body.waktu === 'string' ? new Date(body.waktu) : undefined;
    const when = at && !Number.isNaN(at.getTime()) ? at : new Date();
    const res = await performance.runSnapshotJob(db(), when);
    return json({ period: res.period, snapshots_made: res.snapshotsMade });
  });
}
