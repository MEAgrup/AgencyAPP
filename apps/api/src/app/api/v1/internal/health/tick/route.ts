/**
 * POST /api/v1/internal/health/tick — the monthly Client Health snapshot sweep
 * (M13 §5.2 / OA-6), driven by an EXTERNAL cron rather than a logged-in Director.
 *
 * The audit (WAVE3_GAP_AUDIT M13-G1) found the monthly batch had NO scheduler:
 * `runSnapshotJob` is correct + idempotent but its only entry was
 * `POST /health/snapshots/scan` (actor-gated Director). Without an automatic tick
 * the dashboard bands stay empty and the trend gaps permanently (no backfill,
 * DECISIONS 298). This route is that tick.
 *
 * Runtime = external cron → this route (owner decision 2026-08-19: Pattern A,
 * shared-secret HTTP tick like `internal/plan/tick`; the concrete cron provider —
 * Vercel Cron / a GitHub Action — is wired at deploy, deferred exactly as plan/tick
 * is today). Not a logged-in user, so no JWT: it carries a shared secret in
 * `x-plan-tick-secret`, compared against `PLAN_TICK_SECRET` — the SAME gate the
 * M6B plan tick and the penugasan tick use, deliberately reused rather than minting
 * a second system credential to rotate. An unset secret means the endpoint is
 * CLOSED, never open: a missing env var must not turn a privileged system hook into
 * an anonymous one.
 *
 * The work itself is `health.runSnapshotJob`, which scores every Client for the
 * most-recently CLOSED calendar month and writes one immutable snapshot each. It is
 * idempotent — a client already snapshotted for the period is skipped — so a double
 * call is a no-op the second time. `waktu` in the body (RFC3339) overrides "now"
 * for backfill/testing (the same override shape the penugasan tick accepts); the
 * default is the wall clock, and the domain derives the closed month from it.
 *
 * This route has no `web-internal` caller by design (route-parity is FE→API): the
 * cron is the only client.
 */
import { health } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { healthScanResultToWire } from '@/lib/wire';

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
    const res = await health.runSnapshotJob(db(), when);
    return json(healthScanResultToWire(res));
  });
}
