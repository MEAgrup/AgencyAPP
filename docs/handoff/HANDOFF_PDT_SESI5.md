# HANDOFF — PDT (Pusat Data Toko) SESI 5 → SESI 6

> **Dibuat 2026-09-13.** Baca berkas ini sebelum lanjut. Cabang kerja sesi ini:
> `claude/inspiring-lovelace-d9x7tl`.
>
> **Status: G1-03 SELESAI** (`parsePdtAngka`, `packages/core/src/pdt/angka.ts`
> + 25 tes). Belum di-PR/merge saat berkas ini ditulis — lihat §1. Sesi 6
> lanjut ke **G1-04** (bucket `pdt-raw` + pagar paket ZIP) — lihat §3.

---

## 0. Ringkasan 60 detik

Instruksi sesi ini: "baca handoff sesi 4 dan lanjutkan". Handoff SESI4
merekomendasikan mulai **G1-03 — normalisasi angka terpusat (pilih NaN, bukan
0)** (`docs/backlog/PDT_BACKLOG.md` §1). Sesi ini menulis satu fungsi baru,
`parsePdtAngka` (`packages/core/src/pdt/angka.ts`), diekspor lewat
`packages/core/src/pdt/index.ts`, dengan 25 tes
(`packages/core/src/pdt/angka.test.ts`). **Nol migrasi, nol perubahan gerbang
CI** — G1-03 murni fungsi TS baru, tidak menyentuh DB.

Keputusan desain intinya (dicatat penuh di `docs/DECISIONS.md`, baris paling
atas): fungsi ini membedakan **TIGA** keadaan, bukan dua — sel kosong ⇒ `0`,
nilai ada-tapi-tak-terbaca ⇒ `NaN`, kolom tak ada sama sekali ⇒ di luar
cakupan fungsi ini (ditangani G1-08). Lihat §2 untuk detail.

---

## 1. Yang perlu ditindaklanjuti sesi ini (sebelum atau sambil mulai G1-04)

Sesi ini **belum membuat PR**. Sebelum lanjut G1-04, sesi 6 (atau sesi ini
sendiri bila masih berjalan) perlu:

1. Commit perubahan §2 di bawah (belum di-commit saat berkas ini ditulis —
   cek `git status`).
