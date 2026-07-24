/**
 * GET /api/v1/transactions/{id} — the Transaction detail (M5 §2/§3/§4).
 * Returns the full TransactionView (payment status + installments) in the FE
 * wire shape (`Transaction` in web-internal/src/lib/finance.ts).
 * NotFoundError → 404 via shared error mapper.
 */
import { finance } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { transactionToWire } from '@/lib/wire';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const view = await finance.getPaymentStatus(db(), id);
    return json({ transaction: transactionToWire(view) });
  });
}
