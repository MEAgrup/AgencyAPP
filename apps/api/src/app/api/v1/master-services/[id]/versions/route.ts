/**
 * GET /api/v1/master-services/{id}/versions — the full immutable version chain
 * for one master service. Ports Go's handleMasterServiceVersions.
 */
import { msl } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAs } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { masterServiceToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id } = await ctx.params;
    const versions = await readAs(actor, (tx) => msl.listVersions(tx, id));
    return json({ data: versions.map(masterServiceToWire) });
  });
}
