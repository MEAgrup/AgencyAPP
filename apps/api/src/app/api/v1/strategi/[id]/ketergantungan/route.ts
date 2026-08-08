/**
 * PUT /api/v1/strategi/{id}/ketergantungan — E-12, what the client must supply
 * during execution: what, when, and the consequence of being late.
 *
 * Deliberately NOT the same endpoint as C-7 (`/diagnosa` carries
 * `prasyarat_klien`). C-7 is the gate list before execution starts; E-12 is the
 * running dependency, and `konsekuensi` is the field that separates them. One
 * endpoint for both would make the two lists interchangeable in the UI, which is
 * exactly how one of them would end up empty.
 *
 * Body is the new state, not a patch: an empty array clears the list, and the
 * submit gate (`GET /strategi/{id}/kekurangan`) reports `E-12` as still missing.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiDetailToWire, strategiKetergantunganFromWire } from '@/lib/wire';

/** Wrapped in a named key like every other list endpoint here (`pillars`, `risks`). */
interface Body {
  ketergantungan?: unknown;
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const saved = await strategi.saveKetergantungan(db(), actor, id, strategiKetergantunganFromWire(b.ketergantungan ?? []));
    return json(strategiDetailToWire(saved));
  });
}
