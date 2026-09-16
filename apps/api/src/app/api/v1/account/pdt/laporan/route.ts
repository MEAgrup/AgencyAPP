/**
 * GET /api/v1/account/pdt/laporan — PDT G2-01 lanjutan, Flow B langkah 1
 * ("AM membuka laporan periode X → laporan dirender dari view atas fakta",
 * PDT-21 Rule 21). Query: `client_platform_id` (positive integer) +
 * `periode` (`YYYY-MM-01`, awal bulan).
 *
 * `pdt.bacaLaporanPdt` menentukan platform toko dari `client_platforms`
 * sendiri (bukan dari query param) dan memilih `rakitLaporanTiktok`/
 * `rakitLaporanShopee`. Gerbang izin `canKirimLaporan` — ditegakkan DI DALAM
 * domain (bukan RLS): `pdt_benchmark` sengaja NOL policy RLS ("dibaca/
 * ditulis HANYA service-role saat menskor", migrasi G1-01), jadi route ini
 * memakai `db()` (koneksi service-role, sama pola `commitUploadBatch`), BUKAN
 * `readAsActor` — RLS akan mengosongkan `pdt_benchmark` kalau dipakai di sini.
 *
 * **v1 SENGAJA sempit** (keputusan pemilik, `docs/DECISIONS.md`): payload
 * hanya KPI ringkas + skor. Sepuluh bagian mesin laporan lama lainnya (kanal,
 * iklan, live, video, produk, afiliasi, tokopedia, ads_manager, tahap,
 * insight) belum ada di sini.
 */
import { pdt } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, json } from '@/lib/http';
import { pdtLaporanShopeeToWire, pdtLaporanTiktokToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const params = new URL(request.url).searchParams;

    const clientPlatformIdRaw = params.get('client_platform_id');
    const clientPlatformId = clientPlatformIdRaw === null ? NaN : Number(clientPlatformIdRaw);
    if (!Number.isInteger(clientPlatformId) || clientPlatformId <= 0) {
      throw new BadRequestError('client_platform_id is required (positive integer)');
    }

    const periode = params.get('periode');
    if (periode === null || periode === '') {
      throw new BadRequestError('periode is required (YYYY-MM-01)');
    }

    const laporan = await pdt.bacaLaporanPdt(db(), actor, clientPlatformId, periode);
    const wire = laporan.platform === 'tiktok' ? pdtLaporanTiktokToWire(laporan) : pdtLaporanShopeeToWire(laporan);

    return json(wire);
  });
}
