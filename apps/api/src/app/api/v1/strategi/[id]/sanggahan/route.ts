/**
 * POST /api/v1/strategi/{id}/sanggahan — Section D-7 Sanggahan Target (Rule 19).
 *
 * POST, not PUT: filing a challenge is an ACT with an actor and a timestamp, and
 * the first one notifies SPV Account + Head of Sales. Re-posting while the record
 * is still a draft corrects the text (audited as `edit_sanggahan`) and does NOT
 * notify again.
 *
 * It cannot lower the contract floor, and not by convention — nothing on this path
 * writes `strategi_target`, where `ck_strtg_stretch_gmv` lives. That is Rule 19:
 * a challenge is evidence for the post-mortem, not an escape hatch.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiDetailToWire, strategiSanggahanFromWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const saved = await strategi.raiseSanggahan(db(), actor, id, strategiSanggahanFromWire(b));
    return json(strategiDetailToWire(saved));
  });
}
