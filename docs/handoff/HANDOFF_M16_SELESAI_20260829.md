# HANDOFF — M16/M17 SELESAI: PR #247 merged, live di-push, temuan keamanan ditambal

> Baca ini LEBIH DULU — nomor tertinggi di rantai M16. Berkas sebelumnya
> (`HANDOFF_M16_PENGGABUNGAN.md`, `HANDOFF_SUPABASE_PUSH_20260829.md`,
> `HANDOFF_M16_LT13_MERGE_20260829.md` — yang terakhir kini ada di `main` via
> merge PR #247) tetap berguna untuk detail historis, tapi semua next-action
> yang mereka sebut SUDAH SELESAI di sesi ini. Jangan ulangi.

## 0. TL;DR — semua tuntas

- ✅ **LT-13 diputuskan pemilik** (arah a) + diimplementasikan + di-test.
- ✅ **PR #247 di-merge** ke `main` (commit `d231a71`) — pemilik konfirmasi
  eksplisit setelah CI hijau + `mergeable_state: clean` + 0 review terbuka.
- ✅ **20→13 migrasi M16/M17 di-push ke `CDPS SG` live** via `apply_migration`
  urut nama berkas. Gate pasca-push: 128 tabel / 36 prefix / 29 mesin / 65
  notif — persis klaim PR, nol drift.
- 🔴→✅ **Temuan keamanan baru, ditambal SAMA SESI:** `get_advisors` pasca-push
  menemukan `stage_overdue_tick` (callable TANPA login) dan
  `permintaan_reminder_tick` (callable authenticated) — pola persis O61
  (REVOKE FROM PUBLIC tidak mencabut default-privilege Supabase ke
  anon/authenticated). Ditambal migrasi baru `20260831090000_harden_m16_tick_execute.sql`,
  diterapkan live, `get_advisors` bersih.
- 📋 **PR #248** (`claude/supabase-db-push-live-inbv0l`) membawa migrasi
  hardening ini + seluruh dokumentasi sesi — CI sedang jalan saat handoff ini
  ditulis, **cek statusnya dulu** sebelum kerja lain.

## 1. Yang TIDAK perlu dikerjakan lagi (sudah selesai)

- ~~Push migrasi M16/M17 ke live~~ — SELESAI.
- ~~Resolve konflik PR #247~~ — SELESAI (merged).
- ~~LT-13~~ — SELESAI (Decided, diimplementasikan, di-test).

## 2. Yang MASIH terbuka (tidak mendesak)

1. **Cek PR #248** — `mcp__github__pull_request_read` get/get_status/get_check_runs.
   Kalau CI belum selesai saat sesi ini berakhir, sesi berikutnya cek dulu,
   lalu merge kalau hijau + clean (pemilik sudah minta pola ini: "kalau sudah
   bisa, merge").
2. **`docs/DECISIONS.md` §Open LT-4, LT-5, LT-6, LT-7, LT-8, LT-9, LT-10,
   LT-11** — 8 keputusan implementasi M16 yang masih menunggu pemilik (LT-12/
   LT-14 sekadar catatan struktur, sudah ditambal, tidak butuh keputusan).
   Sodorkan ke pemilik kapan pun nyaman — nol yang memblokir.
3. **O61/O62** (`docs/DECISIONS.md` §Open) — drift live-only PRA-M16
   (ditemukan sesi sebelumnya, BUKAN terkait push M16 ini): dua migrasi
   hardening keamanan live-only tanpa berkas repo, dan satu migrasi
   `m6a_section_d` ter-apply dua kali. Live sudah benar untuk O61/O62 (beda
   dengan temuan hari ini yang justru live-nya bocor) — sesi fokus tersendiri,
   tidak mendesak.
4. **Fase 5 M16 (Portal vendor Live)** — JANGAN mulai. Terblokir security spec
   client-portal-style untuk vendor eksternal yang belum ditulis (`CLAUDE.md`:
   "Client Portal terakhir, setelah security spec").

## 3. Progress build plan keseluruhan

Semua 16 modul asli (Sprint 0 → Wave 1 → Wave 2 → Wave 3) sudah selesai jauh
sebelum sesi ini. M16 (Lead Time)/M17 (AI Optimizer) — spec baru di luar 16
modul, diminta pemilik 2026-08-28 — sekarang **fase 0-4 selesai penuh dan
sudah di produksi**; fase 5 terblokir seperti di atas.

## 4. Referensi

- `docs/DECISIONS.md` — cari tanggal **2026-08-29** untuk seluruh rantai
  keputusan sesi ini (LT-13, push M16, temuan keamanan) + §Open LT-4../O61/O62.
- PR #247 (merged): https://github.com/MEAgrup/AgencyAPP/pull/247
- PR #248 (cek status): https://github.com/MEAgrup/AgencyAPP/pull/248
- `docs/backlog/LEADTIME_BACKLOG.md` §0 — status fase M16/M17.
