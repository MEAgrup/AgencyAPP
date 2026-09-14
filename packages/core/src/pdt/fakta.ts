/**
 * PDT (Pusat Data Toko) — baris fakta tertipe (G1-09 sub-langkah 2b-ii, PRD
 * Flow A langkah 6 "tulis baris fakta sesuai whitelist", Rule 8).
 *
 * Fungsi murni saja — nol I/O, nol DB. Pemanggil (`commitUploadBatch`,
 * `packages/domain/src/pdt.ts`) yang menulis `pdt_fact_ads`/`pdt_fact_content`.
 *
 * **Modul KEDUA (sesi ini): `tt_video` → `pdt_fact_content`** (lihat
 * `ekstrakBarisTtVideo` di bawah). Beda dari `pdt_fact_ads` — kunci unik
 * `pdt_fact_content` (`client_platform_id, platform_content_id`) TIDAK
 * pernah punya komponen NULL (`ID Video` selalu ada untuk baris yang
 * ditulis), jadi pemanggil bisa memakai `ON CONFLICT ... DO UPDATE`
 * sungguhan di sini — beda dari `pdt_fact_ads` yang harus delete-then-
 * insert karena `sku_id`/`content_id` selalu NULL.
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

/**
 * Satu baris `pdt_fact_content` mentah dari `tt_video`, SEBELUM
 * `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil yang
 * melengkapi). `waktuPosting`/`skuId` SENGAJA tidak ada field-nya di sini —
 * lihat docblock `ekstrakBarisTtVideo` untuk kenapa keduanya tetap NULL di
 * pemanggil, bukan dihitung di sini.
 */
export interface PdtBarisContentTtVideo {
  platformContentId: string;
  creatorPlatformId: string | null;
  creatorHandle: string | null;
  /** `true` bila `creatorPlatformId` ada di `akunKontenToko` klien (Rule 3-4 pola sama `validasiIdentitasTiktok`, tapi PER BARIS bukan verdict file). Selalu `false` (bukan `null`) bila `akunKontenToko` belum terikat — kolom DB `NOT NULL DEFAULT false`. */
  isAkunToko: boolean;
  vv: number | null;
  likes: number | null;
  dibagikan: number | null;
  klikProduk: number | null;
  gmv: number | null;
}

/**
 * Ekstrak seluruh baris data `tt_video` (Rule 8 whitelist `modules.ts`:
 * `['ID Kreator', 'ID Video', 'Waktu', 'Produk', 'VV', 'Likes', 'Dibagikan',
 * 'Klik Produk', 'Nama Kreator', 'Informasi Video', 'GPM (Rp)', 'GMV dari
 * video (Rp)']`). Baris ber-`ID Video` kosong dilewati (bukan baris data
 * sungguhan — cermin `baseline/metrik.ts` `video()`:
 * `.filter(r => r['ID Video'] != null || r['Informasi Video'] != null)`,
 * disederhanakan ke `ID Video` saja karena itulah `platform_content_id`,
 * NOT NULL di skema).
 *
 * **`waktu_posting`/`sku_id` TIDAK ada di hasil fungsi ini** (pemanggil
 * SELALU menulis NULL untuk keduanya, sama pola `sku_id` di
 * `ekstrakBarisShopeeAdsLive`):
 *  - `sku_id` (FK `pdt_sku_master`, dari kolom `Produk`) — SKU master belum
 *    dibangun, sama alasan `shopee_ads_cpc` belum dipetakan.
 *  - `waktu_posting` — nol parser TERVERIFIKASI untuk format kolom `Waktu`
 *    modul ini di seluruh repo (beda dari `Waktu Live` milik `tt_live`, yang
 *    PUNYA parser terverifikasi `report/metrik.ts` `parseWaktuLive`). Satu
 *    petunjuk PARSIAL ditemukan: `baseline/metrik.ts` `video()` mencocokkan
 *    `waktu.startsWith(tahun + '/' + bulan)` (prefix `YYYY/MM`) untuk filter
 *    periode — cukup untuk MENYIMPULKAN awalan formatnya, TIDAK cukup untuk
 *    parser timestamp penuh (hari/jam/menit sesudahnya belum pernah
 *    diverifikasi). Menebak sisanya persis kelas kesalahan
 *    `G1-06-PERIODE-TIKTOK` sudah peringatkan — dicatat `docs/DECISIONS.md`
 *    sebagai Open, bukan ditebak.
 *
 * Angka: `parsePdtAngka(v)` TANPA `raw` — konvensi **Seller Center** (titik
 * ribuan, koma desimal), BEDA dari `shopee_ads_live` (Ads Manager) — cermin
 * `baseline/metrik.ts` `video()`, yang memanggil `n(r['VV'])` dkk TANPA flag
 * `raw` (lihat docblock `baseline/angka.ts` `n(v,raw)` untuk kontras kedua
 * konvensi).
 */
export function ekstrakBarisTtVideo(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
  akunKontenToko: readonly string[] | null,
): PdtBarisContentTtVideo[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iIdVideo = idx('ID Video');
  const iIdKreator = idx('ID Kreator');
  const iNamaKreator = idx('Nama Kreator');
  const iVv = idx('VV');
  const iLikes = idx('Likes');
  const iDibagikan = idx('Dibagikan');
  const iKlikProduk = idx('Klik Produk');
  const iGmv = idx('GMV dari video (Rp)');

  const hasil: PdtBarisContentTtVideo[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const platformContentId = iIdVideo === -1 ? '' : String(row?.[iIdVideo] ?? '').trim();
    if (platformContentId === '') continue;
    const creatorPlatformId = iIdKreator === -1 ? null : (String(row?.[iIdKreator] ?? '').trim() || null);
    hasil.push({
      platformContentId,
      creatorPlatformId,
      creatorHandle: iNamaKreator === -1 ? null : (String(row?.[iNamaKreator] ?? '').trim() || null),
      isAkunToko: creatorPlatformId != null && akunKontenToko != null && akunKontenToko.includes(creatorPlatformId),
      vv: iVv === -1 ? null : parsePdtAngka(row?.[iVv]),
      likes: iLikes === -1 ? null : parsePdtAngka(row?.[iLikes]),
      dibagikan: iDibagikan === -1 ? null : parsePdtAngka(row?.[iDibagikan]),
      klikProduk: iKlikProduk === -1 ? null : parsePdtAngka(row?.[iKlikProduk]),
      gmv: iGmv === -1 ? null : parsePdtAngka(row?.[iGmv]),
    });
  }
  return hasil;
}
