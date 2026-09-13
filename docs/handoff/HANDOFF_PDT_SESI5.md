# HANDOFF — PDT (Pusat Data Toko) SESI 5 → SESI 6

> **Dibuat 2026-09-13, diperbarui sesi yang sama setelah G1-04 selesai.** Baca
> berkas ini sebelum lanjut. Cabang kerja sesi ini:
> `claude/inspiring-lovelace-d9x7tl`.
>
> **Status: G1-03 SELESAI dan G1-04 SELESAI**, keduanya dalam SATU sesi (PR
> #359 — awalnya dibuka untuk G1-03, diperluas dengan komit G1-04 di branch
> yang sama, bukan dua PR terpisah; lihat §0). Sesi 6 lanjut ke **G1-05**
> (parse **di server**, DI SINI-lah `bacaDanEkstrakPdtZip` dan
> `parsePdtAngka` yang sesi ini bangun BENAR-BENAR dipakai membaca upload
> nyata) — lihat §4.

---

## 0. Ringkasan 60 detik

Instruksi sesi ini: "baca handoff sesi 4 dan lanjutkan" → G1-03 selesai (lihat
§2) → user minta "lanjut g1-04" di percakapan yang sama → G1-04 juga selesai
(§3), semuanya di satu sesi/branch berkelanjutan.

**Cek sebelum sesi 6 mulai:** PR #359 statusnya saat berkas ini ditulis
**open, belum di-merge** (title masih menyebut "G1-03" saja — perlu
diperbarui menyebut G1-04 juga, atau dipecah kalau reviewer minta). Kalau
sesi 6 mulai dan PR #359 SUDAH di-merge: lanjut normal dari `main`. Kalau
BELUM: cek CI-nya dulu (kemungkinan flake `gelombang-c-showcase.e2e.test.ts`
yang sama seperti PR #356/#357, root-cause `HANDOFF_PDT_SESI2.md` §4 — bukan
punya G1-03/G1-04).

**G1-03** — `parsePdtAngka` (`packages/core/src/pdt/angka.ts`): normalisasi
angka terpusat PDT, tiga keadaan (sel kosong ⇒ 0, tak-terbaca ⇒ NaN, kolom
tak ada ⇒ di luar cakupan). Nol migrasi, nol pemanggil (menunggu G1-05).

**G1-04** — bucket `pdt-raw` + pagar ZIP (Rule 41-42) + pembaca sungguhan +
signed URL. **Dua temuan teknis penting** ditemukan lewat percobaan nyata
(bukan dari dokumentasi) — dicatat penuh di `docs/DECISIONS.md`, ringkasannya
di §3.2 di bawah supaya sesi 6 tidak mengulang biaya penemuannya. **Satu gap
jujur:** signed URL BELUM diuji terhadap Storage live (nol
`SUPABASE_SERVICE_ROLE_KEY` di sandbox sesi ini) — lihat §3.4.

---

## 1. Yang perlu ditindaklanjuti sesi ini (sebelum atau sambil mulai G1-05)

1. Cek status PR #359 (lihat §0). Kalau CI merah dengan
   `gelombang-c-showcase.e2e.test.ts` / fixture `client_platforms` collision:
   bug pra-ada yang sama, standing-down + satu re-run, JANGAN diperbaiki di
   PR ini.
2. **Jalankan tes `describeLive` di `apps/api/src/lib/pdt-storage.test.ts`**
   di lingkungan yang punya `SUPABASE_SERVICE_ROLE_KEY` +
   `NEXT_PUBLIC_SUPABASE_URL` sungguhan (project `CDPS SG`,
   `egddxfcnrtecheiykhlf`) — sandbox sesi G1-04 TIDAK punya kredensial itu,
   jadi tes itu di-skip, bukan lolos. Ini satu-satunya bagian DoD G1-04 yang
   belum diverifikasi nyata ("signed URL kedaluwarsa benar-benar menolak").

---

## 2. G1-03 — SELESAI

| Berkas | Isi |
|---|---|
| `packages/core/src/pdt/angka.ts` | `parsePdtAngka(v, raw?)` |
| `packages/core/src/pdt/angka.test.ts` | 25 tes |
| `packages/core/src/pdt/index.ts` | tambah `export * from './angka'` |

Kontrak: sel kosong (`null`/`undefined`/`''`) ⇒ `0`; nilai ada tapi tak
terbaca (`'-'`, `'N/A'`, teks acak, `NaN`/`Infinity`) ⇒ `NaN`; kolom tak ada
sama sekali ⇒ di luar cakupan (G1-08). `raw` sama semantik `n(v,raw)`
housewide. Rp-prefix, persen (÷100), negatif berkurung diikutkan — semua
terverifikasi perlu di data Shopee/TikTok nyata. **Berdiri sendiri** — tidak
memanggil/mengubah `n()`/`parseIndonesianNumber()` (backlog melarang
mengubah `n()`). **Belum ada pemanggil** — menunggu G1-05.

