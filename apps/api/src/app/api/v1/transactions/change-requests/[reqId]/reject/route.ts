/**
 * POST /api/v1/transactions/change-requests/{reqId}/reject — the Director
 * refusing a filed transaction change (M5-OA-7). Same Director gate as
 * `approve`; the Transaction is left exactly as it was and the requester is
 * notified through the same event, so both verdicts reach them the same way.
 * An already-decided request answers 409 `[pengajuan perubahan sudah
 * diputuskan]`.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { schemeChangeRequestToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ reqId: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { reqId } = await ctx.params;
    const body = await readJson<{ note?: string }>(request);
    const req = await finance.rejectSchemeChange(db(), actor, reqId, body.note ?? '');
    return json({ request: schemeChangeRequestToWire(req) });
  });
}
