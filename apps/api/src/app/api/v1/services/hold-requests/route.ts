/**
 * GET /api/v1/services/hold-requests — every Service in [Hold Requested],
 * oldest first (T-2b). The "Perlu Persetujuan Saya" queue for the Head of
 * Account / Director; `client.pendingHoldRequests` gates explicitly
 * (`canApproveHold`) and returns empty for anyone else, RLS scoping aside.
 *
 * A static segment beside the dynamic `/services/[id]`, resolved first by
 * Next — same arrangement as `/transactions/change-requests`.
 */
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { pendingHoldRequestToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await readAsActor(actor, (sql) => client.pendingHoldRequests(sql, actor));
    return json({ data: rows.map(pendingHoldRequestToWire) });
  });
}
