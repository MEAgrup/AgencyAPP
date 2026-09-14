# HANDOFF — PDT (Pusat Data Toko) SESI 15 → SESI 16

> **Dibuat 2026-09-14.** Baca berkas ini sebelum lanjut (rantai: … → sesi 14 →
> berkas ini; `docs/handoff/HANDOFF_PDT_SESI14.md` untuk konteks modul
> pertama `shopee_ads_live` kalau perlu). Instruksi sesi ini: lanjutkan
> G1-09 sub-langkah 2b-ii ke **modul KEDUA**.
>
> **Status: G1-09 sub-langkah 2b-ii — DUA modul dari 25.** `tt_video` →
> `pdt_fact_content` SELESAI dan berjalan dari `commitUploadBatch`, di atas
> `shopee_ads_live` → `pdt_fact_ads` (sesi 14). Dua tabel fakta (dari enam)
> sekarang punya penulis.

---

## 0. Ringkasan 60 detik

Rekomendasi sesi 14 menyebut `tt_video` sebagai kandidat modul kedua
("kolomnya paling verified") TAPI dengan caveat eksplisit: belum semua
kolom (`Likes`/`Dibagikan`/`Klik Produk`) terkonfirmasi dipakai, dan format
`Waktu` belum diverifikasi. **Investigasi sesi ini (bukan percaya framing
lama apa adanya) menemukan:**

- **`Likes`/`Dibagikan`/`Klik Produk` TERNYATA AMAN dipanen** — sesi 14
  hanya mengecek `adsscanner/tiktok/metrik.ts` `attachVideos` (yang memang
  TIDAK membacanya), tapi TIDAK mengecek `baseline/metrik.ts` `video()` dan
  `report/metrik.ts` `videoRows()` — dua fungsi TERVERIFIKASI lama yang
  membaca ketiganya sebagai passthrough numerik biasa (`n(r['Likes'])` dkk).
  Ketiganya sekarang dipanen ke `pdt_fact_content.likes`/`dibagikan`/
  `klik_produk`.
- **`waktu_posting` TETAP NULL** — caveat sesi 14 benar. Nol parser
  TERVERIFIKASI untuk format kolom `Waktu` modul ini di SELURUH repo. Satu
  petunjuk PARSIAL: `baseline/metrik.ts` `video()` mencocokkan
  `waktu.startsWith(tahun+'/'+bulan)` — menyiratkan awalan `YYYY/MM`, TAPI
  tidak cukup untuk parser timestamp penuh (format hari/jam/menit
  sesudahnya belum pernah diverifikasi ke sample asli). Beda dari `Waktu
  Live` milik `tt_live`, yang PUNYA parser terverifikasi penuh
  (`report/metrik.ts` `parseWaktuLive`, format `YYYY/MM/DD HH:MM`).
- **`sku_id` TETAP NULL** — `pdt_sku_master` belum dibangun, sama alasan
  `shopee_ads_cpc` (sesi 14).
- **`komentar` (kolom `pdt_fact_content`) TIDAK diisi dari `tt_video`** —
  `Komentar` bukan bagian `kolomDipanen` modul ini SAMA SEKALI (beda dari
  Likes/Dibagikan/Klik Produk yang MEMANG ada di whitelist) — bukan celah,
  memang bukan cakupan modul ini per `PDT_KOLOM_DIPANEN.md` §1.5.
- **`is_akun_toko` — fungsi BARU**, PERTAMA yang menurunkan boolean PER
  BARIS dari `ID Kreator` vs `client_platforms.akun_konten_toko` (pola sama
  `validasiIdentitasTiktok` Rule 3-4, tapi verdict per baris bukan per
  file). `NOT NULL DEFAULT false` di skema.
- **Idempotensi: `ON CONFLICT DO UPDATE` SUNGGUHAN** — beda dari
  `shopee_ads_live`/`pdt_fact_ads` (delete-then-insert, sesi 14). Kunci unik
  `pdt_fact_content` (`client_platform_id, platform_content_id`) TIDAK
  PERNAH punya komponen NULL (`ID Video` selalu ada untuk baris yang
  ditulis), jadi Postgres bisa mencocokkan conflict target — pola upsert
  standar, TERBUKTI valid untuk modul fakta yang kuncinya bersih.

