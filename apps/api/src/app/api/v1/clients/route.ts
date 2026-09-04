/**
 * GET /api/v1/clients — the client roster (M4 §6), newest first. Row scope
 * (own / Sales Allocation membership / division / OD / Director) is the RLS
 * safety net, as with GET /leads and GET /attempts. Ports Go's handleListClients.
 *
 * The envelope key is `data` (not `clients`) and rows go through
 * `clientListRowToWire`: web-internal's listClients() reads `res.data` and expects
 * snake_case, so the previous `{ clients: <camelCase rows> }` left the roster page
 * with an undefined list. See DECISIONS O43 for the open question about whether
 * these rows should carry Go's full clientView instead of this projection.
 */
import { page } from '@cdps/core';
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { clientListRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    // P2 §6: paged (?limit=, ?cursor=).
    const params = new URL(request.url).searchParams;
    const req = page.parseRequest(params.get('limit'), params.get('cursor'));
    const result = await readAsActor(actor, (sql) => client.listClients(sql, req));
    return json({ data: result.rows.map(clientListRowToWire), next_cursor: result.nextCursor });
  });
}
