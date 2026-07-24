/**
 * GET /api/v1/finance/queue — all Transactions awaiting first verification
 * ([Menunggu Verifikasi]), with their installment schedules (M5 §3).
 * FE: finance.getQueue() → { data: Transaction[] }.
 */
import { finance } from '@cdps/domain';
import { permission } from '@cdps/core';
import { requireActor } from '@/lib/auth';
import { readAsSystem } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { transactionToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    // Finance-wide verification queue (cross-client) — a named system read (O37).
    const actor = await requireActor(request);
    if (!permission.canReadDivision(actor, 'Finance')) {
      return json({ error: 'forbidden: Finance lead / OD / Director only' }, 403);
    }
    const queue = await readAsSystem((sql) => finance.getFinanceQueue(sql));
    return json({ data: queue.map(transactionToWire) });
  });
}
