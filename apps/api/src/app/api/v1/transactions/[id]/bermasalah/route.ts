/**
 * /api/v1/transactions/{id}/bermasalah — M5 §5 Rule 5 / M5-OA-5.
 *
 * GET  — the dispute flag, the votes cast in the CURRENT cycle, and whether the
 *        case is escalated (both SPVs voted and disagree, no Director ruling).
 *        Ports Go's handleGetBermasalah. Visibility follows the Transaction read,
 *        so it 404s exactly where GET /transactions/{id} does.
 * POST — Admin & Finance raises the flag (a verified payment was disputed or
 *        reversed), opening the joint-resolution cycle. Does not change Payment
 *        Status. Ports Go's handleFlagBermasalah.
 *
 * Two shape defects fixed here (O43 class, both silently fatal):
 *   - POST read the reason from `note`, while web-internal sends `reason`
 *     (`flagBermasalah` in lib/finance.ts). The field was therefore ALWAYS empty
 *     and the endpoint answered the mandatory-field BI message on every call —
 *     the flag could not be raised at all. `note` is still accepted as a fallback
 *     so any other caller keeps working.
 *   - POST answered `{ok:true}` where the client reads `{status}`.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { bermasalahStatusToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const status = await readAsActor(actor, (sql) => finance.bermasalahStatus(sql, actor, id));
    return json(bermasalahStatusToWire(status));
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ reason?: string; note?: string }>(request);
    await finance.flagBermasalah(db(), actor, id, b.reason ?? b.note ?? '');
    return json({ status: 'ok' });
  });
}
