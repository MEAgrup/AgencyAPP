/**
 * PUT /api/v1/strategi/{id}/sanggahan — Section D-7 Sanggahan Target (Rule 19).
 *
 * Advisory: it notifies SPV + Head of Sales and is stored for the post-mortem.
 * It never lowers the contract floor — Rule 7 keeps D-1 read-only and the
 * stretch `>=` it, sanggahan or not.
 *
 * A body without `alasan` retracts an objection raised by mistake; an optional
 * field that cannot be emptied is a trap, and the audit log keeps the before
 * value either way.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiDetailToWire, strategiSanggahanFromWire } from '@/lib/wire';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const saved = await strategi.saveSanggahan(db(), actor, id, strategiSanggahanFromWire(b));
    return json(strategiDetailToWire(saved));
  });
}
