# HANDOFF — PDT (Pusat Data Toko) SESI 14 → SESI 15

> **Dibuat 2026-09-14.** Baca berkas ini sebelum lanjut (rantai: … → sesi 13 →
> berkas ini; `docs/handoff/HANDOFF_PDT_SESI13.md` untuk konteks rekonsiliasi
> 2b-i kalau perlu). Instruksi sesi ini: lanjutkan rekomendasi utama sesi 13
> §1 butir 1 — **G1-09 sub-langkah 2b-ii (baris fakta tertipe), mulai dari
> SATU modul untuk membuktikan pola**.
>
> **Status: G1-09 sub-langkah 2b-ii DIMULAI (SATU modul dari 25).**
> `shopee_ads_live` → `pdt_fact_ads` SELESAI dan berjalan dari
> `commitUploadBatch`. Sesi ini berkomitmen langsung ke branch/histori PR
> #368 (`claude/handoff-sesi10-build-gei0gn` — 2a+2b-i, MASIH OPEN, belum
> di-review manusia saat sesi ini mulai) karena kode 2b-ii menyentuh persis
> `commitUploadBatch` yang sama; commit sesi ini berada di branch sesi
> (`claude/bold-ride-83f352`, fast-forward dari tip PR #368) — **PR belum
> dibuat/diupdate sesi ini**, sesi berikutnya/manusia yang memutuskan apakah
> menumpuk ke PR #368 yang sama atau membuka PR baru begitu #368 di-merge.
> `shopee_ads_cpc`/`shopee_ads_search` **BELUM** dipetakan — masing-masing
> punya blocker BERBEDA yang baru ketahuan saat membangun, bukan sekadar
> "belum sempat" (lihat §1, §2, `docs/DECISIONS.md`).

---

## 0. Ringkasan 60 detik

Rekomendasi sesi 13 menyebut `shopee_ads_cpc`/`shopee_ads_search`/
`shopee_ads_live` sebagai "sama-sama termudah, skema kolom cocok 1:1,
nol turunan rumit" untuk `pdt_fact_ads`. **Investigasi sesi ini menemukan
itu TIDAK BENAR untuk dua dari tiga modul:**

- **`shopee_ads_live` — dipetakan, SELESAI.** Baris datanya PER KAMPANYE,
  bukan per produk, dan kolom `ID Iklan` (`kolomDipanen`, `modules.ts`)
  sudah unik per baris per periode — `sku_id`/`content_id` (`pdt_fact_ads`)
  boleh NULL karena modul ini memang tidak punya keduanya, bukan ditunda.
  Nol ketergantungan ke `pdt_sku_master`.
- **`shopee_ads_cpc` — BELUM, blocker: `pdt_sku_master` belum ada.** Baris
  datanya PER PRODUK (`Kode Produk`) — `PDT_KOLOM_DIPANEN.md` §2.3 sendiri
  menulis "konsumen: `pdt_fact_ads.sku_id`" untuk kolom ini. Tapi `sku_id`
  adalah FK ke `pdt_sku_master`, yang belum dibangun sub-langkah mana pun.
  Tanpa itu, satu-satunya kandidat `kampanye_id` lain (`nama iklan`) TIDAK
  membedakan produk berbeda di kampanye+periode yang sama — kunci unik
  `pdt_fact_ads` kolaps, baris insert terakhir menimpa yang sebelumnya
  secara SENYAP dalam commit yang sama. Persis kelas bug Rule 13-16
  dibangun untuk mencegah, dipindahkan ke tabel fakta.
- **`shopee_ads_search` — BELUM, blocker: `kolomDipanen` tidak cukup,
  titik.** `modules.ts` mendaftarkan modul ini dengan `kolomDipanen:
  ['klik', 'konversi']` SAJA (bucket 3 `Kata Pencarian`/`SOV` DITAHAN
  menunggu Anty, Q-6). Nol kolom `biaya` (`pdt_fact_ads.biaya` NOT NULL di
  skema) dan nol kolom identitas kampanye/produk apa pun. Ini bukan soal
  join yang belum siap (beda dari `shopee_ads_cpc`) — datanya sendiri
  genuinely tidak cukup untuk satu baris `pdt_fact_ads` yang sah.

Kedua gap dicatat Open baru di `docs/DECISIONS.md`
(`G1-09-2BII-ADS-CPC`/`G1-09-2BII-ADS-SEARCH`) — **bukan dipaksakan/
ditebak**, konsisten CLAUDE.md ("jangan invent fields/mapping yang tidak
ada dasarnya").

**Yang dibangun**: `packages/core/src/pdt/fakta.ts`
(`ekstrakBarisShopeeAdsLive`, fungsi murni, 5 tes) + `commitUploadBatch`
(`packages/domain/src/pdt.ts`) menulis `pdt_fact_ads` di transaksi yang
sama dengan `pdt_upload_batch`/`pdt_file` (4 tes baru `pdt.test.ts`).
Angka pakai `parsePdtAngka(v, true)` (konvensi Ads Manager, cermin
`report/shopee/metrik.ts` `parseAdsLive` — satu-satunya pembaca
TERVERIFIKASI bentuk berkas ini). `periode` = AWAL BULAN (Q-3, bukan
`periode.mulai` batch apa adanya). Idempotensi commit-ulang: **replace**
(DELETE toko+sumber+periode ini lalu INSERT ulang, satu transaksi) —
BUKAN `ON CONFLICT`, karena `sku_id`/`content_id` SELALU NULL untuk modul
ini dan Postgres tidak pernah menganggap NULL=NULL untuk keunikan (lihat
`docs/DECISIONS.md` untuk detail lengkap kenapa `ON CONFLICT` tidak aman
di sini). Baris fakta ditulis untuk identitas `cocok`/`tidak_dapat_
divalidasi`/`usulkan_ikat` — HANYA `tolak` (mismatch toko nyata) yang
membuat NOL baris ditulis.

**Koreksi catatan lama**: komentar `commitUploadBatch` dan
`HANDOFF_PDT_SESI12.md`/`SESI13.md` menyebut baris fakta sebagai
"PRD Flow A langkah 8" — **keliru**. PRD §4 Flow A eksplisit: langkah 6
"Parse selektif → tulis baris fakta sesuai whitelist (Rule 8)", langkah 8
"Sistem menghitung: skor per dimensi, kuadran SKU, usulan, prefill semua
form hilir" (KONSUMEN baris fakta, bukan penulisnya). Dikoreksi di komentar
`pdt.ts` sesi ini — tidak mengubah PRD/kode lain yang menyebutnya.

Diverifikasi (sandbox, `db-rebuild.sh --yes` + `npm install` — node_modules
tidak ter-install di awal sesi, dipasang ulang): `@cdps/core` **1150/1150**,
`@cdps/domain` **2554/2555** (1 skip `wave1_uat.e2e`, tidak berubah),
`@cdps/db` **107/107**, `@cdps/api` **555/569** (14 skip) kecuali SATU
kegagalan pra-ada `gelombang-c-showcase.e2e.test.ts` (bug fixture
`client_platforms` collision, dikonfirmasi berulang sesi 2-13, BUKAN
regresi sesi ini); `npm run typecheck` bersih seluruh workspace; `npm run
lint -w @cdps/api -- --max-warnings 0` bersih. `web-internal`/`wire.ts`
**TIDAK disentuh** — baris fakta belum punya konsumen wire/UI (halaman
upload masih sub-langkah 3, belum ada).

---

## 1. Yang perlu ditindaklanjuti sesi berikutnya

1. **Rekomendasi utama — lanjutkan sub-langkah 2b-ii ke modul KEDUA.**
   Kandidat yang PALING dekat siap, berdasarkan pembacaan sesi ini (belum
   final — verifikasi ulang sebelum membangun, jangan warisi asumsi ini
   tanpa cek):
   - **`tt_video` → `pdt_fact_content`** (kunci `(client_platform_id,
     platform_content_id)` — migrasi G1-01 sendiri sudah berkomentar
     `platform_content_id` = "'ID Video' TikTok"). `kolomDipanen` modul ini
     (`modules.ts`: `['ID Kreator', 'ID Video', 'Waktu', 'Produk', 'VV',
     'Likes', 'Dibagikan', 'Klik Produk', 'Nama Kreator', 'Informasi
     Video', 'GPM (Rp)', 'GMV dari video (Rp)']`) tumpang tindih BESAR
     dengan `packages/core/src/adsscanner/tiktok/metrik.ts` `attachVideos`
     (pembaca TERVERIFIKASI: `VV`, `GMV dari video (Rp)`, `GPM (Rp)`,
     `Nama Kreator`, `ID Video`, `Informasi Video`, `Waktu`, `Produk`,
     `ID Kreator`) — TAPI belum semua kolom (`Likes`/`Dibagikan`/`Klik
     Produk`) terkonfirmasi dipakai di sana, dan format tanggal `Waktu`
     BELUM diverifikasi (legacy menyimpannya sebagai STRING mentah, tidak
     pernah di-parse ke Date) — kalau dibangun, `waktu_posting` (kolom
     `timestamptz`) sebaiknya tetap NULL sampai formatnya jelas, sama pola
     `sku_id` di `shopee_ads_live` (defer eksplisit, bukan tebak format
     tanggal). `sku_id`/`is_akun_toko` juga perlu keputusan sendiri
     (`is_akun_toko` diturunkan dari `client_platforms.akun_konten_toko`
     membandingkan `ID Kreator` — pola sama `validasiIdentitasTiktok` Rule
     4, tapi belum ditulis).
   - **`shopee_ads_cpc`/`shopee_ads_search`** — JANGAN dikerjakan sebelum
     `pdt_sku_master` (untuk cpc) atau jawaban Q-6/sample asli (untuk
     search) — lihat `G1-09-2BII-ADS-CPC`/`G1-09-2BII-ADS-SEARCH`,
     `docs/DECISIONS.md`.
   - **`pdt_sku_master`** sendiri (upsert `Kode Produk`/SKU TikTok → `id`,
     Rule 19: SKU tidak pernah dihapus, hanya `status_listing`/
     `last_seen_at` berubah) adalah PRASYARAT untuk `shopee_ads_cpc` DAN
     `pdt_fact_sku_period` — kemungkinan layak jadi target sesi berikutnya
     kalau ingin membuka BANYAK modul sekaligus, bukan cuma satu.
2. **PR #368 (`claude/handoff-sesi10-build-gei0gn`)** — cek status
   TERBARU dulu sebelum apa pun. Saat sesi ini MULAI: masih OPEN, ready
   for review, satu kegagalan CI pra-ada (tidak berubah), belum ada review
   manusia. Sesi ini TIDAK menyentuh PR itu (kerja di branch sesi,
   fast-forward dari tipnya) — commit 2b-ii ini belum jadi bagian PR mana
   pun. **Klaude TIDAK meng-approve/merge PR — itu keputusan manusia.**
3. Item lama masih terbuka, tidak tersentuh sesi ini: `G1-07-PERSKU-
   PESANAN`, `G1-07-TIKTOK-REKONSILIASI`, `G1-09-DETEKSI-PREAMBLE-AMBIGU`,
   `G1-08-SEBAGIAN`, `G1-06-PERIODE-TIKTOK`, `G1-07-PERSKU-DIBAYAR`.
4. G1-09 sub-langkah 3 (halaman upload `web-internal`) dan endpoint
   konfirmasi identitas AM (`usulkan_ikat`) — masih belum ada, tidak
   berubah dari sesi 13.

---

## 2. Detail teknis — `shopee_ads_live` → `pdt_fact_ads`

### 2.1 Berkas baru/diubah

| Berkas | Isi |
|---|---|
| `packages/core/src/pdt/fakta.ts` (baru, +5 tes) | `ekstrakBarisShopeeAdsLive(aoa, barisHeader)` — fungsi murni, baca kolom `ID Iklan`/`Penonton`/`Pesanan`/`Omzet`/`Biaya`/`Efektifitas Iklan`, `parsePdtAngka(v, true)` |
| `packages/domain/src/pdt.ts` (+4 tes `pdt.test.ts`) | `commitUploadBatch` menulis `pdt_fact_ads` untuk berkas `shopee_ads_live` ber-status `ok`, dalam transaksi yang sama dengan `pdt_upload_batch`/`pdt_file` |
| `docs/DECISIONS.md` | 1 baris Decided (teratas) + 2 baris Open baru (`G1-09-2BII-ADS-CPC`, `G1-09-2BII-ADS-SEARCH`) |
| `docs/backlog/PDT_BACKLOG.md` | catatan status G1-09 (2b-ii dimulai) |

### 2.2 Kontrak & keputusan penting

Lihat `docs/DECISIONS.md` baris teratas (2026-09-14, entri PALING atas)
untuk penjelasan lengkap. Ringkasnya:

- **Kenapa `shopee_ads_live`, bukan `shopee_ads_cpc`/`shopee_ads_search`
  juga** — lihat §0 di atas.
- **Gerbang penulisan**: identitas `tolak` (SATU-SATUNYA) ⇒ NOL baris
  fakta ditulis (data toko yang salah tidak boleh mengotori toko ini).
  `cocok`/`tidak_dapat_divalidasi`/`usulkan_ikat` ⇒ baris fakta TETAP
  ditulis — beda dari gerbang rekonsiliasi (2b-i) yang JUGA mengecualikan
  `usulkan_ikat` (soal "belum layak dilaporkan ke klien", bukan "data ini
  milik toko yang salah").
- **`periode` = AWAL BULAN** (`periode.mulai.slice(0,7)+'-01'`), BUKAN
  `periode.mulai` batch apa adanya — Q-3 (`docs/DECISIONS.md`
  2026-09-13) mengunci `pdt_fact_*.periode` ke awal bulan untuk partisi
  bulanan nanti (DDL murni).
- **Idempotensi commit-ulang = REPLACE, bukan `ON CONFLICT`.** `sku_id`/
  `content_id` SELALU NULL untuk modul ini (bagian `uq_pdt_fact_ads`) —
  Postgres tidak pernah menganggap NULL=NULL untuk keunikan, jadi
  `ON CONFLICT` TIDAK AKAN PERNAH cocok pada commit ulang periode yang
  sama (akan menambah baris duplikat, bukan menimpa). Jalan yang dipakai:
  DELETE baris `(client_platform_id, sumber='shopee_ads_live', periode)`
  ini lebih dulu, lalu INSERT ulang dari batch yang sedang commit — satu
  transaksi, sah karena baris fakta adalah data TURUNAN yang selalu bisa
  dihitung ulang (aturan rumah #4), bukan riwayat immutable (itu
  `audit_log`).
- **Angka**: `parsePdtAngka(v, true)` (parameter `raw=true`) — konvensi
  **Ads Manager** (titik desimal, koma ribuan), BUKAN konvensi Seller
  Center (default fungsi tanpa `raw`). Cermin `report/shopee/metrik.ts`
  `parseAdsLive`/`pn(r[ci], true)` — satu-satunya pembaca TERVERIFIKASI
  bentuk berkas ini sebelum PDT ada. **Kalau modul KEDUA nanti dibangun,
  cek dulu apakah modul itu juga Ads Manager atau Seller Center** — jangan
  asumsikan `raw=true` berlaku universal untuk semua modul PDT.
- Diverifikasi (sandbox): lihat §0 untuk angka lengkap.

### 2.3 Yang BELUM dilakukan (sengaja)

- `shopee_ads_cpc`/`shopee_ads_search` → `pdt_fact_ads` — §1 butir 1,
  Open `G1-09-2BII-ADS-CPC`/`G1-09-2BII-ADS-SEARCH`.
- `pdt_sku_master`, `pdt_fact_sku_period`, `pdt_fact_content`,
  `pdt_fact_shop_daily`, `pdt_fact_creator_period` — NOL modul dipetakan
  ke lima tabel ini sama sekali. `pdt_fact_ads` sendiri baru 1 dari 6
  modul yang bisa menulisnya (`shopee_ads_live`; `shopee_ads_cpc`/
  `shopee_ads_search`/`tt_ads_product`/`tt_ads_live` belum).
- Halaman upload `web-internal` (sub-langkah 3), endpoint konfirmasi
  identitas AM — tidak berubah dari sesi 13.

---

## 3. Rujukan

- `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` — Flow A langkah 6 (baris fakta,
  BUKAN langkah 8 — lihat koreksi §0), §6.2 (tabel `pdt_fact_ads` dkk).
- `docs/backlog/PDT_KOLOM_DIPANEN.md` §2.3-2.5 — `shopee_ads_cpc`/
  `search`/`live`, rinci kolom + kenapa `shopee_ads_cpc`/`search` blocked.
- `docs/DECISIONS.md` — baris teratas (2026-09-14, sub-langkah 2b-ii) +
  dua Open baru (`G1-09-2BII-ADS-CPC`/`G1-09-2BII-ADS-SEARCH`).
- `packages/core/src/pdt/fakta.ts` + `.test.ts` — mesin baru, `shopee_ads_live`.
- `packages/domain/src/pdt.ts` `commitUploadBatch` (bagian baris fakta) +
  `packages/domain/src/pdt.test.ts` (describeDb "baris fakta shopee_ads_live").
- `packages/core/src/report/shopee/metrik.ts` `parseAdsLive` — pembaca
  TERVERIFIKASI legacy yang jadi rujukan konvensi angka + kolom.
- `docs/handoff/HANDOFF_PDT_SESI13.md` — riwayat sub-langkah 2b-i
  (rekonsiliasi Shopee).
