/**
 * POST /api/v1/sessions/{id}/flag-discrepancy — [Completed] → [Discrepancy Flagged]
 * (M10 §4 Rule 3), with mandatory Reconciliation Notes. Non-blocking: the Session
 * may still reach [Reconciled] later. Emits the SPV-Account notification (M10-OA-3)
 * atomically. Owning AM / Director. Ports Go's handleFlagDiscrepancy.
 */
import { livestream } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

interface Body {
  notes?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const result = await livestream.flagDiscrepancy(db(), actor, id, b.notes ?? '');
    return transitionResponse(result);
  });
}
