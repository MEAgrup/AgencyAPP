/**
 * GET /api/v1/vendor/sessions — LT-61: every Live Stream Session (LSS-)
 * assigned to the calling vendor Actor, across all Briefs/clients. The
 * vendor-facing counterpart to GET /briefs/{id}/sessions, which needs a Brief
 * id a vendor caller has no way to already know. `requireActor` resolves
 * either an employee or a vendor token (packages/core/src/permission.ts
 * actorFromVendorClaims); `livestream.listVendorSessions` returns an empty
 * list for anything that isn't a vendor Actor, so this route is a no-op for
 * an employee caller rather than a 403 (there's simply nothing "mine" to list).
 */
import { livestream } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { sessionToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const data = await readAsActor(actor, (sql) => livestream.listVendorSessions(sql, actor));
    return json({ data: data.map(sessionToWire) });
  });
}
