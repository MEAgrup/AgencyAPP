/**
 * PDT (Pusat Data Toko) — baris fakta tertipe (G1-09 sub-langkah 2b-ii, PRD
 * Flow A langkah 6 "tulis baris fakta sesuai whitelist", Rule 8).
 *
 * Fungsi murni saja — nol I/O, nol DB. Pemanggil (`commitUploadBatch`,
 * `packages/domain/src/pdt.ts`) yang menulis `pdt_fact_ads`/`pdt_fact_content`.
 *
 * **Modul KEDUA: `tt_video` → `pdt_fact_content`** (lihat `ekstrakBarisTtVideo`
 * di bawah). Beda dari `pdt_fact_ads` — kunci unik `pdt_fact_content`
 * (`client_platform_id, platform_content_id`) TIDAK pernah punya komponen
 * NULL (`ID Video` selalu ada untuk baris yang ditulis), jadi pemanggil bisa
 * memakai `ON CONFLICT ... DO UPDATE` sungguhan di sini — beda dari
 * `pdt_fact_ads` yang harus delete-then-insert karena `sku_id`/`content_id`
 * selalu NULL.
 *
 * **Modul KETIGA (sesi ini): `shopee_parent_sku` + `tt_orders` →
 * `pdt_sku_master`** (lihat `ekstrakBarisSkuMasterShopeeParentSku`/
 * `ekstrakBarisSkuMasterTtOrders` di bawah). Kandidat sebelumnya
 * (`shopee_live`/`shopee_video`, direkomendasikan `HANDOFF_PDT_SESI16.md`)
 * TERNYATA BLOCKED begitu diinvestigasi — `shopee_live` punya kelas blocker
 * SAMA seperti `tt_live` (nol kolom identitas sesi live terverifikasi;
 * `Informasi Streaming` adalah judul bebas, bukan ID stabil — lihat
 * `docs/DECISIONS.md` G1-09-2BII-SHOPEELIVE), dan `shopee_video` masih
 * `UNVERIFIED_SIGNATURE` (`modules.ts`). `pdt_sku_master` dipilih sebagai
 * gantinya — PALING BERHARGA (prasyarat `shopee_ads_cpc`/`pdt_fact_sku_period`/
 * `sku_id` di modul manapun) meski PALING RUMIT (dua platform, upsert bukan
 * insert/replace seperti dua modul di atas). **Bukan** fungsi murni
 * "ekstrak baris" saja seperti dua modul di atas — pemanggil (`commitUploadBatch`)
 * melakukan UPSERT (Rule 19: SKU tidak pernah dihapus, hanya
 * `status_listing`/`last_seen_at` berubah), bukan delete-then-insert atau
 * ON CONFLICT DO UPDATE polos.
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
 * `shopee_ads_cpc` LIHAT Modul KEENAM di bawah — blocker grainnya AKHIRNYA
 * terbuka sesi lalu (sample asli Fim Motor, bukan lagi ditebak). `shopee_ads_search`
 * LIHAT Modul KETUJUH di bawah — blocker `G1-09-2BII-ADS-SEARCH` ("nol kolom
 * biaya/identitas") ditutup sesi ini, sample yang sama membuktikan premis itu
 * sudah usang.
 *
 * **Modul KEEMPAT (sesi ini): `tt_transaction_creator` → `pdt_fact_creator_period`**
 * (lihat `ekstrakBarisKreatorTtTransactionCreator` di bawah) — tabel fakta
 * KEEMPAT yang lahir. Dipilih karena grain barisnya SUDAH per-kreator
 * (`Creator name`, kunci `pdt_fact_creator_period`), jadi NOL ambiguitas
 * kelas `shopee_ads_cpc` di atas — setiap kolom `kolomDipanen` modul ini
 * ber-konsumen EKSPLISIT di `PDT_KOLOM_DIPANEN.md` §1.4 (baik yang menuju
 * kolom skema di sini, maupun yang menuju konsumen LAIN seperti Co-Pilot/PX
 * yang belum dibangun — `Tayangan video`/`Perkiraan komisi` TETAP tidak
 * ditulis ke tabel ini, bukan lupa). `gmv_live`/`gmv_video`/`sampel_terkirim`
 * SENGAJA `null` — modul ini cuma membawa GMV TOTAL kreator (bukan split
 * live/video), dan `Sampel terkirim` MEMANG bukan bagian `kolomDipanen`
 * modul ini (milik `tt_transaction_product`, modul LAIN, grain PER PRODUK
 * — tidak otomatis bisa disatukan ke grain per-kreator tabel ini). **Nol
 * filter akun toko sendiri** — legacy `report/metrik.ts` `affiliateReport`
 * mengecualikan `akunKontenToko` dari daftar kreator (`own.has(...)`), PDT
 * TIDAK mereplikasi filter itu di sini (dicatat, bukan lupa) — beda dari
 * `shopee_ads_cpc` di atas, ini keputusan RENDAH RISIKO (kunci unik tabel
 * TIDAK bisa kolaps karenanya, cuma menambah satu baris ekstra untuk toko
 * sendiri kalau memang muncul di berkas — mudah direvisi lewat reparse).
 *
 * **Modul KELIMA: `shopee_ams_afiliasi` → `pdt_fact_creator_period`**
 * (lihat `ekstrakBarisKreatorShopeeAmsAfiliasi` di bawah) — sisi SHOPEE untuk
 * tabel yang modul KEEMPAT baru mengisi sisi TikTok-nya. ⚠️ **Ejaan kolom
 * DIKOREKSI sesi 20** (`docs/DECISIONS.md` 2026-09-14) — sample asli Fim
 * Motor membuktikan `Username`/`Omzet`/`Komisi` (ejaan sesi ini menulisnya
 * semula) TIDAK PERNAH cocok berkas nyata (`Username Affiliate`/`Omzet
 * Penjualan(Rp)`/`Estimasi Komisi(Rp)`) — bug laten yang membuat modul ini
 * SELALU `parse_status='gagal'` untuk berkas asli sejak lahir, tersembunyi
 * di balik fixture tes yang memalsukan header. Sisa paragraf ini memakai
 * ejaan yang SUDAH dikoreksi. Grain barisnya SUDAH per-kreator (`Username
 * Affiliate`), sama alasan modul KEEMPAT dipilih — kandidat
 * SAUDARANYA di modul yang sama (`shopee_ams_produk`) SENGAJA TIDAK dipetakan
 * di sini: grainnya PER PRODUK (`Kode Item`/`Nama Item`), bukan per-kreator,
 * jadi tidak cocok tabel ini sama sekali — `PDT_KOLOM_DIPANEN.md` §2.10
 * menyebut keduanya bersama sebagai "sinyal PX sisi Shopee / pdt_fact_
 * creator_period Shopee", tapi baris §2.10 itu HARUS dibaca per-grain, bukan
 * "kedua modul menulis ke tabel yang sama". `Komisi`/`ROI` (whitelist modul
 * ini) SENGAJA tidak ditulis ke tabel ini — §2.10 eksplisit `komisi` adalah
 * sumber **`commission_pct`** untuk PX Flow D (konsumen domain LAIN, belum
 * dibangun), bukan kolom `pdt_fact_creator_period` (yang memang tidak punya
 * kolom komisi/ROI sama sekali). `ID Affiliates`/`Produk Terjual` juga tidak
 * dipetakan — tabel ini tidak punya kolom `creator_platform_id` terpisah
 * (beda dari `pdt_fact_content`), dan `Produk Terjual` (hitungan unit) bukan
 * `pesanan_teratribusi` (hitungan pesanan).
 *
 * Angka: `parsePdtAngka(v, true)` — konvensi **Ads Manager** (titik desimal,
 * koma ribuan), BUKAN konvensi Seller Center (`angka.ts` docblock) — cermin
 * `report/shopee/metrik.ts` `parseAdsLive`/`pn(r[ci], true)`, satu-satunya
 * pembaca TERVERIFIKASI untuk bentuk berkas ini sebelum PDT ada.
 *
 * **Modul KEENAM (sesi 19): `shopee_ads_cpc` → `pdt_fact_ads`** (lihat
 * `ekstrakBarisShopeeAdsCpc` di bawah) — blocker grain yang TETAP terbuka
 * sejak sesi 13 (`G1-09-2BII-ADS-CPC`) akhirnya terjawab: sesi ini menerima
 * sample EKSPOR ASLI klien (Fim Motor, berkas fisik `Data+Keseluruhan+Iklan+
 * Shopee-01_07_2026-31_07_2026.csv`, 13 baris data), bukan lagi menebak dari
 * kode legacy saja. Sample membuktikan dugaan sesi 17 **benar**: baris
 * PERTAMA (`Nama Iklan` = "Shop GMV Max", `Jenis Iklan` kosong, `Kode Produk`
 * = `"-"`) adalah iklan TOKO (bukan iklan produk) — TIDAK punya `Kode Produk`
 * sama sekali, tapi tetap satu baris data yang sah (parser legacy
 * `parseAdsCsv` menerimanya, kunci lewat `nama iklan` bukan `Kode Produk`).
 * Grain barisnya **per IKLAN**, bukan per produk — 12 baris sisanya
 * (`Jenis Iklan` = "Iklan Produk") kebetulan satu produk = satu iklan di
 * sample ini, tapi itu properti SAMPLE ini, bukan jaminan skema (produk yang
 * sama BISA punya >1 iklan berjalan). `kampanye_id` (kunci `uq_pdt_fact_ads`)
 * karena itu memakai `nama iklan` — SATU-SATUNYA identitas baris yang selalu
 * ada di whitelist modul ini (tidak ada `ID Iklan` numerik seperti
 * `shopee_ads_live`), cermin PERSIS `parseAdsCsv` legacy (`cNama`, baris
 * ber-nama kosong dilewati). **`sku_id` SENGAJA TETAP `null`** — beda dari
 * dugaan awal PDT_KOLOM_DIPANEN.md §2.3 ("`Kode Produk` konsumen:
 * pdt_fact_ads.sku_id"), sample yang sama menunjukkan `Kode Produk` adalah
 * level PRODUK INDUK (tanpa info varian), sedangkan `pdt_sku_master` (modul
 * KETIGA) berkunci `(platform_product_id, platform_variation_id)` PER VARIAN
 * — satu `Kode Produk` bisa cocok dengan BANYAK baris `pdt_sku_master` (satu
 * per varian), jadi lookup langsung akan mengarang varian mana yang dipilih.
 * Ini KELAS AMBIGUITAS YANG SAMA dengan lookup lintas-tabel yang belum punya
 * preseden (`tt_transaction_product`/`shopee_ams_produk` → `pdt_fact_sku_period`,
 * `docs/handoff/HANDOFF_PDT_SESI18.md` §1 butir 1) — BUKAN diselesaikan diam-
 * diam di sini. Dicatat `G1-09-2BII-ADS-CPC-SKU` (Open baru, `docs/DECISIONS.md`).
 * Angka: `parsePdtAngka(v, true)` — konvensi Ads Manager, sama seperti
 * `shopee_ads_live` (berkas dari dashboard Ads Manager yang sama).
 *
 * **Modul KETUJUH (sesi 22): `shopee_ads_search` → `pdt_fact_ads`** (lihat
 * `ekstrakBarisShopeeAdsSearch` di bawah) — `G1-09-2BII-ADS-SEARCH` DITUTUP.
 * `HANDOFF_PDT_SESI21.md` §3.B: sample asli Fim Motor (`Search-Ads-Overall-
 * Data-*.csv`) TERNYATA punya `Nama Iklan`/`Biaya`, premis blocker lama ("nol
 * kolom biaya/identitas") sudah usang — murni pekerjaan implementasi mengikuti
 * pola `shopee_ads_cpc` di atas, ditandai boleh dikerjakan TANPA menunggu
 * pemilik. **`kampanye_id` KOMPOSIT** — `` `${namaIklan} :: ${kataPencarian}` ``,
 * BUKAN `nama iklan` polos seperti `shopee_ads_cpc` — sample yang tersedia
 * hanya SATU baris data, tidak membuktikan apakah satu iklan search bisa
 * muncul berkali-kali dengan `Kata Pencarian` berbeda dalam satu periode
 * (satu iklan menargetkan banyak keyword, satu baris per keyword). Kalau itu
 * terjadi dan `kampanye_id` cuma `nama iklan`, replace-on-recommit
 * (DELETE+INSERT, sama pola `shopee_ads_cpc`/`shopee_ads_live`) akan diam-diam
 * menimpa baris keyword lain sebagai baris terakhir yang di-loop — bukan
 * error yang kelihatan. Komposit ini aman di kedua kasus: kalau `Kata
 * Pencarian` SELALU `"Semua"` (tidak spesifik keyword, seperti satu-satunya
 * baris sample), komposit berkurang jadi setara `nama iklan` saja (nol
 * downside). `Kata Pencarian` DIBACA di sini tapi SENGAJA TIDAK ditambahkan
 * ke `kolomDipanen` (`modules.ts`) — isinya (bucket 3, Q-6) masih DITAHAN
 * sebagai dimensi laporan, tapi memakainya untuk MEMBENTUK identitas baris
 * bukan pelanggaran penahanan itu (beda tujuan: kunci unik, bukan metrik).
 * `sku_id` tetap `null` — modul ini tidak punya identitas produk sama sekali
 * di whitelist. Angka: `parsePdtAngka(v, true)` — konvensi Ads Manager, sama
 * seperti `shopee_ads_cpc`/`shopee_ads_live`.
 *
 * **Modul KESEMBILAN (sesi 24): `shopee_live` → `pdt_fact_content`** (lihat
 * `ekstrakBarisShopeeLive` di bawah) — `G1-09-2BII-SHOPEELIVE` DITUTUP.
 * `Informasi Streaming` (judul sesi live, ditulis bebas AM) TIDAK stabil
 * sebagai identitas (bisa berulang — sample asli PUNYA judul yang sama untuk
 * DUA sesi berbeda). `Waktu Mulai` (menit presisi, `DD-MM-YYYY HH:mm`)
 * TIDAK PERNAH berulang di sample — satu akun Shopee cuma bisa menjalankan
 * SATU sesi live pada satu waktu, jadi menit presisi SANGAT mungkin unik
 * per akun selama-lamanya (bukan cuma kebetulan sample). `platform_content_id`
 * dibentuk dari DIGIT MENTAH string (`YYYYMMDDHHmm`, concat langsung — BUKAN
 * lewat objek `Date`/konversi zona waktu) supaya identitasnya tidak
 * tersandung ambiguitas WIB↔UTC; `waktuPosting` (kolom informasi, bukan
 * identitas) TETAP dihitung sebagai instant UTC sungguhan (WIB − 7 jam,
 * `WIB_OFFSET_HOURS` — Shopee Seller Center Indonesia SELALU WIB, tidak ada
 * DST). `Informasi Streaming` TIDAK dipetakan ke kolom manapun (deskriptif,
 * `pdt_fact_content` tidak punya slot judul). Angka: `parsePdtAngka(v)`
 * TANPA `raw` — konvensi Seller Center, sama seperti `tt_video` (berkas dari
 * dashboard Seller Center, bukan Ads Manager).
 *
 * **`tt_ads_product`/`tt_ads_live` → `pdt_fact_ads` (2026-09-16, keputusan
 * pemilik via `AskUserQuestion` — dibangun KONSERVATIF, TANPA sample file
 * asli, beda dari SETIAP modul `pdt_fact_ads` lain yang selalu mengutip
 * sample nyata sebelum dibangun).** `roas` DITURUNKAN (`gmv ÷ biaya`,
 * `null` bila `gmv` `null` atau `biaya` 0) untuk KEDUA modul — cermin PERSIS
 * `report/metrik.ts` `adsReport()` legacy, yang menghitung `div(rev, biaya)`
 * untuk sisi produk MAUPUN live, MENGABAIKAN kolom `ROI` mentah `tt_ads_live`
 * meski kolom itu ada di whitelist (`PDT_KOLOM_DIPANEN.md` §1.9 menyebutnya
 * "turunan", `tt_ads_product` malah TIDAK PUNYA kolom ROI/efektivitas sama
 * sekali di whitelistnya — tidak ada rumus lain yang bisa diverifikasi).
 * `sku_id`/`content_id` SELALU `null` — TIDAK dilakukan lookup FK ke
 * `pdt_sku_master`/`pdt_fact_content` meski komentar skema migrasi G1-01
 * menyiratkan `content_id` seharusnya diisi via `ID video`: nol kode PDT
 * manapun pernah melakukan lookup FK semacam itu untuk `pdt_fact_ads`, dan
 * kesalahan SERUPA sudah pernah terjadi (`shopee_ads_cpc` awalnya disangka
 * bisa lookup `sku_id` dari `Kode Produk`, TERNYATA salah setelah sample
 * asli diperiksa — `G1-09-2BII-ADS-CPC-SKU`, `docs/DECISIONS.md`). Pola SAMA
 * `shopee_ads_search`/`shopee_ads_live`: raw string identitas dibaca untuk
 * kunci baris saja (`ID Campaign`), TIDAK ditulis ke kolom identitas produk
 * apa pun. `Akun TikTok`/`Nama LIVE` (konsumen "label kreatif"/"pdt_fact_ads
 * label", `PDT_KOLOM_DIPANEN.md` §1.8/§1.9) dan `Biaya per pesanan` (turunan
 * CPA) TIDAK diekstrak — tidak ada kolom skema `pdt_fact_ads` untuk
 * ketiganya (pola sama `shopee_ads_cpc`'s ACOS, dicatat bukan hilang diam-
 * diam). Angka: `parsePdtAngka(v, true)` — konvensi Ads Manager, sesuai
 * komentar eksplisit `report/metrik.ts` untuk file jenis ini persis
 * ("Ads Manager sends plain floats... hence raw=true"). Asumsi ini dicatat
 * `docs/DECISIONS.md` — mudah dikoreksi begitu sample asli muncul (kolom
 * sudah null-aware, nol breaking change struktural).
 */
