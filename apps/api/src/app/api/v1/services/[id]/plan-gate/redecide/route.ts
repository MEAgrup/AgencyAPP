/**
 * POST /api/v1/services/{id}/plan-gate/redecide — change a recorded G-B decision.
 *
 * Two directions, deliberately NOT symmetric (M6C Rules 11 & 12):
 *   - escalation (`tanpa_plan` → `butuh_plan`): open to the owning AM, always
 *     available, forward-only;
 *   - de-escalation (`butuh_plan` → `tanpa_plan`): SPV/Head Account only, because
 *     it is the action that erases an accountability record — and it must carry
 *     the GB-8 assignment summary so the work does not become invisible.
 *
 * The authority split is enforced in the domain, not here; this route only
 * carries the body across.
 */
import { plangate } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { assignmentSummaryFromWire, planGateToWire } from '@/lib/wire';

interface RedecideBody {
  keputusan_am?: plangate.GateDecision;
  alasan?: string;
  ringkasan_penugasan?: unknown | null;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<RedecideBody>(request);
    const gate = await plangate.redecideGate(
      db(),
      actor,
      id,
      b.keputusan_am ?? 'butuh_plan',
      b.alasan ?? '',
      assignmentSummaryFromWire(b.ringkasan_penugasan ?? null),
    );
    return json(planGateToWire(gate));
  });
}
