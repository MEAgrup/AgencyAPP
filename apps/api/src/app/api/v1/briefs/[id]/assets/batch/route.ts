/**
 * /api/v1/briefs/{id}/assets/batch — fan out a Creative Brief by QUANTITY per PIC
 * (M7 §3 Rule 4: "a 12-video Brief split between two Videographers").
 *
 * POST: one `rows` line per PIC with how many units they take; the server
 * allocates the Sequence #s from the Brief's free slots (§9.3) inside a single
 * transaction, so the whole batch either lands or nothing does. Same gate as the
 * single-Asset door (`../route.ts`): Creative staff/lead or Director.
 *
 * TS-only door (no Go oracle counterpart) — DECISIONS 2026-08-14 "Fan-out Asset
 * per kuantitas".
 */
import { creative } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { assetToWire, toAssetAssignments, type AssetAssignmentWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ rows?: AssetAssignmentWire[] }>(request);
    const assets = await creative.createAssetBatch(db(), actor, id, toAssetAssignments(b.rows));
    return json({ data: assets.map(assetToWire) });
  });
}
