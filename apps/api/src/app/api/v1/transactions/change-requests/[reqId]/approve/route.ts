/**
 * POST /api/v1/transactions/change-requests/{reqId}/approve — the Director's
 * ACC, the step that makes a filed transaction change real (M5-OA-7, owner
 * decision 2026-08-04).
 *
 * Director only: SPV/Head Finance files, a Director actions — anyone else gets
 * 403 with the verbatim BI message. The optional `note` is stored on the
 * request as `decision_note`.
 *
 * Everything is re-derived at this moment rather than trusted from the filing:
 * if a payment landed while it waited, the filed schedule no longer equals
 * Amount Outstanding and the ACC answers 400 with
 * `[total jadwal penagihan tidak sama dengan kekurangan pembayaran]`, leaving
 * the request pending instead of applying stale numbers. An already-decided
 * request answers 409 `[pengajuan perubahan sudah diputuskan]`.
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
    const req = await finance.approveSchemeChange(db(), actor, reqId, body.note ?? '');
    return json({ request: schemeChangeRequestToWire(req) });
  });
}