**Efek samping penting — BUG test-fixture ditemukan & diperbaiki:**
`packages/domain/src/pdt.test.ts` `insertClientPlatform` memakai
`${JSON.stringify(akunKontenToko)}::jsonb` — **DOUBLE-ENCODE**, PERSIS
kelas bug yang `commitUploadBatch` sendiri sudah temukan+perbaiki
sub-langkah 2a. Nilai tersimpan sebagai jsonb SCALAR STRING (`jsonb_typeof`
= `'string'`, diverifikasi psql langsung), BUKAN array. Baru ketahuan sesi
ini karena tes `tt_video` identitas `'tolak'` PERTAMA KALI menembus
`validasiIdentitasTiktok` cabang `tolak` dengan `akunKontenToko`
NON-KOSONG (`.join(', ')` melempar `TypeError` pada string). **SELURUH tes
TikTok `cocok`/`usulkan_ikat` SEBELUMNYA "kebetulan lolos"** karena
`.includes()` pada STRING adalah substring-match yang kebetulan
menghasilkan verdict yang sama seperti keanggotaan array sungguhan untuk
nilai-nilai yang dipakai — risiko nyata: false-positive substring (mis.
`'KR-1'` cocok di dalam `'["KR-10"]'`). **Bukan bug produksi** — nol
pemanggil produksi menulis `akun_konten_toko` hari ini (endpoint konfirmasi
AM belum ada). Diperbaiki: `sql.json(akunKontenToko as never)`, TANPA
`JSON.stringify`/`::jsonb` manual.

**Juga diperbaiki**: `apps/api/.../pdt/batches/route.test.ts` `afterEach`
menambah cleanup `pdt_fact_ads`/`pdt_fact_content` (FK ke
`pdt_upload_batch`) — fixture ZIP TikTok nyata di berkas itu membawa
`tt_video`, jadi sejak commit ini menulis baris fakta, cleanup lama
(tanpa membersihkan baris fakta dulu) gagal FK saat menghapus
`pdt_upload_batch`.

Diverifikasi (sandbox, `db-rebuild.sh --yes` bersih — lihat §2.4 untuk
angka final): `@cdps/core`, `@cdps/domain`, `@cdps/db`, `@cdps/api` semua
hijau kecuali SATU kegagalan pra-ada `gelombang-c-showcase.e2e.test.ts`
(tidak berubah dari sesi-sesi sebelumnya); `npm run typecheck` bersih
seluruh workspace; `npm run lint -w @cdps/api -- --max-warnings 0` bersih.

---

## 1. Yang perlu ditindaklanjuti sesi berikutnya

