/**
 * POST /api/v1/internal/plan/tick — the 00:00 WIB scheduled-job entry point
 * (M6B §9 "Scheduled jobs", backlog B-09).
 *
 * Driven by an EXTERNAL cron — Vercel Cron / a GitHub Action hitting this route
 * (runtime decision DECISIONS 2026-08-11) — not a logged-in user, so it does NOT
 * authenticate with a JWT. It carries a shared secret in the `x-plan-tick-secret`
 * header, compared against `PLAN_TICK_SECRET`. An unset secret means the endpoint
 * is CLOSED (fails every request), never open — a missing env var must not turn a
 * privileged system hook into an anonymous one.
 *
 * The work itself is `plan.runPlanTick`, which is idempotent: calling it twice for
 * the same WIB day acts on nothing the second time. `tanggal` in the body
 * (`YYYY-MM-DD`) overrides the WIB date for backfill/testing; default is today
 * WIB — the same override shape `master-services` accepts.
 *
 * This route has no `web-internal` caller by design (route-parity is FE→API): the
 * cron is the only client.
 */
import { tz } from '@cdps/core';
import { plan } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

interface Body {
  tanggal?: unknown;
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
    const override =
      typeof body.tanggal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.tanggal)
        ? body.tanggal
        : null;
    const today = override ?? tz.dateString(new Date());
    const result = await plan.runPlanTick(db(), today);
    return json(result);
  });
}
