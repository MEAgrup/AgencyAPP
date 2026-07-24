/**
 * GET /api/v1/transactions/{id}/payment — M5 §2 Payment Status view with derived
 * Amount Verified / Amount Outstanding, the installment schedule, and the
 * verification trail. Ports Go's handleGetPaymentStatus. NotFound → 404.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAs } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id } = await ctx.params;
    const payment = await readAs(actor, (tx) => finance.getPaymentStatus(tx, id));
    return json({ payment });
  });
}
