/**
 * POST /api/v1/internal/penugasan/tick — daily due-date sweep for Penugasan
 * Internal (H-1 reminder + past-due notice).
 *
 * On Supabase the sweep runs from pg_cron (`penugasan_reminder_tick`, 07:00 WIB
 * = 00:00 UTC — a deadline reminder is useful at the START of the working day).
 * This route is the same function reachable from an EXTERNAL cron (Vercel Cron /
 * a GitHub Action) for deployments without pg_cron, and for manual backfill.
 *
 * Not a logged-in user, so no JWT: it carries a shared secret in
 * `x-plan-tick-secret`, compared against `PLAN_TICK_SECRET` — the SAME gate the
 * M6B plan tick uses, deliberately reused rather than inventing a second system
 * credential to rotate. An unset secret means the endpoint is CLOSED, never
 * open: a missing env var must not turn a privileged hook into an anonymous one.
 *
 * `waktu` in the body (RFC3339) overrides "now" for backfill/testing; default is
 * the wall clock. The work is idempotent — each task is notified at most once
 * per branch — so a double call is a no-op the second time.
 *
 * No `web-internal` caller by design (route-parity is FE→API): cron is the only
 * client.
 */
import { internaltask } from '@cdps/domain';
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
    const when = at && !Number.isNaN(at.getTime()) ? at : undefined;
    const res = await internaltask.runReminderTick(db(), when);
    return json({ h1: res.h1, jatuh_tempo: res.jatuhTempo });
  });
}
