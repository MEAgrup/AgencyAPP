# HANDOFF — M6A/M6B/M6C Sesi 18 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI16 → SESI17 → **SESI18 (ini, terbaru)**. Baca yang
> bernomor tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch (persis, per akhir sesi 17→18)

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **`main` (default)** | `f10017f` — memuat **B-00…B-05 + M6A A-00…A-13d** (semua PR di bawah sudah merge). **MULAI DARI SINI.** |
| **PR ter-merge sesi ini** | **#116** (B-01+B-02) · **#117** (B-03) · **#118** (B-04) · **#119** (B-05) — semua ke `main` |
| **Branch kerja sesi ini (SUDAH merge, boleh dihapus)** | `claude/b-04-penyesuaian-rule9` · `claude/b-05-distribusi-mingguan` · `claude/handoff-sesi18` (doc ini) |
| **PR MASIH TERBUKA (bukan pekerjaan sesi ini)** | **#115** — M6A **A-11** (`/s/{token}`) + X-16/X-17. Perlu diputuskan pemilik apakah di-merge. Lihat §3 |
| **Branch untuk B-06** | Buat BARU dari `main`: `git fetch origin main && git checkout -B claude/b-06-realisasi-hybrid origin/main` |

> ⚠️ Branch designasi lama (`claude/b-03-mesin-transisi-p4bfmr`) sudah **basi &
> ter-merge** — jangan lanjut di sana. Tiap tiket B berikutnya = branch baru dari
> `main`, PR sendiri (pola sesi ini).

### 0.1 DB lokal — WAJIB, dan Postgres MATI SENDIRI

`packages/domain` melapor ratusan skip tanpa `DATABASE_URL`. Sandbox punya PG16
tapi **tidak jalan otomatis** dan **mati sendiri di tengah sesi**; nyalakan ulang
lalu `db-rebuild` kapan pun `pg_isready` bilang "no response".

```bash
mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main \
  -o '-c config_file=/etc/postgresql/16/main/postgresql.conf' \
  -l /var/lib/postgresql/pg.log start"
su postgres -c "psql -q -c \"alter role postgres with password 'postgres'\""   # HANYA pertama kali
npm ci && scripts/db-rebuild.sh --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
```

⚠️ Lint CI hanya `@cdps/api` & `web-internal`; `packages/domain` tidak dilint (tapi
typecheck-nya iya).

### 0.2 Posisi persis (sesudah B-05)

