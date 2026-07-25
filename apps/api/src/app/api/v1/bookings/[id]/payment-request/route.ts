/** POST /api/v1/bookings/{id}/payment-request — open a Creator Payment Request (M9 §8). */
import { kol } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { paymentRequestToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ amount?: string; payment_details?: string }>(request);
    return json(paymentRequestToWire(await kol.createPaymentRequest(db(), actor, id, b.amount ?? '', b.payment_details ?? '')));
  });
}
