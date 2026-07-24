/**
 * GET /api/v1/clients — the client roster (M4 §6), newest first. Row scope
 * (own / Sales Allocation membership / division / OD / Director) is the RLS
 * safety net, as with GET /leads and GET /attempts. Ports Go's handleListClients.
 */
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAs } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { clientListRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const clients = await readAs(actor, (tx) => client.listClients(tx));
    return json({ data: clients.map(clientListRowToWire) });
  });
}
