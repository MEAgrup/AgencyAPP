/**
 * GET /api/v1/transactions/{id}/payment — M5 §2 Payment Status view with derived
 * Amount Verified / Amount Outstanding, the installment schedule, and the
 * verification trail. Ports Go's handleGetPaymentStatus. NotFound → 404.
 */
import { finance } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const payment = await finance.getPaymentStatus(db(), id);
    return json({ payment });
  });
}
