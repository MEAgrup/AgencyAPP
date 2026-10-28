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
    // P2 §6: paged (?limit=, ?cursor=); ?q= mencari nama klien / nama toko.
    // Feedback OD 27-10-2026: ?closing_dari= / ?closing_sampai= (YYYY-MM-DD WIB),
    // ?status_rilis= (menunggu_finance | dirilis), ?urut= (terbaru | terlama).
    const params = new URL(request.url).searchParams;
    const req = page.parseRequest(params.get('limit'), params.get('cursor'));
    const filter: client.ClientListFilter = {
      closingDari: params.get('closing_dari') ?? undefined,
      closingSampai: params.get('closing_sampai') ?? undefined,
      statusRilis: params.get('status_rilis') ?? undefined,
      urut: params.get('urut') ?? undefined,
    };
    client.parseListFilter(filter); // 400 sebelum membuka koneksi
    const result = await readAsActor(actor, (sql) =>
      client.listClients(sql, req, params.get('q') ?? undefined, filter));
    return json({ data: result.rows.map(clientListRowToWire), next_cursor: result.nextCursor });
  });
}
