# HANDOFF — PDT (Pusat Data Toko) SESI 6 → SESI 7

> **Dibuat 2026-09-13.** Baca berkas ini sebelum lanjut (rantai: sesi 5 →
> sesi 6, berkas ini; `docs/handoff/HANDOFF_PDT_SESI5.md` untuk riwayat G1-03/
> G1-04 kalau perlu konteks lebih dalam).
>
> **Status: G1-05 SELESAI** (`packages/core`, `apps/api` — nol migrasi, sesuai
> ekspektasi tiketnya). Belum di-PR/merge — kerja ada di branch sesi ini,
> commit + PR masih perlu dibuat/diperiksa setelah handoff ini ditulis.

---

## 0. Ringkasan 60 detik

Instruksi sesi ini: "baca handoff sesi 5 dan lanjutkan" → §4 handoff sesi 5
merekomendasikan G1-05 (parse di server) → **G1-05 selesai** sesi ini.

**G1-05** — `apps/api/src/lib/pdt-parse.ts` (`decodePdtAoa`/
`parsePdtZipEntries`): `XLSX.read` dipindah dari browser ke server, dipasang
di atas `PdtZipEntriTerekstrak.pathSementara` yang `bacaDanEkstrakPdtZip`
(G1-04) ekstrak, memanggil `detectPdtModule` (G1-02) sungguhan untuk pertama
kali di luar tes. **Lisensi SheetJS (ketidakpastian terbuka sejak
`RISET_AWAL_BASELINE_BACKLOG.md` §0) ditutup**: `xlsx@0.18.5` dari
`registry.npmjs.org`, `Apache-2.0`, diverifikasi ke
`node_modules/xlsx/package.json` sungguhan — bukan diasumsikan. **`parsePdtAngka`
(G1-03) SENGAJA BELUM dipakai** — alasan tertulis penuh di §2.2 dan
`docs/DECISIONS.md` baris teratas.

---

## 1. Yang perlu ditindaklanjuti sesi ini/berikutnya

1. **Commit + push + PR belum dibuat untuk perubahan G1-05** — lakukan itu
   sebelum lanjut ke G1-06, ikuti alur PR standar repo ini (draft PR,
   watch CI).
2. Item lama dari handoff sesi 5 §1 butir 2 **masih terbuka**: tes
   `describeLive` di `apps/api/src/lib/pdt-storage.test.ts` (signed URL vs
   Storage live) belum dijalankan — sandbox sesi ini juga tidak punya
   `SUPABASE_SERVICE_ROLE_KEY`. Bukan bagian G1-05, tapi tetap gap terbuka
   G1-04 yang belum tertutup.
3. Kalau CI `db-and-migrations` merah lagi dengan
   `gelombang-c-showcase.e2e.test.ts`/`client_platforms` collision: bug
   pra-ada yang SAMA yang sudah dikonfirmasi non-flaky di PR #359 (lihat
   handoff sesi 5 §1 butir 1) — standing-down + satu re-run, JANGAN
   diperbaiki di PR G1-05 (G1-05 tidak menyentuh migrasi sama sekali).

---

## 2. G1-05 — SELESAI

### 2.1 Berkas

| Berkas | Isi |
|---|---|
| `apps/api/package.json` | + dependensi `xlsx` (`0.18.5`, `Apache-2.0`) |
| `apps/api/src/lib/pdt-parse.ts` | `decodePdtAoa` (dekode satu berkas → AoA), `parsePdtZipEntries` (dekode + `detectPdtModule` untuk seluruh entri `diekstrak` G1-04, per-entri, timed) |
| `apps/api/src/lib/pdt-parse.test.ts` | 5 tes — pipeline server PENUH lewat ZIP/xlsx/csv biner sungguhan |
| `docs/DECISIONS.md` | 1 baris baru (di ATAS baris G1-04) — lisensi SheetJS + rasional penundaan `parsePdtAngka` |
| `package-lock.json` | additive-only — `xlsx` + 7 dependensi transitifnya (`adler-32`, `cfb`, `codepage`, `crc-32`, `ssf`, `wmf`, `word`); diverifikasi `git diff --stat` tidak menyentuh baris lain |

