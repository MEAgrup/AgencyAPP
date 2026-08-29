# HANDOFF — Mulai dari sini untuk melanjutkan M16/M17

> **Baca dokumen ini SEBELUM menyentuh apa pun terkait M16/M17.** Ia adalah
> ringkasan navigasi ke tiga dokumen yang sudah ada di repo — tidak
> menduplikasi isinya, hanya memberi tahu urutan baca dan apa yang benar-benar
> tersisa. Ditulis 2026-08-29 setelah PR #247 dan #248 merge ke `main`, dan
> setelah dokumen konsolidasi (`RENCANA_INDUK_M16_M17.md`) sendiri sempat
> ditulis dua kali karena kondisi berubah di tengah sesi (lihat §4).

---

## 0. TL;DR

**M16 (Lead Time per Tahapan Divisi) dan M17 (AI Optimizer) sudah selesai
dibangun, sudah di-review, sudah merge ke `main`, dan sudah di produksi
(`CDPS SG`).** Yang tersisa adalah pekerjaan kecil dan tidak mendesak:
8 keputusan implementasi menunggu konfirmasi pemilik, satu fase yang sengaja
diblokir security spec, dan dua item dokumentasi drift yang tidak terkait
M16 sama sekali. Tidak ada satu pun dari sisa ini yang menghalangi fitur
berjalan di produksi hari ini.

---

## 1. Urutan baca (tiga dokumen, sudah cukup)