2. Push ke `claude/inspiring-lovelace-d9x7tl`, buka PR (pola PR kecil per
   tiket — `#356` G1-01, `#357` G1-02 — CLAUDE.md "Small PRs per Rule/Flow
   cluster").
3. Kalau CI `db-and-migrations` merah lagi dengan error `gelombang-c-showcase.e2e.test.ts`
   / fixture `client_platforms` collision: itu bug pra-ada yang SAMA seperti
   PR #356/#357 (root-cause sudah dicatat `HANDOFF_PDT_SESI2.md` §4). G1-03
   nol sentuh migrasi/DB, jadi kemunculannya di sini murni flakiness urutan
   test suite yang sudah ada, bukan sesuatu yang G1-03 sebabkan — standing-down
   + satu re-run sesuai aturan CI-merah, JANGAN diperbaiki di PR ini (di luar
   cakupan).

---

## 2. G1-03 — SELESAI

| Berkas | Isi |
|---|---|
| `packages/core/src/pdt/angka.ts` | `parsePdtAngka(v, raw?)` — normalisasi angka terpusat PDT |
| `packages/core/src/pdt/angka.test.ts` | 25 tes — blank→0, tak-terbaca→NaN, dua konvensi locale, persen, negatif berkurung, passthrough |
| `packages/core/src/pdt/index.ts` | tambah `export * from './angka'` |
| `docs/DECISIONS.md` | 1 baris baru (2026-09-13, PDT G1-03, di ATAS baris G1-02) |

### 2.1 Kontrak `parsePdtAngka(v: unknown, raw?: boolean): number`

Tiga keadaan (bukan dua — lihat `docs/DECISIONS.md` untuk penalaran penuh +
alternatif yang ditolak):

| Keadaan | Contoh | Hasil |
|---|---|---|
| Sel kosong | `null`, `undefined`, `''`, `'   '` | `0` |
| Nilai ada tapi tak terbaca | `'-'`, `'—'`, `'N/A'`, `'tidak terbatas'`, teks acak, `NaN`/`Infinity` sebagai input | `NaN` |
| Kolom tak ada sama sekali | — (bukan urusan fungsi SEL ini) | di luar cakupan — G1-08 |

`raw` mengikuti nama/semantik `n(v, raw)` yang sudah ada housewide: falsy/omit
= Seller Center (titik = ribuan, koma = desimal, format `1.234,56`); `raw=true`
= Ads Manager (titik = desimal, koma = ribuan). Plus: prefiks `Rp` dibuang,
akhiran `%` dibagi 100 (fraksi, bukan 0–100), negatif berkurung `"(1.234)"` →
`-1234` (refund Shopee).

**Fungsi ini BERDIRI SENDIRI** — tidak memanggil `n()` atau
`parseIndonesianNumber()`, dan sebaliknya. `n()`/`parseIndonesianNumber()`
TIDAK disentuh (backlog G1-03 eksplisit melarang mengubah `n()`; keduanya
tetap dipakai jalur non-PDT yang sudah berjalan).

### 2.2 Verifikasi

- `packages/core`: **1040/1040** lolos (1015 sebelumnya + 25 tes
  `pdt/angka.test.ts` baru).
- `npm run typecheck` bersih di `@cdps/core`, `@cdps/domain`, `@cdps/db`.
- `packages/domain`: 482 lolos (2021 skip — butuh `DATABASE_URL`, sama pola
  seperti sesi sebelumnya), nol regresi dari `packages/core/src/pdt/index.ts`.
- **Belum ada pemanggil** — fungsi ini menunggu G1-05 (parse di server) untuk
  betulan dipakai membaca sel. Sesi ini murni menyediakan fungsi + kontrak +
  tes, sesuai urutan G1-03 → G1-04 → G1-05 di backlog (§0 build order:
  **jangan lompat**).

### 2.3 Yang SENGAJA tidak dilakukan sesi ini

- **Tidak menyatukan `n()`/`toNum()`/`pn()`/`parseIndonesianNumber()` ke
  `parsePdtAngka`** — backlog G1-03 hanya minta jalur PDT (modul baru) pakai
  NaN; ia eksplisit TIDAK meminta migrasi pemakai lama (`baseline`, `report`,
  `report/shopee`, `adsscanner/tiktok`, `skuscreener`) ke fungsi baru, karena
  itu akan menggeser angka skor yang sudah berjalan tanpa data nyata baru untuk
  memverifikasinya ulang. Kalau owner/pemilik memutuskan sebaliknya, itu
  keputusan baru yang butuh entri `docs/DECISIONS.md` sendiri.
- **Tidak menambahkan `sumOpt`/agregasi apa pun yang tahu cara memperlakukan
  `NaN`** — itu tanggung jawab G1-05+ (parser sungguhan) dan/atau G1-08
  (kegagalan parse tidak ditelan), bukan fungsi normalisasi sel ini.

---

## 3. Rekomendasi sesi 6 — mulai G1-04

`docs/backlog/PDT_BACKLOG.md` §1 G1-04: **"Bucket `pdt-raw` + pagar paket
ZIP — infrastruktur pertama di repo ini."**

Poin kunci sebelum mulai:

1. **P-09 sudah terkonfirmasi** (`docs/DECISIONS.md` 2026-09-12): nol bucket,
   nol `supabase/functions/`, nol `createSignedUrl` di seluruh repo hari ini
   — ini betul-betul infrastruktur pertama, tidak ada pola existing untuk
   dicontek secara langsung di repo ini sendiri (beda dari G1-01/02/03 yang
   semuanya punya preseden kuat).
2. Bucket **privat**, path
   `{client_id}/{client_platform_id}/{periode_selesai}/{batch_id}.zip`. Akses
   HANYA lewat signed URL **≤ 15 menit**.
3. **Pagar sebelum satu entri pun dibaca** (Rule 42): ≤ 50 MB · ≤ 40 entri ·
   rasio dekompresi ≤ 100:1. **Entri ditolak** (Rule 41): ZIP bersarang, entri
   terenkripsi/berkata sandi, ekstensi di luar `.xlsx`/`.xls`/`.csv`, zip-slip
   (path keluar akar arsip). **Entri dilewati tanpa peringatan:** `__MACOSX/`,
   `.DS_Store`, `._*` (sample nyata membawanya, itu normal untuk zip macOS).
4. Ekstraksi **streaming ke disk sementara**, bukan seluruhnya ke memori.
   `sha256` dihitung untuk paket DAN tiap entri (sidik jari entri sama pada
   `client_platform_id` berbeda ⇒ peringatan keras).
5. Job purge harian (G1-10) menyusul terpisah — jangan gabung ke G1-04.
   `docs/DECISIONS.md` 2026-09-12 P-09 sudah menetapkan job purge lewat
   **Vercel Cron + `tickSecretOk`** (pola 3-tick yang sudah jalan
   `apps/api/vercel.json`), **BUKAN** `pg_cron` — pagar storage butuh
   panggilan API, bukan cuma baris DB.

**DoD G1-04:** bucket ada di staging · pagar diuji dengan zip bomb sintetis +
zip-slip + ZIP bersarang · signed URL kedaluwarsa benar-benar menolak.

**Jangan lompat ke G1-05/06/…** sebelum G1-04 lulus DoD-nya — build order
eksplisit `PDT_BACKLOG.md` §0.

---

## 4. Rujukan

- `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` (v1.2) — PRD, §6.7 (normalisasi
  angka), §6.8 (anggaran storage, relevan G1-04).
- `docs/backlog/PDT_BACKLOG.md` — G1-03 (sesi ini) → G1-04 (sesi berikutnya).
- `docs/DECISIONS.md` — baris teratas (2026-09-13, PDT G1-03).
- `packages/core/src/pdt/angka.ts` + `angka.test.ts`.
- `packages/core/src/baseline/angka.ts` (`n()`, TIDAK disentuh),
  `packages/core/src/skuscreener/parse.ts` (`parseIndonesianNumber()`, TIDAK
  disentuh) — dua preseden yang jadi dasar desain, dikutip penuh di
  docblock `angka.ts` dan `docs/DECISIONS.md`.
