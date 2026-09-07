/**
 * GET /api/v1/clients/{id}/assets — the client's `[Approved]` Creative Assets,
 * newest approval first. This is what the Ads Asset picker reads (B-5 / K-3).
 *
 * Optional `?source_brief=BRF-…` narrows the list to ONE source Creative Brief
 * (K-3: the Ads Brief points at the Creative Brief it came from). Absent or
 * empty ⇒ every approved Asset of the client, which is the deliberate fallback:
 * a narrowed picker that silently shows nothing sends people back to the
 * spreadsheet.
 *
 * Runs on the service-role client (`db()`), NOT `readAsActor` — the domain
 * evaluates `canSeeAsset` against the client's owning AM BEFORE reading a single
 * Asset row, and the `services`→`clients` join this read needs has no
 * execution-division RLS arm, so under RLS it would return zero rows for exactly
 * the divisions that need it (the O52 trap; same reasoning as
 * `GET /assets/mine`). Returns `{ data: ClientAssetOptionWire[] }`.
 */
import { creative } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { clientAssetOptionToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const sourceBrief = new URL(request.url).searchParams.get('source_brief') ?? '';
    const rows = await creative.listApprovedAssetsForClient(db(), actor, id, sourceBrief);
    return json({ data: rows.map(clientAssetOptionToWire) });
  });
}
