/**
 * GET /api/v1/account/pdt/laporan/kiriman — riwayat kiriman satu toko klien
 * (Flow B langkah 5, PDT-21 Rule 23). Query: `client_platform_id` (positive
 * integer). Seluruh baris `pdt_laporan_kiriman` toko ini, terbaru dulu —
 * dipakai halaman laporan untuk tahu toko+periode yang sedang dilihat SUDAH
 * pernah dikirim (label tombol "Kirim Ulang" vs "Kirim ke Klien").
 *
 * `pdt.riwayatKirimanPdt` menegakkan gerbang izin `canKirimLaporan` sendiri
 * (sama seperti `bacaLaporanPdt`/`kirimLaporanPdt`) — route memakai `db()`
 * (koneksi service-role), pola sama `laporan/route.ts` (bukan `readAsActor`,
 * `pdt_benchmark`-nya sengaja nol policy RLS meski daftar ini sendiri tidak
 * membaca tabel itu — konsistensi dengan pemanggil PDT lain di modul ini).
 */
import { pdt } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, json } from '@/lib/http';
import { pdtKirimanRingkasToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const params = new URL(request.url).searchParams;

    const clientPlatformIdRaw = params.get('client_platform_id');
    const clientPlatformId = clientPlatformIdRaw === null ? NaN : Number(clientPlatformIdRaw);
    if (!Number.isInteger(clientPlatformId) || clientPlatformId <= 0) {
      throw new BadRequestError('client_platform_id is required (positive integer)');
    }

    const rows = await pdt.riwayatKirimanPdt(db(), actor, clientPlatformId);
    return json({ data: rows.map(pdtKirimanRingkasToWire) });
  });
}
