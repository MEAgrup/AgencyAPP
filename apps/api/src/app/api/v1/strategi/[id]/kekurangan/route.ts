/**
 * GET /api/v1/strategi/{id}/kekurangan — everything still blocking submit.
 *
 * §5 step 5 asks the form to show "a live count of unmet required fields". A
 * gate that reports only its first failure turns a hundred-field form into a
 * hundred round-trips, so this returns the whole list; `POST .../submit` applies
 * the same check and refuses.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { strategiKekuranganToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    // The read gate is the same one `getStrategi` applies — asking "what is
    // missing" is asking about the record's contents.
    await strategi.getStrategi(db(), actor, id);
    const missing = await strategi.checkCompleteness(db(), id);
    return json(missing.map(strategiKekuranganToWire));
  });
}
