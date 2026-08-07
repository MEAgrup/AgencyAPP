/**
 * POST /api/v1/transactions/change-requests/{reqId}/cancel — the requester
 * withdrawing their own filing before a Director rules on it (M5-OA-7).
 *
 * Only the requester (or a Director) may cancel: otherwise one SPV could clear
 * another's pending filing out of the way and file their own against the same
 * money. Cancelling is not a verdict, so nobody is notified — it only frees the
 * one-pending-per-transaction slot. An already-decided request answers 409.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { schemeChangeRequestToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ reqId: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { reqId } = await ctx.params;
    const req = await finance.cancelSchemeChange(db(), actor, reqId);
    return json({ request: schemeChangeRequestToWire(req) });
  });
}
