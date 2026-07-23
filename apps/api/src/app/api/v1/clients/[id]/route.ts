/**
 * GET /api/v1/clients/{id} — one Client Record (M4 basic): the client plus its
 * platforms, sales-allocation snapshot, closed Services, and payment Transaction
 * (+ installments). Ports Go's handleGetClient. NotFoundError → 404 (shared
 * error mapper).
 */
import { sales } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const client = await sales.getClient(db(), id);
    return json({ client });
  });
}