1. **Rekomendasi utama — lanjutkan sub-langkah 2b-ii ke modul KETIGA.**
   Kandidat yang perlu diverifikasi (jangan warisi tanpa cek ulang, sama
   peringatan sesi 14):
   - **`pdt_sku_master`** (upsert `Kode Produk`/SKU TikTok → `id`, Rule 19:
     SKU tidak pernah dihapus) — PRASYARAT untuk `shopee_ads_cpc`,
     `pdt_fact_sku_period`, dan `sku_id` di `pdt_fact_content`/
     `pdt_fact_ads` manapun. Kemungkinan target PALING BERHARGA sesi
     berikutnya karena membuka BANYAK modul sekaligus, bukan cuma satu —
     tapi juga PALING RUMIT (strategi upsert lintas platform, `Kode Produk`
     Shopee vs `ID Produk`/`ID produk` TikTok, `status_listing`/
     `last_seen_at`).
   - **`tt_live` → `pdt_fact_content` (jenis='live') — BLOCKED, dicatat
     `G1-09-2BII-TTLIVE` (Open, `docs/DECISIONS.md`).** `kolomDipanen`
     modul ini (`modules.ts`: `['ID Kreator', 'Waktu Live', 'Durasi', 'GMV
     dari LIVE (Rp)', 'Produk Terjual', 'Penonton', 'CTOR', 'Kreator']`)
     TIDAK PUNYA satu pun kolom identitas konten/sesi live (beda dari
     `tt_video` yang punya `ID Video`) — `pdt_fact_content.platform_
     content_id` NOT NULL DAN kunci unik, jadi TIDAK ADA baris yang bisa
     ditulis sama sekali dari whitelist ini. JANGAN coba pakai `Waktu Live`
     atau `ID Kreator`+`Waktu Live` gabungan sebagai pengganti tanpa
     verifikasi ke sample asli (satu kreator bisa live berkali-kali per
     hari — kombinasi itu BUKAN jaminan unik).
   - **`shopee_video`/`shopee_live`** — PDT_KOLOM_DIPANEN §2.6-2.7 bilang
     modul ini "lengkap terhadap konsumen yang diverifikasi" — BELUM dicek
     sesi ini apakah kolom identitas kontennya (video/live Shopee) cukup
     untuk `pdt_fact_content.platform_content_id` seperti `tt_video`.
     Kandidat yang belum diinvestigasi sama sekali — mungkin lebih siap
     dari `tt_live`.
   - **`shopee_ads_cpc`/`shopee_ads_search`** — JANGAN dikerjakan sebelum
     `pdt_sku_master` (cpc) atau jawaban Q-6/sample asli (search) — lihat
     `G1-09-2BII-ADS-CPC`/`G1-09-2BII-ADS-SEARCH`, `docs/DECISIONS.md`
     (tidak berubah sesi ini).
2. **PR #368** — statusnya BELUM dicek ulang sesi ini (masih di branch
   sesi, belum jadi bagian PR mana pun sejak sesi 14). Cek status terbaru
   sebelum memutuskan menumpuk atau membuka PR baru.
3. Item lama masih terbuka, tidak tersentuh sesi ini: `G1-07-PERSKU-
   PESANAN`, `G1-07-TIKTOK-REKONSILIASI`, `G1-09-DETEKSI-PREAMBLE-AMBIGU`,
   `G1-08-SEBAGIAN`, `G1-06-PERIODE-TIKTOK`, `G1-07-PERSKU-DIBAYAR`.
4. G1-09 sub-langkah 3 (halaman upload `web-internal`) dan endpoint
   konfirmasi identitas AM (`usulkan_ikat`) — masih belum ada.
5. **Bug jsonb double-encoding** — hanya diperbaiki di fixture test
   (`insertClientPlatform`). Kalau/ketika endpoint konfirmasi AM (§1 butir
   4 di atas / handoff lama) menulis `client_platforms.akun_konten_toko`
   sungguhan, pastikan penulisnya memakai `sql.json(value)`, BUKAN
   `${JSON.stringify(value)}::jsonb` — precedent bug ini (dan yang
   ditemukan sub-langkah 2a untuk `identitas_sumber`) menunjukkan pola
   salah ini gampang terulang.

---

## 2. Detail teknis — `tt_video` → `pdt_fact_content`

### 2.1 Berkas baru/diubah

| Berkas | Isi |
|---|---|
| `packages/core/src/pdt/fakta.ts` (+5 tes) | `ekstrakBarisTtVideo(aoa, barisHeader, akunKontenToko)` — fungsi murni |
| `packages/domain/src/pdt.ts` (+4 tes `pdt.test.ts`) | `commitUploadBatch` menulis `pdt_fact_content` (ON CONFLICT DO UPDATE) untuk berkas `tt_video` ber-status `ok` |
| `packages/domain/src/pdt.test.ts` | fixture `insertClientPlatform` — bug jsonb double-encoding diperbaiki (`sql.json` bukan `JSON.stringify`+`::jsonb`); +cleanup `pdt_fact_content` di `afterEach` |
| `apps/api/.../pdt/batches/route.test.ts` | cleanup `pdt_fact_ads`/`pdt_fact_content` ditambahkan ke `afterEach` (FK, fixture ZIP TikTok nyata membawa `tt_video`) |
| `docs/DECISIONS.md` | 1 baris Decided (teratas) |
| `docs/backlog/PDT_BACKLOG.md` | catatan status G1-09 (2b-ii modul kedua) |

### 2.2 Kontrak & keputusan penting

