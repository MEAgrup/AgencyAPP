# HANDOFF — M6A/M6B/M6C Sesi 24 (titik mulai sesi berikutnya)

> Rantai: … → SESI22 → SESI23 → **SESI24 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch (persis, akhir sesi 23→24)

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **`main` (default)** | memuat **B-00…B-09 + M6A A-00…A-13d + X-17/O59-b (#127)**. PR #128 (B-09) **sudah merge**. |
| **Sesi ini mengerjakan** | **B-10 Plan Satuan + mesin #17 — SELESAI**, di branch di bawah. |
| **Branch B-10** | `claude/handoff-m6abc-sesi23-b10-vq2ulz` — dicabang dari `origin/main` (post-#128). |
| **PR B-10** | dibuat sesi ini (lihat GitHub) — base `main`. Merge saat hijau. |
| **PR MASIH TERBUKA (lama)** | **#115** — M6A A-11 (`/s/{token}`). X-16 FINAL ⇒ tinggal **diff J-4** + review pemilik. |
| **Branch tugas berikutnya** | Setelah PR B-10 merge: `git fetch origin main && git checkout -B <branch-baru> origin/main`. |

### 0.1 DB lokal — WAJIB, Postgres MATI SENDIRI

```bash
pg_ctlcluster 16 main start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""   # HANYA pertama kali
npm install
scripts/db-rebuild.sh --yes                 # 78 migrasi + seed + gate + invariant
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run --root packages/domain      # full domain hijau
```

### 0.2 Posisi persis (sesudah B-10)

| | |
|---|---|
| Migrasi | **78 berkas** · gerbang tabel **90** · prefix 31 · mesin **18** · event 34 · `CATALOG_VERSION` 4 |
| Test | domain **1084** hijau (+1 skip) · api **344** · web-internal **191** · typecheck 5 paket bersih · `KNOWN_GAPS` kosong |
| Migrasi baru | `20260811000000_m6b_plan_satuan.sql` — tabel `plan_satuan` + mesin #17 + FK `service_plan_gate.plan_id` + `plan_flag` jenis `di_luar_service` |
| Menggantung | Kode B-10: **NOL**. Seam terdokumentasi (bukan bug): generasi periode berjalan bulanan + sweep dormansi otomatis = job (§10c); baris `plan_row` diisi lewat form. Open baru: tidak ada. |

## 1. Apa yang berubah sesi ini — B-10 Plan Satuan (M6C §7)

Detail penuh: `docs/DECISIONS.md` **2026-08-11 (B-10)** + `docs/backlog/M6ABC_BACKLOG.md` (B-10) + `STATE_MACHINES.md` §6e.

- **Menutup Rule 6 M6C.** `openOrJoinPlanSatuanTx(tx, actor, clientId, today)` dipanggil DI DALAM transaksi `plangate.decideGate`/`redecideGate` saat `keputusan_am='butuh_plan'`:
  - **buka** (rantai belum ada) → baris `plan_satuan` + periode 1 `Draft` (`lingkup='klien'`, contract/strategi NULL);
  - **gabung** (rantai `Aktif`) → link ke periode berjalan, **never a 2nd Plan** (S2);
  - **reaktivasi** (rantai `Dorman`) → mesin #17 `Dorman → Aktif` + periode segar `Terjadwal`.
  - lalu isi `service_plan_gate.plan_id`.
- **Mesin #17 `plan_satuan`** (`Aktif ⇄ Dorman`) — properti RANTAI per-klien, hidup di **tabel `plan_satuan`** (PK `client_id`), BUKAN kolom `plan` (dormansi bukan properti satu periode; n salinan = anti-pola). **Non-terminal.** `markPlanSatuanDormant` (§10 job c) menolak selagi ada periode non-terminal.
- **Review tutup 4-field** untuk `lingkup='klien'` — `reviewComplete` reduced (yang_jalan/yang_tidak_jalan/materi_klien; tanpa diagnosa/rekomendasi — "no strategy to blame").
- **`Di Luar Service`** — `plan_flag` jenis `di_luar_service` (analog `di_luar_strategi`, §7.9); kolom `plan_row.di_luar_service` sudah B-01.

### DEVIASI tercatat
- `status_dormansi` = **TABEL** `plan_satuan`, bukan kolom `plan` (komentar ci.yml lama menduga sebaliknya — dikoreksi). Alasan: dormansi properti RANTAI (B-01 sudah menamai ini). Gerbang **90 tabel / 18 mesin** dinaikkan di `ci.yml` + `db-rebuild.sh`.

## 2. Tugas berikutnya (branch baru dari `main`)

- **B-11** — constraint integritas §4(b): partial unique index (satu service ⇒ ≤1 Plan; service dalam kontrak full-management tak boleh menunjuk Plan `lingkup='klien'`). **Kecil.** Sekarang FK `service_plan_gate.plan_id → plan` sudah ada (B-10), jadi index integritasnya bisa dibangun di atasnya. **M6B SELESAI setelah B-11.**
- **A-11** (#115) — tinggal **diff J-4** (X-16 FINAL) + review pemilik.

Seam B-10 yang menjadi tiket kelak (bukan bug):
- **Generasi periode berjalan** untuk Plan Satuan aktif (bulanan) + **sweep dormansi otomatis** (§10c, flip Dorman saat service terakhir berakhir) — pemicunya job, pola sama B-03→B-09; jalur tulisnya (`openOrJoinPlanSatuanTx`/`markPlanSatuanDormant`) sudah ada.
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
# lalu: B-11 (kecil, menutup M6B) atau A-11 diff J-4, branch baru dari origin/main.
```
