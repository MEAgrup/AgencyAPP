/**
 * GET /api/v1/finance/reminders — payment reminder dashboard (M5 §6): overdue
 * installments + upcoming within the H-3 horizon + open-ended outstanding list.
 * FE: finance.getReminders() → RemindersResponse.
 *
 * The domain separates overdue / upcoming; the FE merges them into a single
 * `reminders` array (overdue-first, then upcoming, preserving domain order).
 */
import { finance } from '@cdps/domain';
import { permission } from '@cdps/core';
import { requireActor } from '@/lib/auth';
import { readAsSystem } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { outstandingRowToWire, reminderRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    // Finance-wide operational view (cross-client) — a named system read (O37).
    const actor = await requireActor(request);
    if (!permission.canReadDivision(actor, 'Finance')) {
      return json({ error: 'forbidden: Finance lead / OD / Director only' }, 403);
    }
    const dashboard = await readAsSystem((sql) => finance.reminderDashboard(sql));
    return json({
      reminders: [...dashboard.overdue, ...dashboard.upcoming].map(reminderRowToWire),
      outstanding_no_due_date: dashboard.outstandingNoDueDate.map(outstandingRowToWire),
    });
  });
}
