/**
 * GET /api/v1/services — the Service queue: every Service the actor may see, with
 * its client, its effective plan gate and the Strategy & Plan behind it (M6 §3
 * Rule 4 — "all its Services move … into that AM's personal queue").
 *
 * This is the list that was missing entirely: `/account/intake` only ever shows
 * clients WITHOUT an AM, so the moment SPV assigned one the work vanished from
 * every screen, and the §4/§5 doors (all keyed by Service ID) became unreachable.
 *
 * Scope: Account lead / OD / Director see all; an Account-staff AM sees the
 * Services of the clients they own; anyone else gets 403.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { serviceQueueRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await readAsActor(actor, (sql) => account.serviceQueue(sql, actor));
    return json({ data: rows.map(serviceQueueRowToWire) });
  });
}
