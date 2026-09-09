/**
 * /api/v1/creative/scs/summary — rekap per PIC untuk satu periode.
 *
 * ⚠️ Angka di sini BUKAN KPI dan tidak masuk Modul 14 — sama seperti
 * penyelesaian hari-sama (D5) dan Penugasan Internal. Ia memisahkan Kategori
 * standing dari deliverable dengan sengaja: menjumlahkan keduanya memberi satu
 * angka "produktivitas" yang naik hanya karena seseorang mencatat pekerjaan
 * harian yang memang selalu ada. Layar yang menampilkannya wajib menyatakannya.
 */
import { scs } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { scsPicSummaryToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const u = new URL(request.url);
    const rows = await readAsActor(actor, (sql) => scs.scsPicSummary(
      sql, actor, u.searchParams.get('dari') ?? '', u.searchParams.get('sampai') ?? '',
    ));
    return json({ rekap: rows.map(scsPicSummaryToWire) });
  });
}
