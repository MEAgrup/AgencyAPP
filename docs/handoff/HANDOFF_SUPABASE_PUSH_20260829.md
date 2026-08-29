# HANDOFF — Keputusan `supabase db push` 2026-08-29 (lanjutan HANDOFF_M16_PENGGABUNGAN.md)

> Sesi ini menjawab pertanyaan pemilik "cek apakah lebih baik push sekarang
> atau nanti" dari `docs/handoff/HANDOFF_M16_PENGGABUNGAN.md` §5 butir 1.
> Detail lengkap (SQL, ID versi, angka verifikasi) ada di `docs/DECISIONS.md`
> baris **2026-08-29** (§Decided, paling atas) + **O61**/**O62** (§Open).
> Ini ringkasan navigasi, bukan pengganti baris itu.

## TL;DR

- **M16 (PR #247) TIDAK di-push ke `CDPS SG` sesi ini.** PR itu punya konflik
  merge NYATA di `docs/DECISIONS.md` terhadap `main` saat ini (`mergeable_state:
  "dirty"`, diverifikasi lewat merge 3-way lokal), dan LT-13 (keputusan yang
  mengubah perilaku `syncAiOptimizerSkuRevision`) belum dijawab pemilik.
  Prinsip rumah (pelajaran O38, sudah dicatat berkali-kali di `DECISIONS.md`):
  **live tidak boleh mendahului `main`**. Push 20 migrasi M16 sebelum PR
  merge akan mengulang pola drift itu.
- **Satu migrasi LAIN yang sudah aman (sudah di `main`, bukan di PR #247)
  DI-PUSH sesi ini:** `20260810030000_m6b_carry_over.sql` (B-08/Rule 16,
  merge sejak 2026-08-10) ternyata belum pernah ter-push — tertinggal murni
  karena kelalaian, bukan keputusan sengaja. Diterapkan + diverifikasi
  struktural (kolom+constraint cocok berkas, nol baris data tersentuh, nol
  temuan advisor baru).
- **Ditemukan drift live-only YANG SUDAH ADA SEBELUM sesi ini** (bukan
  disebabkan M16): dua migrasi keamanan (`harden_job_execute_surface`,
  `harden_secdef_execute_sweep`, Agustus 14-15) hidup di live tapi TIDAK ADA
  berkasnya di git manapun (O61), dan `m6a_section_d` ter-apply dua kali di
  live vs satu berkas lokal (O62). Keduanya **dicatat, tidak diperbaiki**
  sesi ini — di luar scope, butuh sesi fokus sendiri.

## Next task (urutan disarankan)

1. **PR #247** — sesi yang bekerja di branch `claude/buildplan-lead-time-tracking-g62d2i`
   perlu resolve konflik `docs/DECISIONS.md` (main sudah menambah entri baru,
   termasuk entri sesi ini, sejak PR #247 bercabang) lalu merge ke `main`.
2. **Sesudah PR #247 merge** — terapkan 20 migrasi M16/M17 (`20260829001000`
   s/d `20260831070000`) ke `CDPS SG` lewat `apply_migration` **satu per satu,
   urut nama berkas** (bukan `db push` sekaligus — ikuti pola nyata yang
   sudah dipakai repo ini, lihat migrasi-migrasi sebelumnya di `list_migrations`
   yang nama fieldnya = nama berkas repo, version = waktu apply).
3. **LT-13** perlu jawaban pemilik sebelum atau sesudah push (tidak
   memblokir push migrasi lain, tapi membatasi klaim fitur AI Optimizer→STRG
   untuk klien ber-`strategi_assumption` sampai dijawab).
4. **O61** — back-port 2 migrasi hardening live-only sebagai berkas riwayat
   (pola sama `20260723064826_rls_harden_execute_surface`, 2026-07-29).
5. **O62** — diff isi `m6a_section_d` dua versi live vs berkas repo untuk
   pastikan retry-nya harmless.

## Referensi

- `docs/handoff/HANDOFF_M16_PENGGABUNGAN.md` — konteks penuh M16/PR #247.
- `docs/DECISIONS.md` baris 2026-08-29 (§Decided) — bukti lengkap (query,
  hasil, angka) untuk semua temuan di atas.
- PR #247: https://github.com/MEAgrup/AgencyAPP/pull/247
