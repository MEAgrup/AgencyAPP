/**
 * Live Stream Sessions under a Brief (M10 §3 / §6.1). Ports Go's
 * handleCreateSession + handleListBriefSessions.
 *
 * - POST: create a request to the vendor for one broadcast (owning AM / Director),
 *   while the parent Live Stream Brief is [Dispatched to Vendor]. → 201.
 * - GET: list every Session of the Brief (fan-out progress). Read gate = OD/Director
 *   + Account lead/SPV + owning AM.
 *
 * Incomplete/Validation → 400, Forbidden → 403, NotFound → 404, Conflict → 409.
 */
import { livestream } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { sessionToWire } from '@/lib/wire';

interface Body {
  platform?: string;
  requested_datetime?: string;
  target_duration_hours?: string;
  products_talent?: string;
  special_instructions?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const session = await livestream.createSession(db(), actor, id, {
      platform: b.platform ?? '',
      requestedDatetime: b.requested_datetime ?? '',
      targetDurationHours: b.target_duration_hours ?? '',
      productsTalent: b.products_talent,
      specialInstructions: b.special_instructions,
    });
    return json(sessionToWire(session), 201);
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const data = await livestream.listBriefSessions(db(), actor, id);
    return json({ data: data.map(sessionToWire) });
  });
}
