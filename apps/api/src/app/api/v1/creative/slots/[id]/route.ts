/**
 * /api/v1/creative/slots/{id} — satu slot produksi.
 *
 * GET satu baris + angka turunannya (sisa, penyelesaian %).
 * PUT ubah RENCANA-nya. `actual_qty` TIDAK punya jalur di sini — ia bergerak
 *     lewat `/actual`, dengan gerbangnya sendiri (PIC slot itu atau lead).
 *     Memisahkannya adalah yang membuat angka HASIL tidak bisa diubah lewat
 *     pintu RENCANA.
 *
 * PUT juga bisa menjawab 200 dengan `peringatan` — lihat POST /creative/slots.
 */
import { dailyops } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { slotSaveResultToWire, slotToWire, toSlotInput } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const row = await readAsActor(actor, (sql) => dailyops.getSlot(sql, actor, id));
    return json(slotToWire(row));
  });
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Parameters<typeof toSlotInput>[0]>(request);
    const r = await dailyops.updateSlot(db(), actor, id, toSlotInput(b ?? {}));
    return json(slotSaveResultToWire(r));
  });
}