Rasional lengkap + alternatif ditolak: `docs/DECISIONS.md` 2026-09-13 baris
G1-03.

---

## 3. G1-04 — SELESAI

### 3.1 Berkas

| Berkas | Isi |
|---|---|
| `packages/core/src/pdt/zip-pagar.ts` | `evaluatePdtZipPagar` — Rule 41-42, MURNI (nol I/O) |
| `packages/core/src/pdt/zip-pagar.test.ts` | 32 tes (metadata sintetis) |
| `packages/core/src/pdt/index.ts` | tambah `export * from './zip-pagar'` |
| `apps/api/src/lib/pdt-zip.ts` | `bacaDanEkstrakPdtZip`/`bersihkanDirektoriSementaraPdt` — pembaca ZIP sungguhan (`yauzl`) |
| `apps/api/src/lib/pdt-zip.test.ts` | 8 tes fixture ZIP sungguhan (`yazl`) |
| `apps/api/src/lib/pdt-storage.ts` | `buatPdtRawSignedUrl` — Storage REST langsung, klem ≤15 menit |
| `apps/api/src/lib/pdt-storage.test.ts` | 6 tes unit (fetch disuntik) + 1 tes `describeLive` (skip di sandbox) |
| `apps/api/package.json` | + `yauzl` (runtime), `yazl`/`@types/yauzl`/`@types/yazl` (dev) |
| `supabase/migrations/20261013010000_g1_04_pdt_raw_bucket.sql` | bucket `pdt-raw` + policy `storage.objects` |
| `supabase/tests/rls_checks.sql` | §47 baru — RLS bucket `pdt-raw` |
| `docs/DECISIONS.md` | 1 baris baru (di ATAS baris G1-03) |
| `docs/DATA_MODEL.md` | 1 baris baru setelah "Batch upload PDT" |

Diterapkan ke live `CDPS SG` (`egddxfcnrtecheiykhlf`) via `apply_migration`.
Diverifikasi: bucket + policy ada (`execute_sql`), `get_advisors` security
**nol temuan baru**.

### 3.2 Dua temuan teknis — BACA sebelum menyentuh `pdt-zip.ts` atau migrasi storage lain

1. **yauzl `decodeStrings:true` (default) melempar error untuk SELURUH
   pembacaan ZIP** (bukan per-entri) begitu satu entri bernama zip-slip
   (`../`, path absolut) ditemukan — `validateFileName()` bawaannya sendiri
   yang melempar. Itu akan menjadikan zip-slip kegagalan PAKET, padahal
   Rule 41 memperlakukannya sebagai kegagalan ENTRI (paket lain tetap
   diproses). **Solusi:** `decodeStrings:false` + dekode manual pakai
   `yauzl.getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, entry.extraFields, false)`
   (primitif yauzl sendiri, TANPA validasinya). Keputusan zip-slip 100% di
   `evaluatePdtZipPagar`, bukan terpecah dengan yauzl.
2. **`CREATE TABLE/SCHEMA IF NOT EXISTS` di Postgres TETAP memeriksa
   privilese CREATE pada skema target SEBELUM mengecek keberadaan objek.**
   Migrasi yang menstub `storage.*` untuk `scripts/db-rebuild.sh` (Postgres
   baru, skema `storage` platform Supabase tidak ada di sana) gagal
   `permission denied for schema storage` di LIVE walau objeknya sudah ada
   dan seharusnya di-skip — peran migrasi bukan pemilik skema `storage` di
   live. **Solusi:** cek keberadaan SENDIRI (`pg_namespace`/`pg_class`/
   `pg_proc`) di dalam blok `DO`, `EXECUTE` DDL hanya bila benar-benar belum
   ada. Kalau menulis migrasi storage LAIN di masa depan: pakai pola yang
   sama persis (lihat `20261013010000_g1_04_pdt_raw_bucket.sql`), jangan
   `IF NOT EXISTS` polos.

### 3.3 Kontrak pagar (Rule 41-42)

`evaluatePdtZipPagar({ukuranPaketBytes, entries})` → gerbang PAKET (Rule 42)
diperiksa lebih dulu: >50MB, >40 entri (MENTAH, termasuk junk macOS — metrik
termurah sebelum tahu mana yang junk), rasio dekompresi total >100:1 ⇒
`{ok:false, alasanTolakPaket, entri:[]}` (entri SENGAJA tidak diklasifikasi).
Kalau lolos, tiap entri diklasifikasi (Rule 41): `dilewati` (macOS junk,
silent) / `ditolak` (zip bersarang/terenkripsi/ekstensi tak didukung/zip-slip
— TIDAK menggagalkan paket) / `diproses`.

