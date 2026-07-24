/**
 * PATCH /api/v1/clients/{id}/platforms/{pid} — M4 §4: correct one platform on a
 * client's Platform List (store link / managed-since / active). Deactivation
 * (active:false) removes it from the list without deleting history. Account Lead
 * / OD / Director only. Ports Go's handleUpdatePlatform. Incomplete → 400,
 * Forbidden → 403, NotFound → 404.
 */
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, json, readJson } from '@/lib/http';

interface Body {
  store_link?: string;
  managed_since?: string;
  active?: boolean;
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; pid: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id, pid } = await ctx.params;
    const platformId = Number(pid);
    if (!Number.isInteger(platformId)) {
      throw new BadRequestError('invalid platform id');
    }
    const b = await readJson<Body>(request);
    await client.updatePlatform(db(), actor, id, platformId, {
      storeLink: b.store_link,
      managedSince: b.managed_since,
      active: b.active,
    });
    return json({ ok: true });
  });
}
