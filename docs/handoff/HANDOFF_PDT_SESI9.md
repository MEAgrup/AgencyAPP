# HANDOFF — PDT (Pusat Data Toko) SESI 9 → SESI 10

> **Dibuat 2026-09-13.** Baca berkas ini sebelum lanjut (rantai: sesi 8 →
> sesi 9, berkas ini; `docs/handoff/HANDOFF_PDT_SESI8.md` untuk riwayat
> G1-07 kalau perlu konteks lebih dalam).
>
> **Status: G1-08 SELESAI** (`packages/core` — nol migrasi, nol route baru).
> Branch sesi ini SAMA dengan G1-06/G1-07 (`claude/lucid-goldberg-0ekacu`,
> instruksi sistem) — commit G1-08 masuk PR #362 yang sudah ada, belum
> di-push di awal sesi ini.

---

## 0. Ringkasan 60 detik

Instruksi sesi ini: "lanjutkan ke task berikutnya" (di tengah membabysit PR
#362) → §3 handoff sesi 8 merekomendasikan G1-08 → **G1-08 selesai** sesi
ini.

**G1-08** — `packages/core/src/pdt/parsestatus.ts`:
- **Rule 9-10** — `validasiKolomWajib`/`turunkanParseStatus`: kolom wajib
  hilang (exact match lalu alias) ⇒ `parse_status='gagal'` dengan pesan
  menyebut nama kolom; "berkas tidak diunggah" tidak pernah dipakai
  (dijamin struktural, bukan hanya konvensi).
- **Rule 12** — `renormalisasiDimensi`/`totalSkorDimensi`: **bug "skor
  netral 5/10" yang PRD sebut BERHASIL DITEMUKAN DAN DIREPRODUKSI** —
  hidup di `packages/core/src/report/shopee/skor.ts` (mesin lama), dimensi
  ROAS & Channel (bobot 22%) diberi neutral 5 saat berkas iklan tidak ada,
  ditambahkan ke total TANPA normalisasi bobot. Mesin baru: dimensi absen
  dikeluarkan, bobot sisanya dinormalisasi ulang, total TIDAK tertarik
  turun. Tes membuktikan angka PERSIS: skenario bug → mesin lama 8,12,
  mesin baru 9 (tetap).
- Dua ketidakpastian BARU ditemukan dan dicatat (bukan ditebak):
  `G1-08-SEBAGIAN` (pemicu status `sebagian` belum terdefinisi — butuh
  bucket wajib/opsional per kolom yang belum ada) dan keputusan SADAR
  untuk TIDAK memperbaiki mesin lama `report/shopee/skor.ts` sekalipun
  bug-nya sudah diketahui persis (PDT-17 strangler bertahap).

---

## 1. Yang perlu ditindaklanjuti sesi ini/berikutnya

1. **Commit + push G1-08 belum dilakukan di awal sesi ini** — masuk PR #362
   yang sudah ada, lakukan sebelum lanjut ke G1-09.
2. **PR #362 (G1-06+G1-07+G1-08) masih terbuka, masih diawasi.** CI
   `db-and-migrations` merah adalah bug pra-ada TERKONFIRMASI (lihat
   handoff sesi 7/8) — jangan diperbaiki di PR ini.
3. **`G1-08-SEBAGIAN` (baru sesi ini)** — pemicu `parse_status='sebagian'`
   belum terdefinisi. Tidak memblokir G1-09, tapi kalau sesi berikutnya
   (atau pemilik) memutuskan menambah bucket wajib/opsional per kolom ke
   `PdtModuleDef`, `turunkanParseStatus` (`parsestatus.ts`) perlu diperluas
   menerima parameter kolom-opsional-hilang.
4. **KEPUTUSAN SADAR, bukan gap: `report/shopee/skor.ts`/`report/skor.ts`
   (TikTok) TIDAK diperbaiki** meski bug neutral-5-nya sudah diketahui
   persis sesi ini. Jangan "sekalian benerin" mesin lama itu di sesi
   manapun sebelum PDT-17 (strangler) benar-benar menjadwalkan
   pematiannya — dua mesin yang menghasilkan angka berbeda untuk klien
   yang sama adalah kelas bug yang LEBIH bahaya daripada bug lama yang
   sudah didokumentasikan.
5. Item lama handoff sesi 5 §1 butir 2 **masih terbuka**: tes
   `describeLive` (`apps/api/src/lib/pdt-storage.test.ts`) belum
   dijalankan — sandbox sesi ini tetap tidak punya
   `SUPABASE_SERVICE_ROLE_KEY`.
6. Dua Open row lama (`G1-06-PERIODE-TIKTOK`, `G1-07-PERSKU-DIBAYAR`) masih
   terbuka, masih tidak memblokir.

---

## 2. G1-08 — SELESAI

### 2.1 Berkas

| Berkas | Isi |
|---|---|
| `packages/core/src/pdt/parsestatus.ts` | `cariKolomWajib`/`validasiKolomWajib` (Rule 9), `turunkanParseStatus` (Rule 10), `renormalisasiDimensi`/`totalSkorDimensi` (Rule 12), `LABEL_DIMENSI_TIDAK_TERSEDIA` |
| `packages/core/src/pdt/parsestatus.test.ts` | 16 tes — termasuk reproduksi PERSIS bug "netral 5/10" (6 dimensi bobot Shopee asli, angka 8,12 vs 9) |
| `packages/core/src/pdt/index.ts` | + `export * from './parsestatus'` |
| `docs/DECISIONS.md` | 1 baris Decided baru (di ATAS G1-07) + 1 baris Open baru (`G1-08-SEBAGIAN`) |

Tidak ada migrasi (`pdt_file.parse_status` CHECK sudah ada G1-01), tidak
ada route baru, tidak ada perubahan gerbang CI.

### 2.2 Kontrak & keputusan penting

- **Bug Rule 12 BUKAN hipotetis** — ditemukan dengan membaca
  `packages/core/src/report/shopee/skor.ts` sungguhan: konstanta
  `MISSING(label) = "file ${label} tidak diunggah — dimensi ini dinilai
  netral (5/10)"`, dipakai enam fungsi `score*` (`scoreRoas`,
  `scoreProduct`, `scoreLive`, `scoreKesehatanToko`, dst.), dan
  `computeSkor` menjumlahkan `skor * bobot` TANPA pengecualian atau
  normalisasi ulang untuk dimensi yang kena `MISSING`. Docblock berkas itu
  sendiri (baris 10-20) SUDAH mengakui pola "neutral 5" sebagai konvensi
  yang disengaja saat porting dari alat lama — G1-08 tidak menyalahkan
  siapa pun, hanya membangun PENGGANTINYA sesuai Rule 12.
- **`turunkanParseStatus` TIDAK PERNAH mengembalikan `'sebagian'`** —
  ketidaktahuan pemicu status itu (lihat `G1-08-SEBAGIAN`) dibuat TERLIHAT
  lewat TYPE (`PdtParseStatus = 'ok' | 'gagal'`, bukan termasuk
  `'sebagian'` sama sekali), bukan disembunyikan di balik fungsi yang
  "kelihatan lengkap" tapi diam-diam tidak pernah memilih cabang ketiga.
- **`renormalisasiDimensi` generik — tidak spesifik Shopee/TikTok** —
  menerima `PdtDimensiSkor[]` apa pun (kode/label/bobotDasar/nilai),
  supaya ia bisa dipakai modul mana pun yang membangun skor berdimensi di
  masa depan (G2 Health Score PDT, kalau/bila dibangun), bukan hardcode ke
  enam dimensi Shopee spesifik.
- **Tes (`parsestatus.test.ts`, 16 tes)** — mencakup: exact/alias/tidak
  ditemukan untuk kolom wajib, kumpulan SEMUA kolom hilang (bukan berhenti
  di yang pertama), turunkanParseStatus untuk kedua sumber kegagalan +
  bukti pesan tidak pernah mengandung "tidak diunggah", dan skenario Rule
  12 lengkap: dimensi absen dikeluarkan (bukti `nilai` tetap `null`, bukan
  diam-diam jadi 5), bobot sisa Σ=1, total TETAP 9 vs mesin lama yang akan
  menghasilkan 8,12, seluruh-dimensi-absen ⇒ total `null` (bukan 0), dan
  kasus dua-dimensi-absen-bobot-beda untuk membuktikan proporsionalitas.
- **Diverifikasi:** `npm run typecheck` (root, 4 workspace) bersih;
  `npm run test -w @cdps/core` — **1127/1127 tes lulus** (16 baru).

### 2.3 Yang BELUM dilakukan (sengaja, bukan gap tak sadar)

- **Perbaikan `report/shopee/skor.ts`/`report/skor.ts` (TikTok) itu
  sendiri** — SENGAJA tidak disentuh (PDT-17 strangler bertahap, lihat §1
  butir 4). G1-08 membangun PENGGANTI yang benar, bukan menambal yang
  lama.
- **Pemicu `parse_status='sebagian'`** — `G1-08-SEBAGIAN`, menunggu
  keputusan bucket kolom wajib/opsional.
- **Pemanggilan sungguhan dari alur upload** — sama seperti
  G1-06/07, belum ada route/domain yang menulis `pdt_file`/skor apa pun;
  G1-09 (halaman upload) yang memanggil.

---

## 3. Rekomendasi sesi 10 — mulai G1-09

`docs/backlog/PDT_BACKLOG.md` §1 G1-09 (halaman upload + tabel hasil
deteksi) — **ini tiket besar** yang PERTAMA KALI menyambungkan seluruh
G1-01..08 jadi satu alur nyata:

1. Satu ZIP, bukan 13 berkas longgar (PDT-25) — `bacaDanEkstrakPdtZip`
   (G1-04) sudah ada.
2. Tabel hasil deteksi SEBELUM disimpan: modul terdeteksi (G1-02), baris
   header, kolom dipanen, kolom baru (nama saja), status — `parsePdtZipEntries`
   (G1-05) sudah menghasilkan sebagian ini.
3. AM dapat menimpa deteksi per berkas dari dropdown SELURUH modul.
4. Validasi identitas (G1-06: `validasiIdentitasShopee`/`validasiIdentitasTiktok`/
   `resolvePeriodeBatch`) dan rekonsiliasi (G1-07:
   `rekonsiliasiGmvPesanan`) DIPANGGIL untuk PERTAMA KALINYA dari alur
   nyata — bukan lagi hanya lewat tes.
5. Parse gagal (G1-08: `turunkanParseStatus`) ditulis ke `pdt_file`.
6. **Di sinilah `pdt_upload_batch`/`pdt_file`/`client_platforms.shop_id`/
   `akun_konten_toko` BENAR-BENAR ditulis** — route API baru dibutuhkan,
   `route-parity.test.ts` (`apps/api/src/lib/route-parity.test.ts`) wajib
   dicek sebelum menambah endpoint (CLAUDE.md).
7. UI batch: status paket (tersedia/kedaluwarsa/legal hold, Rule 50 —
   sudah dicatat SENGAJA tidak jadi kolom tersimpan, migrasi G1-01 §catatan
   awal, diturunkan saat baca).

**Ini tiket paling besar sejauh G1-0x** — pertimbangkan memecahnya jadi
sub-langkah (mis. route POST upload dulu, lalu UI tabel deteksi, lalu
dropdown override) alih-alih satu commit raksasa, konsisten pola "small
PRs per Rule/Flow cluster" (CLAUDE.md).

---

## 4. Rujukan

- `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` — Rule 9-10 (kolom wajib/parse
  status), Rule 12 (skor netral dihapus).
- `docs/backlog/PDT_BACKLOG.md` — G1-08 (sesi ini) → G1-09 (sesi
  berikutnya, tiket besar).
- `docs/DECISIONS.md` — baris teratas (2026-09-13, PDT G1-08) + Open row
  `G1-08-SEBAGIAN` (dan `G1-06-PERIODE-TIKTOK`/`G1-07-PERSKU-DIBAYAR` dari
  sesi sebelumnya, masih terbuka).
- `packages/core/src/pdt/parsestatus.ts` + `parsestatus.test.ts`.
- `packages/core/src/report/shopee/skor.ts` — mesin LAMA ber-bug
  "netral 5/10" yang G1-08 gantikan (bukan perbaiki di tempat).
- `packages/domain/src/performance.ts` `scoreProfile` — pola
  renormalisasi Rule 6 M14 yang `renormalisasiDimensi` salin algoritmanya.
- `docs/handoff/HANDOFF_PDT_SESI8.md` — riwayat G1-07 + PR #362 (masih
  diawasi, CI merah pra-ada).
