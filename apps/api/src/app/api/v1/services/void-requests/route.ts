/**
 * GET /api/v1/services/void-requests — every Service in [Void Requested],
 * oldest first (T-2d). The "Perlu Persetujuan Saya" queue for the Head of
 * Account / Director; `client.pendingVoidRequests` gates explicitly
 * (`canApproveVoid`) and returns empty for anyone else, RLS scoping aside.
 *
 * A static segment beside the dynamic `/services/[id]`, resolved first by
 * Next — same arrangement as `/services/hold-requests`.
 */
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { pendingVoidRequestToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await readAsActor(actor, (sql) => client.pendingVoidRequests(sql, actor));
    return json({ data: rows.map(pendingVoidRequestToWire) });
  });
}
