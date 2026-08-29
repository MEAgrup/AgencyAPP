/**
 * POST /api/v1/internal/stage/tick — daily "tahap lewat target" sweep (M16 §5.4,
 * LT-27). On Supabase this runs from pg_cron (`stage_overdue_tick`, 01:00 UTC =
 * 08:00 WIB, after the working day has started so an overdue tahap surfaces
 * early). Same shared-secret gate as its siblings (`@/lib/tick-auth`) — no JWT,
 * not a logged-in user. `waktu` (RFC3339) overrides "now" for backfill/testing;
 * default is the wall clock. Idempotent (each Brief's current tahap is notified
 * at most once — HANDOFF_M16_AKUN_A.md §1.6), so a double call is a no-op.
 *
 * No `web-internal` caller by design (route-parity is FE→API): cron is the only
 * client, mirroring `/internal/penugasan/tick`.
 */
import { stage } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { tickSecretOk } from '@/lib/tick-auth';

interface Body {
  waktu?: unknown;
}

async function runTick(when: Date | undefined): Promise<Response> {
  const res = await stage.runStageOverdueTick(db(), when);
  return json({ lewat_target: res.lewatTarget });
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
