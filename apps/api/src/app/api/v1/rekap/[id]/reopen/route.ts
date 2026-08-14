/**
 * POST /api/v1/rekap/{id}/reopen — `Ditutup Otomatis → Terbuka` (RM-5). Head of
 * Account only (`canReopenRecap`; the owning AM cannot erase their own
 * force-close). A reason is mandatory and logged; the permanent
 * `pernah_ditutup_otomatis` flag is never cleared. Body: `{ alasan }`.
 */
import { recap } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { recapToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ alasan?: unknown }>(request);
    const alasan = b.alasan === undefined || b.alasan === null ? '' : String(b.alasan);
    const reopened = await recap.reopenRecap(db(), actor, id, alasan);
    return json(recapToWire(reopened));
  });
}
