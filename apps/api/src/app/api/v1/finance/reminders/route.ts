/**
 * GET /api/v1/finance/reminders — M5 §6 payment reminder dashboard: overdue-first
 * installments, upcoming ones within the horizon, and the open-ended
 * "Outstanding, No Due Date" list. Pure derived read. Ports Go's
 * handleReminderDashboard.
 *
 * The response goes through remindersToWire: the domain splits overdue/upcoming,
 * but the client reads ONE `reminders` list plus `outstanding_no_due_date`. This
 * route used to return the raw camelCase `{overdue, upcoming, outstandingNoDueDate}`,
 * which matched none of the keys the reminders page reads (O43 class).
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { remindersToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const dashboard = await readAsActor(actor, (sql) => finance.reminderDashboard(sql));
    return json(remindersToWire(dashboard));
  });
}
