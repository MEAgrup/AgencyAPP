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

    // Pengukur waktu, sengaja permanen. Laporan ini pernah mati di batas 300
    // detik Vercel (504) dan diagnosanya tertahan lama justru karena log hanya
    // menyimpan status, bukan durasi — jadi "lambat" tidak bisa dibedakan dari
    // "lambat di bagian mana". `rakit` mengukur perakitan (seluruh query +
    // skor + kuadran); selisihnya terhadap `total` adalah auth, serialisasi
    // dan overhead framework. Satu baris log per permintaan, terbaca di
    // runtime log Vercel; `Server-Timing` membuat angka yang SAMA terlihat di
    // tab Network browser tanpa perlu akses log.
    const t0 = performance.now();
    const laporan = await pdt.bacaLaporanPdt(db(), actor, clientPlatformId, periode);
    const tRakit = performance.now() - t0;
    const wire = laporan.platform === 'tiktok' ? pdtLaporanTiktokToWire(laporan) : pdtLaporanShopeeToWire(laporan);
    const tTotal = performance.now() - t0;

    // eslint-disable-next-line no-console
    console.log(
      `[pdt/laporan] cp=${clientPlatformId} periode=${periode} platform=${laporan.platform}`
      + ` rakit=${tRakit.toFixed(0)}ms total=${tTotal.toFixed(0)}ms`,
    );

    const res = json(wire);
    res.headers.set('Server-Timing', `rakit;dur=${tRakit.toFixed(1)}, total;dur=${tTotal.toFixed(1)}`);
    return res;
  });
}
