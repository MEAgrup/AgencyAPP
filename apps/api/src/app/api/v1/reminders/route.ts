/**
 * GET /api/v1/reminders — M5 §6 payment reminder dashboard: overdue-first
 * installments, upcoming ones within the horizon, and the open-ended
 * "Outstanding, No Due Date" list. Pure derived read. Ports Go's
 * handleReminderDashboard.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const dashboard = await readAsActor(actor, (sql) => finance.reminderDashboard(sql));
    return json(dashboard);
  });
}
