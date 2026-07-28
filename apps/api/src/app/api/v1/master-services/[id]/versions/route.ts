/**
 * GET /api/v1/master-services/{id}/versions — the full immutable version chain
 * for one master service. Ports Go's handleMasterServiceVersions.
 */
import { msl } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { masterServiceToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const versions = await readAsActor(actor, (sql) => msl.listVersions(sql, id));
    return json({ data: versions.map(masterServiceToWire) });
  });
}
