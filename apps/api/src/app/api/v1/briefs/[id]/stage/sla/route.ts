/**
 * POST /api/v1/briefs/{id}/stage/sla — override one stage's target hari kerja
 * for this Brief (M16 §2 Rule 7). Body: { stage_code, target_hari_kerja }.
 * Gate: isLead(division) — pola `task.setSlaTarget` (M12 §5.3).
 */
import { stage } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ stage_code?: string; target_hari_kerja?: number }>(request);
    await stage.setStageSlaTarget(db(), actor, id, (b.stage_code ?? '').trim(), Number(b.target_hari_kerja ?? 0));
    return json({ ok: true });
  });
}
