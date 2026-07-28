/**
 * GET /api/v1/divisions/{division}/brief-queue — the Brief queue for a target
 * division (M6 §6 Rule 1), oldest first. Readable by that division's staff/lead,
 * Account lead, and OD/Director. Ports Go's handleDivisionQueue.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { briefToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ division: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { division } = await ctx.params;
    const rows = await readAsActor(actor, (sql) => account.listDivisionQueue(sql, actor, decodeURIComponent(division)));
    return json({ data: rows.map(briefToWire) });
  });
}
