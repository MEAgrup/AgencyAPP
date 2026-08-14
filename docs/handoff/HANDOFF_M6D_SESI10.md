# Handoff — M6D SESI 10 — D-14 (amandemen M14: disiplin rekap + kepatuhan catatan) mendarat

**Tanggal:** 2026-08-14 · **Branch kerja:** `claude/baca-handoff-progress-dmhuvf`

> Rantai M6D: SESI1 (spec) → … → SESI8 (D-09b + D-10) → SESI9 (D-11/D-12/D-13 integrasi Health)
> → **SESI10 (ini) = D-14 (amandemen M14 RM-9/RM-9a)**. **D-01…D-14 ✅ SEMUA DONE.**
> **M6D = SELESAI penuh.** Tak ada tiket M6D tersisa.

---

## 0. Ringkasan sesi ini

1. **D-14** — amandemen **M14 Team Performance** (bukan M6D lagi; M6D hanya memasok sinyal):
   dua komponen KPI baru bersumber M6D + re-weight profil peran (owner RM-9a 2026-08-13).
2. **Migrasi** `20260814010000_m14_d14_recap_discipline_weights.sql` — re-weight `perf_kpi_weights`
   + baris komponen baru, tiap profil tetap **Σ=100** (dijaga guard sanity DO-block).
3. **Domain** `packages/domain/src/performance.ts` — `amRecapDisciplineCandidate` +
   `divisionNoteComplianceCandidate`, di-wire ke `amCandidates`/`creative`/`ads`/`kol` candidates.
4. **FE** label + daftar komponen (`web-internal/src/lib/performance.ts`). Config/breakdown page
   **data-driven** → komponen baru muncul otomatis.
5. **Nol migrasi mesin/prefix, nol event baru** → gate **112/33/21/48 TETAP**.
6. Verifikasi hijau (DB segar `scripts/db-rebuild.sh --yes`): domain **1246 pass / 1 skip**,
   apps/api **345**, web-internal **238**; typecheck bersih; parity route/shape/body hijau.

---

## 1. Yang MENDARAT

### Bobot (migrasi `20260814010000`) — carve PROPORSIONAL, Σ=100
| Peran | Sebelum | Sesudah (RM-9a) |
|---|---|---|
| **AM** | chr 50 / complaint 25 / revision-esc 25 | chr **45** / complaint **22.5** / revision-esc **22.5** / **`weekly_recap_discipline` 10** |
| **Creative** | speed 30 / output 25 / gmv 25 / revision 20 | 28.5 / 23.75 / 23.75 / 19 / **`weekly_note_compliance` 5** |
| **Ads** | speed 25 / roas 30 / gmv 25 / opt 20 | 23.75 / 28.5 / 23.75 / 19 / **`weekly_note_compliance` 5** |
| **KOL** | creator 30 / qc 25 / speed 20 / esc 25 | 28.5 / 23.75 / 19 / 23.75 / **`weekly_note_compliance` 5** |

### Dua komponen baru (`performance.ts`)
- **`weekly_recap_discipline`** (AM, RM-9): `% rekap portofolio dalam periode dgn`
  `status='Ditutup' AND pernah_ditutup_otomatis=false`. **Hitung flag permanen, bukan status akhir**
  — rekap yang di-buka-kembali Head tetap dihitung MELAWAN AM (§9). Window = recap ber-`minggu_mulai`
  di bulan snapshot. Denominator 0 → dikecualikan + redistribusi Rule 6.
- **`weekly_note_compliance`** (Creative/Ads/KOL, RM-8): `% pasangan (rekap,divisi) yang divisinya SENTUH`
  `(punya baris wrr_divisi — sama aturan "berutang" job D-06) yang wrr_catatan_divisi-nya terisi`.
  **Sinyal DIVISI-WIDE** — dibagi rata ke tiap staff divisi (catatan diisi per-divisi, bukan per-staff).
- Keduanya persentase 0..100 **self-normalizing** → **tak ada baris `perf_period_targets`**.

---

## 2. Titik mulai sesi berikutnya — **TAK ADA tiket M6D/D-xx tersisa**

