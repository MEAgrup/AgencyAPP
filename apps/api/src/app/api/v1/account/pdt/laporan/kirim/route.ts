/**
 * POST /api/v1/account/pdt/laporan/kirim — PDT G2-01, Flow B langkah 4 ("AM
 * menekan Kirim ke klien ⇒ snapshot beku ditulis ke `pdt_laporan_kiriman`",
 * PDT-21 Rule 22). Body: `{ client_platform_id, periode }` — bentuk SAMA
 * dengan query `GET /account/pdt/laporan`, dikirim sebagai JSON body karena
 * ini mutasi (menulis baris baru), bukan pembacaan.
 *
 * `pdt.kirimLaporanPdt` menghitung ULANG laporan lewat `bacaLaporanPdt`
 * (gerbang `canKirimLaporan` + pemilihan platform sudah ditegakkan di sana)
 * lalu membekukan hasilnya. Kirim kedua untuk toko+periode yang sama BUKAN
 * error — itu kirim-ulang/revisi (Flow B langkah 5): baris baru menunjuk
 * kiriman sebelumnya lewat `menggantikan_kiriman_id`, TIDAK meminta berkas
 * ulang ke AM (Rule 23).
 *
 * `db()` (service-role), pola sama `GET /account/pdt/laporan` — `pdt_benchmark`
 * sengaja NOL policy RLS, dan `pdt_laporan_kiriman` sendiri nol policy INSERT
 * untuk `authenticated` (gerbang izin ditegakkan manual di domain, bukan RLS).
 */
import { pdt } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, json } from '@/lib/http';
import { pdtLaporanKirimanToWire } from '@/lib/wire';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);

    const body = (await request.json().catch(() => ({}))) as {
      client_platform_id?: unknown;
      periode?: unknown;
    };
    const clientPlatformId = typeof body.client_platform_id === 'number' ? body.client_platform_id : NaN;
    if (!Number.isInteger(clientPlatformId) || clientPlatformId <= 0) {
      throw new BadRequestError('client_platform_id is required (positive integer)');
    }

    const periode = body.periode;
    if (typeof periode !== 'string' || periode === '') {
      throw new BadRequestError('periode is required (YYYY-MM-01)');
    }

    const hasil = await pdt.kirimLaporanPdt(db(), actor, clientPlatformId, periode);

    return json(pdtLaporanKirimanToWire(hasil));
  });
}