`bacaDanEkstrakPdtZip(buffer)` — dua lewatan atas satu `ZipFile`: lewatan 1
kumpulkan metadata (nol dekompresi), panggil pagar; lewatan 2 ekstrak
STREAMING (Transform pass-through hash) ke direktori sementara HANYA entri
`diproses`. `validateEntrySizes:true` (default yauzl) = lapis kedua terhadap
metadata bohong — mismatch ditangkap per-entri ke `gagalEkstrak`, tidak
menjatuhkan batch.

### 3.4 Yang BELUM diverifikasi (gap jujur, bukan diklaim selesai)

- **Signed URL vs live Storage** — `buatPdtRawSignedUrl` benar secara bentuk
  request (6 tes unit lolos), tapi DoD "kedaluwarsa benar-benar menolak"
  BELUM dijalankan terhadap Storage sungguhan (nol
  `SUPABASE_SERVICE_ROLE_KEY` di sandbox). Tes `describeLive` di
  `pdt-storage.test.ts` sudah ditulis lengkap (upload objek kecil, sign
  `expiresIn=1`, tunggu 2 detik, assert ditolak, cleanup) — tinggal
  dijalankan di lingkungan yang punya kredensialnya.
- **Belum ada pemanggil** untuk `bacaDanEkstrakPdtZip`/`buatPdtRawSignedUrl`
  dari route manapun — G1-04 menyediakan alat, G1-05/09 yang memasangnya ke
  endpoint upload sungguhan.

---

## 4. Rekomendasi sesi 6 — mulai G1-05

`docs/backlog/PDT_BACKLOG.md` §1 G1-05: **"Parse di server — pemindahan
arsitektur yang sesungguhnya."**

1. `XLSX.read` hari ini jalan **di browser**
   (`web-internal/src/lib/{riset-awal,report,skuscreener,adsscanner}.ts`);
   PRD §6.7 minta parse di server. Seluruh engine `packages/core` SUDAH
   murni/DOM-free/menerima AoA — yang pindah HANYA dekode berkasnya.
2. `xlsx@0.18.5` hari ini dependensi **`web-internal` saja** — perlu masuk
   `apps/api`. ⚠️ Lisensi SheetJS pernah jadi ketidakpastian terbuka
   (`RISET_AWAL_BASELINE_BACKLOG.md` §0) — **pastikan terjawab dulu**
   sebelum menambah dependensi.
3. Di sinilah `bacaDanEkstrakPdtZip` (G1-04) dan `parsePdtAngka` (G1-03)
   BENAR-BENAR dipakai: entri yang diekstrak G1-04 (path di
   `pathSementara`) dibaca `XLSX.read` di server, dikonversi ke AoA, lalu
   `detectPdtModule` (G1-02) mencocokkan modul, `parsePdtAngka` (G1-03)
   menormalkan selnya.
4. Target < 45 detik batch 13 berkas (~1.500 baris SKU + ~2.000 baris
   konten). Bila lebih: job asinkron + status polling — BUKAN mengurangi
   kedalaman parse.
5. Setelah G1-05: G1-06 (identitas toko dari berkas) → G1-07 (rekonsiliasi)
   → G1-08 (kegagalan parse tidak ditelan) → G1-09 (halaman upload +
   dropdown override manual, termasuk 3 modul unverified G1-02 §2.3).

**Jangan lompat ke G1-09** sebelum G1-05..08 — build order eksplisit
`PDT_BACKLOG.md` §0.

---

## 5. Rujukan

- `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` — §6.7 (angka), Rule 38-44 (ZIP),
  §7 (modul).
- `docs/backlog/PDT_BACKLOG.md` — G1-04 (sesi ini) → G1-05 (sesi berikutnya).
- `docs/DECISIONS.md` — dua baris teratas (2026-09-13, PDT G1-04 lalu G1-03).
- `docs/DATA_MODEL.md` — baris "Bucket storage `pdt-raw` PDT" baru.
- `packages/core/src/pdt/angka.ts`, `zip-pagar.ts` + tes.
- `apps/api/src/lib/pdt-zip.ts`, `pdt-storage.ts` + tes.
- `supabase/migrations/20261013010000_g1_04_pdt_raw_bucket.sql`.
- `supabase/tests/rls_checks.sql` §47.
- Live: `CDPS SG` (`egddxfcnrtecheiykhlf`) — bucket `pdt-raw` + policy
  `pdt_raw_objects_select` sudah live, `get_advisors` nol temuan baru.
