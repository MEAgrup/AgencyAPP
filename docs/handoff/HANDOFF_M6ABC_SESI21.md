# HANDOFF — M6A/M6B/M6C Sesi 21 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI19 → SESI20 → **SESI21 (ini, terbaru)**. Baca yang
> bernomor tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch (persis, akhir sesi 20→21)

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **`main` (default)** | memuat **B-00…B-07 + M6A A-00…A-13d + #123 admin/employees** (per PR #124/#125). B-08 BELUM di `main`. |
| **Sesi ini mengerjakan** | **B-08 carry-over eksplisit** — SELESAI, di branch, **PR #126 TERBUKA (belum merge)** |
| **Branch B-08** | `claude/b-08-carry-over-bqhdr1` — commit `780a34e` (kode) + commit handoff ini di atasnya |
| **PR B-08** | **#126** — `https://github.com/MEAgrup/AgencyAPP/pull/126`. Base `main`. Menunggu review/merge pemilik |
| **PR MASIH TERBUKA (lama)** | **#115** — M6A A-11 (`/s/{token}`) + X-16/X-17 (keputusan pemilik) |
| **Branch untuk tugas berikutnya** | JANGAN mulai dari branch B-08. Setelah #126 merge: `git fetch origin main && git checkout -B <branch-baru> origin/main`. Kalau #126 belum merge saat mulai kerja baru yang independen, tetap cabang dari `origin/main`. |

> ⚠️ **Tidak ada yang menggantung.** B-08 lengkap (kode + test + migrasi + docs).
> Tugas berikutnya (B-09) **sengaja TIDAK dimulai** karena terblokir keputusan
> non-kode — lihat §2. Itu bukan pekerjaan setengah jadi; itu ticket yang
> menunggu keputusan pemilik/Hans.

### 0.1 DB lokal — WAJIB, dan Postgres MATI SENDIRI

PG16 ada tapi tidak jalan otomatis & bisa mati sendiri di tengah sesi. Yang
BENAR-BENAR jalan sesi ini (sandbox pakai `pg_ctlcluster`, bukan `pg_ctl` manual):

```bash
pg_ctlcluster 16 main start                 # nyalakan (abaikan "stale pid file" — ia hapus sendiri)
# HANYA pertama kali (hba 127.0.0.1 = scram-sha-256, jadi WAJIB ada password):
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
npm install                                  # vitest dll tidak ada sampai ini dijalankan
scripts/db-rebuild.sh --yes                  # DROP + 77 migrasi + seed + gate + invariant
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run src/plan.test.ts src/plan.reals.test.ts --root packages/domain   # 113 hijau
```

Kalau `psql: connection refused` di tengah sesi → Postgres mati lagi, ulangi
`pg_ctlcluster 16 main start` (password sudah keburu terpasang, tak perlu ulang).

⚠️ Lint CI hanya `@cdps/api` & `web-internal`; `packages/domain` tidak dilint
(typecheck iya, `npm run typecheck`).

### 0.2 Posisi persis (sesudah B-08)

