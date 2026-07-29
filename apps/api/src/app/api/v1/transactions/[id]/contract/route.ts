/**
 * POST /api/v1/transactions/{id}/contract — M5 §7 attach the contract link to a
 * Transaction (the hard gate before [Lunas]). Admin & Finance / Director only.
 * Ports Go's handleAttachContract. Forbidden → 403, NotFound → 404,
 * Incomplete → 400.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ contract_attachment?: string }>(request);
    await finance.attachContract(db(), actor, id, b.contract_attachment ?? '');
    return json({ status: 'ok' });
  });
}