import { WIB_OFFSET_HOURS } from '../tz';
import { parsePdtAngka } from './angka';
import { PDT_KOLOM_ALIAS } from './modules';
import { parseRentangTanggalTiktok, parseTanggalId, parseTanggalIdStrip } from './identitas';

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

/**
 * Indeks alias `pdt_kolom_alias` (Rule 9) dikelompokkan modul → kolom kanonik.
 * Diturunkan dari `PDT_KOLOM_ALIAS` — satu rumah ejaan untuk SELURUH pipeline,
 * bukan daftar kedua yang bisa menyimpang diam-diam.
 */
const ALIAS_EJAAN: ReadonlyMap<string, Record<string, readonly string[]>> = (() => {
  const map = new Map<string, Record<string, string[]>>();
  for (const a of PDT_KOLOM_ALIAS) {
    const perKolom = map.get(a.modulKode) ?? {};
    (perKolom[a.kolomKanonik] ??= []).push(a.alias);
    map.set(a.modulKode, perKolom);
  }
  return map;
})();

/**
 * Cari indeks kolom di baris header: ejaan KANONIK dulu, baru alias modul itu
 * (`PDT_KOLOM_ALIAS`, Rule 9) — urutan yang SAMA dipakai `cariKolomWajib`
 * (`parsestatus.ts`), supaya satu berkas tidak pernah lolos validasi lewat
 * alias lalu diekstrak sebagai kolom kosong.
 *
 * **Kenapa ini ada (sesi 43).** Sebelum ini alias hanya dibaca
 * `validasiKolomWajib`/`hitungKolomDipanenBaru`; setiap `ekstrakBaris*` memakai
 * `header.findIndex(exact)` sendiri. Jadi alias menaikkan `parse_status` ke
 * `ok` TANPA membuat kolomnya terbaca — kegagalan SENYAP (nilai `null`,
 * bukan error), justru kelas bug yang paling sulit ketahuan karena gerbangnya
 * hijau. `tt_live`'s `Kreator` → `Nama panggilan` (alias sejak seed pertama)
 * sudah terkena persis itu. Ekstraktor yang modulnya PUNYA alias wajib lewat
 * sini; invariannya dijaga tes `fakta.test.ts` ("setiap modul ber-alias punya
 * ekstraktor sadar-alias"), bukan kedisiplinan penulis.
 */
function pencariKolom(header: readonly unknown[], modulKode: string): (nama: string) => number {
  const alias = ALIAS_EJAAN.get(modulKode) ?? {};
  return (nama: string): number => {
    const exact = header.findIndex((c) => norm(c) === norm(nama));
    if (exact !== -1) return exact;
    for (const a of alias[nama] ?? []) {
      const i = header.findIndex((c) => norm(c) === norm(a));
      if (i !== -1) return i;
    }
    return -1;
  };
}

/** Satu baris `pdt_fact_ads` mentah dari `shopee_ads_live`, SEBELUM `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil yang melengkapi — sama seperti fungsi lain di paket ini, murni tidak tahu konteks batch). */
export interface PdtBarisAdsShopeeLive {
  kampanyeId: string;
  tayangan: number | null;
  pesananSku: number | null;
  gmv: number | null;
  biaya: number;
  roas: number | null;
  /** G3-06 — teks mentah kolom `Tujuan`. Lihat `bacaTipeKampanyeSumber`. */
  tipeKampanyeSumber: string | null;
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
  const idx = pencariKolom(header, 'shopee_ads_live'); // sadar-alias (Rule 9) — lihat docblock `pencariKolom`
  const iKampanye = idx('ID Iklan');
  const iTayangan = idx('Penonton');
  const iPesanan = idx('Pesanan');
  // `Omzet Penjualan` (ejaan sel yang sebenarnya, dikoreksi sesi 43); `Omzet` polos
  // tetap terbaca lewat alias.
  const iGmv = idx('Omzet Penjualan');
  const iBiaya = idx('Biaya');
  const iRoas = idx('Efektifitas Iklan');
  const iTipe = idx('Tujuan'); // G3-06

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
      tipeKampanyeSumber: bacaTipeKampanyeSumber(row, iTipe),
    });
  }
  return hasil;
}

/**
 * Teks MENTAH konfigurasi kampanye (`pdt_fact_ads.tipe_kampanye_sumber`, G3-06).
 *
 * Nama kolomnya berbeda per modul karena memang berbeda di berkasnya —
 * diverifikasi ke 12 klien nyata (sesi 43), bukan ditebak:
 *
 * | modul | kolom | nilai yang benar-benar muncul |
 * |---|---|---|
 * | `shopee_ads_cpc` | `Mode Bidding` | `GMV Max ROAS`, `GMV Max Auto Bidding (Shop)`, `GMV Max Auto` |
 * | `shopee_ads_search` | `Mode Bidding` | `Bidding Manual`, `Bidding Otomatis` |
 * | `shopee_ads_live` | `Tujuan` | `Live GMV Max Auto`, `Live GMV Max ROAS`, `Tingkatkan Jumlah Penonton` |
 * | `tt_ads_product` | `Jenis materi iklan` | `Video`, `Kartu produk` |
 *
 * `tt_ads_live` TIDAK punya kolom semacam ini dan tidak membutuhkannya: seluruh
 * berkasnya adalah kampanye LIVE, jadi tipenya melekat pada identitas modul.
 * Pemanggilnya (`pdt.ts`) yang mengisi konstanta itu — BUKAN fungsi di sini,
 * supaya tidak ada nilai yang tampak "dipanen dari berkas" padahal diasumsikan.
 *
 * Dikembalikan APA ADANYA (trim saja); sel kosong ⇒ `null`, bukan `''` — absen
 * ≠ nol, pola sama seluruh kolom fakta PDT lain. Pemetaan ke `CAMPAIGN_TYPES`
 * ada di `packages/domain`; lihat migrasi `20261120010000` untuk alasannya
 * ("taksonomi tidak punya dua rumah").
 */
const bacaTipeKampanyeSumber = (row: readonly unknown[] | undefined, i: number): string | null =>
  i === -1 ? null : (String(row?.[i] ?? '').trim() || null);

const roasTurunan = (gmv: number | null, biaya: number): number | null =>
  gmv == null || biaya === 0 ? null : gmv / biaya;

/**
 * Satu baris `pdt_fact_ads` mentah dari `tt_ads_product`, SEBELUM
 * `client_platform_id`/`batch_id`/`periode`/`parser_versi`. `roas` DITURUNKAN
 * (lihat docblock berkas) — modul ini TIDAK PUNYA kolom ROI/efektivitas mentah
 * sama sekali. `tayangan`/`klik` ditambahkan 2026-09-16 (`G1-09-2BII-TTADS-
 * SAMPLE`, sample asli Avitaskin Juli 2026) — sama pola `shopee_ads_cpc`.
 */
export interface PdtBarisAdsTtProduct {
  kampanyeId: string;
  biaya: number;
  pesananSku: number | null;
  gmv: number | null;
  roas: number | null;
  tayangan: number | null;
  klik: number | null;
  /** G3-06 — teks mentah kolom `Jenis materi iklan`. Lihat `bacaTipeKampanyeSumber`. */
  tipeKampanyeSumber: string | null;
}

/**
 * Ekstrak seluruh baris data `tt_ads_product` (Rule 8 whitelist `modules.ts`
 * — HANYA kolom yang diekstrak di sini yang boleh masuk `kolomDipanen`, lihat
 * komentar di sana untuk kenapa). File asli 26 kolom A–Z (diverifikasi, lihat
 * di bawah); `ID Campaign` (kampanye_id), `Biaya`, `Pesanan SKU`, `Pendapatan
 * kotor` (gmv), `Impresi iklan produk` (tayangan), `Jumlah klik iklan produk`
 * (klik) yang punya kolom skema `pdt_fact_ads` — sisanya (`ID produk`/`ID
 * video`/`Akun TikTok`/`Biaya per pesanan`/dst.) TIDAK diekstrak (harvested-
 * not-mapped, TIDAK didaftar di `kolomDipanen` — tercatat sebagai `kolomBaru`
 * informational, bukan gagal parse). Baris ber-`ID Campaign` kosong dilewati
 * (bukan baris data sungguhan).
 *
 * **Diverifikasi 2026-09-16 (`G1-09-2BII-TTADS-SAMPLE`, DITUTUP)** terhadap
 * sample ekspor asli klien (Avitaskin, "creative data for product campaigns",
 * Juli 2026, 2093 baris data) — konvensi `parsePdtAngka(v, true)` (Ads
 * Manager: titik desimal, TANPA pemisah ribuan) TERBUKTI BENAR: `Biaya`/
 * `Pendapatan kotor` di file asli adalah STRING literal 3 desimal titik
 * tanpa pemisah ribuan (mis. `"1407834.000"`), bukan sel numerik. Nama kolom
 * `ID Campaign` (bukan `ID kampanye`/varian lain) juga TERKONFIRMASI persis.
 * `ID produk`/`ID video` bernilai `"N/A"` (string literal) untuk baris
 * "Kartu produk" tanpa video — bukan sel kosong.
 */
