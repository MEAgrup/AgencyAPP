# HANDOFF — M6A/M6B/M6C Sesi 22 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI20 → SESI21 → **SESI22 (ini, terbaru)**. Baca yang
> bernomor tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch (persis, akhir sesi 21→22)

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **`main` (default)** | memuat **B-00…B-08 + M6A A-00…A-13d + #123 admin/employees**. **B-08 kini SUDAH di `main`** (PR #126 di-merge, `cbe97eb`). |
| **Sesi ini mengerjakan** | Batch keputusan pemilik 2026-08-11: **X-17 + O59-b DIEKSEKUSI (kode)**; X-16/X-18/X-06/X-08/X-12 + B-09-arsitektur + PA-8/O53 **DICATAT/DIPUTUS** di `docs/DECISIONS.md`. |
| **Branch sesi ini** | `claude/handoff-m6abc-sesi21-jc5rs1` — X-17, O59-b, DECISIONS batch, handoff ini. **Belum ada PR dibuka** (menunggu keputusan pemilik apakah buka PR). |
| **PR MASIH TERBUKA (lama)** | **#115** — M6A A-11 (`/s/{token}`) + X-16/X-17. **X-16 kini FINAL** ⇒ #115 tidak lagi terblokir X-16. |
| **Branch untuk tugas berikutnya** | Setelah kerja sesi ini merge: `git fetch origin main && git checkout -B <branch-baru> origin/main`. |

> ⚠️ **Tidak ada yang menggantung.** Kode yang ditulis (X-17, O59-b) lengkap +
> hijau. Item lain di batch ini adalah **keputusan tercatat** atau **arah yang
> sengaja ditunda ke ticket sendiri** (O60/O49/O45/O47b) — bukan kerja setengah
> jadi. Lihat §2.

### 0.1 DB lokal — WAJIB, dan Postgres MATI SENDIRI

Sama seperti SESI21 (`pg_ctlcluster`, bukan `pg_ctl`):

```bash
pg_ctlcluster 16 main start                 # abaikan "stale pid file"
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""   # HANYA pertama kali
npm install
scripts/db-rebuild.sh --yes                 # DROP + 77 migrasi + seed + gate + invariant
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run --root packages/domain      # full domain hijau
```

Kalau `psql: connection refused` → Postgres mati lagi, ulangi `pg_ctlcluster 16 main start`.
⚠️ Lint CI hanya `@cdps/api` & `web-internal`; `packages/domain` di-typecheck (`npm run typecheck`), bukan di-lint.

### 0.2 Posisi persis (sesudah batch 2026-08-11)

| | |
|---|---|
| Migrasi | **77 berkas** (TIDAK berubah sesi ini — X-17/O59-b nol migrasi) · gerbang tabel **89** · prefix 31 · mesin 17 · event **34** · `CATALOG_VERSION` 4 |
| Test | X-17 +1 (`strategi.test.ts`, kini **185**) · O59-b +3 (**baru** `notif_catalog.reals.test.ts`) · typecheck 4 paket bersih · `core/notification` 14 hijau · `KNOWN_GAPS` kosong |
| Live `CDPS SG` (`egddxfcnrtecheiykhlf`) | B-08 (`20260810030000`) menyusul ke live saat rilis; X-17/O59-b nol migrasi (nol dampak live) |
| Menggantung | Kode: **NOL**. Arah yang ditunda ke ticket sendiri: **O60 · O49 · O45 · O47b**. Kerja produk berikutnya: **B-09** (kini TIDAK terblokir — lihat §2) / B-11 / B-10 |

## 1. Apa yang berubah sesi ini

Detail penuh: `docs/DECISIONS.md` **2026-08-11** (batch). Ringkas:

- **X-17 (DIEKSEKUSI).** `packages/domain/src/strategi.ts` — `setAssumptionStatus`
  menolak flip pada versi `Diarsipkan`/`Kedaluwarsa`:
  `ConflictError(MSG_ASSUMPTION_STATUS_TERKUNCI)` = `[status asumsi tidak dapat
  diubah pada versi Strategi yang sudah diarsipkan atau kedaluwarsa]`. Guard
  setelah gerbang kepemilikan, mencerminkan `setFieldVisibility`. +1 test.
- **O59-b (DIEKSEKUSI).** `packages/domain/src/notif_catalog.reals.test.ts`
  (BARU) — gerbang katalog notif dulu hanya menghitung; kini set-equality
  **berbasis NAMA**: `notif_events` (event_type, catalog_version, resolver) ≡ TS
  `CATALOG`, `notif_catalog_versions` ≡ `CATALOG_VERSIONS`, + hitung per-versi.
  Jalan di CI job `db-and-migrations` (`DATABASE_URL` ada, tidak di-skip).
- **PA-8 + O53 (KOREKSI — sudah selesai sejak v2).** Verifikasi ground truth:
  6 event Plan M6B **dan** `m6.client.assigned` **sudah** terdaftar di katalog
  **v2** (`20260807010000_notif_catalog_v2.sql`). Klaim SESI21 §2(2) "0 baris"
  adalah query salah-kolom (`code`, seharusnya `event_type`). ⇒ **B-09 blocker
  #2 VOID**. O59-b menutup celah yang melahirkan kebingungan itu.
