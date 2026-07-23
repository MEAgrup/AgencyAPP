/**
 * GET /api/v1/reminders — M5 §6 payment reminder dashboard: overdue-first
 * installments, upcoming ones within the horizon, and the open-ended
 * "Outstanding, No Due Date" list. Pure derived read. Ports Go's
 * handleReminderDashboard.
 */
import { finance } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(): Promise<Response> {
  return handle(async () => {
    const dashboard = await finance.reminderDashboard(db());
    return json(dashboard);
  });
}