M6D tuntas D-01…D-14. Pekerjaan reporting AM & team (M6D + M13 + M14) lengkap di level tiket.
Kalau melanjutkan, kandidat berikutnya di luar M6D:
- **M15 Client/Team Portal** (Wave 3, terakhir — sesudah security spec). Lihat `docs/prd/CDPS_Module15_*`.
- **Deferral terdokumentasi (bukan bug, nunggu input eksternal), bila mau diselesaikan:**
  - **O9** — target bulanan REAL per staff/Advertiser (M14 masih placeholder `is_placeholder=true`).
  - **RM-2 hold/paused** — filter "kecuali semua service hold/paused" = NO-OP sampai state hold/paused
    ditambahkan ke mesin `service` (M6D D-06 flag).
  - **CTR/CVR auto** — tak dimodelkan (M8 hanya simpan persen, tanpa clicks/impressions); tetap manual/`—`.

---

## 3. Ranjau repo (tetap + BARU dari D-14)

- **BARU: `weekly_note_compliance` = DIVISI-WIDE, bukan per-staff.** Kueri dihitung dari `wrr_divisi`/
  `wrr_catatan_divisi` yang berkunci `divisi` saja → **semua staff satu divisi berbagi angka yang sama**.
  Ini interpretasi §9 ("did the **division** file") yang dicatat eksplisit di `DECISIONS.md` 2026-08-14 —
  jangan "perbaiki" jadi per-staff tanpa keputusan owner baru.
- **BARU: carve WAJIB proporsional.** Kalau kelak owner mengubah bobot, jaga tetap proporsional bila ingin
  §4 Kenny worked example (86.4) tetap lulus tanpa sentuh tes — redistribusi Rule 6 mengembalikan proporsi
  lama saat komponen M6D absen. Bobot = living config; migrasi = re-baseline default, edit admin per-baris menang.
- **BARU: `weekly_recap_discipline` hitung FLAG, bukan status.** `Ditutup` + `pernah_ditutup_otomatis=true`
  (Head buka-kembali lalu AM tutup) TETAP tak bersih. Jangan gabung jadi "status='Ditutup'" saja.
- **Cleanup tes:** `wrr_catatan_divisi` append-only (no-delete trigger) → **`truncate`**, bukan `delete`
  (cermin `recap.close.test.ts`). `weekly_result_recap`/`wrr_divisi` boleh `delete`.
- Skor M14 lain tak disentuh; nol perubahan M13 `health.ts`. `backend/**` read-only (Go+MySQL pensiun).
- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration` (O38); DB rebuild HANYA `scripts/db-rebuild.sh`.

---

## 4. Lingkungan dev lokal
- Install: **`npm ci`** (npm workspaces). Typecheck: `npm run -s typecheck` (root).
- Tes DB (Postgres 16): `service postgresql start` → `ALTER USER postgres PASSWORD 'postgres'` →
  `scripts/db-rebuild.sh --yes` → `DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npx vitest run`
  per workspace. Tanpa `DATABASE_URL`, suite DB **skip** (tes D-14 ada di `performance.test.ts` `describeDb`).
- Lint: `cd web-internal && npx eslint <path>` / `cd apps/api && npx eslint <path>`.

---

## 5. Sumber kebenaran
- `docs/prd/CDPS_Module14_Team_Performance.md` §2/§9 (profil peran + amandemen RM-9/RM-9a, kini **✅ IMPLEMENTED**).
- `docs/backlog/M6D_BACKLOG.md` §4 (D-14 ✅ DONE) — D-01…D-14 semua DONE.
- `docs/DECISIONS.md` 2026-08-14 (D-14 — baris teratas) & 2026-08-13 (RM-9a sign-off).
- Kode: `supabase/migrations/20260814010000_m14_d14_recap_discipline_weights.sql`;
  `packages/domain/src/performance.ts` (`COMP_WEEKLY_RECAP_DISCIPLINE`/`COMP_WEEKLY_NOTE_COMPLIANCE`,
  `amRecapDisciplineCandidate`/`divisionNoteComplianceCandidate`) + `performance.test.ts` (+4);
  `web-internal/src/lib/performance.ts` (`KPI_COMPONENTS` + `COMPONENT_LABELS`).
