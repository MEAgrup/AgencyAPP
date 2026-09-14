/**
 * PDT (Pusat Data Toko) — baris fakta tertipe (G1-09 sub-langkah 2b-ii, PRD
 * Flow A langkah 6 "tulis baris fakta sesuai whitelist", Rule 8).
 *
 * Fungsi murni saja — nol I/O, nol DB. Pemanggil (`commitUploadBatch`,
 * `packages/domain/src/pdt.ts`) yang menulis `pdt_fact_ads`.
 *
 * **`shopee_ads_live` adalah modul PERTAMA yang dipetakan ke tabel fakta**
 * (bukti pola sebelum digeneralisasi ke 24 modul lain — `docs/handoff/
 * HANDOFF_PDT_SESI13.md` §1 butir 1). Dipilih dari ketiga modul iklan Shopee
 * karena SATU-SATUNYA yang tidak butuh `pdt_sku_master` (belum dibangun,
 * pekerjaan terpisah) untuk kunci unik barisnya: `ID Iklan` sendiri sudah
 * unik per baris per periode (satu baris = satu kampanye live), jadi
 * `(client_platform_id, sumber, kampanye_id, sku_id=NULL, content_id=NULL,
 * periode)` (`uq_pdt_fact_ads`, migrasi G1-01) adalah kunci yang SAH tanpa
 * perlu resolusi SKU apa pun.
 *
 * `shopee_ads_cpc`/`shopee_ads_search` SENGAJA BELUM dipetakan di sini —
 * dicatat `docs/DECISIONS.md` (G1-09-2BII-ADS-CPC/G1-09-2BII-ADS-SEARCH):
 *  - `shopee_ads_cpc`: baris PER PRODUK (`Kode Produk`, PDT_KOLOM_DIPANEN.md
 *    §2.3: "konsumen: pdt_fact_ads.sku_id") — tapi `sku_id` (FK ke
 *    `pdt_sku_master`) tidak bisa diisi sampai SKU master ada. Memakai
 *    `nama iklan` sebagai `kampanye_id` sementara `sku_id` tetap NULL akan
 *    membuat produk BERBEDA di bawah kampanye/periode yang sama saling
 *    menimpa (kunci unik kolaps) — persis kelas bug Rule 13-16 dibangun
 *    untuk mencegah, bukan cuma di rekonsiliasi.
 *  - `shopee_ads_search`: `kolomDipanen` (`modules.ts`) hanya `['klik',
 *    'konversi']` (bucket 3 `Kata Pencarian`/`SOV` DITAHAN, Q-6) — nol
 *    `biaya` (NOT NULL di skema) dan nol identitas kampanye/produk. Tidak
 *    ada baris `pdt_fact_ads` yang SAH bisa ditulis dari whitelist ini hari
 *    ini sama sekali.
 *
 * Angka: `parsePdtAngka(v, true)` — konvensi **Ads Manager** (titik desimal,
 * koma ribuan), BUKAN konvensi Seller Center (`angka.ts` docblock) — cermin
 * `report/shopee/metrik.ts` `parseAdsLive`/`pn(r[ci], true)`, satu-satunya
 * pembaca TERVERIFIKASI untuk bentuk berkas ini sebelum PDT ada.
 */
import { parsePdtAngka } from './angka';

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

/** Satu baris `pdt_fact_ads` mentah dari `shopee_ads_live`, SEBELUM `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil yang melengkapi — sama seperti fungsi lain di paket ini, murni tidak tahu konteks batch). */
export interface PdtBarisAdsShopeeLive {
  kampanyeId: string;
  tayangan: number | null;
  pesananSku: number | null;
  gmv: number | null;
  biaya: number;
  roas: number | null;
}

/**
 * Ekstrak seluruh baris data `shopee_ads_live` (Rule 8 whitelist `modules.ts`:
 * `['ID Iklan', 'Penonton', 'Pesanan', 'Omzet', 'Biaya', 'Efektifitas Iklan']`
 * — tidak ada `klik` di modul ini, beda dari `shopee_ads_cpc`). Baris ber-
 * `ID Iklan` kosong dilewati (bukan baris data sungguhan — cermin
 * `parseAdsLive` legacy: `if (!nama) continue;`).
 */
export function ekstrakBarisShopeeAdsLive(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisAdsShopeeLive[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iKampanye = idx('ID Iklan');
  const iTayangan = idx('Penonton');
  const iPesanan = idx('Pesanan');
  const iGmv = idx('Omzet');
  const iBiaya = idx('Biaya');
  const iRoas = idx('Efektifitas Iklan');

  const hasil: PdtBarisAdsShopeeLive[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const kampanyeId = iKampanye === -1 ? '' : String(row?.[iKampanye] ?? '').trim();
    if (kampanyeId === '') continue;
    hasil.push({
      kampanyeId,
      tayangan: iTayangan === -1 ? null : parsePdtAngka(row?.[iTayangan], true),
      pesananSku: iPesanan === -1 ? null : parsePdtAngka(row?.[iPesanan], true),
      gmv: iGmv === -1 ? null : parsePdtAngka(row?.[iGmv], true),
      biaya: iBiaya === -1 ? 0 : parsePdtAngka(row?.[iBiaya], true),
      roas: iRoas === -1 ? null : parsePdtAngka(row?.[iRoas], true),
    });
  }
  return hasil;
}
