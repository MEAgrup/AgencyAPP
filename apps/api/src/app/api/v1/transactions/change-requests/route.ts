/**
 * GET /api/v1/transactions/change-requests[?status=] — the Director's ACC queue
 * for filed transaction changes (M5-OA-7). Default `pending` (the set that can
 * still be acted on); `?status=` empty means every status, matching the lead
 * delete-request queue's convention so one rule is learned once.
 *
 * Row scope is `transaction_change_requests_select` via `readAsActor`: a
 * Director/OD sees everything, Finance sees its own worklist, and anyone else
 * gets an empty list rather than someone else's money.
 *
 * The static `change-requests` segment sits beside the dynamic `[id]` one; Next
 * matches static first, exactly as `leads/delete-requests` does next to
 * `leads/[id]`.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { schemeChangeRequestToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const status = new URL(request.url).searchParams.get('status');
    const rows = await readAsActor(actor, (sql) =>
      finance.schemeChangeRequests(sql, status === null ? {} : { status }));
    return json({ data: rows.map(schemeChangeRequestToWire) });
  });
}
