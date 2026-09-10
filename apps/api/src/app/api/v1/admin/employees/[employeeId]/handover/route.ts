/**
 * GET /api/v1/admin/employees/{employeeId}/handover — everything still assigned
 * to an employee, read BEFORE a resign so the operator sees what they are about
 * to leave dangling.
 *
 * Same gate as the resign itself (Director OR HR-division Lead) rather than the
 * broader admin-read gate: this list names a person's whole active workload,
 * which is exactly the sort of thing that should not be browsable by everyone
 * who can read the roster. Enforced here because the query below deliberately
 * runs on the privileged client — it spans `clients`, `briefs`,
 * `internal_tasks`, `scs_tasks` and `creator_bookings`, and reading it through
 * RLS would return a partial list that LOOKS complete, which for a "what will
 * break" preview is worse than a refusal.
 */
import { admin } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { handoverItemToWire } from '@/lib/wire';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ employeeId: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    if (!admin.canManageEmployeeAssignment(actor)) {
      throw new admin.ForbiddenError(admin.MSG_RESIGN_DENIED);
    }
    const { employeeId } = await ctx.params;
    const items = await admin.handoverList(db(), employeeId);
    return json({ data: items.map(handoverItemToWire) });
  });
}