export function ekstrakBarisTtAdsProduct(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisAdsTtProduct[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iKampanye = idx('ID Campaign');
  const iPesanan = idx('Pesanan SKU');
  const iGmv = idx('Pendapatan kotor');
  const iBiaya = idx('Biaya');
  const iTayangan = idx('Impresi iklan produk');
  const iKlik = idx('Jumlah klik iklan produk');
  const iTipe = idx('Jenis materi iklan'); // G3-06

  const hasil: PdtBarisAdsTtProduct[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const kampanyeId = iKampanye === -1 ? '' : String(row?.[iKampanye] ?? '').trim();
    if (kampanyeId === '') continue;
    const biaya = iBiaya === -1 ? 0 : parsePdtAngka(row?.[iBiaya], true);
    const gmv = iGmv === -1 ? null : parsePdtAngka(row?.[iGmv], true);
    hasil.push({
      kampanyeId,
      biaya,
      pesananSku: iPesanan === -1 ? null : parsePdtAngka(row?.[iPesanan], true),
      gmv,
      roas: roasTurunan(gmv, biaya),
      tayangan: iTayangan === -1 ? null : parsePdtAngka(row?.[iTayangan], true),
      klik: iKlik === -1 ? null : parsePdtAngka(row?.[iKlik], true),
      tipeKampanyeSumber: bacaTipeKampanyeSumber(row, iTipe),
    });
  }
  return hasil;
}

/**
 * Satu baris `pdt_fact_ads` mentah dari `tt_ads_live`, SEBELUM
 * `client_platform_id`/`batch_id`/`periode`/`parser_versi`. `roas` DITURUNKAN
 * (lihat docblock berkas) — kolom `ROI (Toko saat ini)` mentah SENGAJA
 * diabaikan, cermin `report/metrik.ts` legacy. `tayangan` ditambahkan
 * 2026-09-16 (`G1-09-2BII-TTADS-SAMPLE`) dari `Tayangan LIVE` — modul ini
 * tidak punya kolom klik (sama pola `shopee_ads_live`, bukan `shopee_ads_cpc`).
 */
export interface PdtBarisAdsTtLive {
  kampanyeId: string;
  biaya: number;
  pesananSku: number | null;
  gmv: number | null;
  roas: number | null;
  tayangan: number | null;
}

/**
 * Ekstrak seluruh baris data `tt_ads_live` (Rule 8 whitelist `modules.ts` —
 * HANYA kolom yang diekstrak di sini yang boleh masuk `kolomDipanen`, lihat
 * komentar di sana). File asli 19 kolom A–S (diverifikasi, lihat di bawah);
 * `ID Campaign` (kampanye_id), `Biaya`, `Pesanan SKU`, `Pendapatan kotor`
 * (gmv), `Tayangan LIVE` (tayangan) yang punya kolom skema `pdt_fact_ads` —
 * `Nama LIVE` TIDAK diekstrak (label, bukan kolom skema), `ROI (Toko saat
 * ini)` mentah TIDAK dipakai (lihat docblock berkas — `roas` diturunkan
 * `gmv÷biaya`, bukan dibaca langsung) DAN sengaja TIDAK didaftar di
 * `kolomDipanen` (nama kolom asli beda dari dugaan awal `'ROI'` — lihat
 * `modules.ts`). Baris ber-`ID Campaign` kosong dilewati.
 *
 * **Diverifikasi SEBAGIAN 2026-09-16 (`G1-09-2BII-TTADS-SAMPLE`, DITUTUP)**:
 * sample ekspor asli klien (Avitaskin, "livestream data for live campaigns",
 * Juli 2026) mengonfirmasi HEADER (nama kolom persis, termasuk `ID Campaign`
 * — sama seperti `tt_ads_product`, BUKAN nama lain — dan `ROI (Toko saat
 * ini)`, BUKAN `ROI` polos seperti dugaan awal `modules.ts`) tapi NOL baris
 * data (toko ini nol kampanye LIVE aktif periode itu) — format desimal
 * `Biaya`/`Pendapatan kotor`/`ROI (Toko saat ini)` untuk `tt_ads_live` BELUM
 * punya bukti empiris baris nyata, hanya kesamaan struktural dengan
 * `tt_ads_product` (exporter sama, konvensi Ads Manager `raw=true` sama).
 */
export function ekstrakBarisTtAdsLive(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisAdsTtLive[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iKampanye = idx('ID Campaign');
  const iPesanan = idx('Pesanan SKU');
  const iGmv = idx('Pendapatan kotor');
  const iBiaya = idx('Biaya');
  const iTayangan = idx('Tayangan LIVE');

  const hasil: PdtBarisAdsTtLive[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const kampanyeId = iKampanye === -1 ? '' : String(row?.[iKampanye] ?? '').trim();
    if (kampanyeId === '') continue;
    const biaya = iBiaya === -1 ? 0 : parsePdtAngka(row?.[iBiaya], true);
    const gmv = iGmv === -1 ? null : parsePdtAngka(row?.[iGmv], true);
    hasil.push({
      kampanyeId,
      biaya,
      pesananSku: iPesanan === -1 ? null : parsePdtAngka(row?.[iPesanan], true),
      gmv,
      roas: roasTurunan(gmv, biaya),
      tayangan: iTayangan === -1 ? null : parsePdtAngka(row?.[iTayangan], true),
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

/** `"43s"` / `"2min"` / `"1min 30s"` / `"1h 2min 3s"` (TikTok Affiliate `Duration`) → detik, atau `null` bila nol komponen terbaca. BEDA dari `parseDurasiTiktokDetik` (`tt_live`, bentuk KAKU `"Xh Ymin"` — sengaja tidak dilonggarkan supaya modul yang sudah terverifikasi tidak ikut bergeser). */
function parseDurasiAffiliateDetik(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const m = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*min)?\s*(?:(\d+)\s*s)?$/.exec(t);
  if (!m || (m[1] == null && m[2] == null && m[3] == null)) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * Satu baris `pdt_fact_content` mentah dari `tt_affiliate_video`, SEBELUM
 * `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil yang
 * melengkapi). `shopId` BUKAN kolom `pdt_fact_content` — ia dibawa keluar
 * untuk gerbang "satu berkas = satu toko" di pemanggil (lihat docblock
 * `ekstrakBarisTtAffiliateVideo`).
 *
 * `creatorPlatformId` SELALU `null` dan `isAkunToko` SELALU `false`: ekspor
 * sisi partner ini TIDAK membawa ID kreator sama sekali (hanya `Creator
 * name`), jadi tak ada nilai yang bisa dibandingkan ke
 * `client_platforms.akun_konten_toko` — menebak lewat pencocokan nama adalah
 * persis kelas kesalahan yang Rule 3-4 larang. Konten di berkas ini memang
 * konten AFILIASI (bukan akun toko), jadi `false` juga benar secara semantik.
 */
export interface PdtBarisContentTtAffiliateVideo {
  platformContentId: string;
  creatorHandle: string | null;
  shopId: string | null;
  vv: number | null;
  likes: number | null;
  gmv: number | null;
  durasiDetik: number | null;
}

/**
 * Ekstrak seluruh baris data `tt_affiliate_video` — ekspor "Custom report"
 * TikTok Shop Affiliate SISI PARTNER/TAP (M9-OA-4, `docs/DECISIONS.md`
 * 2026-09-17), sumber `Affiliate video-attributed GMV` per `Video ID`.
 *
 * **Baris `Summary`.** Berkas ini menaruh satu baris agregat TikTok tepat di
 * bawah header, ber-`Date` = `"Summary"` dan sebagian besar kolom `"-"`.
 * Baris data sungguhan dikenali dari kolom `Date` yang HARUS bisa diparse
 * jadi rentang (`parseRentangTanggalTiktok`) — bukan dari `Video ID` kosong
 * seperti `tt_video`, karena `Summary` mengisi `Video ID` dengan `"-"` yang
 * "tidak kosong" tapi juga bukan ID.
 *
 * **Baris ganda per video: DIPILIH SATU, TIDAK PERNAH DIJUMLAH.** Di sample
 * asli 67 dari 111 video punya lebih dari satu baris. Baris kembar itu sama
 * `Video ID`, sama `Creator name`, sama `Product ID`, sama `Post time`, sama
 * `Duration`, dan HANYA berbeda pada metadata kampanye (`Campaign duration`
 * — kampanye yang sama diperpanjang) + `Creator follower count`, tapi
 * membawa metrik yang berbeda (mis. `Video views` 20 vs 15). Bukti bahwa
 * baris-baris itu BUKAN irisan yang saling lepas: menjumlahkan seluruh baris
 * memberi 24.381 views sementara baris `Summary` TikTok sendiri menyebut
 * 15.369 — jumlah MELAMPAUI total platform 59%. Karena itu menjumlah
 * dilarang (ia mengarang uang yang tidak ada di baris mana pun, melanggar
 * house convention #4 dan "never estimated" M9-OA-4), dan kunci unik
 * `pdt_fact_content` (`client_platform_id, platform_content_id, periode`)
 * memang memaksa satu baris per video.
 *
 * Pemilihannya DETERMINISTIK dan bebas urutan: GMV terbesar, lalu `Video
 * views` terbesar, lalu `Creator follower count` terbesar, terakhir
 * kemunculan pertama. Seluruh nilai baris terpilih diambil dari SATU baris
 * yang sama (bukan max per kolom) supaya angka yang tersimpan tetap kombinasi
 * yang benar-benar pernah ada di berkas. **Mengapa nilai TERBESAR, bukan
 * terkecil/terbaru:** `Affiliate video-attributed GMV` adalah angka KUMULATIF
 * seumur video (keputusan pemilik, `docs/DECISIONS.md` 2026-09-17) — dari dua
 * pengamatan angka kumulatif yang sama, yang lebih besar adalah yang lebih
 * lengkap.
 *
 * Kenapa selisih 24.381 vs 15.369 itu sendiri tidak dijelaskan di sini:
 * semantik baris-ganda ekspor TikTok tidak terdokumentasi di mana pun, dan
 * menebaknya dilarang CLAUDE.md — ia dicatat sebagai pertanyaan terbuka
 * `G-TTAFF-BARIS-GANDA` di `docs/DECISIONS.md`. Yang dibangun di sini adalah
 * aturan yang AMAN apa pun jawabannya: tidak pernah melebihi nilai yang
 * sungguh tertulis di berkas.
 *
 * Kolom yang TIDAK punya rumah di `pdt_fact_content` sengaja tidak ditulis:
 * `Creator video-attributed orders`/`Affiliate video orders`/
 * `Creator-attributed items sold` (nol kolom pesanan/unit di tabel ini),
 * kedua kolom komisi partner, dan `Video product RPM`. Keduanya tetap ada di
 * `kolomDipanen` (whitelist panen, PDT-27) supaya tidak hilang dari berkas
 * mentah yang tersimpan. `waktu_posting` TIDAK diisi dari `Post time` — zona
 * waktu dashboard TikTok belum terverifikasi di repo ini, alasan yang sama
 * persis dengan `ekstrakBarisTtLive`.
 *
 * Angka: `parsePdtAngka(v)` TANPA `raw` — konvensi Seller Center, sama
 * seperti seluruh modul TikTok lain. ⚠️ Kolom uang di sample asli SELURUHNYA
 * `Rp0`, jadi pemisah ribuan/desimalnya belum dapat diverifikasi — dicatat
 * bersama `G-TTAFF-BARIS-GANDA`.
 */
export function ekstrakBarisTtAffiliateVideo(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisContentTtAffiliateVideo[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iDate = idx('Date');
  const iVideoId = idx('Video ID');
  const iCreator = idx('Creator name');
  const iFollower = idx('Creator follower count');
  const iShopId = idx('Shop ID');
  const iViews = idx('Video views');
  const iLikes = idx('Video likes');
  const iGmv = idx('Affiliate video-attributed GMV');
  const iDurasi = idx('Duration');

  // Kunci = `Video ID`; nilai = kandidat terbaik sejauh ini + skor pemilihnya.
  const terpilih = new Map<string, { baris: PdtBarisContentTtAffiliateVideo; skor: readonly number[] }>();
  const urutan: string[] = [];

  for (const row of aoa.slice(barisHeader)) {
    if (iDate === -1) break; // nol kolom `Date` ⇒ baris data tidak dapat dibedakan dari `Summary`
    if (parseRentangTanggalTiktok(String(row?.[iDate] ?? '')) == null) continue;
    const platformContentId = iVideoId === -1 ? '' : String(row?.[iVideoId] ?? '').trim();
    if (platformContentId === '') continue;

    const gmv = iGmv === -1 ? null : parsePdtAngka(row?.[iGmv]);
    const vv = iViews === -1 ? null : parsePdtAngka(row?.[iViews]);
    const follower = iFollower === -1 ? 0 : parsePdtAngka(row?.[iFollower]);
    const baris: PdtBarisContentTtAffiliateVideo = {
      platformContentId,
      creatorHandle: iCreator === -1 ? null : (String(row?.[iCreator] ?? '').trim() || null),
      shopId: iShopId === -1 ? null : (String(row?.[iShopId] ?? '').trim() || null),
      vv,
      likes: iLikes === -1 ? null : parsePdtAngka(row?.[iLikes]),
      gmv,
      durasiDetik: iDurasi === -1 ? null : parseDurasiAffiliateDetik(String(row?.[iDurasi] ?? '')),
    };
    // NaN (sel ada tapi gagal diparse, G1-03) tidak boleh MENANG pemilihan —
    // ia diperlakukan sebagai skor terendah, tapi nilainya tetap ditulis apa
    // adanya bila baris itu yang akhirnya terpilih.
    const skorAman = (n: number | null): number => (n == null || Number.isNaN(n) ? -1 : n);
    const skor = [skorAman(gmv), skorAman(vv), skorAman(follower)] as const;

    const lama = terpilih.get(platformContentId);
    if (lama == null) {
      terpilih.set(platformContentId, { baris, skor });
      urutan.push(platformContentId);
      continue;
    }
    for (let i = 0; i < skor.length; i += 1) {
      if (skor[i] === lama.skor[i]) continue;
      if (skor[i] > lama.skor[i]) terpilih.set(platformContentId, { baris, skor });
      break;
    }
  }

  return urutan.map((k) => terpilih.get(k)!.baris);
}

/** `DD-MM-YYYY HH:mm` (Shopee `Waktu Mulai`) → `{ digitMentah, instantUtc }`, atau `null` bila tidak cocok pola. `digitMentah` adalah string angka MENTAH (`YYYYMMDDHHmm`, concat langsung dari komponen tertulis) — untuk identitas, tidak lewat objek Date. `instantUtc` adalah instant UTC sungguhan (WIB − `WIB_OFFSET_HOURS`) — untuk kolom informasi `waktu_posting`, BUKAN untuk identitas. */
function parseWaktuMulaiShopeeLive(w: string): { digitMentah: string; instantUtc: Date } | null {
  const m = w.trim().match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min] = m;
  const hhPad = hh.padStart(2, '0');
  const digitMentah = `${yyyy}${mm}${dd}${hhPad}${min}`;
  const instantUtc = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh - WIB_OFFSET_HOURS, +min));
  if (isNaN(instantUtc.getTime())) return null;
  return { digitMentah, instantUtc };
}

/** Satu baris `pdt_fact_content` mentah dari `shopee_live`, SEBELUM `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil yang melengkapi). `sku_id`/`creatorPlatformId`/`creatorHandle` SELALU `null` — modul ini tidak punya identitas produk maupun kreator terpisah di whitelist (sesi live Shopee adalah akun toko sendiri, bukan afiliasi). `isAkunToko` SELALU `true` — beda dari `tt_video` (yang membandingkan `creatorPlatformId` ke `akunKontenToko`), laporan ini secara struktural HANYA berisi sesi live akun toko (tidak ada laporan afiliasi dalam bentuk ini). */
export interface PdtBarisContentShopeeLive {
  platformContentId: string;
  waktuPosting: Date;
  vv: number | null;
  gmv: number | null;
}

/**
 * Ekstrak seluruh baris data `shopee_live` (Modul KESEMBILAN — lihat
 * docblock kepala berkas untuk kenapa blocker `G1-09-2BII-SHOPEELIVE`
 * akhirnya ditutup sesi ini). Rule 8 whitelist `modules.ts`: `['Informasi
 * Streaming', 'Waktu Mulai', 'Pengunjung', 'Penjualan (Pesanan Siap
 * Dikirim)(Rp)']`. `platform_content_id` dibentuk dari `Waktu Mulai`
 * (`parseWaktuMulaiShopeeLive`, digit mentah `YYYYMMDDHHmm`) — BUKAN dari
 * `Informasi Streaming` (judul bebas, bisa berulang, lihat docblock kepala
 * berkas). Baris ber-`Waktu Mulai` kosong ATAU tidak cocok pola `DD-MM-YYYY
 * HH:mm` dilewati (bukan baris data sungguhan — tidak ada identitas yang
 * bisa dibentuk). `Pengunjung` → `vv` (kolom itu comment-nya eksplisit
 * "konsumen: report.dimensi_video/live", dipakai bersama oleh `tt_video`/
 * modul ini). Angka: `parsePdtAngka(v)` TANPA `raw` — konvensi Seller
 * Center, sama seperti `tt_video`.
 */
export function ekstrakBarisShopeeLive(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisContentShopeeLive[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iWaktuMulai = idx('Waktu Mulai');
  const iPengunjung = idx('Pengunjung');
  const iGmv = idx('Penjualan (Pesanan Siap Dikirim)(Rp)');

  const hasil: PdtBarisContentShopeeLive[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const waktuMulaiRaw = iWaktuMulai === -1 ? '' : String(row?.[iWaktuMulai] ?? '').trim();
    if (waktuMulaiRaw === '') continue;
    const parsed = parseWaktuMulaiShopeeLive(waktuMulaiRaw);
    if (parsed == null) continue;
    hasil.push({
      platformContentId: parsed.digitMentah,
      waktuPosting: parsed.instantUtc,
      vv: iPengunjung === -1 ? null : parsePdtAngka(row?.[iPengunjung]),
      gmv: iGmv === -1 ? null : parsePdtAngka(row?.[iGmv]),
    });
  }
  return hasil;
}

/** `YYYY/MM/DD/ HH:mm` (TikTok `Waktu Live`, format TERVERIFIKASI — sama pola `report/metrik.ts` `parseWaktuLive`) → digit mentah `YYYYMMDDHHmm` (identitas, bukan lewat objek Date/zona waktu — pola sama `parseWaktuMulaiShopeeLive`). `null` bila tidak cocok pola. */
function parseWaktuLiveTiktokDigit(w: string): string | null {
  const m = w.trim().match(/^(\d{4})\/(\d{2})\/(\d{2})\/?\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, yyyy, mm, dd, hh, min] = m;
  return `${yyyy}${mm}${dd}${hh.padStart(2, '0')}${min}`;
}

/** `"Xh Ymin"` (TikTok `Durasi`, mis. `"2h 53min"`/`"0h 19min"`) → detik, atau `null` bila tidak cocok pola. */
function parseDurasiTiktokDetik(s: string): number | null {
  const m = s.trim().match(/^(\d+)h\s*(\d+)min$/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

/** Satu baris `pdt_fact_content` mentah dari `tt_live`, SEBELUM `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil yang melengkapi). `waktuPosting` SELALU `null` — zona waktu dashboard TikTok BELUM terverifikasi di repo manapun (beda dari `shopee_live`, yang punya dasar terverifikasi "Seller Center Indonesia SELALU WIB"); `platformContentId` tidak butuh interpretasi zona waktu (digit mentah dari string, bukan lewat objek Date), jadi identitas tetap aman ditulis walau `waktuPosting` ditahan. */
export interface PdtBarisContentTtLive {
  platformContentId: string;
  creatorPlatformId: string | null;
  creatorHandle: string | null;
  isAkunToko: boolean;
  vv: number | null;
  gmv: number | null;
  durasiDetik: number | null;
}

/**
 * Ekstrak seluruh baris data `tt_live` (Rule 8 whitelist `modules.ts`:
 * `['ID Kreator', 'Waktu Live', 'Durasi', 'GMV dari LIVE (Rp)', 'Produk
 * Terjual', 'Penonton', 'CTOR', 'Kreator']`) — **`G1-09-2BII-TTLIVE`
 * DITUTUP** lewat sample asli ("Tiktok - Avitaskin.zip"): berkas `Live
 * Analysis*.xlsx` sungguhan TIDAK membawa kolom ID sesi live terpisah (sama
 * seperti tebakan awal), tapi kombinasi `ID Kreator` + `Waktu Live` (menit
 * presisi) TERBUKTI 100% unik di SELURUH 149 baris sample nyata (nol
 * duplikat) — pola SAMA PERSIS `shopee_live`/`Waktu Mulai`
 * (`G1-09-2BII-SHOPEELIVE`): satu kreator (toko ATAU afiliasi — beda dari
 * `shopee_live`, laporan ini MEMUAT sesi live afiliasi juga, lihat
 * `isAkunToko`) tidak bisa menjalankan dua sesi live sekaligus pada menit
 * yang sama. `platformContentId` = `${idKreator}-${digitMentah}`
 * (`parseWaktuLiveTiktokDigit`, format `YYYY/MM/DD/ HH:mm` TERVERIFIKASI,
 * sama pola `report/metrik.ts` `parseWaktuLive`) — `idKreator` WAJIB ikut
 * (beda dari `shopee_live` yang HANYA akun toko sendiri) karena berkas ini
 * mencampur banyak kreator berbeda, yang secara teori bisa live di menit
 * yang sama SATU SAMA LAIN (bukan cuma menit yang sama dengan diri sendiri).
 * Baris ber-`ID Kreator` kosong ATAU `Waktu Live` tidak cocok pola dilewati
 * (nol identitas yang bisa dibentuk). `Durasi` (`"Xh Ymin"`,
 * `parseDurasiTiktokDetik`) → `durasi_detik`. Angka: `parsePdtAngka(v)`
 * TANPA `raw` — konvensi Seller Center, sama seperti `tt_video`/`shopee_live`.
 */
export function ekstrakBarisTtLive(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
  akunKontenToko: readonly string[] | null,
): PdtBarisContentTtLive[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = pencariKolom(header, 'tt_live'); // sadar-alias (Rule 9)
  const iIdKreator = idx('ID Kreator');
  const iWaktuLive = idx('Waktu Live');
  const iKreator = idx('Kreator'); // alias `Nama panggilan` — sebelum sesi 43 TIDAK pernah terbaca ekstraktor
  const iDurasi = idx('Durasi');
  const iGmv = idx('GMV dari LIVE (Rp)');
  const iPenonton = idx('Penonton');

  const hasil: PdtBarisContentTtLive[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const idKreator = iIdKreator === -1 ? '' : String(row?.[iIdKreator] ?? '').trim();
    const waktuLiveRaw = iWaktuLive === -1 ? '' : String(row?.[iWaktuLive] ?? '').trim();
    if (idKreator === '' || waktuLiveRaw === '') continue;
    const digitMentah = parseWaktuLiveTiktokDigit(waktuLiveRaw);
    if (digitMentah == null) continue;
    hasil.push({
      platformContentId: `${idKreator}-${digitMentah}`,
      creatorPlatformId: idKreator,
      creatorHandle: iKreator === -1 ? null : (String(row?.[iKreator] ?? '').trim() || null),
      isAkunToko: akunKontenToko != null && akunKontenToko.includes(idKreator),
      vv: iPenonton === -1 ? null : parsePdtAngka(row?.[iPenonton]),
      gmv: iGmv === -1 ? null : parsePdtAngka(row?.[iGmv]),
      durasiDetik: iDurasi === -1 ? null : parseDurasiTiktokDetik(String(row?.[iDurasi] ?? '')),
    });
  }
  return hasil;
}

/**
 * Satu baris (SATU SKU/varian, sesudah dedup) `pdt_sku_master`, SEBELUM
 * `client_platform_id`/`batch_id`/`parser_versi` (pemanggil yang melengkapi,
 * pola sama fungsi lain di paket ini). `platformVariationId` `''` bila
 * platform/modul sumber tidak membawa id varian terpisah (kolom DB
 * `DEFAULT ''`, bukan `NULL` — cermin skema `pdt_sku_master`,
 * `uq_pdt_sku_master (client_platform_id, platform_product_id,
 * platform_variation_id)`).
 */
export interface PdtBarisSkuMaster {
  platformProductId: string;
  platformVariationId: string;
  sellerSku: string | null;
  namaProduk: string | null;
  namaVariasi: string | null;
  kategoriPlatform: string | null;
  hargaSatuanTerakhir: number | null;
}

/** Dedup berdasar `(platformProductId, platformVariationId)` — baris belakangan menang (menimpa baris sebelumnya di array yang sama), cermin semantik `ON CONFLICT DO UPDATE` yang dipakai pemanggil. Satu berkas bisa membawa SKU yang sama berkali-kali (mis. satu baris per pesanan) — tabel master butuh SATU baris per SKU, bukan satu per kemunculan. */
function dedupSkuMaster(baris: readonly PdtBarisSkuMaster[]): PdtBarisSkuMaster[] {
  const byKey = new Map<string, PdtBarisSkuMaster>();
  for (const b of baris) byKey.set(`${b.platformProductId} ${b.platformVariationId}`, b);
  return [...byKey.values()];
}

/**
 * Ekstrak master SKU dari `shopee_parent_sku` (Rule 18: sumber kanonik Shopee
 * — `parentskudetail.xlsx`, `Kode Produk`/`Kode Variasi`/`SKU Induk`, ketiga
 * satu-satunya kolom identitas modul ini di `kolomDipanen`,
 * `PDT_KOLOM_DIPANEN.md` §2.2). **`nama_produk`/`kategori_platform`/
 * `harga_satuan_terakhir` SENGAJA selalu `null` di sini** — modul ini tidak
 * membawa satu pun dari ketiganya di whitelist (bukan lupa dipetakan; ketiga
 * nama kolom itu genuinely tidak ada di `kolomDipanen` modul ini). Baris
 * ber-`Kode Produk` kosong dilewati.
 */
export function ekstrakBarisSkuMasterShopeeParentSku(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisSkuMaster[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iKodeProduk = idx('Kode Produk');
  const iKodeVariasi = idx('Kode Variasi');
  const iSkuInduk = idx('SKU Induk');

  const hasil: PdtBarisSkuMaster[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const platformProductId = iKodeProduk === -1 ? '' : String(row?.[iKodeProduk] ?? '').trim();
    if (platformProductId === '') continue;
    hasil.push({
      platformProductId,
      platformVariationId: iKodeVariasi === -1 ? '' : String(row?.[iKodeVariasi] ?? '').trim(),
      sellerSku: iSkuInduk === -1 ? null : (String(row?.[iSkuInduk] ?? '').trim() || null),
      namaProduk: null,
      namaVariasi: null,
      kategoriPlatform: null,
      hargaSatuanTerakhir: null,
    });
  }
  return dedupSkuMaster(hasil);
}

/**
 * Ekstrak master SKU dari `tt_orders` (`Semua Pesanan`, Rule 18 separuh
 * TikTok). **Deviasi sadar dari Rule 18 harfiah** (dicatat
 * `docs/DECISIONS.md`): PRD minta `tt_orders` DIGABUNG
 * `tt_transaction_product` (`Transaction_Analysis_Product_List`, `Product
 * ID`/`Product category`) — tapi TIDAK ADA kolom kunci gabung yang
 * terverifikasi antara keduanya (`tt_orders` punya `SKU ID`, level VARIAN;
 * `tt_transaction_product` punya `Product ID`, diduga level PRODUK INDUK —
 * dua grain berbeda, nol kolom penghubung di `kolomDipanen` manapun).
 * Mengarang join tanpa kunci sungguhan berisiko salah-gabung SKU yang
 * berbeda. **`tt_orders` kolomDipanen sendiri sudah membawa `Product
 * Category`** (`modules.ts`) — jadi `kategori_platform` TETAP terisi tanpa
 * berkas kedua, dan seluruh field skema lain (`seller_sku`/`nama_produk`/
 * `nama_variasi`/`harga_satuan_terakhir`) juga tercakup oleh SATU berkas ini
 * saja. `platform_variation_id` diisi `''` (bukan `SKU ID` dipakai dua kali)
 * — `SKU ID` sendiri sudah level-varian (satu-satunya id yang tersedia),
 * jadi ia jadi `platformProductId`; TikTok tidak mengekspos id level-produk-
 * induk terpisah di whitelist modul ini. Baris ber-`SKU ID` kosong dilewati.
 * Angka (`SKU Unit Original Price`): `parsePdtAngka(v)` TANPA `raw` —
 * konvensi Seller Center, sama seperti `tt_orders` adalah ekspor Seller
 * Center (bukan Ads Manager).
 */
export function ekstrakBarisSkuMasterTtOrders(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisSkuMaster[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iSkuId = idx('SKU ID');
  const iSellerSku = idx('Seller SKU');
  const iProductName = idx('Product Name');
  const iVariation = idx('Variation');
  const iProductCategory = idx('Product Category');
  const iHarga = idx('SKU Unit Original Price');

  const hasil: PdtBarisSkuMaster[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const platformProductId = iSkuId === -1 ? '' : String(row?.[iSkuId] ?? '').trim();
    if (platformProductId === '') continue;
    hasil.push({
      platformProductId,
      platformVariationId: '',
      sellerSku: iSellerSku === -1 ? null : (String(row?.[iSellerSku] ?? '').trim() || null),
      namaProduk: iProductName === -1 ? null : (String(row?.[iProductName] ?? '').trim() || null),
      namaVariasi: iVariation === -1 ? null : (String(row?.[iVariation] ?? '').trim() || null),
      kategoriPlatform: iProductCategory === -1 ? null : (String(row?.[iProductCategory] ?? '').trim() || null),
      hargaSatuanTerakhir: iHarga === -1 ? null : parsePdtAngka(row?.[iHarga]),
    });
  }
  return dedupSkuMaster(hasil);
}

/** `NaN` menang atas angka apa pun saat dijumlah — satu baris yang gagal parse harus TERLIHAT di agregat (Rule 12), bukan diam-diam diperlakukan sebagai 0. */
function tambahAngka(a: number, b: number): number {
  return Number.isNaN(a) || Number.isNaN(b) ? NaN : a + b;
}

/**
 * Satu baris `pdt_fact_sku_period` mentah dari `tt_orders`, SEBELUM
 * `client_platform_id`/`batch_id`/`periode`/`parser_versi`/`basis` (pemanggil
 * yang melengkapi, pola sama `PdtBarisSkuPeriodShopeeAmsProduk`). `sku_id`
 * SELALU `null` di pemanggil — sama alasan `shopee_ams_produk`: `SKU ID`
 * `tt_orders` memang sudah level VARIAN (lihat `ekstrakBarisSkuMasterTtOrders`
 * di atas, yang memakainya sebagai `platformProductId` dengan
 * `platformVariationId` kosong), tapi modul ini tidak melakukan lookup ke
 * `pdt_sku_master` — ia menulis identitas Ads/Seller Center APA ADANYA,
 * persis pola `shopee_ams_produk` (`PDT-TIKET-TT-ORDERS-FAKTA-DIBAYAR`).
 */
export interface PdtBarisFaktaSkuTtOrders {
  platformProductId: string;
  gmv: number;
  pesananSku: number;
  gmvDariKreator: number;
}

/**
 * Ekstrak & AGREGASI baris `tt_orders` (modul `Semua pesanan*.csv`) jadi satu
 * baris `pdt_fact_sku_period` per SKU (`PDT-TIKET-TT-ORDERS-FAKTA-DIBAYAR`,
 * `docs/backlog/PX_M3_BACKLOG.md`). Beda dari SETIAP ekstraktor lain di berkas
 * ini — `tt_orders` adalah data level BARIS PESANAN (banyak baris per SKU per
 * periode), bukan satu baris ringkasan per SKU seperti `shopee_ams_produk` —
 * jadi fungsi ini SATU-SATUNYA yang menjumlahkan lintas-baris (`Map` per
 * `SKU ID`), bukan memetakan 1:1.
 *
 * **`basis = 'dibayar'`**: hanya baris ber-`Order Status` **`Completed`**
 * (dinormalisasi lower-case+trim) yang dihitung — baris status lain (mis.
 * `Unpaid`/`Cancelled`/`Shipped`) DILEWATI SELURUHNYA, tidak menyumbang 0 ke
 * agregat maupun ke `gmv`/`pesanan_sku`/`gmv_dari_kreator`. ⚠️ **Belum
 * diverifikasi ke sample `tt_orders` asli** (dicatat eksplisit di tiket dan
 * `docs/DECISIONS.md`) — literal `'Completed'` diambil dari SATU-SATUNYA
 * nilai yang muncul di fixture repo ini sejauh ini (`fakta.test.ts`,
 * `detect.test.ts`, termasuk baris tersamar `576…`/`17123…` yang tampak
 * berasal dari export asli), bukan dikonfirmasi langsung ke tim PDT.
 *
 * `gmv` = Σ `SKU Subtotal After Discount`, `pesananSku` = Σ `Quantity`,
 * `gmvDariKreator` = Σ `SKU Subtotal After Discount` UNTUK baris yang
 * `Creator Handle`-nya terisi (sinyal afiliasi PX, kolom sudah ada sejak
 * G1-01) — kolom skema `numeric`, jadi ini jumlah GMV, bukan cacah baris.
 * Angka: `parsePdtAngka(v)` TANPA `raw` — konvensi Seller Center, sama seperti
 * `ekstrakBarisSkuMasterTtOrders`. Baris ber-`SKU ID` kosong dilewati (bukan
 * baris data sungguhan, sama pola modul lain di paket ini).
 */
export function ekstrakBarisFaktaSkuTtOrders(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisFaktaSkuTtOrders[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iSkuId = idx('SKU ID');
  const iQuantity = idx('Quantity');
  const iSubtotal = idx('SKU Subtotal After Discount');
  const iStatus = idx('Order Status');
  const iCreator = idx('Creator Handle');

  const byProduk = new Map<string, { gmv: number; pesananSku: number; gmvDariKreator: number }>();
  for (const row of aoa.slice(barisHeader)) {
    const platformProductId = iSkuId === -1 ? '' : String(row?.[iSkuId] ?? '').trim();
    if (platformProductId === '') continue;
    const status = iStatus === -1 ? '' : norm(row?.[iStatus]);
    if (status !== 'completed') continue;

    const subtotal = iSubtotal === -1 ? 0 : parsePdtAngka(row?.[iSubtotal]);
    const qty = iQuantity === -1 ? 0 : parsePdtAngka(row?.[iQuantity]);
    const creatorHandle = iCreator === -1 ? '' : String(row?.[iCreator] ?? '').trim();

    const acc = byProduk.get(platformProductId) ?? { gmv: 0, pesananSku: 0, gmvDariKreator: 0 };
    acc.gmv = tambahAngka(acc.gmv, subtotal);
    acc.pesananSku = tambahAngka(acc.pesananSku, qty);
    if (creatorHandle !== '') acc.gmvDariKreator = tambahAngka(acc.gmvDariKreator, subtotal);
    byProduk.set(platformProductId, acc);
  }

  return [...byProduk.entries()].map(([platformProductId, acc]) => ({ platformProductId, ...acc }));
}

/** Satu baris `pdt_fact_creator_period` mentah dari `tt_transaction_creator`, SEBELUM `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil yang melengkapi, pola sama fungsi lain di paket ini). */
export interface PdtBarisKreatorTtTransactionCreator {
  creatorHandle: string;
  gmv: number | null;
  pesananTeratribusi: number | null;
  aov: number | null;
  ctor: number | null;
  jumlahLive: number | null;
  jumlahVideo: number | null;
}

/**
 * Ekstrak seluruh baris data `tt_transaction_creator` (Rule 8 whitelist
 * `modules.ts`: `['Creator name', 'GMV dari kreator', 'AOV', 'CTOR',
 * 'Pesanan teratribusi', 'Tayangan video', 'Video', 'Siaran LIVE', 'Perkiraan
 * komisi']`). `Tayangan video`/`Perkiraan komisi` SENGAJA tidak dipetakan ke
 * field manapun di sini — konsumennya Co-Pilot/PX (`PDT_KOLOM_DIPANEN.md`
 * §1.4), belum dibangun, BUKAN kolom `pdt_fact_creator_period`. Baris
 * ber-`Creator name` kosong dilewati (kunci NOT NULL `pdt_fact_creator_period`).
 * Angka: `parsePdtAngka(v)` TANPA `raw` — konvensi Seller Center, cermin
 * `report/metrik.ts` `affiliateReport`/`reader()` (dipanggil tanpa flag `raw`).
 */
export function ekstrakBarisKreatorTtTransactionCreator(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisKreatorTtTransactionCreator[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iCreatorName = idx('Creator name');
  const iGmv = idx('GMV dari kreator');
  const iPesanan = idx('Pesanan teratribusi');
  const iAov = idx('AOV');
  const iCtor = idx('CTOR');
  const iVideo = idx('Video');
  const iLive = idx('Siaran LIVE');

  const hasil: PdtBarisKreatorTtTransactionCreator[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const creatorHandle = iCreatorName === -1 ? '' : String(row?.[iCreatorName] ?? '').trim();
    if (creatorHandle === '') continue;
    hasil.push({
      creatorHandle,
      gmv: iGmv === -1 ? null : parsePdtAngka(row?.[iGmv]),
      pesananTeratribusi: iPesanan === -1 ? null : parsePdtAngka(row?.[iPesanan]),
      aov: iAov === -1 ? null : parsePdtAngka(row?.[iAov]),
      ctor: iCtor === -1 ? null : parsePdtAngka(row?.[iCtor]),
      jumlahLive: iLive === -1 ? null : parsePdtAngka(row?.[iLive]),
      jumlahVideo: iVideo === -1 ? null : parsePdtAngka(row?.[iVideo]),
    });
  }
  return hasil;
}

/** Satu baris `pdt_fact_creator_period` mentah dari `shopee_ams_afiliasi`, SEBELUM `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil yang melengkapi). */
export interface PdtBarisKreatorShopeeAmsAfiliasi {
  creatorHandle: string;
  gmv: number | null;
  pesananTeratribusi: number | null;
}

/**
 * Ekstrak seluruh baris data `shopee_ams_afiliasi` (Rule 8 whitelist
 * `modules.ts`: `['ID Affiliates', 'Username Affiliate', 'Omzet
 * Penjualan(Rp)', 'Produk Terjual', 'Pesanan', 'Estimasi Komisi(Rp)', 'ROI']`
 * — ejaan PERSIS sample asli Fim Motor, dikoreksi sesi 20 dari ejaan lama
 * ('Username'/'Omzet'/'Komisi') yang TIDAK PERNAH cocok berkas nyata, lihat
 * docblock kepala berkas). `Username Affiliate` (bukan `ID Affiliates`)
 * dipakai sebagai `creatorHandle` — cermin `report/shopee/metrik.ts`
 * `parseAffCsv` (dipanggil dari `aff_creator`, `nameKws: ['username',
 * 'kreator', 'creator', 'nama']`, kolom NAMA yang dipakai sebagai kunci baris
 * `nm`, bukan ID). `ID Affiliates`/`Produk Terjual` TIDAK dipetakan ke field
 * manapun di sini — `pdt_fact_creator_period` tidak punya kolom untuk
 * keduanya (nol `creator_platform_id` terpisah di tabel ini, beda dari
 * `pdt_fact_content`; `Produk Terjual` = hitungan unit, bukan
 * `pesanan_teratribusi`). `Estimasi Komisi(Rp)`/`ROI` JUGA tidak dipetakan —
 * keduanya sinyal **PX Flow D** (`PDT_KOLOM_DIPANEN.md` §2.10: `komisi`
 * sumber `commission_pct` Shopee), konsumen di domain LAIN
 * (`productexchange`), bukan `pdt_fact_creator_period` — menuliskannya di
 * sini akan mengarang kolom yang tidak diminta whitelist ini. Baris
 * ber-`Username Affiliate` kosong dilewati (kunci NOT NULL
 * `pdt_fact_creator_period`). Angka: `parsePdtAngka(v, true)` — konvensi
 * **Ads Manager**, cermin `parseAffCsv`/`pn(r[ci], true)`.
 */
export function ekstrakBarisKreatorShopeeAmsAfiliasi(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisKreatorShopeeAmsAfiliasi[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iUsername = idx('Username Affiliate');
  const iOmzet = idx('Omzet Penjualan(Rp)');
  const iPesanan = idx('Pesanan');

  const hasil: PdtBarisKreatorShopeeAmsAfiliasi[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const creatorHandle = iUsername === -1 ? '' : String(row?.[iUsername] ?? '').trim();
    if (creatorHandle === '') continue;
    hasil.push({
      creatorHandle,
      gmv: iOmzet === -1 ? null : parsePdtAngka(row?.[iOmzet], true),
      pesananTeratribusi: iPesanan === -1 ? null : parsePdtAngka(row?.[iPesanan], true),
    });
  }
  return hasil;
}

/**
 * Satu baris `pdt_fact_sku_period` mentah dari `shopee_ams_produk`, SEBELUM
 * `client_platform_id`/`batch_id`/`periode`/`parser_versi`/`basis`
 * (pemanggil yang melengkapi — `basis` bukan hasil fungsi ini karena bukan
 * diturunkan dari kolom apa pun di sini, lihat docblock `ekstrakBarisShopeeAmsProduk`).
 * `sku_id` SELALU `null` di pemanggil (level produk-induk, lihat docblock
 * kepala berkas — `G1-09-2BII-ADS-CPC-SKU`).
 */
export interface PdtBarisSkuPeriodShopeeAmsProduk {
  platformProductId: string;
  gmv: number | null;
  produkTerjual: number | null;
  pesanan: number | null;
}

/**
 * Ekstrak seluruh baris data `shopee_ams_produk` (Modul KEDELAPAN, sesi 23
 * — `G1-09-2BII-ADS-CPC-SKU` DITUTUP juga membuka blocker modul ini:
 * `pdt_fact_sku_period.sku_id` sekarang NULLABLE, lihat docblock kepala
 * berkas). Rule 8 whitelist `modules.ts`: `['Kode Item', 'Nama Item',
 * 'Omzet Penjualan(Rp)', 'Produk Terjual', 'Pesanan', 'Estimasi
 * Komisi(Rp)', 'ROI']` — `Nama Item` TIDAK dipetakan (tampilan UI saja,
 * Rule 20 melarangnya jadi kunci). `Estimasi Komisi(Rp)`/`ROI` SENGAJA
 * TIDAK ditulis ke tabel ini — `PDT_KOLOM_DIPANEN.md` §2.10: `Estimasi
 * Komisi(Rp)` adalah sumber `commission_pct` untuk PX Flow D (konsumen
 * domain LAIN, belum dibangun), dan `pdt_fact_sku_period` memang tidak
 * punya kolom komisi/ROI sama sekali — sama pola `shopee_ams_afiliasi`/
 * modul KELIMA di atas. `sku_id` SELALU `null` di pemanggil — `Kode Item`
 * level PRODUK INDUK, `pdt_sku_master` berkunci per varian (lihat docblock
 * kepala berkas, `G1-09-2BII-ADS-CPC-SKU`: pemilik menjawab "kebutuhan
 * hanya GMV per produk bukan sampai varian"). Baris ber-`Kode Item` kosong
 * dilewati (bukan baris data sungguhan, sama pola modul lain di paket ini).
 * **`basis = 'dibayar'`** — DITETAPKAN pemanggil (bukan diturunkan di sini),
 * keputusan pemilik (`AskUserQuestion` sesi 23): AMS tidak menyebutkan
 * basis GMV-nya secara eksplisit (beda dari `shopee_parent_sku`/G1-07 yang
 * memang menulisnya di nama kolom), diperlakukan sebagai "Pesanan
 * Dibayar/Selesai" (lazim untuk program afiliasi — komisi biasanya baru
 * dihitung dari pesanan yang benar-benar selesai, mencegah kecurangan lewat
 * order yang dibatalkan). Angka: `parsePdtAngka(v, true)` — konvensi Ads
 * Manager, sama seperti `shopee_ams_afiliasi` (dashboard AMS yang sama).
 */
export function ekstrakBarisShopeeAmsProduk(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisSkuPeriodShopeeAmsProduk[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iKodeItem = idx('Kode Item');
  const iOmzet = idx('Omzet Penjualan(Rp)');
  const iProdukTerjual = idx('Produk Terjual');
  const iPesanan = idx('Pesanan');

  const hasil: PdtBarisSkuPeriodShopeeAmsProduk[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const platformProductId = iKodeItem === -1 ? '' : String(row?.[iKodeItem] ?? '').trim();
    if (platformProductId === '') continue;
    hasil.push({
      platformProductId,
      gmv: iOmzet === -1 ? null : parsePdtAngka(row?.[iOmzet], true),
      produkTerjual: iProdukTerjual === -1 ? null : parsePdtAngka(row?.[iProdukTerjual], true),
      pesanan: iPesanan === -1 ? null : parsePdtAngka(row?.[iPesanan], true),
    });
  }
  return hasil;
}

/** Satu baris `pdt_fact_ads` mentah dari `shopee_ads_cpc`, SEBELUM `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil yang melengkapi, pola sama fungsi lain di paket ini). `sku_id`/`content_id` SELALU `null` di pemanggil — lihat docblock kepala berkas untuk kenapa (`Kode Produk` level induk, `pdt_sku_master` berkunci per varian). `platformProductId` DIISI (sesi 23, `G1-09-2BII-ADS-CPC-SKU`) — salinan identitas `Kode Produk`, BUKAN lookup ke `pdt_sku_master`. */
export interface PdtBarisAdsShopeeCpc {
  kampanyeId: string;
  platformProductId: string | null;
  tayangan: number | null;
  klik: number | null;
  pesananSku: number | null;
  gmv: number | null;
  biaya: number;
  roas: number | null;
  /** G3-06 — teks mentah kolom `Mode Bidding`. Lihat `bacaTipeKampanyeSumber`. */
  tipeKampanyeSumber: string | null;
}

/**
 * Ekstrak seluruh baris data `shopee_ads_cpc` (Rule 8 whitelist `modules.ts`:
 * `['ID Toko', 'Periode', 'Kode Produk', 'Dilihat', 'Jumlah Klik', 'Konversi',
 * 'Biaya', 'nama iklan', 'omzet penjualan', 'Efektifitas Iklan', 'Biaya Iklan
 * Terhadap Omzet (ACOS) (%)']` — `ID Toko`/`Periode` adalah preamble batch,
 * bukan kolom baris, dan ACOS tidak punya kolom skema `pdt_fact_ads` (dicatat,
 * bukan hilang diam-diam — konsumennya `HealthAds.acos`, domain LAIN).
 * `kampanye_id` memakai `nama iklan` (BUKAN `Kode Produk` — lihat docblock
 * kepala berkas untuk bukti grain PER IKLAN dari sample Fim Motor), cermin
 * PERSIS `parseAdsCsv` legacy (`report/shopee/metrik.ts`, `cNama`). Baris
 * ber-`nama iklan` kosong dilewati (bukan baris data sungguhan — sama alasan
 * legacy: `if (!nama) continue`). Angka: `parsePdtAngka(v, true)` — konvensi
 * Ads Manager, sama seperti `shopee_ads_live`.
 *
 * `platformProductId` (sesi 23, `G1-09-2BII-ADS-CPC-SKU` DITUTUP — pemilik:
 * "kebutuhan hanya GMV per produk bukan sampai varian") — `Kode Produk`
 * disalin LANGSUNG (bukan lookup `pdt_sku_master`, yang berkunci per
 * varian). Nilai `'-'` (sample "Shop GMV Max" Fim Motor asli, iklan TOKO
 * tanpa produk) dan sel kosong SAMA-SAMA dipetakan `null`, BUKAN string
 * literal `'-'` — `'-'` bukan identitas produk sungguhan.
 */
export function ekstrakBarisShopeeAdsCpc(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisAdsShopeeCpc[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iKampanye = idx('nama iklan');
  const iKodeProduk = idx('Kode Produk');
  const iTayangan = idx('Dilihat');
  const iKlik = idx('Jumlah Klik');
  const iPesanan = idx('Konversi');
  const iGmv = idx('omzet penjualan');
  const iBiaya = idx('Biaya');
  const iRoas = idx('Efektifitas Iklan');
  const iTipe = idx('Mode Bidding'); // G3-06

  const hasil: PdtBarisAdsShopeeCpc[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const kampanyeId = iKampanye === -1 ? '' : String(row?.[iKampanye] ?? '').trim();
    if (kampanyeId === '') continue;
    const kodeProduk = iKodeProduk === -1 ? '' : String(row?.[iKodeProduk] ?? '').trim();
    hasil.push({
      kampanyeId,
      platformProductId: kodeProduk === '' || kodeProduk === '-' ? null : kodeProduk,
      tayangan: iTayangan === -1 ? null : parsePdtAngka(row?.[iTayangan], true),
      klik: iKlik === -1 ? null : parsePdtAngka(row?.[iKlik], true),
      pesananSku: iPesanan === -1 ? null : parsePdtAngka(row?.[iPesanan], true),
      gmv: iGmv === -1 ? null : parsePdtAngka(row?.[iGmv], true),
      biaya: iBiaya === -1 ? 0 : parsePdtAngka(row?.[iBiaya], true),
      roas: iRoas === -1 ? null : parsePdtAngka(row?.[iRoas], true),
      tipeKampanyeSumber: bacaTipeKampanyeSumber(row, iTipe),
    });
  }
  return hasil;
}

/** Satu baris `pdt_fact_ads` mentah dari `shopee_ads_search`, SEBELUM `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil yang melengkapi). */
export interface PdtBarisAdsShopeeSearch {
  kampanyeId: string;
  tayangan: number | null;
  klik: number | null;
  pesananSku: number | null;
  gmv: number | null;
  biaya: number;
  roas: number | null;
  /**
   * G3-06 — teks mentah kolom `Mode Bidding`. Nama kolomnya SAMA dengan
   * `shopee_ads_cpc` tapi artinya tidak: laporan ini Search Ads (punya kolom
   * `Kata Pencarian`), jadi 'Bidding Manual' di sini berarti bidding manual
   * atas KATA KUNCI. Pembedaannya dilakukan pemeta di `packages/domain` lewat
   * `sumber` baris itu, bukan dengan menebak dari teksnya saja.
   */
  tipeKampanyeSumber: string | null;
}

/**
 * Ekstrak seluruh baris data `shopee_ads_search` (Modul KETUJUH — lihat
 * docblock kepala berkas untuk kenapa blocker `G1-09-2BII-ADS-SEARCH`
 * akhirnya ditutup sesi ini). Rule 8 whitelist `modules.ts`: `['Jumlah
 * Klik', 'Konversi', 'Nama Iklan', 'Biaya']` — `Kata Pencarian` DIBACA di
 * sini untuk membentuk `kampanye_id` KOMPOSIT tapi SENGAJA TIDAK ditambah
 * ke `kolomDipanen` (Q-6 masih DITAHAN, isinya belum boleh jadi dimensi
 * laporan). `kampanye_id` memakai `` `${namaIklan} :: ${kataPencarian}` ``
 * (bukan `nama iklan` polos seperti `shopee_ads_cpc`) — lihat docblock
 * kepala berkas untuk alasan lengkap. Baris ber-`Nama Iklan` kosong
 * dilewati (bukan baris data sungguhan — sama pola `shopee_ads_cpc`/
 * `shopee_ads_live`). Angka: `parsePdtAngka(v, true)` — konvensi Ads
 * Manager, sama seperti `shopee_ads_cpc`/`shopee_ads_live` (berkas dari
 * dashboard yang sama).
 */
export function ekstrakBarisShopeeAdsSearch(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisAdsShopeeSearch[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iKampanye = idx('Nama Iklan');
  const iKataPencarian = idx('Kata Pencarian');
  const iTayangan = idx('Dilihat');
  const iKlik = idx('Jumlah Klik');
  const iPesanan = idx('Konversi');
  const iGmv = idx('Omzet Penjualan');
  const iBiaya = idx('Biaya');
  const iRoas = idx('Efektifitas Iklan');
  const iTipe = idx('Mode Bidding'); // G3-06

  const hasil: PdtBarisAdsShopeeSearch[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const namaIklan = iKampanye === -1 ? '' : String(row?.[iKampanye] ?? '').trim();
    if (namaIklan === '') continue;
    const kataPencarian = iKataPencarian === -1 ? '' : String(row?.[iKataPencarian] ?? '').trim();
    hasil.push({
      kampanyeId: `${namaIklan} :: ${kataPencarian}`,
      tayangan: iTayangan === -1 ? null : parsePdtAngka(row?.[iTayangan], true),
      klik: iKlik === -1 ? null : parsePdtAngka(row?.[iKlik], true),
      pesananSku: iPesanan === -1 ? null : parsePdtAngka(row?.[iPesanan], true),
      gmv: iGmv === -1 ? null : parsePdtAngka(row?.[iGmv], true),
      biaya: iBiaya === -1 ? 0 : parsePdtAngka(row?.[iBiaya], true),
      roas: iRoas === -1 ? null : parsePdtAngka(row?.[iRoas], true),
      tipeKampanyeSumber: bacaTipeKampanyeSumber(row, iTipe),
    });
  }
  return hasil;
}

/** Satu baris `pdt_fact_shop_daily` mentah dari `tt_shop_analytics`, SEBELUM `client_platform_id`/`batch_id`/`basis`/`parser_versi` (pemanggil yang melengkapi). */
export interface PdtBarisShopDailyTiktok {
  tanggal: string;
  gmv: number;
  pesanan: number;
  produkTerjual: number | null;
  pengunjung: number | null;
  produkDiklik: number | null;
  cr: number | null;
  pembeli: number | null;
  refund: number | null;
}

/**
 * Ekstrak baris harian `tt_shop_analytics` → `pdt_fact_shop_daily` (basis
 * `'net'`, Rule 15). **Ditemukan saat riset G2-01 (sesi 34)**: keenam tabel
 * fakta G1-01 sudah punya penulis KECUALI `pdt_fact_shop_daily` — nol
 * pemanggil menulisnya sejak lahir, celah yang lolos dari seluruh sesi
 * G1-09 sub-langkah 2b-ii sebelumnya (sembilan modul lain sudah dipetakan,
 * tabel ini tidak pernah masuk daftar kandidat) padahal ia yang paling
 * mendasar (GMV harian shop-level, prasyarat mesin skor G2). Dicatat
 * `docs/DECISIONS.md` sebagai celah yang ditemukan, bukan diselundupkan diam-diam.
 *
 * Sample asli ("Tiktok - Avitaskin.zip", `Shop Analytics_Key metrics_*.xlsx`)
 * TERNYATA membawa dua blok dalam SATU sheet: "Ringkasan data" (baris total
 * periode penuh, sudah dipakai `parseTiktokShopAnalytics`/G1-07 rekonsiliasi)
 * DAN "Data harian" (satu baris per tanggal, kolom identik) — bukan bentuk
 * yang `barisHeader` modul (menunjuk header "Ringkasan data") bisa jangkau,
 * jadi fungsi ini mencari marker `'Data harian'` SENDIRI di dalam `aoa` yang
 * sama, independen dari `barisHeader` yang dipakai fungsi rekonsiliasi.
 *
 * `gmv`/`refund` disalin APA ADANYA (GMV kotor per hari, refund kotor per
 * hari) — TIDAK di-net-kan di sini. `pdt_fact_shop_daily.gmv` menyimpan
 * angka MENTAH per basis (persis seperti tiga basis Shopee yang juga
 * menyimpan angka mentah per status pesanan, bukan hasil akhir yang sudah
 * diolah); "Rule 15: TikTok = GMV − refund" adalah kontrak KONSUMEN (mesin
 * skor G2 menghitung `gmv - refund` saat membaca, sama pola `kpiToko()`
 * mesin lama yang membedakan `gmv`/`gmvKotor`), bukan sesuatu yang dibakukan
 * ke satu kolom saat tulis — dua kolom terpisah (`gmv`, `refund`) TETAP
 * dibutuhkan agar laporan bisa menampilkan GMV kotor DAN net sekaligus,
 * persis seperti mesin lama menampilkan keduanya.
 *
 * "Pengembalian dana" memakai `'-'` untuk hari tanpa refund (bukan `0`) —
 * `parsePdtAngka('-')` sengaja mengembalikan `NaN` (G1-03, dibedakan dari sel
 * kosong), BUKAN dianggap 0 di sini; menerka `'-'` selalu berarti nol adalah
 * persis kelas asumsi yang G1-03 hindari. `NaN` yang tersimpan di kolom
 * `refund` terlihat oleh konsumen (Postgres `numeric` mendukung `NaN`
 * sebagai nilai sah), bukan diam-diam jadi 0.
 */
export function ekstrakBarisShopDailyTiktok(aoa: readonly (readonly unknown[])[]): PdtBarisShopDailyTiktok[] {
  const idxMarker = aoa.findIndex((row) => norm(row?.[0]) === 'data harian');
  if (idxMarker === -1) return [];
  const header = aoa[idxMarker + 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iTanggal = idx('Tanggal');
  const iGmv = idx('GMV');
  const iPesanan = idx('Pesanan');
  const iProdukTerjual = idx('Produk terjual');
  const iPengunjung = idx('Pengunjung');
  const iKlik = idx('Klik produk');
  const iCr = idx('Persentase konversi');
  const iPembeli = idx('Pembeli');
  const iRefund = idx('Pengembalian dana');

  const hasil: PdtBarisShopDailyTiktok[] = [];
  for (const row of aoa.slice(idxMarker + 2)) {
    const tanggalRaw = iTanggal === -1 ? '' : String(row?.[iTanggal] ?? '').trim();
    if (tanggalRaw === '') continue;
    const tanggal = parseTanggalId(tanggalRaw);
    if (tanggal == null) continue;
    hasil.push({
      tanggal,
      gmv: iGmv === -1 ? 0 : parsePdtAngka(row?.[iGmv]),
      pesanan: iPesanan === -1 ? 0 : parsePdtAngka(row?.[iPesanan]),
      produkTerjual: iProdukTerjual === -1 ? null : parsePdtAngka(row?.[iProdukTerjual]),
      pengunjung: iPengunjung === -1 ? null : parsePdtAngka(row?.[iPengunjung]),
      produkDiklik: iKlik === -1 ? null : parsePdtAngka(row?.[iKlik]),
      cr: iCr === -1 ? null : parsePdtAngka(row?.[iCr]),
      pembeli: iPembeli === -1 ? null : parsePdtAngka(row?.[iPembeli]),
      refund: iRefund === -1 ? null : parsePdtAngka(row?.[iRefund]),
    });
  }
  return hasil;
}

/** Satu baris `pdt_fact_shop_daily` mentah dari `shopee_shop_stats` (satu basis), SEBELUM `client_platform_id`/`batch_id`/`basis`/`parser_versi` (pemanggil yang melengkapi — `basis` bergantung SHEET mana yang dipanggil, fungsi ini generik untuk ketiganya). */
export interface PdtBarisShopDailyShopee {
  tanggal: string;
  gmv: number;
  pesanan: number;
  produkDiklik: number | null;
  pengunjung: number | null;
  cr: number | null;
  pembeli: number | null;
  pembeliBaru: number | null;
  refund: number | null;
  pesananDibatalkan: number | null;
}

/**
 * Ekstrak baris harian SATU sheet basis `shopee_shop_stats` →
 * `pdt_fact_shop_daily` (G1-09-2BII-SHOPDAILY-SHOPEE, ditemukan+ditutup sesi
 * 34 lanjutan — dicatat sebagai gap eksplisit sejak `ekstrakBarisShopDailyTiktok`
 * ditutup TikTok-saja). Sample asli ("Shopee - Fim Motor.zip",
 * `fim_motor.shopee-shop-stats.*.xlsx`) TERNYATA membawa TIGA SHEET terpisah
 * bernama persis `'Pesanan Dibuat'`/`'Pesanan Siap Dikirim'`/`'Pesanan
 * Dibayar'` (Rule 16 — tiga basis TIDAK PERNAH dicampur) — bukan tiga section
 * dalam satu sheet seperti bentuk TikTok. Modul `shopee_shop_stats` sudah
 * mengunci `namaSheet` ke SATU basis ('Siap Dikirim', default laporan klien);
 * `sheetTambahan` (`modules.ts`, baru sesi ini) menambahkan dua sheet lain
 * KHUSUS untuk ekstraksi — fungsi ini dipanggil TIGA KALI oleh domain layer,
 * sekali per sheet, `aoa` masing-masing diambil dari `input.sheets.get(nama)`.
 *
 * Bentuk tiap sheet SAMA PERSIS: header di baris 1 (`aoa[0]`), ringkasan
 * PERIODE PENUH di baris 2 (`aoa[1]`, sudah dipakai
 * `parseShopeeShopStatsBasisTerisolasi`/rekonsiliasi — kolom `Tanggal` berisi
 * RENTANG `DD-MM-YYYY-DD-MM-YYYY`, bukan satu tanggal), baris kosong, HEADER
 * BERULANG persis identik, baru baris harian. Fungsi ini mencari kemunculan
 * KEDUA kolom `'Tanggal'` di kolom pertama (baris ringkasan TIDAK PERNAH lolos
 * — isinya rentang, bukan `'tanggal'`) — Rule 7 "dicari, bukan diasumsikan",
 * pola sama `ekstrakBarisShopDailyTiktok` tapi marker berupa HEADER BERULANG,
 * bukan teks penanda seksi.
 *
 * **Tanggal berformat STRIP** (`DD-MM-YYYY`, BUKAN slash seperti preamble
 * Shopee lain) — `parseTanggalIdStrip` (`identitas.ts`, baru sesi ini),
 * diverifikasi langsung dari sample ("01-07-2026").
 *
 * **`pesananDibatalkan`** (G2-01-SHOPEE-CANCEL-REPEAT-RATE, separuh — cancelRate
 * SAJA, repeatRate ditunda sengaja keputusan pemilik) — konsumen
 * `PdtSkorInputPesananDibuatShopee.cancelRate` (pemanggil menghitung rasio
 * Σ/Σ terhadap `pesanan`, sama pola `cr`). `'Penjualan Dibatalkan'` (nilai
 * Rupiah, BUKAN hitungan) SENGAJA TIDAK dipetakan — nol konsumen hari ini
 * (`scoreConv` mesin lama hanya memakai hitungan pesanan, lihat migrasi
 * `20261105010000`). **`'Tingkat Pembelian Berulang'` (repeat rate) SENGAJA
 * TIDAK dipetakan di sini** — metrik "pembeli unik beli >1x SATU PERIODE
 * PENUH" tidak bisa direkonstruksi dari Σ/rata-rata baris HARIAN (beda kelas
 * dari `cr`/`cancelRate` yang aditif); `pdt_fact_shop_daily` yang berskema
 * PER HARI bukan "rumah" yang tepat — ditunda sampai pola penyimpanan
 * metrik per-periode diputuskan (lihat migrasi `20261105010000` untuk
 * rincian lengkap, `docs/DECISIONS.md`).
 */
export function ekstrakBarisShopDailyShopee(aoa: readonly (readonly unknown[])[]): PdtBarisShopDailyShopee[] {
  const idxHeaderHarian = aoa.findIndex((row, i) => i > 0 && norm(row?.[0]) === 'tanggal');
  if (idxHeaderHarian === -1) return [];
  const header = aoa[idxHeaderHarian] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iTanggal = idx('Tanggal');
  const iGmv = idx('Total Penjualan (IDR)');
  const iPesanan = idx('Total Pesanan');
  const iKlik = idx('Produk Diklik');
  const iPengunjung = idx('Total Pengunjung');
  const iCr = idx('Tingkat Konversi Pesanan');
  const iPembeli = idx('Pembeli');
  const iPembeliBaru = idx('Total Pembeli Baru');
  const iRefund = idx('Penjualan Dikembalikan');
  const iPesananDibatalkan = idx('Pesanan Dibatalkan');

  const hasil: PdtBarisShopDailyShopee[] = [];
  for (const row of aoa.slice(idxHeaderHarian + 1)) {
    const tanggalRaw = iTanggal === -1 ? '' : String(row?.[iTanggal] ?? '').trim();
    if (tanggalRaw === '') continue;
    const tanggal = parseTanggalIdStrip(tanggalRaw);
    if (tanggal == null) continue;
    hasil.push({
      tanggal,
      gmv: iGmv === -1 ? 0 : parsePdtAngka(row?.[iGmv]),
      pesanan: iPesanan === -1 ? 0 : parsePdtAngka(row?.[iPesanan]),
      produkDiklik: iKlik === -1 ? null : parsePdtAngka(row?.[iKlik]),
      pengunjung: iPengunjung === -1 ? null : parsePdtAngka(row?.[iPengunjung]),
      cr: iCr === -1 ? null : parsePdtAngka(row?.[iCr]),
      pembeli: iPembeli === -1 ? null : parsePdtAngka(row?.[iPembeli]),
      pembeliBaru: iPembeliBaru === -1 ? null : parsePdtAngka(row?.[iPembeliBaru]),
      refund: iRefund === -1 ? null : parsePdtAngka(row?.[iRefund]),
      pesananDibatalkan: iPesananDibatalkan === -1 ? null : parsePdtAngka(row?.[iPesananDibatalkan]),
    });
  }
  return hasil;
}

/**
 * Satu baris `pdt_fact_sku_period` mentah dari `tt_product_analytics`,
 * SEBELUM `client_platform_id`/`batch_id`/`periode`/`parser_versi`/`basis`
 * (pemanggil yang melengkapi). `sku_id` SELALU `null` di pemanggil — `ID
 * Produk` level PRODUK INDUK, sama keputusan pemilik `G1-09-2BII-ADS-CPC-SKU`
 * ("kebutuhan hanya GMV per produk bukan sampai varian") yang sudah
 * diterapkan `shopee_ams_produk`/`tt_ads_product` (lihat docblock kepala
 * berkas untuk keduanya).
 */
export interface PdtBarisSkuPeriodTtProductAnalytics {
  platformProductId: string;
  namaProduk: string | null;
  gmv: number | null;
  gmvDariKreator: number | null;
  gmvVideoPenjual: number | null;
  gmvLivePenjual: number | null;
  pesananSku: number | null;
  impresi: number | null;
  klik: number | null;
  ctr: number | null;
  ctor: number | null;
}

/**
 * Ekstrak seluruh baris data `tt_product_analytics` — langkah pertama
 * `G2-01-KUADRAN-SKU` (riset sesi 34, dicatat `docs/backlog/PDT_BACKLOG.md`:
 * dimensi Portfolio Produk `computeSkorTiktok` butuh `pdt_fact_sku_period`
 * TERISI per SKU, kolom sudah ada sejak G1-01 tapi belum ada penulisnya sama
 * sekali untuk TikTok — beda dari Shopee yang sudah punya `shopee_ams_produk`).
 *
 * Bentuk berkas TERVERIFIKASI sample asli ("Tiktok - Avitaskin.zip",
 * `product_list_20260701.xlsx`) via `G1-07-TIKTOK-REKONSILIASI` (lihat
 * docblock kepala berkas `rekonsiliasi.ts`): laporan LEBAR dengan header
 * BERULANG per kelompok kategori kolom (`'Semua'`/`'LIVE penjual'`/`'Video
 * penjual'`/dst berulang per blok) — `header.findIndex` (kecocokan PERTAMA)
 * mengambil kolom di bawah kelompok `'Semua'` (grand total), TERBUKTI benar
 * secara aritmetika terhadap `sumTiktokProductAnalyticsGmv` (fungsi
 * rekonsiliasi yang sama, sudah diverifikasi Σ = Σ shop-level). `barisHeader`
 * mengikuti `PdtModuleDef.barisHeaderHint` (`modules.ts`: `4`, Rule 7
 * "product_list baris 4"), sama kontrak pemanggil dengan fungsi lain di
 * berkas ini.
 *
 * Rule 8 whitelist `modules.ts` (`tt_product_analytics.kolomDipanen`):
 * `'Produk terjual'`/`'Status daftar produk'`/`'AOV'` TIDAK dipetakan ke
 * kolom manapun di sini — `'Produk terjual'` TIDAK dipanen modul ini sama
 * sekali (beda dari `shopee_ams_produk`, jadi `produk_terjual` TETAP `null`
 * di `pdt_fact_sku_period` untuk baris TikTok, bukan celah — kolomnya memang
 * tidak pernah masuk whitelist); `'Status daftar produk'` tidak punya kolom
 * skema padanan; `'AOV'` tidak punya kolom skema padanan (sama pola
 * `Estimasi Komisi(Rp)`/`ROI` di `shopee_ams_produk`). **`'Nama'` DIPETAKAN
 * sejak `G2-01-KUADRAN-SKU` (lanjutan, bagian laporan "produk")** — disalin
 * LANGSUNG (bukan lookup, TAMPILAN UI SAJA, Rule 20) ke `namaProduk`,
 * `pdt_fact_sku_period.nama_produk` (migrasi `20261108010000`).
 *
 * `sku_id` SELALU `null` di pemanggil, `platformProductId` = `'ID Produk'`
 * disalin LANGSUNG (bukan lookup `pdt_sku_master`). Baris ber-`ID Produk`
 * kosong dilewati (bukan baris data sungguhan, sama pola modul lain di
 * berkas ini). Angka: `parsePdtAngka(v)` TANPA flag Ads Manager — berkas ini
 * dari Seller Center Analytics, keluarga yang sama dengan `tt_shop_analytics`/
 * `ekstrakBarisShopDailyTiktok` (bukan dashboard Ads Manager).
 */
export function ekstrakBarisTtProductAnalytics(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisSkuPeriodTtProductAnalytics[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = pencariKolom(header, 'tt_product_analytics'); // sadar-alias (Rule 9)
  const iIdProduk = idx('ID Produk');
  const iNama = idx('Nama');
  const iGmv = idx('GMV');
  const iGmvKreator = idx('GMV dari kreator');
  const iGmvVideo = idx('GMV dari video penjual');
  const iGmvLive = idx('GMV dari LIVE penjual');
  const iPesananSku = idx('Pesanan SKU');
  const iImpresi = idx('Impresi produk');
  const iKlik = idx('Klik produk');
  const iCtr = idx('CTR'); // kolom `CTR` polos MEMANG ada di berkas nyata — bukan salah eja
  const iCtor = idx('CTOR (pesanan SKU)'); // dikoreksi sesi 43; `CTOR` polos tetap jalan lewat alias

  const hasil: PdtBarisSkuPeriodTtProductAnalytics[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const platformProductId = iIdProduk === -1 ? '' : String(row?.[iIdProduk] ?? '').trim();
    if (platformProductId === '') continue;
    hasil.push({
      platformProductId,
      namaProduk: iNama === -1 ? null : (String(row?.[iNama] ?? '').trim() || null),
      gmv: iGmv === -1 ? null : parsePdtAngka(row?.[iGmv]),
      gmvDariKreator: iGmvKreator === -1 ? null : parsePdtAngka(row?.[iGmvKreator]),
      gmvVideoPenjual: iGmvVideo === -1 ? null : parsePdtAngka(row?.[iGmvVideo]),
      gmvLivePenjual: iGmvLive === -1 ? null : parsePdtAngka(row?.[iGmvLive]),
      pesananSku: iPesananSku === -1 ? null : parsePdtAngka(row?.[iPesananSku]),
      impresi: iImpresi === -1 ? null : parsePdtAngka(row?.[iImpresi]),
      klik: iKlik === -1 ? null : parsePdtAngka(row?.[iKlik]),
      ctr: iCtr === -1 ? null : parsePdtAngka(row?.[iCtr]),
      ctor: iCtor === -1 ? null : parsePdtAngka(row?.[iCtor]),
    });
  }
  return hasil;
}

/**
 * Satu baris `pdt_fact_kesehatan_penalti` mentah dari `shopee_kesehatan`,
 * SEBELUM `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil
 * yang melengkapi). Nol identitas natural — pemanggil replace-on-recommit,
 * sama pola `pdt_fact_ads` (sku_id/content_id selalu null).
 */
export interface PdtBarisKesehatanShopee {
  poin: number;
  deskripsi: string;
  durasi: string;
}

/**
 * Ekstrak seluruh baris `shopee_kesehatan` (G2-01-SHOPEE-KESEHATAN-WRITER) —
 * modul PALING sederhana di registry (`modules.ts`: "seluruh sheet hanya 3
 * kolom", `barisHeaderHint: 1`, nol preamble) — satu baris = satu pelanggaran
 * aktif. Cermin `report/shopee/metrik.ts` `parseKesehatan`: baris ber-`Poin
 * Penalti` KOSONG DAN `Deskripsi` kosong dilewati (bukan baris data
 * sungguhan — beda dari modul lain di berkas ini yang memakai SATU kolom
 * identitas untuk filter, di sini dua kolom sekaligus karena `Poin Penalti`
 * `0` yang genuinely valid tidak boleh disalahartikan "baris kosong").
 * Sheet TANPA satu pun baris data (toko bersih, nol penalti) mengembalikan
 * array kosong — pemanggil (`rakitInputSkorShopee`) yang membedakan "nol
 * penalti" dari "modul tidak pernah diunggah" lewat `pdt_file`/`pdt_upload_batch`
 * (pola sama `PdtSkorInputLiveShopee.diunggah`), bukan dari baris fakta.
 */
export function ekstrakBarisKesehatanShopee(aoa: readonly (readonly unknown[])[], barisHeader: number): PdtBarisKesehatanShopee[] {
  const header = aoa[barisHeader - 1] ?? [];
  // Sadar-alias (Rule 9): ekspor nyata menulis `Poin Pinalti`/`Pinalti Berjalan`,
  // whitelist-nya `Poin Penalti`/`Deskripsi`. Keduanya sah — lihat `PDT_KOLOM_ALIAS`.
  const idx = pencariKolom(header, 'shopee_kesehatan');
  const iPoin = idx('Poin Penalti');
  const iDeskripsi = idx('Deskripsi');
  const iDurasi = idx('Durasi');

  const hasil: PdtBarisKesehatanShopee[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const deskripsi = iDeskripsi === -1 ? '' : String(row?.[iDeskripsi] ?? '').trim();
    const poinRaw = iPoin === -1 ? null : row?.[iPoin];
    const poinKosong = poinRaw == null || String(poinRaw).trim() === '';
    if (poinKosong && deskripsi === '') continue;
    hasil.push({
      poin: poinKosong ? 0 : parsePdtAngka(poinRaw),
      deskripsi,
      durasi: iDurasi === -1 ? '' : String(row?.[iDurasi] ?? '').trim(),
    });
  }
  return hasil;
}

/**
 * Satu baris `pdt_fact_layanan_chat` mentah dari `shopee_chat` ("Performa
 * Chat", sheet "Kriteria Utama"), SEBELUM `client_platform_id`/`batch_id`/
 * `periode`/`parser_versi` (pemanggil yang melengkapi). G3-02a —
 * `chatResponseRatePersen`/`chatResponseMenit` (Section B-4.2) sebelum ini
 * tidak pernah punya tabel fakta (`docs/backlog/PDT_BACKLOG.md` G3-02).
 * `chatMasuk`/`chatDibalas` disimpan MENTAH, bukan rasio pra-hitung —
 * pemanggil (`pdt-prefill.ts`) yang menjumlahkan (Σnumerator/Σdenominator,
 * pola sama seluruh rasio PDT lain). `tingkatKonversiChatDibalas` (kolom
 * `Tingkat Konversi (Chat Dibalas)`) disimpan APA ADANYA sebagai insight —
 * SENGAJA BUKAN pengganti response rate (`modules.ts` `shopee_chat` sudah
 * mendokumentasikan dua kolom ini semantiknya beda).
 */
export interface PdtBarisLayananChatShopee {
  pengunjung: number | null;
  chatMasuk: number | null;
  chatDibalas: number | null;
  waktuResponDetik: number | null;
  csatPersen: number | null;
  totalPesanan: number | null;
  penjualan: number | null;
  tingkatKonversiChatDibalas: number | null;
}

/**
 * Ekstrak baris `shopee_chat` (G3-02a) — sheet "Kriteria Utama" SATU baris
 * ringkasan periode (cermin `report/shopee/metrik.ts` `parseChat`'s
 * `rows[iH+1]`), bukan daftar per-chat individual. Baris tanpa `Periode
 * Waktu` terisi dilewati (bukan baris data sungguhan). Angka dibaca format
 * Seller Center (titik ribuan/koma desimal, BUKAN Ads Manager — modul ini
 * bukan ekspor AMS, pola sama `shopee_live`/`shopee_shop_stats`, beda dari
 * `shopee_ads_*`/`shopee_ams_*` yang `raw=true`).
 */
export function ekstrakBarisLayananChatShopee(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisLayananChatShopee[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iPeriode = idx('Periode Waktu');
  const iPengunjung = idx('Pengunjung');
  const iChatMasuk = idx('Jumlah Chat');
  const iChatDibalas = idx('Chat Dibalas');
  const iWaktuRespon = idx('Waktu Respon Rata-rata');
  const iCsat = idx('CSAT %');
  const iTotalPesanan = idx('Total Pesanan');
  const iPenjualan = idx('Penjualan (IDR)');
  const iKonversiChatDibalas = idx('Tingkat Konversi (Chat Dibalas)');

  const hasil: PdtBarisLayananChatShopee[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const periode = iPeriode === -1 ? '' : String(row?.[iPeriode] ?? '').trim();
    if (periode === '') continue;
    hasil.push({
      pengunjung: iPengunjung === -1 ? null : parsePdtAngka(row?.[iPengunjung]),
      chatMasuk: iChatMasuk === -1 ? null : parsePdtAngka(row?.[iChatMasuk]),
      chatDibalas: iChatDibalas === -1 ? null : parsePdtAngka(row?.[iChatDibalas]),
      waktuResponDetik: iWaktuRespon === -1 ? null : parsePdtAngka(row?.[iWaktuRespon]),
      csatPersen: iCsat === -1 ? null : parsePdtAngka(row?.[iCsat]),
      totalPesanan: iTotalPesanan === -1 ? null : parsePdtAngka(row?.[iTotalPesanan]),
      penjualan: iPenjualan === -1 ? null : parsePdtAngka(row?.[iPenjualan]),
      tingkatKonversiChatDibalas: iKonversiChatDibalas === -1 ? null : parsePdtAngka(row?.[iKonversiChatDibalas]),
    });
  }
  return hasil;
}

/**
 * Satu baris `pdt_fact_promo` mentah dari `shopee_diskon` atau
 * `shopee_flash_sale`, SEBELUM `client_platform_id`/`batch_id`/`periode`/
 * `parser_versi` (pemanggil yang melengkapi — pola sama fungsi lain di berkas
 * ini). G4-03 aksi 4.
 */
export interface PdtBarisPromoShopee {
  /**
   * HANYA terisi untuk `shopee_diskon`. `'Semua'` adalah total periode yang
   * SUDAH di-dedup oleh Shopee; nilai lain adalah KOMPONEN yang boleh saling
   * tumpang tindih. `null` untuk flash sale (berkasnya nol dimensi tipe).
   */
  tipePromosi: string | null;
  penjualanDibuat: number | null;
  penjualanSiapDikirim: number | null;
  pesananDibuat: number | null;
  pesananSiapDikirim: number | null;
  /** HANYA `shopee_flash_sale` — satu-satunya kolom yang diskon tidak punya. */
  produkDilihat: number | null;
  produkDiklik: number | null;
}

/**
 * Ekstrak sheet "Kriteria Utama" `shopee_diskon` (G4-03 aksi 4).
 *
 * ⚠️ **Fungsi ini mengembalikan SELURUH baris, termasuk `Tipe Promosi='Semua'`,
 * dan pemanggilnya TIDAK BOLEH menjumlahkannya.** Baris `'Semua'` bukan jumlah
 * baris lain — ia MEN-DEDUP: satu pesanan bisa membawa beberapa tipe promosi
 * sekaligus (produk ber-Diskon yang juga masuk Paket Diskon), jadi ia muncul di
 * kedua baris komponen dan dihitung SEKALI di `'Semua'`.
 *
 * Diverifikasi ke berkas nyata, dan ini hanya ketahuan karena ada klien kelima:
 * pada 5 dari 6 klien Σ komponen KEBETULAN sama persis dengan `'Semua'`. Pada
 * klien keenam tidak — Σ komponen Rp444.444.312 vs `'Semua'` Rp354.987.431,
 * 25% lebih tinggi. Menjumlahkan tabel ini adalah bug kelas
 * `G1-07-SHOPEE-DOBEL-HITUNG` (lihat `rekonsiliasi.ts` `sumShopeeParentSkuGmv`).
 *
 * Baris ber-`Tanggal` kosong dilewati (bukan baris data). Sheet "Grafik setiap
 * Kriteria" (rincian HARIAN, header identik) dan "Rincian Performa" (per promosi
 * individual) TIDAK diekstrak di sini — `modules.ts` sudah menetapkan cakupan MVP
 * "hanya agregat sheet Kriteria Utama"; pemanggil memilih sheet-nya lewat
 * `PdtModuleDef.namaSheet`.
 */
export function ekstrakBarisPromoDiskonShopee(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisPromoShopee[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = pencariKolom(header, 'shopee_diskon');
  const iTanggal = idx('Tanggal');
  const iTipe = idx('Tipe Promosi');
  const iJualDibuat = idx('Penjualan (Pesanan Dibuat) (IDR)');
  const iJualSiap = idx('Penjualan (Pesanan Siap Dikirim) (IDR)');
  const iPesDibuat = idx('Pesanan (Pesanan Dibuat)');
  const iPesSiap = idx('Pesanan (Pesanan Siap Dikirim)');

  const hasil: PdtBarisPromoShopee[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const tanggal = iTanggal === -1 ? '' : String(row?.[iTanggal] ?? '').trim();
    if (tanggal === '') continue;
    const tipe = iTipe === -1 ? '' : String(row?.[iTipe] ?? '').trim();
    hasil.push({
      tipePromosi: tipe === '' ? null : tipe,
      penjualanDibuat: iJualDibuat === -1 ? null : parsePdtAngka(row?.[iJualDibuat]),
      penjualanSiapDikirim: iJualSiap === -1 ? null : parsePdtAngka(row?.[iJualSiap]),
      pesananDibuat: iPesDibuat === -1 ? null : parsePdtAngka(row?.[iPesDibuat]),
      pesananSiapDikirim: iPesSiap === -1 ? null : parsePdtAngka(row?.[iPesSiap]),
      produkDilihat: null, // kolom funnel HANYA ada di flash sale
      produkDiklik: null,
    });
  }
  return hasil;
}

/**
 * Ekstrak sheet "Kriteria Utama" `shopee_flash_sale` (G4-03 aksi 4).
 *
 * Bentuknya BEDA dari diskon meski nama sheet-nya sama, dan bedanya tidak boleh
 * disamakan diam-diam:
 *  - kunci barisnya `Periode Waktu` (bukan `Tanggal`), dan hanya ADA SATU baris
 *    data — agregat seluruh periode, nol dimensi tipe promosi;
 *  - kolom uangnya bersufiks `(Rp)` TANPA spasi (`Penjualan (Pesanan Dibuat)(Rp)`),
 *    sementara diskon memakai ` (IDR)` dengan spasi. Menyalin ejaan diskon ke sini
 *    akan menghasilkan seluruh kolom `null` tanpa satu pun error — kelas kegagalan
 *    senyap yang sama yang baru saja menelan lima whitelist (sesi 43);
 *  - `Jumlah Produk Dilihat`/`Produk Diklik` adalah satu-satunya hal yang flash
 *    sale punya dan diskon tidak (dan juga tanda tangan deteksinya).
 *
 * Berkas ber-nol baris data (flash sale tidak pernah dijalankan periode itu)
 * mengembalikan array kosong — BEDA dari baris ber-angka nol, yang berarti
 * dijalankan tapi nol hasil. Pemanggil membedakan keduanya lewat `pdt_file`/
 * `pdt_upload_batch`, pola sama `ekstrakBarisKesehatanShopee`.
 */
export function ekstrakBarisPromoFlashSaleShopee(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisPromoShopee[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = pencariKolom(header, 'shopee_flash_sale');
  const iPeriode = idx('Periode Waktu');
  const iJualDibuat = idx('Penjualan (Pesanan Dibuat)(Rp)');
  const iJualSiap = idx('Penjualan (Pesanan Siap Dikirim)(Rp)');
  const iPesDibuat = idx('Pesanan (Pesanan Dibuat)');
  const iPesSiap = idx('Pesanan (Pesanan Siap Dikirim)');
  const iDilihat = idx('Jumlah Produk Dilihat');
  const iDiklik = idx('Produk Diklik');

  const hasil: PdtBarisPromoShopee[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const periode = iPeriode === -1 ? '' : String(row?.[iPeriode] ?? '').trim();
    if (periode === '') continue;
    hasil.push({
      tipePromosi: null, // flash sale nol dimensi tipe — dijaga CHECK di DB juga
      penjualanDibuat: iJualDibuat === -1 ? null : parsePdtAngka(row?.[iJualDibuat]),
      penjualanSiapDikirim: iJualSiap === -1 ? null : parsePdtAngka(row?.[iJualSiap]),
      pesananDibuat: iPesDibuat === -1 ? null : parsePdtAngka(row?.[iPesDibuat]),
      pesananSiapDikirim: iPesSiap === -1 ? null : parsePdtAngka(row?.[iPesSiap]),
      produkDilihat: iDilihat === -1 ? null : parsePdtAngka(row?.[iDilihat]),
      produkDiklik: iDiklik === -1 ? null : parsePdtAngka(row?.[iDiklik]),
    });
  }
  return hasil;
}
