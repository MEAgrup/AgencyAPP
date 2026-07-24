/**
 * GET /api/v1/finance/reminders — payment reminder dashboard (M5 §6): overdue
 * installments + upcoming within the H-3 horizon + open-ended outstanding list.
 * FE: finance.getReminders() → RemindersResponse.
 *
 * The domain separates overdue / upcoming; the FE merges them into a single
 * `reminders` array (overdue-first, then upcoming, preserving domain order).
 */
import { finance } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { outstandingRowToWire, reminderRowToWire } from '@/lib/wire';

export async function GET(): Promise<Response> {
  return handle(async () => {
    const dashboard = await finance.reminderDashboard(db());
    return json({
      reminders: [...dashboard.overdue, ...dashboard.upcoming].map(reminderRowToWire),
      outstanding_no_due_date: dashboard.outstandingNoDueDate.map(outstandingRowToWire),
    });
  });
}
