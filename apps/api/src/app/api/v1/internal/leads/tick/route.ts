/**
 * POST /api/v1/internal/leads/tick — daily "lead aging" sweep (L1/L3,
 * docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md). On Supabase this runs
 * from pg_cron (`leads_unrespon_tick`, 22:30 UTC = 05:30 WIB). Same shared-
 * secret gate as its siblings (`@/lib/tick-auth`) — no JWT, not a logged-in
 * user. `waktu` (RFC3339) overrides "now" for backfill/testing; default is the
 * wall clock. Idempotent (a status flip removes the row from the next run's
 * candidate set), so a double call is a no-op.
 *
 * No `web-internal` caller by design (route-parity is FE→API): cron is the
 * only client, mirroring `/internal/stage/tick` and `/internal/penugasan/tick`.
 */
import { sales } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { tickSecretOk } from '@/lib/tick-auth';

interface Body {
  waktu?: unknown;
}

async function runTick(when: Date | undefined): Promise<Response> {
  const res = await sales.runUnresponTick(db(), when);
  return json({ unrespon: res.unrespon, auto_not_qualified: res.autoNotQualified });
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