1. **`docs/handoff/RENCANA_INDUK_M16_M17.md`** — baca ini dulu, penuh.
   Berisi: kenapa modul ini ada, temuan repo yang membentuk desainnya,
   23 keputusan pemilik lengkap dengan rasional, kamus 12 tabrakan istilah,
   desain teknis 5 blok, analisis latensi review AM, riwayat eksekusi
   (bagaimana PR #247 dan #248 benar-benar terjadi), dan daftar sisa
   pekerjaan (§6).
2. **`docs/backlog/LEADTIME_BACKLOG.md`** — status tiket **otoritatif**.
   Setiap baris ✅ menyebut nama migrasi dan nama test persis. Kalau Anda
   ragu apakah sesuatu sudah dibangun, cek di sini, bukan menerka dari kode.
3. **`docs/DECISIONS.md`, cari `M16`** — rasional penuh tiap keputusan,
   termasuk 8 yang masih terbuka (`LT-4`..`LT-11`) dan dua temuan keamanan
   yang sudah ditambal (baris `🔴 KEAMANAN` dan `db push`, keduanya
   2026-08-29).

Kalau ketiganya sudah dibaca, Anda tahu semua yang perlu diketahui — jangan
membaca ulang seluruh riwayat chat sebelumnya.

---

## 2. Sisa pekerjaan — dalam urutan yang masuk akal dikerjakan

Semuanya **single-track** (satu sesi, tidak dipecah paralel — keputusan
pemilik 2026-08-29, dicatat `DECISIONS.md`).

| # | Isi | Butuh apa | Mendesak? |
|---|---|---|---|
| — | Sodorkan `LT-4`..`LT-11` ke pemilik untuk konfirmasi | Membaca 8 baris `DECISIONS.md` §Open, mengajukan lewat `AskUserQuestion` atau kanal lain | Tidak — nol yang memblokir fitur berjalan |
| LT-1 | Bobot `perf_kpi_weights` final untuk `kecepatan_review_am` + divisi baru | Keputusan COO, satu tulisan config, nol deploy | Tidak — bobot 0 aman selamanya sampai diputuskan |
| LT-2 | Daftar & urutan pekerjaan Store Operation | Keputusan pemilik, lalu satu migrasi seed `stage_pipeline` | Tidak — divisi berfungsi tanpa pipeline |
| LT-60 | Input tahapan Live oleh tim internal atas nama vendor | Implementasi baru, tidak bergantung apa pun | Bisa dikerjakan kapan saja |
| — | Halaman FE penuh untuk Ads/Permintaan | Implementasi baru — PR #247 baru bawa type declaration wire | Kalau tim mulai memakai fitur Ads/Permintaan |
| O61 | Back-port 2 migrasi hardening keamanan live-only sebagai berkas riwayat | Sesi fokus tersendiri, **tidak terkait M16** | Tidak — live sudah benar |
| O62 | Verifikasi migrasi `m6a_section_d` yang ter-apply 2× di live | Sesi fokus tersendiri, **tidak terkait M16** | Tidak — belum ada gejala kerusakan |
| LT-61 | Login vendor sendiri (realm auth eksternal) | 🔴 **Terblokir** — butuh spec keamanan client-portal-style yang belum ditulis | **Jangan mulai** sampai spec itu ada |

**Kalau Anda ditugaskan modul CDPS lain (bukan M16/M17):** dokumen-dokumen
di atas tidak relevan untuk Anda — cek `docs/prd/CDPS_Build_Plan.md` dan
`docs/DECISIONS.md` entri terbaru untuk konteks modul itu.

---

## 3. Jebakan yang sudah ditemukan — jangan diulangi

1. **Jangan jalankan `npx vitest run` dari root repo.** Melewati
   `packages/domain/vitest.config.ts` (`fileParallelism: false`, sengaja
   menyerialkan test karena berbagi satu koneksi Postgres) → ratusan
   false-failure. Pakai `npm run test --workspaces --if-present` dari root,
   atau `cd packages/domain && npx vitest run`.
2. **Sebelum push ke branch designated manapun, `git fetch` dan cek riwayat
   remote lebih dulu.** Sesi ini sempat menulis ulang status build dua kali
   karena PR #247 lalu #248 merge ke `main` **di tengah sesi**, oleh sesi
   lain, tanpa notifikasi — `git log origin/main` adalah kebenaran, bukan
   asumsi dari chat sebelumnya.
3. **Cek `mcp__github__list_pull_requests` / nomor PR yang disebut pemilik**
   sebelum mempercayai status "belum di-push ke live" dari dokumen mana pun
   yang lebih dari beberapa jam umurnya — migrasi produksi bisa berubah
   status cepat di repo yang aktif seperti ini.
4. **Setelah `apply_migration` ke Supabase live, selalu jalankan
   `mcp__Supabase__get_advisors` (security).** Preseden O61 dan temuan
   `stage_overdue_tick`/`permintaan_reminder_tick` (2026-08-29): Supabase
   memasang `ALTER DEFAULT PRIVILEGES` yang memberi `anon`/`authenticated`
   EXECUTE pada setiap fungsi baru — `REVOKE ... FROM PUBLIC` saja **tidak**
   mencabutnya, dan tidak ada test Postgres polos (CI/lokal) yang bisa
   menangkap ini.

---

## 4. Kenapa ada dua versi `RENCANA_INDUK_M16_M17.md`

Untuk transparansi kalau Anda melihat commit yang tampak menulis ulang
dokumen yang sama dua kali dalam waktu singkat: sesi yang menulisnya mulai
dari asumsi "Fase 2–4 belum dikerjakan" (benar pada titik itu), lalu
menemukan PR #247 sudah merge, menulis ulang jadi "sudah merge ke `main`,
belum di-push ke live", lalu menemukan PR #248 **juga** sudah merge,
menulis ulang lagi jadi "sudah di produksi". Ini bukan indikasi dokumen
tidak stabil — ini bukti bahwa dokumen tersebut ditulis berdasarkan
`git log origin/main` nyata di setiap titik, bukan diasumsikan. Versi yang
ada di `main` sekarang adalah versi final yang sudah diverifikasi terhadap
PR #248.

---

## 5. Kontak/otorisasi

Pemilik: Nerissa (nerissa.arv@meagency.co.id) dan Yohan
(yohanagustian@meagency.co.id, juga akun GitHub yang merge PR #247/#248).
Keduanya berwenang menjawab `LT-4`..`LT-11` dan menetapkan bobot LT-1.
