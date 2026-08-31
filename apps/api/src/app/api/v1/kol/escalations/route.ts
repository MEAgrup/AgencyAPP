/**
 * GET /api/v1/kol/escalations — every Booking in
 * [Escalated - Creator Unresponsive], oldest first (§10.1 / M9-OA-6). The
 * "Perlu Persetujuan Saya" queue for whoever may resolve it
 * (`canContinueEscalation`: the owning AM, the assigned Coordinator, KOL Team
 * Leader, or Director).
 *
 * `creator_bookings` RLS has no division-lead arm (only the assigned
 * coordinator / creator / read-all) — `kol.pendingEscalations` reads unscoped
 * and filters in TS, so this calls `db()` rather than `readAsActor`, same
 * posture as `tasks/block-requests`.
 */
import { kol } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { pendingEscalationToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await kol.pendingEscalations(db(), actor);
    return json({ data: rows.map(pendingEscalationToWire) });
  });
}
