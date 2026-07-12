# HANDOFF — Cek merge Wave 1 selesai, menunggu keputusan mulai Wave 2

_Sesi: cek proses merge Wave 1 + verifikasi kesiapan Wave 2 (2026-07-12)._

## Status merge (terverifikasi sesi ini)
- **PR #6 (Wave 1 Integration) MERGED ke `main`** — commit `2a75125`. Semua PR Wave 1 lama (#1–#5) closed; tidak ada PR Wave 1 terbuka.
- `main` = `origin/main` = HEAD branch kerja `claude/cdps-wave1-merge-check-u2g811` (`2a75125`). Working tree bersih.

## Verifikasi teknis (dijalankan langsung sesi ini, bukan hanya percaya handoff lama)
- ✅ `go build ./...` bersih, `go vet ./...` bersih.
- ✅ **`go test -p 1 -count=1 ./...` → 17 paket backend semua `ok`** (termasuk `internal/integration/crossflow_test`, module0/1/4/5, importer, httpapi, semua core engine).
- ✅ Migrasi **up → down all → up** bersih (setelah down all sisa hanya `schema_migrations` — normal golang-migrate).
- ✅ `seed` (Alpha Digital) jalan & idempoten.
- **Kesimpulan: tidak ada utang blocking di sisi kode.** Wave 1 money path lolos semua DoD.

## Setup dev di container baru (WAJIB — container ephemeral, MySQL tidak ter-install default)
1. `apt-get update` **dulu** (cache stale → error 404). Lalu `apt-get install -y iproute2 rsync` (dep `mariadb-server` yang sering unmet), baru `apt-get install -y --fix-missing mariadb-server`.
2. Init bila perlu: `mariadb-install-db --user=mysql --datadir=/var/lib/mysql --auth-root-authentication-method=normal`; `mkdir -p /run/mysqld && chown mysql:mysql /run/mysqld`; start `nohup mysqld_safe --datadir=/var/lib/mysql &`.
3. Buat DB & user (root via socket):
   ```sql
   CREATE DATABASE cdps; CREATE DATABASE cdps_test;
   CREATE USER 'cdps'@'127.0.0.1' IDENTIFIED BY 'cdps_dev';  -- + 'cdps'@'localhost'
   GRANT ALL ON *.* TO 'cdps'@'127.0.0.1' WITH GRANT OPTION;  -- + 'cdps'@'localhost'
   SET GLOBAL log_bin_trust_function_creators=1;
   ```
4. Env: `CDPS_TEST_DSN="cdps:cdps_dev@tcp(127.0.0.1:3306)/cdps_test?parseTime=true&multiStatements=true"` (+ `CDPS_DSN` ke `/cdps`). Lalu `make test`.

## Yang menahan Wave 1 "resmi ditutup" (UAT W1-20) — SEMUA item manusia, bukan kode
- **O21** — daftar NIK→email karyawan (HR) → tanpa ini belum ada login riil.
- **O20** — keputusan UTC vs WIB (Nerissa/Yohan) → akurasi reminder jatuh tempo.
- **O18** — mapping layanan legacy→MSL (Sales Head) → real-run importer W1-19.
- Endpoint HRIS (`/employees`, `/auth/verify`) ditunda tim HRIS; interim pakai CSV.

Detail runbook UAT: `docs/handoff/W1-20_UAT_RUNBOOK.md`. Langkah manusia go-live: `docs/handoff/LANGKAH_MANUSIA_GO_LIVE.md`.

## Utang teknis (deferred, tercatat di `docs/DECISIONS.md` blok "Wave 1 Integration", NON-blocking Wave 2)
Port byte-faithful sisa test stream A; handler bulk single-reg M1; pin MSL untuk layanan yang ditambah saat negosiasi (jalur inti pakai layanan Qualified Form).

## KEPUTUSAN TERBUKA — belum dijawab, tanyakan di awal sesi berikut
Konflik aturan rumah **Build Plan R5** ("no Wave-2 tickets started before Wave-1 exit criteria pass UAT") vs UAT yang macet di item manusia. Tiga opsi diajukan ke Nerissa:
- **A (rekomendasi)** — mulai Wave 2 **M6** sekarang paralel (waive R5 sementara; skema `0002` beku & stabil, M6 hanya konsumsi klien `released_to_account_at`, jadi aman dikerjakan sambil bahan UAT dikumpulkan).
- **B** — tahan sampai UAT lulus; sementara bantu siapkan bahan UAT (checklist/skrip UAT, draft form pelengkap O23).
- **C** — beresi utang teknis dulu sebelum M6.

> **Belum ada jawaban.** JANGAN mulai koding Wave 2 sebelum Nerissa memilih.

## Kalau A dipilih — langkah mulai Wave 2 (urutan CLAUDE.md: M6 → M12 early → M7 → M8 → M9 → M10)
Mulai **M6 (Account & Service)**: baca `docs/prd/CDPS_Module6_Account_Service.md` + entri M6 di `DATA_MODEL.md`/`STATE_MACHINES.md`; kerja per klaster Rule/Flow, test-first (state machine + money math); DoD CLAUDE.md (validasi BI `[…]`, permission per role incl. layered OD/Director, immutability, recompute-from-log, seed Alpha Digital tetap lolos). Skema baru via migrasi baru saja (0002 beku), status hanya via transition engine, ID via `ident.Next` setelah validasi.

## Estimasi progres (% cakupan engineering; durasi tak dihitung — jumlah dev belum diketahui, Build Plan §7)
| Fase | Modul | Bobot | Kumulatif |
|---|---|---|---|
| Sprint 0 (fondasi) | Phase 0 + HRIS + MSL | ~20% | 20% |
| Wave 1 (money path) ✅ | M0, M1, M4, M5 | ~20% | **~40%** |
| Wave 2 (delivery engine) | M6→M12→M7,M8,M9,M10 | ~32% | ~72% |
| Wave 3 (attribusi, health, portal) | M2, M3, M11, M13, M14, M15 | ~22% | ~94% |
| Go-live hardening (UAT semua wave, migrasi data riil, security Client Portal) | — | ~6% | 100% |

➡️ Mulai Wave 2 ≈ **40%** → Wave 2 selesai ≈ **70%** → Wave 3 ≈ **94%** → sisanya sampai **100% siap pakai**. Catatan: Wave 2 ticket count terbanyak tapi repetitif — begitu engine M12 jadi, M7/M8/M9 variasi pola yang sama.
