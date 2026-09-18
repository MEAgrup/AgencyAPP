/**
 * GET /api/v1/services/closure-requests — every Service in [Closure Requested],
 * oldest first (O75). The Director's "Perlu Persetujuan Saya" queue;
 * `client.pendingClosureRequests` gates explicitly (`canApproveClosure`,
 * Director-only) and returns empty for anyone else, RLS scoping aside.
 *
 * A static segment beside the dynamic `/services/[id]`, resolved first by
 * Next — same arrangement as `/services/hold-requests`.
 */
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { pendingClosureRequestToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await readAsActor(actor, (sql) => client.pendingClosureRequests(sql, actor));
    return json({ data: rows.map(pendingClosureRequestToWire) });
  });
}
