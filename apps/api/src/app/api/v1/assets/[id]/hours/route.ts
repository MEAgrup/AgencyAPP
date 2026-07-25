/**
 * POST /api/v1/assets/{id}/hours — log the Asset's manual Hours Logged (M7 §5
 * Rule 2). Assigned PIC (self-report), Creative lead, or Director; must be > 0.
 * Body: { hours }. Ports Go's handleLogHours.
 */
import { creative } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ hours?: number }>(request);
    await creative.logHours(db(), actor, id, b.hours ?? 0);
    return json({ id, hours_logged: b.hours ?? 0 });
  });
}
