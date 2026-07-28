/** GET /api/v1/payment-requests/{id} — one Creator Payment Request (M9 §8). */
import { kol } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { paymentRequestToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(paymentRequestToWire(await readAsActor(actor, (sql) => kol.getPaymentRequest(sql, actor, id))));
  });
}
