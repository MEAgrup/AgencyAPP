/**
 * PUT /api/v1/strategi/{id}/narasi — the four Section E/H paragraph fields:
 * E-1 growth thesis · E-13 execution-order rationale · H-3 fallback scenario ·
 * H-4 stop/scope-change conditions.
 *
 * The rest of Sections E and H are child rows and have their own endpoints
 * (`/pillars` for E-3…E-11, `/risks` for H-1). These four are the paragraphs
 * those rows cannot hold, so they live on the header and save together.
 *
 * A partial body is legal — this is the autosave door (§7), and the submit gate
 * (`GET /strategi/{id}/kekurangan`) is what reports `E-1` / `E-13` / `H-3` as
 * still missing. H-4 is `O` and never gated.
 *
 * ⚠️ `kondisi_stop_scope` (H-4) is §4.1 **hard-internal**. This body serves the
 * INTERNAL app only; the client-facing `/s/{token}` renderer (A-11) is a separate
 * serialiser that applies the visibility filter before serialising and must never
 * reuse this shape.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiDetailToWire, strategiNarasiFromWire } from '@/lib/wire';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const saved = await strategi.saveNarasi(db(), actor, id, strategiNarasiFromWire(b));
    return json(strategiDetailToWire(saved));
  });
}
