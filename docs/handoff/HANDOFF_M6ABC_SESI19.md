# HANDOFF — M6A/M6B/M6C Sesi 19 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI17 → SESI18 → **SESI19 (ini, terbaru)**. Baca yang
> bernomor tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch (persis, per akhir sesi 18→19)

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **`main` (default)** | memuat **B-00…B-05 + M6A A-00…A-13d** (per handoff SESI18). **B-06 belum di `main`** sampai PR **#121** merge |
| **Branch kerja sesi ini** | `claude/handoff-m6abc-sesi18-j749x6` — memuat **B-06 realisasi hybrid** (di atas `main`) → **PR #121** (terbuka, menunggu merge) |
| **PR MASIH TERBUKA (bukan pekerjaan sesi ini)** | **#115** — M6A **A-11** (`/s/{token}`) + X-16/X-17. Keputusan pemilik. Lihat §3 handoff SESI18 |
| **Branch untuk B-07** | Buat BARU dari `main` **setelah B-06 merge**: `git fetch origin main && git checkout -B claude/b-07-tutup-transaksional origin/main` |

### 0.1 DB lokal — WAJIB, dan Postgres MATI SENDIRI

Sama dengan SESI18 §0.1: PG16 ada tapi tidak jalan otomatis & mati sendiri.
Nyalakan ulang + `db-rebuild` kapan pun `pg_isready` bilang "no response".

```bash
mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main \
  -o '-c config_file=/etc/postgresql/16/main/postgresql.conf' \
  -l /var/lib/postgresql/pg.log start"
su postgres -c "psql -q -c \"alter role postgres with password 'postgres'\""   # HANYA pertama kali
npm ci && scripts/db-rebuild.sh --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
```

⚠️ Lint CI hanya `@cdps/api` & `web-internal` (root-level, BUKAN workspace —
`cd web-internal && npm run lint`); `packages/domain` tidak dilint (typecheck iya).

### 0.2 Posisi persis (sesudah B-06)

| | |
|---|---|
| Migrasi | **76 berkas** · gerbang tabel **89** · prefix 31 · mesin **17** · event 34 · `CATALOG_VERSION` 4 |
| Test | `apps/api` **340** · `core` **137** · `db` **15** · `domain` **1010 + 1 skip** (`plan.test.ts` **65** + `plan.reals.test.ts` **7**) · db-rebuild gate + invariant hijau · typecheck 4 workspace bersih · `KNOWN_GAPS` kosong |
| Live `CDPS SG` (`egddxfcnrtecheiykhlf`) | ✅ **B-06 SUDAH di-apply & diverifikasi** (2026-08-10, versi apply-timestamp `m6b_realisasi_hybrid`). Terverifikasi hadir: trigger `trg_plan_actual_no_manual_auto` + fungsi `private.jwt_can_write_plan` + `guard_plan_actual_no_manual_auto` + 2 policy tulis (`plan_actual_insert/update`) + grant `INSERT,SELECT,UPDATE`. Live ≡ repo s/d B-06. ⚠️ Versi migrasi live ber-timestamp apply ≠ nama berkas repo — **normal** (`apply_migration` assign versi sendiri) |
| Menggantung | Kode: **NOL** (untuk M6B s/d B-06). Keputusan pemilik: X-06 · X-08 (metrik manual: `jam_live`?) · X-12 · X-16 · X-17 · O59-b · O42-b · O60 · O47b |

## 1. Apa yang berubah sesi ini — B-06 realisasi hybrid

Migrasi `20260810020000_m6b_realisasi_hybrid.sql` + `packages/domain/src/plan.ts`
+ `packages/domain/src/plan.reals.test.ts` (BARU). Detail penuh:
`docs/DECISIONS.md` 2026-08-10 (B-06) + `docs/backlog/M6ABC_BACKLOG.md`.

**Inti keras (Rule 10, invariant beku):** metrik `otomatis` di `plan_actual`
tidak dapat ditimpa aktor JWT (AM), ditegakkan di **TIGA tempat yang wajib
sepakat** — `plan.reals.test.ts` membuktikan tak menyimpang (kelas
`reads_rls.test.ts`):
1. **trigger** `trg_plan_actual_no_manual_auto` (BEFORE INSERT/UPDATE) — jalan di
   SETIAP koneksi termasuk owner/service-role (RLS di-bypass di jalur tulis).
   Sistem vs manusia dibedakan lewat **kehadiran aktor JWT** (`jwt_employee_id()`
   NULL = sistem → lolos; ada = digerbang). Aktor JWT hanya boleh mengubah kolom
   `sengketa` pada baris otomatis.
