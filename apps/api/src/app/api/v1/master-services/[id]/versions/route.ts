/**
 * GET /api/v1/master-services/{id}/versions — the full immutable version chain
 * for one master service. Ports Go's handleMasterServiceVersions.
 */
import { msl } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const versions = await msl.listVersions(db(), id);
    return json({ versions });
  });
}
