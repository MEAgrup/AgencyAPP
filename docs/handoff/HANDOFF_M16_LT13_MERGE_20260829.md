# HANDOFF — LT-13 diputus, PR #247 menuju merge (lanjutan HANDOFF_M16_PENGGABUNGAN.md)

> Baca ini SEBELUM `HANDOFF_M16_PENGGABUNGAN.md` dan `HANDOFF_SUPABASE_PUSH_20260829.md` —
> nomor tertinggi, jadi ini yang menggambarkan posisi sebenarnya. Kedua handoff
> lama tetap berguna untuk detail Akun A/B dan alasan menahan `db push`.

## 0. TL;DR — posisi sekarang

- **LT-13 SUDAH DIPUTUS pemilik** (via `AskUserQuestion`, 2026-08-29): arah (a).
  `syncAiOptimizerSkuRevision` sekarang berjalan untuk SEMUA klien Aktif yang
  SKU-nya cocok — termasuk yang punya `strategi_assumption` tercatat (sebelumnya
  DEFER untuk hampir semua klien nyata). Diimplementasikan + diuji + di-push ke
  PR #247.
- **Konflik merge PR #247 vs `main` (docs/DECISIONS.md) SUDAH DIRESOLVE** — bukan
  lagi blocker. `mergeable_state` sudah `unstable`→(harusnya `clean` begitu CI
  selesai), BUKAN lagi `dirty`.
- **PR #247 SEDANG MENUNGGU job `backend` (oracle paritas Go) selesai** di CI
  terakhir — job lain (api/core-engines/db-and-migrations/web-internal) semua
  ✅. **Cek dulu status PR sebelum lanjut apa pun** — kalau sesi ini berakhir
  sebelum job itu selesai, sesi berikutnya HARUS cek ulang, bukan asumsi hijau:
  `mcp__github__pull_request_read` method `get`/`get_status` pada PR #247.
- **Kalau CI hijau semua DAN `mergeable_state=clean` DAN nol review/thread
  terbuka** (dicek sesi ini: 0 review, 0 thread) — **merge PR #247** (pemilik
  sudah eksplisit minta "kalau sudah bisa, merge" di chat 2026-08-29). Method
  `merge` (bukan squash/rebase) — konsisten dengan pola commit merge yang
  sudah dipakai repo ini (`git log origin/main`).
- **Supabase `db push` migrasi M16/M17 (20 berkas, `20260829001000`..
  `20260831080000`) BELUM dijalankan ke `CDPS SG` live** — sengaja ditahan
  sampai PR #247 benar-benar merge ke `main` (prinsip O38: live tidak boleh
  mendahului `main`). **Setelah merge, ini next action #1** — lihat §3.

## 1. Progress build plan keseluruhan — sudah sampai mana

`docs/prd/CDPS_Build_Plan.md` §4: Sprint 0 → Wave 1 (M0,M1,M4,M5) → Wave 2
(M6,M12,M7,M8,M9,M10) → Wave 3 (M2,M3,M11,M13,M14,M15). **Semua wave itu
SUDAH SELESAI** jauh sebelum sesi ini (lihat riwayat `docs/DECISIONS.md` —
M6A-M6D, M8, M9, M14 dst. semua sudah dibangun & di-QA berkali-kali oleh
pemilik di produksi).

**M16 (Lead Time per Tahapan) + M17 (AI Optimizer)** BUKAN bagian dari 16 modul
asli — ini spec BARU yang diminta pemilik 2026-08-28 (`docs/prd/CDPS_Module16_Lead_Time.md`,
`docs/prd/CDPS_Module17_AI_Optimizer.md`), dikerjakan paralel 2 akun
(`docs/handoff/PARALEL_M16_DUA_AKUN.md`) lalu digabung. Status
`docs/backlog/LEADTIME_BACKLOG.md` §0:

| Fase | Isi | Status |
|---|---|---|
| 0 | Spec + keputusan | ✅ SELESAI |
| 1 | Registry divisi | ✅ SELESAI |
| 2/2b | Pipeline tahapan + lead time + metrik AM | ✅ SELESAI |
| 3 | Ads | ✅ SELESAI |
| 4 | `REQ-` + AI Optimizer | ✅ SELESAI (LT-13, satu-satunya gap signifikan, DIPUTUS sesi ini) |
| 5 | Portal vendor Live | ⬜ **TERBLOKIR** — butuh security spec eksternal (belum ada). **JANGAN mulai** sampai spec itu ada — lihat `CLAUDE.md` "Client Portal terakhir, setelah security spec". |

