/**
 * /api/v1/creative/schedule/{tanggal} — jadwal produksi satu hari (M19 §5.6).
 *
 * Bentuknya sudah ter-grup per studio di domain, termasuk studio yang NOL slot
 * hari itu: kolom kosong adalah informasi ("ruangan itu bebas"), dan grid yang
 * hanya menampilkan studio ber-slot menyembunyikan kapasitas kosong justru saat
 * Leader sedang mencari tempat.
 *
 * Dibaca lewat `readAsActor` supaya RLS yang memikul scope baris: lead Creative
 * se-divisi, staff hanya barisnya sendiri, OD/Director di mana pun.
 */
import { dailyops } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { dayScheduleToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ tanggal: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { tanggal } = await ctx.params;
    const d = await readAsActor(actor, (sql) => dailyops.daySchedule(sql, actor, tanggal));
    return json(dayScheduleToWire(d));
  });
}
