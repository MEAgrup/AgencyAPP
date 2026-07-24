/**
 * GET /api/v1/reminders — M5 §6 payment reminder dashboard: overdue-first
 * installments, upcoming ones within the horizon, and the open-ended
 * "Outstanding, No Due Date" list. Pure derived read. Ports Go's
 * handleReminderDashboard.
 */
import { finance } from '@cdps/domain';
import { permission } from '@cdps/core';
import { requireActor } from '@/lib/auth';
import { readAsSystem } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    // Finance-wide operational view (cross-client) — a named system read (O37).
    // Gate to the roles RLS grants finance-wide read: Finance lead / OD / Director.
    const actor = await requireActor(request);
    if (!permission.canReadDivision(actor, 'Finance')) {
      return json({ error: 'forbidden: Finance lead / OD / Director only' }, 403);
    }
    const dashboard = await readAsSystem((sql) => finance.reminderDashboard(sql));
    return json(dashboard);
  });
}
