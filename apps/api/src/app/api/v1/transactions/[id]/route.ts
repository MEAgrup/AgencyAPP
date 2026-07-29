/**
 * GET /api/v1/transactions/{id} — M5 the Transaction aggregate: scheme, derived
 * Amount Verified / Outstanding, the [Bermasalah] flag, contract link, release
 * timestamp, and the installment schedule. Ports Go's handleGetTransaction.
 *
 * Visibility is M5 §5: a role with no Module 5 access → 403; a transaction the
 * actor may not see → 404, never 403 (a 403 would confirm it exists).
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { transactionToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const trx = await readAsActor(actor, (sql) => finance.loadTransactionAggregate(sql, actor, id));
    return json({ transaction: transactionToWire(trx) });
  });
}
