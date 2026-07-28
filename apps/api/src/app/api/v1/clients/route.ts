/**
 * GET /api/v1/clients — the client roster (M4 §6), newest first. Row scope
 * (own / Sales Allocation membership / division / OD / Director) is the RLS
 * safety net, as with GET /leads and GET /attempts. Ports Go's handleListClients.
 */
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const clients = await readAsActor(actor, (sql) => client.listClients(sql));
    return json({ clients });
  });
}