Lihat `docs/DECISIONS.md` baris teratas (2026-09-14, entri PALING atas)
untuk penjelasan lengkap. Ringkasnya ada di §0 di atas — poin tambahan:

- **Angka: `parsePdtAngka(v)` TANPA `raw`** — konvensi **Seller Center**
  (titik ribuan, koma desimal), **BEDA dari `shopee_ads_live` (Ads
  Manager)**. Cermin `baseline/metrik.ts` `video()` yang memanggil
  `n(r['VV'])` dkk TANPA flag `raw`. **Kalau modul KETIGA nanti dibangun,
  cek dulu konvensi angkanya sendiri** — jangan asumsikan salah satu dari
  dua konvensi berlaku universal.
- **Baris kosong dilewati berdasar `ID Video` kosong** (bukan `ID Video`
  ATAU `Informasi Video`, beda dari `baseline/metrik.ts` `video()` yang
  memakai OR — disederhanakan karena `platform_content_id` yang NOT NULL
  di skema, bukan `Informasi Video`).

### 2.3 Yang BELUM dilakukan (sengaja)

- `tt_live` → `pdt_fact_content` — BLOCKED, `G1-09-2BII-TTLIVE` (Open baru
  sesi ini, `docs/DECISIONS.md`) — lihat §1 butir 1.
- `shopee_video`/`shopee_live` → `pdt_fact_content` — belum diinvestigasi.
- `pdt_sku_master`, `pdt_fact_sku_period`, `pdt_fact_shop_daily`,
  `pdt_fact_creator_period` — NOL modul dipetakan ke empat tabel ini.
- `shopee_ads_cpc`/`shopee_ads_search` → `pdt_fact_ads` — tidak berubah
  dari sesi 14 (`G1-09-2BII-ADS-CPC`/`G1-09-2BII-ADS-SEARCH`).
- Halaman upload `web-internal`, endpoint konfirmasi identitas AM — tidak
  berubah.

### 2.4 Verifikasi (angka final, DB dibangun ulang bersih)

`@cdps/core` **1155/1155**, `@cdps/domain` **2558/2559** (1 skip
`wave1_uat.e2e`, tidak berubah), `@cdps/db` **107/107**, `@cdps/api`
**555/569** (14 skip) kecuali SATU kegagalan pra-ada
`gelombang-c-showcase.e2e.test.ts` (bug fixture `client_platforms`
collision, dikonfirmasi berulang sesi 2-15, BUKAN regresi sesi ini);
`npm run typecheck` bersih seluruh workspace; `npm run lint -w @cdps/api
-- --max-warnings 0` bersih.

---

## 3. Rujukan

- `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` §6.2 — tabel `pdt_fact_content`.
- `docs/backlog/PDT_KOLOM_DIPANEN.md` §1.5-1.6 — `tt_video`/`tt_live`,
  rinci kolom + kenapa `tt_live` blocked (temuan sesi ini, belum dicatat
  di berkas ini sendiri — cek `docs/DECISIONS.md` dulu).
- `docs/DECISIONS.md` — baris teratas (2026-09-14, sub-langkah 2b-ii modul
  kedua + bug jsonb fixture).
- `packages/core/src/pdt/fakta.ts` + `.test.ts` — `ekstrakBarisTtVideo`.
- `packages/domain/src/pdt.ts` `commitUploadBatch` (bagian `pdt_fact_content`) +
  `packages/domain/src/pdt.test.ts` (describeDb "baris fakta tt_video").
- `packages/core/src/baseline/metrik.ts` `video()` + `packages/core/src/report/metrik.ts`
  `videoRows()` — pembaca TERVERIFIKASI legacy yang jadi rujukan kolom+konvensi angka.
- `packages/core/src/report/metrik.ts` `parseWaktuLive` — parser format
  `Waktu Live` (`tt_live`) TERVERIFIKASI, RUJUKAN untuk kalau `Waktu` video
  akhirnya diverifikasi juga (pola yang sama, bukan tebakan baru).
- `docs/handoff/HANDOFF_PDT_SESI14.md` — riwayat modul pertama
  (`shopee_ads_live`).
