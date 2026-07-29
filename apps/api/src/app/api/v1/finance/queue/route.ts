/**
 * GET /api/v1/finance/queue — M5 §8.1 Finance verification worklist: every
 * Transaction still at [Menunggu Verifikasi], with Amount Verified / Outstanding
 * derived from the verification log. Ports Go's handleFinanceQueue.
 *
 * Finance (any level), OD, and Director only — anyone else gets 403 rather than
 * an empty list, because "not your worklist" and "nothing to verify" are
 * different answers and the FE renders them differently.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { transactionToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await readAsActor(actor, (sql) => finance.financeQueue(sql, actor));
    return json({ data: rows.map(transactionToWire) });
  });
}
