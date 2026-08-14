# Handoff — D-14 (Disiplin Rekap M14) SELESAI (SESI 4) + task berikutnya

**Tanggal:** 2026-08-14 · **Branch:** `claude/baca-handoff-optimasi-metrik-mm073o`
**Pendahulu:** `HANDOFF_OPTIMASI_DAN_METRIK_SESI3.md` (menutup T-1…T-4; D-14 = prioritas #1).
Baca ini paling akhir — ia menutup D-14.

> **Ringkas:** **D-14 SELESAI** — komponen skor M14 *Disiplin Rekap Mingguan* (AM) +
> *Kepatuhan Catatan Mingguan* (divisi Creative/Ads/KOL) dibangun di atas bobot
> RM-9a yang sudah ditandatangani pemilik 2026-08-13. Semua suite hijau. Keputusan
> implementasi tercatat di `docs/DECISIONS.md` (blok 2026-08-14).

---

## 0. MULAI DARI SINI
1. Branch memuat satu commit fitur D-14 di atas PR #163 (T-1…T-4). Verifikasi CI
   hijau lalu merge PR-nya.
2. Task berikutnya yang nyata ada di §3. Tidak ada yang mendesak/terblokir —
   semua sisa **owner-gated** atau poles opsional.

## 1. Yang DIBANGUN (D-14)
| Berkas | Isi |
|---|---|
| `supabase/migrations/20260814090000_d14_recap_discipline.sql` | Re-seed `perf_kpi_weights` ke bobot RM-9a final (AM **45/22.5/22.5/10**; Creative **28.5/23.75/23.75/19/5**; Ads **23.75/28.5/23.75/19/5**; KOL **28.5/23.75/19/23.75/5**, tiap Σ=100) + dua fungsi `private.am_recap_discipline` / `private.division_note_compliance` (SECURITY DEFINER, pola O51). |
| `packages/domain/src/performance.ts` | Konstanta `COMP_RECAP_DISCIPLINE`/`COMP_NOTE_COMPLIANCE`; helper `amRecapDiscipline` (di `amCandidates`) + `divisionNoteCompliance` (di creative/ads/kol candidates). |
| `web-internal/src/lib/performance.ts` | Dua key ke `KPI_COMPONENTS` + label BI di `COMPONENT_LABELS`. |
| `packages/domain/src/performance.test.ts` | Unit carve-proporsional (bukti: mengecualikan komponen baru mengembalikan proporsi lama → skor pra-D-14 utuh) + 5 tes DB per-role. |
| Docs | `DECISIONS.md` (blok 2026-08-14), `M6D_BACKLOG.md` D-14 → SELESAI, M14 §9 sudah ada. |

### Definisi terpasang (recompute-from-log)
- **Disiplin Rekap (AM)** = % rekap klien-aktif AM pada periode berstatus `Ditutup`
  **DAN** `pernah_ditutup_otomatis=false`. Menghitung **flag permanen**, bukan
  status akhir — force-close lalu dibuka-kembali Head tetap merugikan AM (M14 §9).
  Denominator mewarisi filter klien-aktif otomatis (rekap hanya dibuka utk klien
  aktif oleh `wrr_monday_job`, kini exclude `[On Hold]` — RM-2).
- **Kepatuhan Catatan (divisi)** = % rekap yang divisi **sentuh** (ada `wrr_divisi`)
  yang juga punya `wrr_catatan_divisi`. Sinyal **per-DIVISI** (bukan per-staf) —
  tabel rekap ber-key divisi; tiap staf divisi berbagi skornya.
- Keduanya persentase 0..100 langsung → **tanpa** baris `perf_period_targets`.
  Dikecualikan+redistribusi (Rule 6) saat nol rekap/sentuhan.
- **Agregasi periode:** bulan WIB memuat rekap yang **Senin-nya** jatuh di bulan itu
  (`minggu_mulai BETWEEN start AND end`); unit = rekap (klien×minggu).

## 2. Verifikasi (branch ini, DB rebuild lokal)
- `packages/core` **221** · `packages/db` **48** · `packages/domain` **1271** (1 skip) · `apps/api` **345** · `web-internal` **238** — semua hijau.
- `scripts/db-rebuild.sh` hijau: **109 migrasi**, gate `tabel 113 / entity_prefix 34 / sm_machines 22 / notif_events 52` TETAP, 4 invariant SQL lolos.
- typecheck bersih (core/db/domain/api/web-internal); eslint bersih (api `--max-warnings 0`, web-internal). Parity route/shape/body hijau (bagian dari 345 api).
- **Carve proporsional** menjaga skor lama: periode tanpa data rekap → komponen baru dikecualikan → redistribusi mengembalikan proporsi pra-D-14 (mis. Ads 23.75/28.5/23.75/19 ÷0.95 = 25/30/25/20) → Kenny §4 tetap 86.4.

## 3. TASK BERIKUTNYA (dari SESI3 §3, semua tersisa)
### #A — Konfirmasi interpretasi (butuh tanda tangan bila pemilik mau lain)
Aman dipakai, tercatat `DECISIONS.md`:
- **D-14 agregasi (baru):** unit = rekap (klien×minggu), atribusi bulan by Senin,
  kepatuhan catatan per-divisi. Kalau pemilik mau unit per-klien atau atribusi
  per-staf → revisi (linkage per-staf belum ada di lapisan rekap).
- **T-4b CPL sumber = `conversions`**; **T-4a view organik = input manual** (dari SESI3).

### #B — Sisa tuas kecepatan P-1 *(owner-gated — JANGAN mulai tanpa diminta)*
Dari SESI2 §4 (belum dikerjakan sengaja): rewrite hop proxy (ukur dulu; CSRF),
±40 refresh berurutan FE, `runSnapshotJob` satu-transaksi-per-klien, N+1 jalur TULIS,
p95 diukur pemilik sendiri.

### #C — Poles kecil (opsional)
Milestone **edit** (judul/tanggal); highlight target-date lewat jatuh tempo di recap page.

## 4. Ranjau repo (tetap berlaku)
- Migrasi HANYA `supabase/migrations/**` + `apply_migration` (O38); rebuild DB HANYA
  `scripts/db-rebuild.sh`. Menambah tabel/prefix/mesin/notif = naikkan gate di DUA
  berkas — **D-14 tidak menambah apa pun**, jadi gate tak berubah.
- Komponen KPI baru = baris `perf_kpi_weights` + label FE (`web-internal/src/lib/performance.ts`
  `KPI_COMPONENTS`+`COMPONENT_LABELS`) — bukan wire interface baru, jadi nol perubahan shape-parity.
- Agregat rekap dibaca lewat fungsi `private.*` SECURITY DEFINER (bukan query
  langsung) supaya batch (bypass RLS) & `previewCurrent` (RLS aktor) identik.
- Nol perubahan skor M13. `recap_discipline`/`note_compliance` adalah komponen M14
  ber-bobot (BUKAN display) — beda dari CTR/CVR/CPL (display, T-3/T-4).

## 5. Sumber kebenaran
- Skoring: `performance.ts::{amRecapDiscipline, divisionNoteCompliance}` + `computeFor`.
- Bobot: `perf_kpi_weights` (migrasi `20260814090000`).
- Sinyal mentah M6D: `weekly_result_recap.{status, pernah_ditutup_otomatis, minggu_mulai}`, `wrr_divisi`, `wrr_catatan_divisi`; filter aktif `wrr_monday_job` (D-06 + T-2 hold).
- Spec: M14 PRD §9 · `DECISIONS.md` 2026-08-13 (RM-9a) + 2026-08-14 (implementasi).