Tidak ada migrasi, tidak ada route baru, tidak ada perubahan gerbang CI (G1-05
murni kode `apps/api`/`packages/core`, konsisten dengan cakupan tiketnya di
`PDT_BACKLOG.md`).

### 2.2 Kontrak & keputusan penting

- **`decodePdtAoa(bytes)`** — `XLSX.read(bytes, {type:'buffer'})` lalu
  `XLSX.utils.sheet_to_json(ws, {header:1, raw:false, defval:''})` pada sheet
  PERTAMA. Pola ini **salinan persis** dekode browser
  (`web-internal/src/lib/riset-awal.ts` `parseExportFile`, juga
  `report.ts`/`skuscreener.ts`/`adsscanner.ts`) — `XLSX.read` mengendus
  format lewat ISI, bukan ekstensi, jadi satu fungsi menangani `.xlsx`/
  `.xls`/`.csv` (satu-satunya tiga yang lolos pagar Rule 41 G1-04) sekaligus,
  termasuk CSV ber-BOM `utf-8-sig` (PRD §6.7, diuji eksplisit).
- **`parsePdtZipEntries(diekstrak, modules)`** — untuk tiap
  `PdtZipEntriTerekstrak` (G1-04): baca `pathSementara`, `decodePdtAoa`,
  `detectPdtModule`, kumpulkan ke `berkas`/`gagal` + `durasiMs` batch.
  Kegagalan SATU entri (berkas rusak) ditangkap ke `gagal`, TIDAK
  menjatuhkan entri lain (Rule 10) — **temuan implementasi:** `XLSX.read`
  TERNYATA menerima teks polos sembarangan diam-diam sebagai CSV satu-kolom
  (tidak melempar); fixture "berkas rusak" yang benar-benar menguji
  kegagalan dekode harus diawali byte `PK\x03\x04` (klaim ZIP) supaya
  `XLSX.read` benar-benar mencoba mem-parsing-nya sebagai ZIP dan gagal di
  direktori pusat yang tidak sah.
