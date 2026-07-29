/**
 * POST /api/v1/finance/reminders/scan — M5 §6 / §7 Rule 3: run the reminder scan
 * (installment overdue transitions + fire-once due / contract notifications).
 * A batch job normally run on a schedule; here it is exposed as an
 * SPV/Head-Finance- or Director-triggered action. Ports Go's ScanReminders.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    if (!finance.canManageScheme(actor)) {
      throw new finance.ForbiddenError(); // 403 via the shared error mapper
    }
    const summary = await finance.scanReminders(db());
    return json({ summary });
  });
}
