/**
 * POST /api/v1/clients/{id}/platforms — M4 §3/§4: add a platform to a client's
 * Platform List (Account Lead / OD / Director). Ports Go's handleAddPlatform.
 * Incomplete → 400, Forbidden → 403, NotFound → 404.
 */
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

interface Body {
  platform?: string;
  store_link?: string;
  managed_since?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const platformId = await client.addPlatform(db(), actor, id, {
      platform: b.platform ?? '',
      storeLink: b.store_link,
      managedSince: b.managed_since,
    });
    return json({ platform_id: platformId }, 201);
  });
}
