/**
 * POST /api/v1/clients/{id}/payment-intent — the M4 §5 payment-intent handoff
 * (Sales → Admin & Finance).
 *
 * The client's Primary Sales PIC (or a Director) declares the payment scheme; it
 * is stamped on both the Client Record and its linked Transaction, each audited
 * before→after. Body: { payment_intent }. Responds with the refreshed Client
 * Record, matching Go's handleSetPaymentIntent.
 *
 * Ports Go's handleSetPaymentIntent. Invalid scheme → 400, Forbidden (not this
 * client's PIC) → 403, NotFound → 404, IntentLocked (Finance already verified, or
 * the Transaction left [Menunggu Verifikasi]) → 409 (shared error mapper).
 *
 * Note on the re-read: the handoff commits first, then the Client Record is read
 * back through `readAsActor` so the response passes the same RLS predicate as
 * GET /clients/{id} — the write authority (Sales PIC identity) and the read
 * authority (RLS row scope) stay independently enforced, as in Go.
 */
import { client, sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { clientDetailToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ payment_intent?: string }>(request);
    await client.setPaymentIntent(db(), actor, id, b.payment_intent ?? '');
    const record = await readAsActor(actor, (sql) => sales.getClient(sql, id));
    return json({ client: clientDetailToWire(record) });
  });
}
