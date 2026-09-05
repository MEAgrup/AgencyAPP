/**
 * PUT /api/v1/clients/{id}/platforms/{pid}/tahap-fokus — R3.
 *
 * Sets (or clears) the buyer-journey stage a store is chasing. One field, one
 * verb, its own route: it is NOT part of the client-profile patch, because the
 * profile patch is gated on Account Lead / OD / Director while this is the
 * owning AM's call (see `report.setTahapFokus` for the full reasoning).
 *
 * A PUT with `tahap: null` — or the empty string a <select> submits for its
 * blank option — clears the field. That is a legitimate state, not a failure:
 * "we have not decided yet" must be expressible, otherwise the first pick is
 * permanent.
 */
import { report } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { errorJson, handle, json, readJson } from '@/lib/http';

interface Body {
  tahap?: string | null;
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string; pid: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id, pid } = await ctx.params;
    const platformId = Number(pid);
    if (!Number.isInteger(platformId) || platformId <= 0) {
      return errorJson(report.MSG_PLATFORM_NOT_FOUND, 404);
    }
    const b = await readJson<Body>(request);
    const tahap = await report.setTahapFokus(db(), actor, id, platformId, b.tahap ?? null);
    // Echoed back so the caller renders what the SERVER stored, not what it sent
    // — and `null` is sent explicitly rather than omitted (O43).
    return json({ tahap_fokus: tahap });
  });
}
