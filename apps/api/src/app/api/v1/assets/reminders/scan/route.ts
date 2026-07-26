/**
 * POST /api/v1/assets/reminders/scan — M7 §5 Rule 2 / M7-OA-2 (DECISIONS O29 /
 * W3-CAT-1): run the Hours Logged end-of-day reminder sweep. Nudges every active
 * Asset's PIC who has not logged Hours today, at most once per (Asset, WIB day).
 * A batch job normally run on a schedule; exposed here as a Creative-division- or
 * Director-triggered action (the gate lives inside runHoursReminderScan). Ports
 * Go's handleScanHoursReminders.
 *
 * Forbidden → 403 (verbatim BI) via the shared error mapper.
 */
import { creative } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { scanHoursReminderResultToWire } from '@/lib/wire';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const res = await creative.runHoursReminderScan(db(), actor);
    return json(scanHoursReminderResultToWire(res));
  });
}
