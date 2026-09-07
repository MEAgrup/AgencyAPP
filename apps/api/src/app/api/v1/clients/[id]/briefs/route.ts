/**
 * GET /api/v1/clients/{id}/briefs — a client's Briefs, optionally narrowed to
 * one division via `?division=`.
 *
 * A-req-2 (K-3): the AM's Ads-Brief form picks its SOURCE Creative Brief from
 * this list. Client-scoped rather than service-scoped on purpose — an
 * engagement's Creative work and its Ads work regularly sit on two different
 * purchased Services, so a service-scoped list would be empty in the ordinary
 * case, and it is the same scope the read half of K-3 already uses
 * (`GET /clients/{id}/assets`).
 *
 * Read gate is `account.listClientBriefs`: the owning AM, Account lead,
 * OD/Director. Read through `readAsActor`, so RLS is the second wall.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { briefToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const division = new URL(request.url).searchParams.get('division') ?? '';
    const rows = await readAsActor(actor, (sql) => account.listClientBriefs(sql, actor, id, division));
    return json({ data: rows.map(briefToWire) });
  });
}
