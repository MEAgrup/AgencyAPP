/**
 * GET /api/v1/attempts/{id} — the full attempt detail: the attempt, its lead, the
 * persisted Qualified-form snapshot with its service lines, the whole negotiation
 * history, the not-qualified reasons, and the engine's legal next moves.
 *
 * Ports Go's handleGetAttempt, including its envelope: the detail is the response
 * body ITSELF, not wrapped under an `attempt` key — the client reads
 * `AttemptDetail.attempt`, so wrapping it nests the block one level too deep and
 * blanks the page. NotFoundError → 404 (shared error mapper).
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { attemptDetailToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const detail = await readAsActor(actor, (sql) => sales.getAttempt(sql, id));
    return json(attemptDetailToWire(detail));
  });
}
