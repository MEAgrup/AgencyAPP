/**
 * PUT /api/v1/strategi/{id}/channels — Section B-0, the per-channel blocks (D4: one block per contracted channel).
 *
 * A replace-set: the section is saved whole. Saving row by row would let a
 * section land half-written, which for Section B is precisely the state Rule 5
 * forbids — and it would turn one user action into a burst of audit rows nobody
 * can reconstruct a form state from.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiDetailToWire, strategiChannelsFromWire } from '@/lib/wire';

interface Body {
  channels?: unknown;
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const saved = await strategi.saveChannels(db(), actor, id, strategiChannelsFromWire(b.channels ?? []));
    return json(strategiDetailToWire(saved));
  });
}
