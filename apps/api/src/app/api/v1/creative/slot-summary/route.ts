/**
 * /api/v1/creative/slot-summary — penyelesaian hari-sama per PIC, satu periode
 * (`?dari=YYYY-MM-DD&sampai=YYYY-MM-DD`).
 *
 * ⚠️ ANGKA OPERASIONAL LEADER, BUKAN KPI (ketokan D5). Ia TIDAK masuk Modul 14
 * dan tidak punya bobot. Ia mengukur "apakah yang dijadwalkan hari itu selesai
 * hari itu"; Speed Score M12 mengukur SLA turnaround multi-hari per Asset. Dua
 * pertanyaan berbeda, dua tempat berbeda — dan satu angka yang mengukur
 * dua-duanya tidak mengukur apa pun.
 *
 * Persentase bisa `null` saat penyebutnya nol; halaman merendernya '—', bukan
 * 0% (aturan rumah #7).
 */
import { dailyops } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { picSameDayToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const u = new URL(request.url);
    const dari = u.searchParams.get('dari') ?? '';
    const sampai = u.searchParams.get('sampai') ?? '';
    const rows = await readAsActor(actor, (sql) =>
      dailyops.sameDaySummary(sql, actor, dari, sampai));
    return json({ data: rows.map(picSameDayToWire) });
  });
}
