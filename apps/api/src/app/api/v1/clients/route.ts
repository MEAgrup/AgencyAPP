/**
 * GET /api/v1/clients — the client roster (M4 §6), newest first. Row scope
 * (own / Sales Allocation membership / division / OD / Director) is the RLS
 * safety net, as with GET /leads and GET /attempts. Ports Go's handleListClients.
 */
import { client } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { clientListRowToWire } from '@/lib/wire';

export async function GET(): Promise<Response> {
  return handle(async () => {
    const clients = await client.listClients(db());
    return json({ data: clients.map(clientListRowToWire) });
  });
}
