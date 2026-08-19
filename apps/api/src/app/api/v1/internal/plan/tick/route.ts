/**
 * POST /api/v1/internal/plan/tick — the 00:00 WIB scheduled-job entry point
 * (M6B §9 "Scheduled jobs", backlog B-09).
 *
 * Driven by an EXTERNAL cron — Vercel Cron (owner decision 2026-08-19) hitting this
 * route — not a logged-in user, so it does NOT authenticate with a JWT. It carries a
 * shared secret via `x-plan-tick-secret` or `Authorization: Bearer` (see
 * `@/lib/tick-auth`); an unset secret means the endpoint is CLOSED (fails every
 * request), never open — a missing env var must not turn a privileged system hook
 * into an anonymous one.
 *
 * Both verbs run the same tick: POST (curl/GitHub Actions, with an optional body
 * override) and GET (Vercel Cron issues a GET and cannot send a body). The work
 * `plan.runPlanTick` is idempotent: calling it twice for the same WIB day acts on
 * nothing the second time. `tanggal` in the POST body (`YYYY-MM-DD`) overrides the
 * WIB date for backfill/testing; default is today WIB — the same override shape
 * `master-services` accepts.
 *
 * This route has no `web-internal` caller by design (route-parity is FE→API): the
 * cron is the only client.
 */
import { tz } from '@cdps/core';
import { plan } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { tickSecretOk } from '@/lib/tick-auth';

interface Body {
  tanggal?: unknown;
}

/** The tick itself, shared by GET (Vercel Cron) and POST (curl / GitHub Actions). */
async function runTick(override: string | null): Promise<Response> {
  const today = override ?? tz.dateString(new Date());
  return json(await plan.runPlanTick(db(), today));
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    if (!tickSecretOk(request)) return json({ error: 'unauthorized' }, 401);
    const body = await readJson<Body>(request).catch(() => ({}) as Body);
    const override =
      typeof body.tanggal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.tanggal)
        ? body.tanggal
        : null;
    return runTick(override);
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    if (!tickSecretOk(request)) return json({ error: 'unauthorized' }, 401);
    return runTick(null);
  });
}
