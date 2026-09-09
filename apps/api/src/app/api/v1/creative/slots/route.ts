/**
 * /api/v1/creative/slots — buat satu slot produksi (M19 Flow A).
 *
 * Jawabannya **201 dengan `peringatan`**, bukan 4xx, kalau studionya bertumpang
 * atau PIC-nya sedang tidak ada (Rule 8/9, ketokan D3/D4). Itu bukan validasi
 * yang longgar: Leader menerima tumpang-tindih dengan sadar, dan sistem yang
 * memblokirnya akan dilewati dengan mencatat jadwal di luar sistem — persis
 * keadaan yang modul ini ada untuk mengakhiri.
 *
 * Yang TETAP 400: field wajib kosong, `target_qty <= 0`, studio/jenis task tak
 * dikenal, rentang waktu terbalik.
 */
import { dailyops } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { slotSaveResultToWire, toSlotInput } from '@/lib/wire';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<Parameters<typeof toSlotInput>[0]>(request);
    const r = await dailyops.createSlot(db(), actor, toSlotInput(b ?? {}));
    return json(slotSaveResultToWire(r), 201);
  });
}