2. **RLS `WITH CHECK`** — `plan_actual_insert` (`manual`-only + `private.
   jwt_can_write_plan`), `plan_actual_update` (scope). Braces laten.
3. **jalur TS** — `recordManualActual` (`sumber='manual'` saja + `MANUAL_METRICS`);
   tak ada jalur manusia menulis nilai `otomatis`.

**Domain baru:** `recordManualActual` (PE-1/PE-2), `fileSengketa` (PE-6),
`recordAutoActual` (ingest sistem PE-3). `MANUAL_METRICS=['gmv']` (X-08).

**Deviasi tercatat (DECISIONS 2026-08-10):**
- `otomatis` ditulis **HANYA sistem** (lebih ketat dari PRD literal; SPV pun tak
  override manual — aturan rumah #4 "auto = recomputable, bukan input").
- **X-07 dipatuhi:** penutupan TIDAK mengunci — GMV pasca-tutup diterima &
  dicatat **amandemen** (`realisasi_amandemen`) di `audit_log` (Rule 11), NOL
  kolom baru.

## 2. 🔴 TUGAS BERIKUTNYA — M6B, urut (sisa 5 tiket kode)

### 2.1 B-07 — penutupan periode transaksional (BERIKUTNYA)

PRD Rule 15. `Aktif → Ditutup` lewat `transitionPlan`, **transaksional**: semua
baris terminal (`Selesai`/`Sebagian`/`Tidak Dikerjakan` + alasan) + **semua GMV
manual masuk** + **review P-F lengkap**, atau **tidak sama sekali** (partial close
BUKAN state). Force-close (`Ditutup Otomatis`) set baris yang hilang →
`Tidak Dikerjakan — tanpa keterangan` (sengaja jelek di laporan). ⚠️ Ingat X-07:
`Ditutup Otomatis` tetap ada TAPI tak mengunci realisasi (B-06 sudah menegakkan
ini di sisi tulis — `recordManualActual` tak digerbangi status).

### 2.2 Sisa M6B

B-08 carry-over (`plan_row.terbawa`/`periode_asal_id` ada; **+ Σ negative variance
ke `defisit_terbawa`** — bagian §263 yang B-04 tunda) · B-09 job WIB (00:00
aktivasi — panggil `activatePlanPeriode` — + force-close + tengah-periode
`Baris Belum Dieksekusi` + tutup+5hr `plan_realisasi_belum_lengkap`; idempoten;
sinyal keterlambatan realisasi ke audit log TAPI belum ke KPI — X-12) · B-10 Plan
Satuan + mesin #17 + `status_dormansi` (**menutup Rule 6 M6C**) · B-11 constraint
integritas §4(b).

## 3. Sisa M6A + keputusan pemilik

Sama dengan SESI18 §3: **PR #115** (A-11 `/s/{token}` + X-16/X-17) masih terbuka;
Form Section J (J-1/J-4 toggle tak terjangkau) + J-4 diff. Tak berubah sesi ini.

## 4. Katalog notifikasi (blocker lintas-modul) — TETAP

Event M6B (`plan_periode_aktif`, `plan_realisasi_belum_lengkap`, sengketa→SPV,
dll) **belum terdaftar** di `notif_events` — butuh **PA-8/O55**. Semua seam
notifikasi B-03…B-06 (termasuk `fileSengketa` route-ke-SPV) sengaja **TIDAK
emit**. Emisikan hanya setelah katalog dinaikkan.

## 5. Perintah pertama di chat baru

```bash
# DB nyala + dibangun ulang (§0.1), lalu:
scripts/db-rebuild.sh --yes                                    # 76 migrasi, gate 89/31/17/34 + invariant
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run src/plan.test.ts src/plan.reals.test.ts --root packages/domain   # 72 hijau

# lalu mulai B-07 (setelah B-06 merge ke main):
git fetch origin main && git checkout -B claude/b-07-tutup-transaksional origin/main
```

`plan.reals.test.ts` merah ⇒ invariant B-06 rusak: trigger/RLS/predikat TS tak
lagi sepakat (mis. AM bisa timpa metrik otomatis, atau sistem malah ikut
terblokir). `plan.test.ts` merah `realisasi_amandemen` ⇒ deteksi status terminal
di `recordManualActual` keliru (X-07 bocor).
