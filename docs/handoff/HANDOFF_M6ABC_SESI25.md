# HANDOFF — M6A/M6B/M6C Sesi 25 (titik mulai sesi berikutnya)

> Rantai: … → SESI23 → SESI24 → **SESI25 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch (persis, akhir sesi 24→25)

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **`main` (default)** | memuat **B-00…B-10 + M6A A-00…A-13d + X-17/O59-b**. PR #129 (B-10) & #130 (handoff SESI24) sudah MERGE. |
| **Sesi ini mengerjakan** | **B-11 integritas §4(b) — SELESAI**. Branch `claude/b-11-plan-satuan-fns96c`, PR draft dibuat. **MENUTUP M6B (kini 100%).** |
| **PR MASIH TERBUKA (lama)** | **#115** — M6A A-11 (`/s/{token}`). X-16 FINAL ⇒ tinggal **diff J-4** + review pemilik. |
| **Branch tugas berikutnya** | Cabang baru dari `main` yang memuat B-11: `git fetch origin main && git checkout -B <branch-baru> origin/main`. |

### 0.1 DB lokal — WAJIB, Postgres MATI SENDIRI

```bash
pg_ctlcluster 16 main start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""   # HANYA pertama kali
npm install
scripts/db-rebuild.sh --yes                 # 79 migrasi + seed + gate + invariant
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run --root packages/domain      # full domain hijau
```

### 0.2 Posisi persis (sesudah B-11)

| | |
|---|---|
| Migrasi | **79 berkas** · gerbang tabel **90** · prefix 31 · mesin **18** · event 34 · `CATALOG_VERSION` 4 |
| Test | domain **1088** hijau (+1 skip) · api **344** · web-internal **191** · typecheck 5 paket bersih · `KNOWN_GAPS` kosong |
| Migrasi baru | `20260811010000_m6b_plan_gate_integrity.sql` — trigger `trg_spg_service_single_plan` (§4b; **nol tabel/mesin baru**) |
| Menggantung | Kode B-11: **NOL** (di branch, PR draft). Open baru: tidak ada. |

## 1. Apa yang berubah sesi ini — B-11 integritas §4(b) (MENUTUP M6B)

Detail penuh: `docs/DECISIONS.md` **2026-08-11 (B-11)** + `docs/backlog/M6ABC_BACKLOG.md` (B-11) + `docs/DATA_MODEL.md` (baris Plan Satuan).

PRD §10 meminta DUA hal; hanya SATU jadi objek DB baru:

- **Klausa "partial unique index (≤1 Plan per service)" — TIDAK dibuat objek baru.**
  Peta service→Plan = `service_plan_gate.plan_id`, dan `service_id` adalah
  **PRIMARY KEY** tabel itu ⇒ satu baris gate ⇒ satu `plan_id` ⇒ ≤1 Plan. Partial
  unique index `(service_id) WHERE plan_id IS NOT NULL` = subset ketat PK,
  **redundan**. Migrasi gate M6C (`20260806061000` section 4) sudah menulis
  penalaran ini + menunda hanya "sisa"-nya (= klausa full-mgmt). Deviasi mekanisme
  index-vs-PK dicatat DECISIONS.
- **Klausa full-management — trigger `trg_spg_service_single_plan`**
  (`check_spg_service_single_plan`, `BEFORE INSERT OR UPDATE OF plan_id`): saat
  `plan_id` diisi → (a) Plan yang ditaut WAJIB `lingkup='klien'` (gate hanya menaut
  Plan Satuan), dan (b) service yang **kontraknya punya Strategi** (= kontrak
  Full-Management) DITOLAK masuk Plan Satuan (sudah tercakup Plan `lingkup='kontrak'`).
- **Cerminan TS (invariant beku):** `plangate.decideGate`/`redecideGate` memanggil
  `serviceInFullMgmtContract(tx, serviceId)` sebelum `openOrJoinPlanSatuanTx`;
  tolak dengan `MSG_FULL_MGMT_PLAN`. Predikat DB & TS identik — "the two must not diverge".

### Keputusan rancangan tercatat
- **Penanda "milik kontrak Full-Management" = kontraknya punya Strategi, BUKAN
  `services.plan_tier='plan_wajib'`.** Satu kontrak Full-Mgmt memayungi n service
  di bawah SATU Strategi (Store Mgmt + GMV Max + Nano KOL = satu Strategi), termasuk
  add-on `ditentukan_am` yang dibeli belakangan (§4b "even when purchased separately
  later"). Tier per-service tak menangkapnya; Strategi menangkapnya.
- **Ber-scope KONTRAK service, bukan KLIEN.** Klien yang memegang kontrak Full-Mgmt
  TETAP boleh menaruh service satuan berdiri-sendiri ke Plan Satuan (dites).
- **Trigger, bukan CHECK** — "milik kontrak Full-Mgmt" lintas-tabel
  (service→contract→strategi); CHECK tak boleh ber-subquery.

## 2. Tugas berikutnya (branch baru dari `main`)

**M6B SELESAI (100%).** Kandidat berikutnya:

- **A-11** (#115) — tinggal **diff J-4** (X-16 FINAL) + review pemilik.
- **M6A sisa** — A-08…A-13d sudah mendarat; cek `HANDOFF_M6ABC_SESI13.md` untuk item M6A yang belum.
- Seam B-10 yang menjadi tiket kelak (bukan bug), tak berubah sesi ini:
  - **Generasi periode berjalan** (bulanan) + **sweep dormansi otomatis** (§10c) = job (pola B-03→B-09; jalur tulis `openOrJoinPlanSatuanTx`/`markPlanSatuanDormant` sudah ada).
  - **De-eskalasi** (Flow step 9, tutup baris Plan berjalan) — kini hanya mencatat keputusan.
  - **3 event notif gate** (§10) — seam katalog beku, sama B-03…B-08.

## 3. Open questions (detail `docs/DECISIONS.md` §Open)

| # | Inti | Status |
|---|---|---|
| X-19 | Sweep (b) B-09 pakai `status_baris='Rencana'`, bukan "tanpa Brief" | 🟡 Tak blokir; ganti saat M7/M12 menautkan Brief↔baris |
| X-16 | Tier 6 field §4.1 | ✅ FINAL — buka A-11 |
| X-08 | `jam_live` manual? | 🟡 `gmv`-only sampai Hans |
| X-12 | Komponen KPI keterlambatan | 🟡 rumah di M14 |
| X-18 | Σ negative variance ke deficit | 🟡 toggle P-F eksplisit bila diinginkan |

## 4. Perintah pertama chat baru

```bash
pg_ctlcluster 16 main start && npm install && scripts/db-rebuild.sh --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run --root packages/domain      # full domain hijau
# lalu: A-11 diff J-4, atau item M6A sisa. Branch baru dari origin/main.
```
