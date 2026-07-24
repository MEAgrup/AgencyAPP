/**
 * GET /api/v1/finance/queue — all Transactions awaiting first verification
 * ([Menunggu Verifikasi]), with their installment schedules (M5 §3).
 * FE: finance.getQueue() → { data: Transaction[] }.
 */
import { finance } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { transactionToWire } from '@/lib/wire';

export async function GET(): Promise<Response> {
  return handle(async () => {
    const queue = await finance.getFinanceQueue(db());
    return json({ data: queue.map(transactionToWire) });
  });
}
