/**
 * GET /api/v1/strategi/{id}/prefill — what the client's completed Interview
 * hands to this Strategi (Blok D / RAB-09): the verdict-driven handoff flags plus
 * the concrete Section A/C/E prefill suggestions. Returns `null` when the client
 * has no scored, completed interview yet, so the form simply shows nothing.
 *
 * Suggestions only — the AM accepts each value through the normal Section editors
 * (M6A "usulan → konfirmasi"); this route writes nothing.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { strategiPrefillToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const prefill = await strategi.getStrategiPrefill(db(), actor, id);
    return json(prefill === null ? null : strategiPrefillToWire(prefill));
  });
}
