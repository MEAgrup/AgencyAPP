/**
 * POST /api/v1/internal/penugasan/tick — daily due-date sweep for Penugasan
 * Internal (H-1 reminder + past-due notice).
 *
 * On Supabase the sweep runs from pg_cron (`penugasan_reminder_tick`, 07:00 WIB
 * = 00:00 UTC — a deadline reminder is useful at the START of the working day),
 * so this job is deliberately NOT listed in `vercel.json`: pg_cron already owns it
 * and double-wiring would fire it twice (harmless — idempotent — but confusing).
 * This route is the same function reachable from an EXTERNAL cron for deployments
 * without pg_cron, and for manual backfill. It supports GET + `Authorization: Bearer`
 * exactly like its siblings so the owner can move it onto Vercel Cron later by
 * dropping the pg_cron job and adding a `vercel.json` entry — no code change.
 *
 * Not a logged-in user, so no JWT: it carries a shared secret via `x-plan-tick-secret`
 * or `Authorization: Bearer` (see `@/lib/tick-auth`) — the SAME gate the M6B plan tick
 * uses, deliberately reused rather than inventing a second system credential to
 * rotate. An unset secret means the endpoint is CLOSED, never open: a missing env var
 * must not turn a privileged hook into an anonymous one.
 *
 * `waktu` in the POST body (RFC3339) overrides "now" for backfill/testing; default is
 * the wall clock (GET, which Vercel Cron uses, sends no body). The work is idempotent
 * — each task is notified at most once per branch — so a double call is a no-op the
 * second time.
 *
 * No `web-internal` caller by design (route-parity is FE→API): cron is the only
 * client.
 */
import { internaltask } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { tickSecretOk } from '@/lib/tick-auth';

interface Body {
  waktu?: unknown;
}

/** The sweep itself, shared by GET (Vercel Cron) and POST (curl / GitHub Actions). */
async function runTick(when: Date | undefined): Promise<Response> {
  const res = await internaltask.runReminderTick(db(), when);
  return json({ h1: res.h1, jatuh_tempo: res.jatuhTempo });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    if (!tickSecretOk(request)) return json({ error: 'unauthorized' }, 401);
    const body = await readJson<Body>(request).catch(() => ({}) as Body);
    const at = typeof body.waktu === 'string' ? new Date(body.waktu) : undefined;
    const when = at && !Number.isNaN(at.getTime()) ? at : undefined;
    return runTick(when);
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    if (!tickSecretOk(request)) return json({ error: 'unauthorized' }, 401);
    return runTick(undefined);
  });
}
