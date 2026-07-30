/**
 * GET /api/v1/transactions/{id}/payment — M5 §2 Payment Status view with derived
 * Amount Verified / Amount Outstanding, the installment schedule, and the
 * verification trail. NotFound → 404.
 *
 * ⚠️ O43 residue — the body is the RAW camelCase read model, deliberately: Go has
 * NO `handleGetPaymentStatus` (an earlier comment here claimed it did; it does
 * not exist), and `web-internal` calls this path from nowhere. With neither an
 * oracle nor a consumer, naming the wire keys now would be inventing a contract.
 * Whoever builds the first page against this endpoint owns the `*ToWire` mapper.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const payment = await readAsActor(actor, (sql) => finance.getPaymentStatus(sql, id));
    return json({ payment });
  });
}
