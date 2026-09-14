# HANDOFF — PDT (Pusat Data Toko) SESI 12 → SESI 13

> **Dibuat 2026-09-14.** Baca berkas ini sebelum lanjut (rantai: … → sesi 11 →
> berkas ini; `docs/handoff/HANDOFF_PDT_SESI11.md` untuk konteks
> G1-09-BODY-BESAR kalau perlu). Instruksi sesi ini: "lanjutkan build" (link
> ke `HANDOFF_PDT_SESI10.md` di GitHub — TERNYATA sudah tidak mutakhir, lihat
> catatan di bawah). Sesi 11 §1 butir 1 merekomendasikan mulai G1-09
> sub-langkah 2 (commit); **sesi ini yang mengerjakannya.**
>
> **Catatan penting soal urutan handoff:** tautan yang diberikan ke sesi ini
> menunjuk `HANDOFF_PDT_SESI10.md`, tapi `main` SUDAH MAJU satu PR lagi
> (#366, "G1-09-BODY-BESAR") yang PUNYA handoff-nya sendiri
> (`HANDOFF_PDT_SESI11.md`, ditulis sesi yang sama dengan PR itu, sudah
> merge) — bukan gap dokumentasi seperti dugaan awal sesi ini, hanya tautan
> yang diberikan sudah basi satu langkah. **Verifikasi ini dengan
> `git log origin/main` + `ls docs/handoff/` SEBELUM mengasumsikan handoff
> mana yang mencerminkan `main` terkini** — jangan percaya nomor di tautan
> yang diberikan begitu saja.
>
> **Status: G1-09 sub-langkah 2a (commit) SELESAI.** Belum ada PR/merge saat
> berkas ini ditulis — lihat status PR di GitHub untuk status terbaru.

---

## 0. Ringkasan 60 detik

**G1-09 sub-langkah 2a — commit, SELESAI:**
`POST /api/v1/account/pdt/batches` (`packages/domain/src/pdt.ts`
`commitUploadBatch` + `markRawStored`, `apps/api/.../pdt/batches/route.ts`)
menjalankan ULANG pipeline G1-04→G1-05→G1-09 dari `storage_path` staging yang
sama (bukan menerima cache `/preview`, keputusan eksplisit — lihat
`docs/DECISIONS.md`), lalu **benar-benar menulis** `pdt_upload_batch` +
`pdt_file` dalam satu transaksi + satu baris `audit_log`, dan mengunggah byte
paket (sudah di tangan dari unduh ulang) ke path FINAL Rule 44. Status batch
ditulis dari identitas (Rule 2-4): `tolak`→`ditolak` (TETAP tersimpan, Flow A
langkah 9), `usulkan_ikat`→`identitas_belum_terikat`,
`cocok`/`tidak_dapat_divalidasi`→`parsing`. **`status` tidak pernah
`verified`** — itu baru lahir dari rekonsiliasi (sub-langkah 2b, belum ada).

Sesi 11 (`HANDOFF_PDT_SESI11.md`) mengira sub-langkah 2 akan "memindahkan
objek staging ke path final" (Storage `move`) — **sesi ini malah mengunggah
ULANG byte yang sudah di tangan** (dari unduh untuk parse ulang), bukan
memindahkan objek Storage-ke-Storage. Lebih sederhana (nol endpoint Storage
`move` yang perlu diverifikasi lebih dulu), byte-nya toh sudah ada di memori.

**BELUM dibangun (sengaja, sub-langkah 2b/3 + dua ticket kecil terpisah):**
rekonsiliasi (Rule 13-16), penulisan baris fakta tertipe (`pdt_fact_*`), UI
halaman upload `web-internal` (kontrak wire + FE type sudah ada dua kali
sekarang — pratinjau DAN commit — halaman/tombolnya belum), endpoint
konfirmasi AM untuk identitas `usulkan_ikat` (menulis
`client_platforms.shop_id`/`akun_konten_toko` — Rule 2/4 minta konfirmasi
eksplisit, BUKAN otomatis saat commit).

---

## 1. Yang perlu ditindaklanjuti sesi berikutnya

1. **Rekomendasi utama — G1-09 sub-langkah 2b: rekonsiliasi + baris fakta
   (Flow A langkah 7-8).** Ini pekerjaan BESAR tersendiri, per rekomendasi
   sesi 10/11 yang masih berlaku: pertimbangkan memecahnya LAGI jadi:
   - **2b-i — rekonsiliasi shop-level (Rule 13-16).** `packages/core/src/pdt/rekonsiliasi.ts`
     (`rekonsiliasiGmvPesanan`, G1-07) SUDAH ADA dan diuji unit
     (`rekonsiliasi.test.ts`, 14 tes) tapi **belum pernah dipanggil dari
     alur nyata**. Perlu diputuskan EKSPLISIT (jangan ditebak, catat di
     `docs/DECISIONS.md`): basis mana yang direkonsiliasi saat commit —
     Rule 16 bilang basis LAPORAN default = Siap Dikirim, basis GERBANG PX
     = Dibayar (PDT-19). Apakah commit menjalankan KEDUANYA (dua panggilan
     rekonsiliasi independen, dua kemungkinan hasil `verified`/`ditolak`
     yang beda) atau HANYA basis laporan (Siap Dikirim), dengan basis PX
     dihitung belakangan/terpisah? PRD Rule 15 tegas "jangan campur basis"
     tapi tidak eksplisit bicara "berapa kali direkonsiliasi per commit".
     `G1-07-PERSKU-DIBAYAR` (Open, docs/DECISIONS.md) juga masih menghalangi
     rekonsiliasi per-SKU basis Dibayar — kolom SKU-level basis itu di
     `shopee_parent_sku` belum ditemukan di sample.
   - **2b-ii — baris fakta tertipe (`pdt_fact_shop_daily`/`pdt_fact_sku_period`/
     `pdt_fact_content`/`pdt_fact_creator_period`/`pdt_fact_ads`/`pdt_sku_master`).**
     Peta `kolomDipanen` (whitelist per modul, `PdtModuleDef`) → kolom
     tabel fakta BERTIPE belum ada sama sekali — ini "pekerjaan besar
     tersendiri" yang catatan G1-05 sendiri sudah tandai sejak awal. 25
     modul × kolom masing-masing; kemungkinan perlu tabel pemetaan
     eksplisit (mis. `pdt_kolom_ke_fakta` di kode, bukan migrasi) per modul
     → {tabel_fakta, kolom_fakta, transform}. **Mulai dari SATU modul
     dulu** (`shopee_ads_cpc` → `pdt_fact_ads`, atau `tt_video` →
     `pdt_fact_content`, keduanya kecil) untuk membuktikan polanya sebelum
     menggeneralisasi ke 25 modul sekaligus.
   - Setelah 2b-i DAN 2b-ii berjalan untuk MINIMAL satu modul per tabel
     fakta, `commitUploadBatch` baru boleh menulis `status='verified'`.
2. **G1-09 sub-langkah 3: halaman upload `web-internal`.** Kontrak data
   (`web-internal/src/lib/pdt.ts`) sekarang punya DUA bagian (pratinjau +
   commit) tapi **masih belum ada halaman/komponen yang memanggil salah
   satunya**. Perlu: form pilih klien→toko→upload ZIP (lewat
   `upload-url` → PUT langsung ke Storage → `preview`), tabel hasil deteksi,
   dropdown override per baris (`module_options`), tombol submit final (ke
   `POST /account/pdt/batches`, SEKARANG SUDAH ADA).
3. **Endpoint konfirmasi identitas AM (Rule 2/4, kecil, mandiri).** Saat
   commit menghasilkan `status='identitas_belum_terikat'`,
   `identitas_sumber` menyimpan usulan (`{shop_id,username,nama_toko}`
   Shopee atau `{id_kreator}` TikTok) tapi `client_platforms.shop_id`/
   `akun_konten_toko` TIDAK diisi — PRD minta AM "mengonfirmasi sekali"
   secara eksplisit, bukan otomatis. Perlu endpoint BARU (mis.
   `POST /account/pdt/batches/{id}/konfirmasi-identitas`) yang membaca
   `identitas_sumber` batch, menulis `client_platforms.shop_id`/
   `akun_konten_toko` (append untuk TikTok — array, bukan overwrite),
   dan menaikkan status batch (`identitas_belum_terikat` → mungkin
   `parsing`, atau langsung ke rekonsiliasi bila 2b sudah ada saat itu).
   Kecil, tidak butuh menunggu 2b, bisa dikerjakan lebih dulu/paralel.
4. **`G1-09-DETEKSI-PREAMBLE-AMBIGU` (baru, `docs/DECISIONS.md` Open,
   ditemukan sesi ini).** Export Shopee Ads (CPC/Search/Live) ber-preamble
   SUNGGUHAN bisa terdeteksi ambiguous terhadap `shopee_ams_afiliasi` —
   preamble literal memuat kata "Username" dan kolom wajib CPC memuat
   substring "Omzet" ("omzet penjualan"), dan `detect.ts` mencocokkan
   tanda tangan **di mana pun dalam sheet**, bukan hanya baris header.
   Tidak memblokir apa pun (dropdown override tetap jalan), tapi berarti
   AM akan sering melihat "pilih modul manual" untuk berkas yang
   seharusnya jelas. Perlu sample export Shopee Ads asli untuk
   memverifikasi apakah preamble memang selalu ada di produksi (menguatkan
   urgensi perbaikan) sebelum menyentuh `detect.ts` — jangan menambal
   berdasarkan fixture buatan tangan saja.
5. Item lama masih terbuka, masih tidak memblokir apa pun di atas:
   `G1-08-SEBAGIAN`, `G1-06-PERIODE-TIKTOK`, `G1-07-PERSKU-DIBAYAR` — lihat
   `docs/DECISIONS.md` §Open, tidak berubah sesi ini.
6. `apps/api/src/lib/pdt-storage.test.ts` `describeLive` masih belum pernah
   dijalankan (nol `SUPABASE_SERVICE_ROLE_KEY` di sandbox manapun sejauh
   ini). Sub-langkah 2b (baris fakta) TIDAK butuh ini — commit sudah
   berjalan penuh via Storage REST simulasi (fetch disuntik) + Postgres
   sungguhan.

---

## 2. G1-09 sub-langkah 2a — SELESAI, rinci

### 2.1 Berkas baru/diubah

| Berkas | Isi |
|---|---|
| `packages/core/src/pdt/types.ts` | `PDT_PARSER_VERSI = 1` (BARU — belum pernah ada sebelum sesi ini; satu angka global pipeline G1-04..09, beda dari `pdt_parser_modul.versi` per-modul) |
| `packages/domain/src/pdt.ts` (+ 24 tes baru, `describeDb`) | `commitUploadBatch`, `markRawStored`, `PdtCommitOverride`/`PdtCommitRawMeta`/`PdtCommitStatus`/`PdtCommitBerkasHasil`/`PdtCommitPersiapan`; refaktor `resolveIdentitasPreview` → `resolveIdentitasDanSumber` (internal, mengembalikan `sumber` untuk ditulis `identitas_sumber`, dipakai bersama preview yang hanya mengambil `.verdict`) |
| `apps/api/src/lib/pdt-storage.ts` (+ 3 tes) | `unggahPdtRawObjek` — POST + `x-upsert`, pasangan `unduhPdtRawObjek` |
| `apps/api/src/lib/pdt-commit.ts` (BARU) | `hitungPdtCommitRawMeta` — menghitung `entri`/`entriDilewati` dari `PdtZipBacaHasil.pagar.entri` |
| `apps/api/src/app/api/v1/account/pdt/batches/route.ts` (BARU, + 8 tes) | route handler commit |
| `apps/api/src/lib/wire.ts` | `pdtCommitBatchToWire` + `PdtCommitBatchWire`/`PdtCommitBerkasWire` |
| `apps/api/src/lib/shape-parity.test.ts` | + 2 baris `WIRE_TO_FE` |
| `web-internal/src/lib/pdt.ts` | + `PdtCommitBatch`/`PdtCommitBerkas` (type-only, belum ada halaman) |
| `docs/DECISIONS.md` | 1 baris Decided (teratas) + 1 baris Open baru (`G1-09-DETEKSI-PREAMBLE-AMBIGU`) |
| `docs/backlog/PDT_BACKLOG.md` | catatan status di bawah DoD G1-09 |

### 2.2 Kontrak & keputusan penting

Lihat `docs/DECISIONS.md` baris teratas (2026-09-14) untuk penjelasan LENGKAP
tiap keputusan berikut — ringkasnya:

- **Pipeline dijalankan ULANG dari `storage_path`**, bukan menerima cache
  hasil `/preview`. Route commit mengunduh ulang ZIP staging, mengekstrak,
  memparse, mendeteksi — SAMA PERSIS urutan `/preview` — sebelum menulis.
  Ini memilih opsi yang sesi 11 sudah rekomendasikan (§1 butir 1 di sana).
- **Raw storage: unggah ulang byte yang sudah di tangan** (`unggahPdtRawObjek`),
  BUKAN "move" Storage-ke-Storage seperti dugaan sesi 11. Path final (Rule
  44, memuat `batch_id`) baru bisa dihitung SETELAH baris batch lahir —
  urutannya: transaksi DB (batch+file+audit) → unggah byte → `markRawStored`
  (UPDATE `raw_path`/dst., NULL sampai berhasil). Ini opsi "alternatif" yang
  sesi 11 sudah sebutkan (§1 butir 1: "unduh + unggah + hapus staging") —
  disederhanakan jadi DUA panggilan, bukan tiga (staging TIDAK dihapus,
  dibiarkan jadi objek yatim Rule 49, seperti staging yang tidak terpakai
  sama sekali).
- **Periode gagal (Rule 5) ⇒ NOL baris `pdt_upload_batch` sama sekali** —
  `periode_mulai`/`periode_selesai` NOT NULL di skema, dan baik "nol berkas
  ok" maupun "berkas beda bulan kalender" sama-sama tidak punya nilai sah
  untuk keduanya. Ini DIPAKSA skema, bukan pilihan bebas.
- **Identitas gagal (Rule 2-4) ⇒ TETAP menulis baris**, `status='ditolak'`
  — beda dari periode karena periode-nya sendiri sudah valid di titik itu
  (Flow A langkah 9: "tetap tersimpan agar dapat didiagnosis").
- **`pdt_file` hanya ditulis untuk entri yang punya `sha256`/`bytes`
  sungguhan** (NOT NULL di skema) — entri `ditolak_pagar` dan entri yang
  GAGAL DIEKSTRAK (bukan gagal decode) tidak pernah punya keduanya, jadi
  TIDAK dipersist (tetap terlihat di respons commit request itu saja).
  Entri gagal-decode dan `perlu_pilih_modul` tanpa override tetap dapat
  baris: `modul_kode=NULL`, `baris_header=0` (sentinel BARU),
  `deteksi_oleh='tanda_tangan'` (dibaca sebagai METODE yang dicoba, bukan
  "berhasil").
- **`retensi_sampai`**: status `parsing`/`identitas_belum_terikat` memakai
  baris DEFAULT Rule 45 (+120 hari) — PRD tidak eksplisit menyebut kedua
  status ini, disamakan dengan `verified` karena keduanya "batch hidup"
  menunggu langkah berikutnya; hanya `ditolak` yang beda (+30 hari).
- **Override AM ditegakkan** (sesi 11 §1 butir 1 belum menyentuh ini):
  `commitUploadBatch` menerima `overrides: {nama, modulKode}[]`, memvalidasi
  modul terhadap platform toko, memaksa `modulTerdeteksi` berkas yang
  di-override lalu memparse ulang dengan modul itu — `deteksi_oleh` ditulis
  `'override_am'` untuk berkas yang di-override, `'tanda_tangan'` untuk
  sisanya (termasuk yang gagal/ambigu TANPA override).
- **Bug ditemukan & diperbaiki: double-encoding jsonb via postgres.js.**
  `${obj}::jsonb` dengan `JSON.stringify(obj)` manual di parameter
  DOUBLE-ENCODE — postgres.js menerapkan serialisasi JSON-nya sendiri
  begitu melihat hint `::jsonb`, jadi string yang sudah di-stringify ikut
  dibungkus lagi. **Pola benar:** `tx.json(value)` (method resmi driver)
  TANPA `JSON.stringify` manual dan TANPA `::jsonb`. Diverifikasi lewat
  `psql` langsung (`pg_typeof`) sebelum/sesudah — kalau modul LAIN di repo
  ini punya pola `${JSON.stringify(x)}::jsonb`, POTENSI bug yang sama ada
  di sana (belum disapu — di luar cakupan sesi ini, `health.ts` punya pola
  itu tapi tidak diverifikasi ulang).
- **Ditemukan (dicatat, TIDAK diperbaiki): `G1-09-DETEKSI-PREAMBLE-AMBIGU`**
  (Open row baru) — lihat §1 butir 4 di atas.
- **Diverifikasi (sandbox — `service postgresql start` + `db-rebuild.sh
  --yes`, pola sama sesi 9/10/11):** `npm run typecheck` bersih di SELURUH
  workspace (termasuk `web-internal`, di luar root npm workspace). `npm run
  lint -w @cdps/api -- --max-warnings 0` bersih. Dengan `DATABASE_URL`
  terpasang: **`@cdps/core` 1141/1141**, **`@cdps/domain` 2545/2546 (1 skip
  `wave1_uat.e2e`, sama seperti sesi lalu)**, **`@cdps/db` 107/107**,
  **`@cdps/api` 555/569 (14 skip) kecuali SATU kegagalan
  `gelombang-c-showcase.e2e.test.ts` — bug pra-ada YANG SAMA dikonfirmasi
  sesi 2-11, bukan regresi dari sesi ini**, **`web-internal` 763/763**.
  `shape-parity`/`route-parity` keduanya hijau.

### 2.3 Yang BELUM dilakukan (sengaja, bukan gap tak sadar)

- **Rekonsiliasi + baris fakta** (Flow A langkah 7-8) — sub-langkah 2b,
  lihat §1 butir 1.
- **Halaman upload `web-internal`** — sub-langkah 3, lihat §1 butir 2.
- **Endpoint konfirmasi identitas AM** — lihat §1 butir 3.
- **Perbaikan deteksi ambiguous preamble** — `G1-09-DETEKSI-PREAMBLE-AMBIGU`,
  lihat §1 butir 4.
- **Rule 43 (sha256 dedupe lintas `client_platform_id` ⇒ peringatan
  keras)** — belum ada di commit ini; indeks `idx_pdt_file_sha256` (G1-01)
  sudah ada untuk mendukungnya, tapi query/peringatannya sendiri belum
  ditulis. Tidak memblokir apa pun (Rule 43 adalah peringatan, bukan
  pagar).
- **`baris_terparse`** (`pdt_file`, jumlah baris data yang berhasil
  diparse) — dibiarkan NULL di commit ini; perhitungan sungguhan (per baris,
  bukan per berkas) baru relevan begitu 2b menulis baris fakta satu per
  satu.
- **Verifikasi Storage `move`/`copy` API** (sesi 11 §1 butir 2) — TIDAK
  LAGI DIBUTUHKAN, digantikan pola unggah-ulang-byte-di-tangan (lihat §2.2
  di atas). Baris itu di sesi 11 kini basi, dicatat di sini supaya jelas
  KENAPA bukan diabaikan.

---

## 3. Rujukan

- `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` — Flow A (§4) langkah 6-9, Rule
  2-5/13-16/38-45.
- `docs/backlog/PDT_BACKLOG.md` — G1-09 (status sub-langkah di bawah DoD-nya).
- `docs/DECISIONS.md` — baris teratas (2026-09-14, PDT G1-09 sub-langkah 2a)
  + Open row baru `G1-09-DETEKSI-PREAMBLE-AMBIGU` (dan
  `G1-08-SEBAGIAN`/`G1-06-PERIODE-TIKTOK`/`G1-07-PERSKU-DIBAYAR` dari sesi
  sebelumnya, masih terbuka).
- `packages/domain/src/pdt.ts` `commitUploadBatch`/`markRawStored` +
  `packages/domain/src/pdt.test.ts`.
- `apps/api/.../pdt/batches/route.ts` (commit) + `.../batches/preview/route.ts`
  (pratinjau, sesi 10/11) + `apps/api/src/lib/pdt-commit.ts`.
- `web-internal/src/lib/pdt.ts` — kontrak FE (pratinjau + commit), siap
  dipakai halaman sub-langkah 3.
- `apps/api/src/lib/pdt-storage.ts` — signed URL unduh (G1-04), signed
  upload URL + unduh server-ke-server (G1-09-BODY-BESAR, sesi 11), unggah
  server-ke-server (G1-09 sub-langkah 2a, sesi ini) — SEMUA fungsi Storage
  yang dibutuhkan Flow A langkah 1-6 sekarang ada.
- `packages/core/src/pdt/rekonsiliasi.ts` — `rekonsiliasiGmvPesanan` (G1-07),
  siap dipanggil sub-langkah 2b, BELUM PERNAH dipanggil dari alur nyata.
- `docs/handoff/HANDOFF_PDT_SESI11.md` — riwayat G1-09-BODY-BESAR + PR #366
  (sudah merge).