- **Keputusan tercatat:** X-16 FINAL (buka A-11), X-18 diputus (toggle P-F opsional,
  nol-migrasi), B-09 arsitektur (cron eksternal → endpoint idempoten ber-secret),
  X-06 dikonfirmasi (versi-aktif-saja), X-08 ditegaskan (`gmv`-only sampai Hans),
  X-12 ditegaskan (audit-log saja).

## 2. Tugas berikutnya — B-09 kini TIDAK TERBLOKIR

Kedua blocker SESI21 §2 sudah terjawab:

1. **Arsitektur runtime job — DIPUTUS:** cron eksternal → `POST /internal/plan/tick`
   idempoten ber-secret (Vercel Cron / GitHub Action). `pg_cron` alternatif nol-infra
   (17:00 UTC = 00:00 WIB) bila deploy memilih — konfirmasi deploy saat implementasi.
2. **Katalog notif M6B — SUDAH terdaftar (v2).** Bukan blocker. `plan_baris_belum_dieksekusi`
   & `plan_realisasi_belum_lengkap` ada di `notif_events`; `notify_emit` tidak akan gagal.

**Batas X-12 (masih berlaku):** B-09 catat keterlambatan GMV ke `audit_log`,
**tidak** boleh mengklaim memengaruhi Performance Score / mengarang bobot KPI.

**Yang SUDAH siap** (dari SESI21): `activatePlanPeriode`, `forceClosePlanPeriode`,
`expireStrategi`, `packages/core/src/tz.ts` (`WIB_OFFSET_HOURS=7`). B-09 tinggal:
(i) fungsi SWEEP idempoten (`activateDuePeriods`/`forceCloseOverdue` + Rule 5
"satu Aktif per rantai"), (ii) endpoint `/internal/plan/tick` ber-secret, (iii)
emisi notif M6B (katalog sudah ada).

**Alternatif bersih tanpa B-09** (branch baru dari `main`):
- **B-11** — constraint integritas §4(b) (partial unique index: satu service ⇒ ≤1 Plan;
  service full-management tak boleh menunjuk Plan `lingkup='klien'`). Kecil, mandiri.
- **B-10** — Plan Satuan (M6C §7): `lingkup='klien'`, dormansi mesin #17. Besar, mandiri.

## 3. Arah tercatat yang MENUNGGU ticket fokusnya sendiri

Sengaja TIDAK dikerjakan bersama batch ini (masing-masing butuh PR sendiri; menyentuh
live / menulis-ulang histori / mengubah detektor subtil = "jangan setengah jadi"):

| # | Arah (sudah diputus) | Catatan eksekusi |
|---|---|---|
| **O49** | `managed_since = YYYY-MM-DD` + perluas gate wire dari bentuk→nilai untuk semua field bertanggal | Mekanis. Cek `apps/api/src/lib/wire.datecolumns.test.ts` (pola O49(a) 3 field installment). |
| **O60** | Detektor ledger RLS tembus satu indireksi: predikat yang memanggil helper `private.*` ber-arm dihitung punya arm | Ledger §42 menyusut ~10 baris. Peninjau §42 boleh ambil. |
| **O48** | Arm Lead/SPV per-tabel per kebutuhan halaman; daftar §42 hanya menyusut | Tidak butuh keputusan baru — dieksekusi per halaman. |
| **O45** | Cek paritas-grant menembak live (UAT service-role: fungsi anon-executable = allow-list) | Butuh sesi ber-service-role ke live. Invariant lokal hijau ≠ bukti permukaan EXECUTE live aman. |
| **O47b** | Jalankan `RUNBOOK_O47b_SCRUB_PII.md`: hapus 26 ref + tiket GitHub Support untuk gc | **Butuh izin pemilik (retensi data) + sesi ber-hak-hapus-ref.** Jangan lapor bersih sebelum verifikasi + Support selesai. |

## 4. Open questions (detail di `docs/DECISIONS.md` §Open)

| # | Inti | Status |
|---|---|---|
| X-16 | Tier 6 field §4.1 | ✅ **FINAL 2026-08-11** — buka A-11 (#115) |
| X-17 | Gerbang status `setAssumptionStatus` | ✅ **DIEKSEKUSI 2026-08-11** |
| X-18 | Komponen varians `defisit_terbawa` | ✅ **DIPUTUS 2026-08-11** — toggle P-F opsional, nol-migrasi |
| X-06 | Tautan klien versi-aktif-saja | ✅ dikonfirmasi 2026-08-11 |
| X-08 | `jam_live` metrik manual? | 🟡 `gmv`-only sampai **Hans** konfirmasi vendor |
| X-12 | Komponen KPI keterlambatan | 🟡 DIJADWALKAN — rumah KPI di M14; batas B-09 tetap |
| X-11 | D-3 turunan (provisional) | 🟡 tinjau QC produksi |

## 5. Perintah pertama chat baru (rekomendasi)

```bash
# 1. nyalakan DB (§0.1) + rebuild + verifikasi baseline
pg_ctlcluster 16 main start && npm install && scripts/db-rebuild.sh --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run --root packages/domain      # full domain hijau

# 2. kalau kerja sesi ini belum merge → pertimbangkan buka PR untuk branch
#    claude/handoff-m6abc-sesi21-jc5rs1 (X-17 + O59-b + DECISIONS batch).
# 3. B-09 kini TIDAK terblokir (§2). Alternatif: B-11 (kecil) atau B-10 (besar).
```
