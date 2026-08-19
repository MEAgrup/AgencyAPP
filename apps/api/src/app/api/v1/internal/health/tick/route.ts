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
 * shared-secret HTTP tick like `internal/plan/tick`; the concrete cron provider is
 * Vercel Cron, wired in `vercel.json`). Not a logged-in user, so no JWT: it carries a
 * shared secret via `x-plan-tick-secret` or `Authorization: Bearer` (see
 * `@/lib/tick-auth`) — the SAME gate the M6B plan tick and the penugasan tick use,
 * deliberately reused rather than minting a second system credential to rotate. An
 * unset secret means the endpoint is CLOSED, never open: a missing env var must not
 * turn a privileged system hook into an anonymous one.
 *
 * Both verbs run the same sweep: POST (curl/GitHub Actions, with an optional body
 * override) and GET (Vercel Cron issues a GET and cannot send a body). The work
 * `health.runSnapshotJob` scores every Client for the most-recently CLOSED calendar
 * month and writes one immutable snapshot each. It is idempotent — a client already
 * snapshotted for the period is skipped — so a double call is a no-op the second
 * time. `waktu` in the POST body (RFC3339) overrides "now" for backfill/testing (the
 * same override shape the penugasan tick accepts); the default is the wall clock, and
 * the domain derives the closed month (WIB) from it — so the monthly cron must fire
 * on a day that is the 1st in BOTH WIB and UTC (see `vercel.json`).
 *
 * This route has no `web-internal` caller by design (route-parity is FE→API): the
 * cron is the only client.
 */
import { health } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { tickSecretOk } from '@/lib/tick-auth';
import { healthScanResultToWire } from '@/lib/wire';

interface Body {
  waktu?: unknown;
}

/** The sweep itself, shared by GET (Vercel Cron) and POST (curl / GitHub Actions). */
async function runTick(when: Date): Promise<Response> {
  const res = await health.runSnapshotJob(db(), when);
  return json(healthScanResultToWire(res));
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    if (!tickSecretOk(request)) return json({ error: 'unauthorized' }, 401);
    const body = await readJson<Body>(request).catch(() => ({}) as Body);
    const at = typeof body.waktu === 'string' ? new Date(body.waktu) : undefined;
    const when = at && !Number.isNaN(at.getTime()) ? at : new Date();
    return runTick(when);
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    if (!tickSecretOk(request)) return json({ error: 'unauthorized' }, 401);
    return runTick(new Date());
  });
}
