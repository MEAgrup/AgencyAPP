/**
 * POST /api/v1/attempts/{id}/not-qualified — close a Contacted attempt as Not
 * Qualified with ≥1 reason from the closed NQ taxonomy (M1-OA-8). Ports Go's
 * handleNotQualified. "[Lainnya ...]" requires free text (lainnya_text).
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{ reasons?: string[]; lainnya_text?: string }>(request);
    const result = await sales.setNotQualified(db(), actor, id, body.reasons ?? [], body.lainnya_text ?? '');
    if (!result.ok) return transitionResponse(result);
    return json({ status: result.to });
  });
}
