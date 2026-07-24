/**
 * POST /api/v1/transactions/{id}/verify — M5 §3 payment verification: Admin &
 * Finance confirms actual receipt (amount, date, proof) against the Transaction,
 * optionally satisfying one Installment. On the first verification the Client
 * Record releases to Account (§5). Ports Go's handleVerifyPayment.
 *
 * Response: { transaction: Transaction } (FE finance.ts verify → Transaction).
 * mapError: Incomplete / OverVerification → 400, Forbidden → 403,
 * NotFound → 404, ContractRequired → 409.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { transactionToWire } from '@/lib/wire';

interface Body {
  installment_id?: string;
  amount?: string;
  received_date?: string;
  proof_of_payment?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    await finance.verifyPayment(db(), actor, {
      transactionId: id,
      installmentId: b.installment_id,
      amount: b.amount ?? '',
      receivedDate: b.received_date ?? '',
      proofOfPayment: b.proof_of_payment,
    });
    const view = await finance.getPaymentStatus(db(), id);
    return json({ transaction: transactionToWire(view) }, 201);
  });
}
