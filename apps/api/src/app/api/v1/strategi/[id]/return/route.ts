/**
 * POST /api/v1/strategi/{id}/return — send it back with notes (Rule 12).
 *
 * Two outcomes only, and this is the second one. Version 1 lands in `Draft`, a
 * revision lands in `Draft Revisi`: Rule 12 says a returned Strategi keeps its
 * version number, and dropping a revision into `Draft` would make it read as a
 * first draft in every list and metric.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiToWire } from '@/lib/wire';

interface Body {
  catatan?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    return json(strategiToWire(await strategi.returnStrategi(db(), actor, id, b.catatan ?? '')));
  });
}
