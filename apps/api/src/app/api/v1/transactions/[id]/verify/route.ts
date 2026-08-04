/**
 * POST /api/v1/transactions/{id}/verify — M5 §3 payment verification: Admin &
 * Finance confirms actual receipt (amount, date, proof) against the Transaction,
 * optionally satisfying one Installment. On the first verification the Client
 * Record releases to Account (§5). Ports Go's handleVerifyPayment.
 *
 * mapError: Incomplete / OverVerification → 400, Forbidden → 403,
 * NotFound → 404, ContractRequired → 409.
 *
 * Responds with the re-read Transaction aggregate under `transaction`, at 200 —
 * both to match Go (handleVerifyPayment) and because that is what web-internal
 * reads (`verify()` in lib/finance.ts is typed `{transaction: Transaction}`). It
 * used to answer 201 with the raw camelCase VerifyResult, which carried neither
 * the key nor the installment rows the page re-renders from (O43 class).
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { transactionToWire } from '@/lib/wire';

interface Body {
  installment_id?: string;
  amount?: string;
  received_date?: string;
  proof_of_payment?: string;
  /**
   * Optional contract link, attached in the SAME domain transaction as the
   * verification (M5 §7 Rule 1). The finance page now carries this field inside
   * the verification form, so the [Lunas] gate (§7 Rule 2) can be satisfied by
   * the one submit that trips it instead of a separate action nothing linked to it.
   */
  contract_attachment?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    await finance.verifyPayment(db(), actor, {
      transactionId: id,
      installmentId: b.installment_id,
      amount: b.amount ?? '',
      receivedDate: b.received_date ?? '',
      proofOfPayment: b.proof_of_payment,
      contractAttachment: b.contract_attachment,
    });
    // Re-read as the actor so the response reflects post-verification state
    // (payment_status, derived amounts, installment statuses) in one round trip.
    const trx = await readAsActor(actor, (sql) => finance.loadTransactionAggregate(sql, actor, id));
    return json({ transaction: transactionToWire(trx) });
  });
}
