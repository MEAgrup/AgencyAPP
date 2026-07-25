/** /api/v1/briefs/{id}/creator-list — the compiled Creator List (M9 §6). */
import { kol } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { creatorListToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ link?: string }>(request);
    return json(creatorListToWire(await kol.generateCreatorList(db(), actor, id, b.link ?? '')));
  });
}
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(creatorListToWire(await kol.getCreatorList(db(), actor, id)));
  });
}
