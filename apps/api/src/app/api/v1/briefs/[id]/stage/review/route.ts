/**
 * POST /api/v1/briefs/{id}/stage/review — Cek Brief AM (M16 §2 Rule 10): the
 * target division accepts the Brief ("Diterima", advances the pipeline one
 * edge) or returns it to the AM ("Dikembalikan" + structured `alasan_kode`,
 * dead-ends at `Brief Dikembalikan ke AM`). Body: { keputusan, alasan_kode?,
 * catatan? }. Division staff/lead or Director; one-time (a second review on
 * the same Brief is a 409).
 */
import { stage } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { toReviewInput } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ keputusan?: string; alasan_kode?: string; catatan?: string }>(request);
    await stage.reviewBrief(db(), actor, id, toReviewInput(b));
    return json({ ok: true });
  });
}