- **⚠️ `parsePdtAngka` (G1-03) BELUM dipanggil dari G1-05** — ini
  penyimpangan sengaja dari kalimat backlog G1-05 ("…lalu `parsePdtAngka`
  menormalkan selnya"), dicatat FULL di `docs/DECISIONS.md`: `kolomDipanen`
  (`PdtModuleDef`) cuma whitelist NAMA kolom, bukan peta tipe (kolom mana
  angka, kolom mana teks, konvensi locale `raw` mana) — peta itu adalah
  bagian dari kontrak yang G1-06 (identitas dari berkas) dan G1-07
  (rekonsiliasi) baru akan tentukan. Menebaknya sekarang = mengarang
  kontrak yang belum ditetapkan (dilarang CLAUDE.md). **G1-06/07 yang
  memanggil `parsePdtAngka` per sel**, bukan G1-05.
- **Tes (`pdt-parse.test.ts`, 5 tes)** — bukan fixture AoA literal seperti
  `packages/core/src/pdt/detect.test.ts`, tapi bytes BINER sungguhan
  (`XLSX.write`/teks CSV) supaya klaim "parse jalan tanpa browser" jujur:
  - 23 berkas (9 TikTok + 13 Shopee termasuk 2 varian ejaan
    `shopee_kesehatan` + 1 `meta_ads` = 22 modul), campuran `.xlsx`/`.csv`/
    CSV-ber-BOM, dizip lewat `yazl` (pola sama `pdt-zip.test.ts`), lewat
    `bacaDanEkstrakPdtZip` → `parsePdtZipEntries` — nol salah-slot, nol
    gagal.
  - Kegagalan satu entri tidak menjatuhkan batch.
  - **Target performa** — batch 13 berkas / ≈3.522 baris (≈1.500 SKU +
    ≈2.000 konten, ukuran mengikuti target PRD, DIBANGUN SINTETIS karena
    data klien asli tidak ada di repo) selesai **341-392ms** (diukur
    3× jalan berturut-turut, konsisten), jauh di bawah target < 45 detik.
    Dicatat di `console.log` tes + di sini — bukan diklaim tanpa angka.

### 2.3 Yang BELUM dilakukan (sengaja, bukan gap tak sadar)

- **Pemetaan `kolomDipanen` → kolom bertipe + pemanggilan `parsePdtAngka`
  per sel** — G1-06/07, lihat §2.2 di atas.
- **Penulisan ke tabel fakta (`pdt_fact_*`)** — belum ada barang satu baris
  pun ditulis DB dari hasil parse; G1-05 hanya AoA + modul terdeteksi di
  memori, dikonsumsi langsung oleh tes integrasi (sesuai DoD backlog "tes
  integrasi memanggil domain langsung" — belum ada route/endpoint upload).
- **Identitas toko/periode dari berkas** — G1-06.

---

## 3. Rekomendasi sesi 7 — mulai G1-06

`docs/backlog/PDT_BACKLOG.md` §1 G1-06: **"Identitas toko & periode dari
BERKAS, bukan dari input AM."**

1. Shopee: preamble CSV iklan (baris 1-6) bawa `Username`/`Nama Toko`/
   `ID Toko`/`Periode` — cocokkan ke `client_platforms.shop_id`; kalau
   kosong, alur `identitas_belum_terikat` (Q-1 opsi A, simetris Rule 4
   TikTok) — lihat detail penuh di `PDT_BACKLOG.md` G1-06.
2. TikTok: tidak bawa `shop_id` sama sekali — identitas dari `ID Kreator`
   vs `client_platforms.akun_konten_toko`.
3. Periode dari berkas (Rule 5), bukan input AM; `tanggal_tarik_data`
   selalu jam SERVER (Rule 37).
4. Di sinilah pemetaan `kolomDipanen`→kolom bertipe + `parsePdtAngka` yang
   G1-05 sengaja tunda kemungkinan besar mulai terbentuk (extraksi nilai
   dari AoA yang G1-05 sudah sediakan, sekarang tahu identitas/periode
   batchnya).
5. Setelah G1-06: G1-07 (rekonsiliasi) → G1-08 (kegagalan parse tidak
   ditelan) → G1-09 (halaman upload + dropdown override manual).

**Jangan lompat ke G1-09** sebelum G1-06..08 — build order eksplisit
`PDT_BACKLOG.md` §0.

---

## 4. Rujukan

- `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` — §6.7 (parse server), Rule 5
  (periode dari berkas), Rule 2-4 (identitas).
- `docs/backlog/PDT_BACKLOG.md` — G1-05 (sesi ini) → G1-06 (sesi berikutnya).
- `docs/DECISIONS.md` — baris teratas (2026-09-13, PDT G1-05).
- `apps/api/src/lib/pdt-parse.ts` + `pdt-parse.test.ts`.
- `apps/api/src/lib/pdt-zip.ts` (G1-04, `PdtZipEntriTerekstrak`/
  `bacaDanEkstrakPdtZip` yang G1-05 konsumsi).
- `packages/core/src/pdt/detect.ts`/`modules.ts` (G1-02, `detectPdtModule`/
  `PDT_MODULES` yang G1-05 panggil).
- `packages/core/src/pdt/angka.ts` (G1-03, `parsePdtAngka` — masih menunggu
  pemanggil pertama, G1-06/07).
- `docs/handoff/HANDOFF_PDT_SESI5.md` — riwayat G1-03/G1-04 + gap signed-URL
  live yang masih terbuka.
