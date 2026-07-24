/**
 * POST /api/v1/finance/reminders/scan — run the reminder scan batch (M5 §6/§7
 * Rule 3): installment [Jatuh Tempo] transitions + fire-once notifications +
 * soft 7-day contract flag. SPV/Head Finance or Director only. Idempotent.
 * FE: finance.scanReminders() → ScanResult (flat, not wrapped).
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { scanSummaryToWire } from '@/lib/wire';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    if (!finance.canManageScheme(actor)) {
      throw new finance.ForbiddenError();
    }
    const summary = await finance.scanReminders(db());
    return json(scanSummaryToWire(summary));
  });
}
