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
 * **Isi payload (per 2026-09-22).** Docblock ini dulu menulis "v1 SENGAJA
 * sempit: payload hanya KPI ringkas + skor" — itu sudah tidak benar sejak
 * LAPORAN-GRAFIK-1/LAPORAN-PARITAS-HTML/KUADRAN-SHOPEE/KEDALAMAN-JELAJAH
 * (`docs/DECISIONS.md`). Yang dikirim sekarang: `kpi` (termasuk kedalaman
 * jelajah), `harian`, `kanal`, `iklan`, `kampanye`, `live`, `sesi_live`,
 * `video`, `produk` (kuadran KEDUA platform + mode relatif + funnel per
 * produk), `afiliasi`, `kreator`, `promo` dan `layanan` (Shopee),
 * `tahap` (TikTok), `skor`, `insight`.
 *
 * Yang MASIH belum ada, dan alasannya ada di `docs/DECISIONS.md`, bukan
 * "belum sempat": voucher (nol modul parser), cancel rate & retur (nol kolom
 * di `pdt_fact_shop_daily`), dan Tokopedia (nol modul, nol baris fakta).
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