| | |
|---|---|
| Migrasi | **75 berkas** · gerbang tabel **89** · prefix 31 · mesin **17** · event 34 · `CATALOG_VERSION` 4 |
| Test | `apps/api` **340** · `core` **137** · `db` **15** · `domain` **995 + 1 skip** (`plan.test.ts` **57**: 29 B-01/02/03 + 16 B-04 + 12 B-05) · db-rebuild gate + 4 invariant hijau · typecheck 4 workspace bersih · `KNOWN_GAPS` kosong |
| Live `CDPS SG` (`egddxfcnrtecheiykhlf`) | ✅ **sinkron s/d B-05** — migrasi B-01 + B-05 sudah di-apply (B-02/03/04 murni kode). Fungsi `check_plan_row_week_sum` + 2 trigger hadir; 91 base tables (89 repo + 2 tabel A-11 dari #115 yang di-apply lebih dulu). ⚠️ Versi migrasi live ber-timestamp apply (mis. `2026081007…`) ≠ nama berkas repo — **normal** (`apply_migration` assign versi sendiri; isi skema cocok), bukan drift |
| Menggantung | Kode: **NOL**. Keputusan pemilik: X-06 · X-08 · X-12 · X-16 · X-17 · O59-b · O42-b · O60 · O47b |

## 1. Apa yang berubah sesi ini — B-04 + B-05

Semua di `packages/domain/src/plan.ts`. Detail penuh: `docs/DECISIONS.md`
2026-08-10 (B-04, B-05) + `docs/backlog/M6ABC_BACKLOG.md`.

**B-04 — penyesuaian target asimetris (Rule 9) + `defisit_terbawa`** (NOL migrasi):
- `classifyAdjustment` (murni) · `adjustPlanTarget` (jalur tulis tunggal, turun
  >10% pada `Terjadwal` menahan periode `→ Menunggu Persetujuan`) ·
  `approveTargetAdjustment`/`rejectTargetAdjustment` (SPV, TIDAK mengaktifkan) ·
  `activatePlanPeriode` diperluas (expiry pending → `Kedaluwarsa` + revert, Rule 4) ·
  `defisit_terbawa` computed (`getPlanDetail.defisitTerbawa` + `contractDeficit`).
- Ambang 10% = konstanta `DOWNWARD_APPROVAL_THRESHOLD_PCT` (PA-1). Pending tak
  dihitung ke deficit. Periode 1 tak ditahan.

**B-05 — distribusi mingguan turunan (Rule 7)** (migrasi `20260810010000`):
- Constraint trigger DEFERRABLE `trg_plan_row_week_sum` (+ kuota-induk): Σ minggu =
  `plan_row.kuota` atau nol minggu; tolak dgn row-ID + selisih.
- `distributeWeeks` (murni, sum-preserving, re-weight `BIG_DATE_WEIGHT=2`) ·
  `deriveWeeklyDistribution` di `activatePlanPeriode` (idempoten) ·
  `setWeeklyDistribution` (re-drag AM, hanya `Aktif`).

## 2. 🔴 TUGAS BERIKUTNYA — M6B, urut (sisa 7 tiket kode)

### 2.1 B-06 — realisasi hybrid (BERIKUTNYA)

PRD Rule 10/11. GMV per channel **manual** (AM, + lampiran `file_bukti` + tanggal
ambil, jendela 5 hari); metrik lain (ad spend, ROAS, video, kreator, jam live,
Brief) **auto & read-only**. Inti keras: **UPDATE metrik `otomatis` DIBLOK untuk
role AM di level DB DAN RLS** — invariant beku, predikat TS + policy RLS tak boleh
menyimpang (sama kelas dgn invariant lain di `reads_rls.test.ts`). `plan_actual`
sudah ada bentuknya (B-01) dgn `sumber ∈ manual/otomatis`, `ck_plan_actual_manual_bukti`,
`ck_plan_actual_sengketa`. `Sengketa Angka` (AM menantang metrik auto) → route ke SPV.
Kemungkinan BUTUH migrasi (RLS/policy + mungkin kolom amandemen post-close). ⚠️ Baca
X-07 (deviasi PRD: `Ditutup Otomatis` tetap ada, efek kunci dicabut) + X-08 (daftar
metrik manual eksplisit di UI) sebelum mulai.

### 2.2 Sisa M6B

B-07 tutup transaksional (`Aktif → Ditutup` lewat `transitionPlan`; semua baris
terminal + GMV + review, atau tidak sama sekali — Rule 15) · B-08 carry-over
(`plan_row.terbawa`/`periode_asal_id` ada) **+ Σ negative variance ke
`defisit_terbawa`** (bagian §263 yang B-04 tunda) · B-09 job WIB (00:00 aktivasi —
panggil `activatePlanPeriode` yang B-04/B-05 perluas — + force-close `Ditutup
Otomatis` + tengah-periode `Baris Belum Dieksekusi` + tutup+5hr
`plan_realisasi_belum_lengkap`; idempoten) · B-10 Plan Satuan + mesin #17 +
`status_dormansi` (**menutup Rule 6 M6C** — 88% → tuntas) · B-11 constraint
integritas §4(b).

## 3. Sisa M6A + keputusan pemilik

- **PR #115 (A-11 `/s/{token}` + X-16/X-17) MASIH TERBUKA** — belum di-merge.
  Kalau pemilik mau M6A maju: merge #115 lebih dulu (lihat isi PR untuk verifikasi).
  Sesudah itu **A-11 live migration** menyusul (2 tabel share-link — sudah di live,
  belum di `main`).
- Sisa M6A: **Form Section J** (J-1/J-4 punya toggle tak terjangkau) + **J-4 diff**.
- **X-16** (6 field tak terklasifikasi) · **X-17** (`setAssumptionStatus` tanpa
  gerbang server) — nyangkut di #115.

## 4. Katalog notifikasi (blocker lintas-modul)

Event M6B/M6A (`plan_target_diturunkan`, `plan_periode_aktif`, dll) **belum
terdaftar** di `notif_events` — butuh **PA-8/O55**. Semua seam notifikasi di B-03…
B-05 sengaja TIDAK emit (emit event tak terdaftar gagal `notify_emit`). Emisikan
hanya setelah katalog dinaikkan.

## 5. Perintah pertama di chat baru

```bash
# DB nyala + dibangun ulang (§0.1), lalu:
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run src/plan.test.ts --root packages/domain     # 57 hijau
scripts/db-rebuild.sh --yes                                    # 75 migrasi, gate 89/31/17/34 + 4 invariant

# lalu mulai B-06:
git fetch origin main && git checkout -B claude/b-06-realisasi-hybrid origin/main
```

`plan.test.ts` merah pada trigger `plan_row_week` ⇒ constraint DEFERRABLE hilang/
keliru. Merah `adjustPlanTarget` hold ⇒ routing `Terjadwal → Menunggu Persetujuan`
rusak. Merah `defisit_terbawa` ⇒ filter pending/committed di `deficitOfChain`
keliru. Merah `deriveWeeklyDistribution` ⇒ `distributeWeeks` tak sum-preserving atau
hook di `activatePlanPeriode` lepas.
