/**
 * POST /api/v1/plan/{id}/briefs — RAB-16 "satu klik, warisi semua".
 *
 * From an Aktif Plan period, descend every eligible `plan_row` into a Brief for
 * its divisi PIC. The AM supplies only jatuh tempo + prioritas per row (`fills`);
 * the rest is inherited. This route is a shell: `requireActor` → map body
 * snake→camel → `inheritBriefsFromPlan`. The write scope, Aktif gate, service
 * resolution, per-row skip reasons, idempotency, and the Service [Briefed] advance
 * all live in the domain. Response body is snake_case via `wire.ts` — the created
 * Briefs through `briefToWire`, so a page never sees a raw domain object (O43).
 */
import { briefInherit } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { briefInheritResultToWire } from '@/lib/wire';

interface InheritBody {
  fills?: { plan_row_id?: number; due_date?: string; priority?: string }[];
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<InheritBody>(request);
    const fills: briefInherit.BriefInheritFill[] = (body.fills ?? []).map((f) => ({
      planRowId: Number(f.plan_row_id),
      dueDate: f.due_date ?? '',
      priority: f.priority ?? '',
    }));
    const result = await briefInherit.inheritBriefsFromPlan(db(), actor, id, fills);
    return json(briefInheritResultToWire(result));
  });
}