| | |
|---|---|
| Migrasi | **77 berkas** (B-08 +1: `20260810030000_m6b_carry_over.sql`) · gerbang tabel **89** (kolom, bukan tabel) · prefix 31 · mesin 17 · event 34 · `CATALOG_VERSION` 4 |
| Test | `apps/api` **340** · `core` **137** · `db` **15** · `domain` **1060 + 1 skip** (`plan.test.ts` **106** + `plan.reals.test.ts` **7**) · db-rebuild gate + invariant hijau · typecheck bersih · `KNOWN_GAPS` kosong |
| Live `CDPS SG` (`egddxfcnrtecheiykhlf`) | ≡ repo s/d B-07. **B-08 belum di-apply live** (migrasi `20260810030000` menyusul saat #126 merge — kolom + CHECK, aman) |
| Menggantung | Kode: **NOL**. Keputusan pemilik/infra: **X-18 (BARU)** · B-09 arsitektur job (BARU) · PA-8 (katalog notif) · X-06 · X-08 · X-12 · X-16 · X-17 |

## 1. Apa yang berubah sesi ini — B-08 carry-over eksplisit (Rule 16 / PF-5)

`packages/domain/src/plan.ts` + `packages/domain/src/plan.test.ts` +
migrasi `20260810030000_m6b_carry_over.sql`. Detail penuh: `docs/DECISIONS.md`
2026-08-10 (B-08 + open X-18) + `docs/backlog/M6ABC_BACKLOG.md` (B-08).

**Rule 16 — "carry-over itu eksplisit".** Baris yang berakhir `Sebagian` /
`Tidak Dikerjakan` di periode yang **sudah ditutup** (`Ditutup`/`Ditutup
Otomatis`) meminta keputusan per baris:

- `dibawa` → salin baris penuh ke periode berikutnya (`terbawa=true`,
  `periode_asal_id`, reset `Rencana`).
- `dibatalkan` → buang, catat keputusan saja.
- `revisi` → naikkan ke revisi Strategi (revisinya sendiri jalur PF-7), catat
  keputusan saja.

**Yang dibangun:**
- Migrasi: **satu kolom** `plan_row.keputusan_carryover varchar(16) NULL` +
  CHECK `IN ('dibawa','dibatalkan','revisi')`. Nol tabel baru. Kolom di baris
  **ASAL** (disposisi baris yang MENINGGALKAN periodenya) — beda dari `terbawa`
  (B-01) yang menandai baris **TUJUAN** yang dibawa MASUK. Preseden B-04
  (`status_persetujuan`): keputusan yang menggerbangi perilaku ke depan = kolom,
  `audit_log` = jejak immutable.
- `decideCarryOver(sql, actor, planRowId, keputusan)` — jalur tulis tunggal
  (AM/lead Account), satu keputusan per baris (guard `IS NULL`), `dibawa`
  ditolak bila tak ada periode berikutnya penerima (periode terakhir / berikutnya
  sudah ditutup). Baris audit `keputusan_carryover` mencatat pilihan + id baris
  terbawa + periode tujuan.
- `listCarryOverPending(sql, actor, planId)` — baris tak-selesai belum diputus.
- `PlanRow.keputusanCarryover` + `rowToPlanRow`.

**Keputusan penting (jangan diubah tanpa alasan tercatat):**
- **`kuota` disalin APA ADANYA — tanpa hitung "sisa".** `plan_row` simpan kuota
  rencana, bukan pencapaian per baris (pencapaian ada di metrik auto/GMV per
  channel). Menghitung "sisa" = mengarang angka (aturan rumah #4). AM sunting
  kuota baris terbawa di periode baru bila perlu.
- **jsonb via `tx.json(...)`, BUKAN `${JSON.stringify(...)}::jsonb`.** Pola
  `::jsonb` (dipakai finance/kol/health) DOUBLE-ENCODE array di jalur ini:
  postgres.js menyimpulkan tipe param dari cast lalu meng-encode ulang string →
  jsonb jadi STRING `"[]"`, gagal `ck_plan_row_*_arr`. `tx.json` menyerahkan
  serialisasi ke driver → array jsonb benar. (Diverifikasi empiris sesi ini.)
- **Komponen `defisit_terbawa` §263 "Σ negative variance where chosen to carry"
  TIDAK dibangun** → open question **X-18** (§3). Deficit tetap = Σ penyesuaian
  turun (B-04, `deficitOfChain`). Karena dihitung (bukan kolom), menambahnya
  kelak = **nol migrasi**.

## 2. Tugas berikutnya B-09 — TERBLOKIR, jangan mulai setengah jadi

**B-09 (Scheduled jobs)** adalah ticket "WIB scheduler" M6B. Bukti ia belum ada:
rute `apps/api/src/app/api/v1/strategi/[id]/expire/route.ts` menundanya ke B-09
dengan kata-kata sendiri (*"the job that would drive it belongs with M6B's WIB
scheduler (backlog B-09); until that lands, an AM or SPV closes it explicitly"*).

Ia terblokir **DUA** hal yang bukan pekerjaan kode:

1. **Belum ada keputusan arsitektur runtime job.** "00:00 WIB harian" harus
   dipicu oleh sesuatu — dan repo **nol preseden**: tak ada pg_cron, edge
   function, cron eksternal, atau worker. Opsi yang perlu diputus pemilik/deploy:
   - **pg_cron** di Supabase (migrasi `cron.schedule`, jalan di DB, TZ UTC → hitung 17:00 UTC = 00:00 WIB);
   - **cron eksternal → endpoint** (mis. Vercel Cron / GitHub Action hit `POST /internal/plan/tick` ber-secret);
   - **Supabase edge function** terjadwal.
   Ini keputusan deploy, bukan kode murni — CLAUDE.md: jangan mengarang, tandai.
   Rekomendasi bila dipaksa memilih: **cron eksternal → endpoint idempoten**
   (paling portable, mudah dites, tak mengikat DB) — tapi TUNGGU konfirmasi.

2. **Event notifikasi M6B belum terdaftar di `notif_events`.** Query
   `select code from notif_events where code like 'plan%'` → **0 baris** (dari 34
   event total). B-09 bagian (b) `plan_baris_belum_dieksekusi` & (c)
   `plan_realisasi_belum_lengkap` akan gagal di `notify_emit`. Ini **PA-8/O55**,
   sign-off **Hans** (invariant katalog + tier). Sama seam yang B-03…B-08 semua
   tunda ("notif tunda PA-8/O55").

**Batas X-12 (sudah diputus):** B-09 boleh mencatat keterlambatan GMV ke
`audit_log`, **tidak boleh** mengklaim ia memengaruhi Performance Score / mengarang
bobot KPI — "rumahnya" belum ada.

**Apa yang SUDAH siap untuk B-09** (jadi begitu 2 blocker di atas dijawab,
sisanya cepat): fungsi per-periode idempoten sudah ada —
`activatePlanPeriode` (Terjadwal→Aktif + derive minggu + expiry pending >10%),
`forceClosePlanPeriode` (Aktif→Ditutup Otomatis), `expireStrategi` (Rule 14).
B-09 tinggal: (i) fungsi SWEEP idempoten (`activateDuePeriods`/`forceCloseOverdue`
yang cari periode jatuh tempo + tegakkan Rule 5 "satu Aktif per rantai"), (ii)
wiring runtime (blocker #1), (iii) emisi notif (blocker #2). `packages/core/src/tz.ts`
sudah punya helper WIB (`WIB_OFFSET_HOURS=7`).

**Kalau pemilik ingin progres tanpa menunggu:** ticket M6B yang TIDAK terblokir
dan bisa dikerjakan bersih (butuh branch baru dari `main`):
- **B-11** — constraint integritas §4(b) (partial unique index: satu service ⇒
  ≤1 Plan; service full-management tak boleh menunjuk Plan `lingkup='klien'`).
  Kecil, migrasi + test, mandiri.
- **B-10** — Plan Satuan (M6C §7): `lingkup='klien'`, parent Service, `Di Luar
  Service`, review 4 field, **dormansi mesin #17** (ditunda dari B-01). Besar,
  tapi mandiri (skema `lingkup='klien'` sudah didukung B-01; plan.ts sudah
  menangani cabang klien di reads/deficit/carry-over).

## 3. Open questions yang RELEVAN (detail di `docs/DECISIONS.md` §Open)

| # | Inti | Dari | Blokir? |
|---|---|---|---|
| **X-18 (BARU)** | `defisit_terbawa` §263 komponen "Σ negative variance where chosen to carry" tak cukup dispesifikasi: tak ada field PRD perekam "chosen to carry" untuk UANG (PF-5 bawa BARIS, bukan rupiah), contoh Alpha tak pernah membawa varians ke deficit, PA-7 peringatkan double-count. B-08 TIDAK menebak; deficit tetap = Σ penyesuaian turun. Karena dihitung, menambahnya kelak nol-migrasi. | Yohan/Yulianti | Tidak blokir inti B-08. Hanya angka deficit view untuk kasus miss-yang-dibawa |
| **B-09 arsitektur job (BARU, di handoff ini §2)** | Runtime "00:00 WIB harian": pg_cron / cron eksternal→endpoint / edge function. Nol preseden repo. | Pemilik/deploy | **Blokir B-09** |
| PA-8 | Katalog notif v2 (25/28 event) butuh sign-off + event M6B didaftar ke `notif_events` | Hans | **Blokir B-09 (b)(c)** + emisi notif semua M6B |
| X-06 | Tautan klien hanya versi aktif (tanpa riwayat/diff) | Yohan | Blokir A-11 (#115) |
| X-08 | `jam_live` metrik manual? (PA-4 vendor lapor di luar sistem) | Hans/dev | Tidak blokir; `MANUAL_METRICS=['gmv']` saja |
| X-12 | "Point log buruk" X-07 belum punya komponen KPI | Pemilik | Membatasi B-09 (lihat §2) |
| X-16 / X-17 | Tier 6 field §4.1 / gerbang status `setAssumptionStatus` | Pemilik/Yohan | X-16 blokir A-11 (#115) |

## 4. Perintah pertama chat baru (rekomendasi)

```bash
# 1. nyalakan DB (lihat §0.1) + rebuild + verifikasi baseline B-08
pg_ctlcluster 16 main start && npm install && scripts/db-rebuild.sh --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run src/plan.test.ts src/plan.reals.test.ts --root packages/domain   # 113 hijau

# 2. cek status PR #126 (B-08). Kalau sudah merge → main sudah punya B-08.
# 3. sebelum B-09: konfirmasi ke pemilik 2 blocker §2 (runtime job + PA-8).
#    kalau ingin progres sekarang, ambil B-11 (kecil, mandiri) dari origin/main.
```