**Jadi: seluruh scope M16/M17 yang DIRENCANAKAN sudah selesai kodenya, tinggal
PR #247 merge + push migrasi ke live.** Tidak ada modul baru yang perlu ditulis
dari nol — pekerjaan tersisa murni administratif (merge, push, keputusan
kosmetik LT-4..12/14).

## 2. Cutover Go/MySQL → TS/Supabase (`docs/backlog/CUTOVER_BACKLOG.md`)

**Tidak disentuh sesi ini, statusnya sama seperti sebelumnya:** `backend/`
(Go) masih hidup HANYA sebagai oracle paritas (job CI `backend`), belum
dicabut (C-05 belum tercapai). Job `backend` di PR #247 ada persis untuk
menjaga paritas ini — kalau ia merah, itu urusan paritas Go↔TS, BUKAN kode
M16/M17 (M16/M17 tidak menyentuh `backend/` sama sekali, jadi kegagalan di
sana kemungkinan besar pra-eksisting, cek dulu apakah merah juga di `main`
sebelum menyalahkan PR ini).

## 3. Next actions — urutan

1. **Cek status PR #247** (`pull_request_read` get/get_status/get_check_runs).
   - Kalau job `backend` masih jalan atau baru selesai: tunggu hasilnya.
   - Kalau **semua hijau + `mergeable_state=clean`**: **merge** (method
     `merge`), lalu lanjut ke langkah 2.
   - Kalau ada yang merah: diagnosa dulu (ikuti aturan "CI red" di system
     prompt — cek dulu apakah merah juga di `main`/pra-eksisting sebelum
     root-cause sebagai punya PR ini).
2. **Setelah PR #247 MERGE ke `main`** — jalankan `apply_migration` (BUKAN
   `db push` mentah — itu bukan pola nyata repo ini, lihat
   `HANDOFF_SUPABASE_PUSH_20260829.md` §alasan) ke `CDPS SG`
   (`egddxfcnrtecheiykhlf`) untuk 20 migrasi M16/M17, **urut nama berkas**:
   `20260829001000_m16_fondasi.sql` … `20260831080000_lt13_sync_revisi_otomatis.sql`
   (`ls supabase/migrations/2026083[0-9]*.sql supabase/migrations/2026083[01]*.sql | sort`
   dari `main` pasca-merge untuk daftar pasti). Verifikasi
   `mcp__Supabase__list_migrations` SEBELUM push (pastikan tidak ada drift baru
   sejak sesi ini — pola O38, "petakan per makna, jangan per nomor").
3. **Sodorkan sisa `docs/DECISIONS.md` §Open LT-4, LT-5, LT-6, LT-7, LT-8,
   LT-9, LT-10, LT-11, LT-14 ke pemilik** (LT-12/LT-14 sekadar catatan
   struktur, tidak butuh keputusan aktif) — nol yang memblokir apa pun, tapi
   sudah menunggu sejak PR #247 dibuat.
4. **O61/O62** (`docs/DECISIONS.md` §Open, dari sesi `supabase-db-push-live`
   terpisah) — drift live-only PRA-M16, sesi fokus tersendiri:
   - O61: back-port 2 migrasi hardening keamanan live-only (`harden_job_execute_surface`,
     `harden_secdef_execute_sweep`) sebagai berkas riwayat verbatim.
   - O62: diff isi `m6a_section_d` yang ter-apply dua kali di live vs satu
     berkas lokal — pastikan harmless.
5. **Fase 5 (Portal vendor Live)** — JANGAN mulai sampai security spec
   client-portal-style untuk vendor eksternal ada.

## 4. PR yang aktif sekarang

- **#247** `claude/buildplan-lead-time-tracking-g62d2i` → `main` — M16/M17
  penuh. Draft: **tidak** (ready for review). Lihat §0/§3.
- **#248** `claude/supabase-db-push-live-inbv0l` → `main` — dokumentasi
  keputusan db-push (m6b_carry_over sudah di-push live, M16 ditahan). Draft:
  ya. CI hijau, `mergeable_state=clean`, aman di-merge kapan saja pemilik mau
  (nol dependency ke #247).

## 5. Referensi

- `docs/handoff/HANDOFF_M16_PENGGABUNGAN.md` — konteks penggabungan Akun A/B.
- `docs/handoff/HANDOFF_SUPABASE_PUSH_20260829.md` — alasan lengkap menahan
  db push + apa yang sudah di-push.
- `docs/DECISIONS.md` — baris 2026-08-29 (LT-13 Decided, di paling atas
  §Decided) + §Open (LT-4..12/14, O61, O62).
- PR #247: https://github.com/MEAgrup/AgencyAPP/pull/247
- PR #248: https://github.com/MEAgrup/AgencyAPP/pull/248
