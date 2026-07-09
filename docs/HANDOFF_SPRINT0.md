# CDPS — Handoff Sprint 0 (untuk sesi/chat berikutnya)

> Status per 2026-07-09 · Branch: `claude/csdps-hris-naming-fix-llickh` · Semua sudah di-commit & push.
> Konteks wajib baca sebelum lanjut: `CLAUDE.md`, `docs/backlog/SPRINT0_BACKLOG.md`, `docs/prd/CDPS_Build_Plan.md`, `PERMISSIONS.md`, `docs/STATE_MACHINES.md`, `docs/DATA_MODEL.md`.

## 1. Apa yang sudah selesai

### A. Perbaikan penamaan (commit `ea478c9`)
Seluruh file PRD modul di-rename `HRIS_*` → `CDPS_*` + normalisasi underscore; judul dokumen disesuaikan; istilah **HRIS kini eksklusif untuk sistem HR eksternal** (kontrak: `docs/HRIS_API_CONTRACT.md`). Keputusan tercatat di `docs/DECISIONS.md`. Catatan: nama resmi sistem adalah **CDPS** (bukan "CSDPS" — konfirmasi typo dari pemilik produk bila perlu).

### B. Sprint 0 — backend Go (commit `3b87938`, `backend/`)
Modular monolith `github.com/meagrup/agencyapp/backend`, MySQL/MariaDB. Tiket S0-01…S0-12 selesai (S0-12 = jalur demo, exit review formal tetap perlu disaksikan manusia):
- **ID generator** (`internal/core/ident`): `PREFIX-YYYYMM-NNNN`, dialokasikan di dalam transaksi create SETELAH validasi lolos; aman konkuren, rollback tidak mengonsumsi nomor.
- **Audit log** (`internal/core/audit`): append-only; trigger MySQL `BEFORE UPDATE/DELETE → SIGNAL 45000` (immutability di storage layer); setiap tulis wajib actor.
- **State-machine engine** (`internal/core/statemachine`): config deklaratif transkripsi dari `docs/STATE_MACHINES.md` — 12 mesin (prospect_attempt, lead_record, campaign, transaction_payment, installment, service, brief_task [kanonik; `[Blocked]` khusus SPV/Lead], creator_booking, creator_payment_request, live_stream_session, complaint, dependency [auto — transisi manual ditolak]). Satu-satunya jalur tulis kolom status. Pesan blokir BI persis: default `[transisi status tidak diizinkan]`; penolakan role: `[anda tidak memiliki akses untuk melakukan transisi ini]`. Flag paralel (`[Jatuh Tempo]`, `[Bermasalah]`) terpisah dari status.
- **HRIS integration** (`internal/hris`, S0-06/07): interface `EmployeeSource` (HTTP sesuai `docs/HRIS_API_CONTRACT.md` + CSV fallback dev); sync idempoten; nonaktif di HRIS ⇒ sesi CDPS dicabut; hilang dari full sync ⇒ flagged (tidak dihapus). Auth delegasi HRIS (`Authenticator`), CDPS terbitkan sesi opaque sendiri (cookie `cdps_session`); HRIS mati ⇒ 503 `[sistem HRIS tidak dapat dihubungi, coba beberapa saat lagi]` (fail closed); tanpa password store.
- **Permission layer** (S0-08): `role_mappings` (divisi/jabatan HRIS → division+level CDPS, dikelola admin tanpa redeploy) + `employee_layered_roles` (OD/Director). Matriks per `PERMISSIONS.md`: staff=own, lead=division, OD=read-all tanpa tulis, Director=full.
- **Master Service List** (S0-09): versi immutable, lookup "versi efektif pada tanggal X", edit hanya Sales lead/Director — 403 `[anda tidak memiliki akses untuk mengubah master service list]`. Field wajib: name, standard_price (string desimal), commission_rule, effective_from.
- **Notification center** (S0-10): 13 event katalog Phase 0 v2 §9 terdaftar dengan recipient-resolver; inbox per user, unread count, mark-read only, TIDAK ada jalur delete.
- **Seed** (S0-11): fixture Alpha Digital — 10 karyawan (`backend/testdata/employees.csv`), role mappings, 3 master services, 1 demo task. Idempoten.
- **Demo entity** (S0-12): `demo_tasks` (`DEMO-`) pakai mesin brief_task + alur block-request (staff ajukan → notifikasi ke lead divisi → lead approve → status `[Blocked]`).
- **mockhris** (`cmd/mockhris`, :8081): implementasi 2 endpoint kontrak HRIS dari CSV; semua password fixture `rahasia123`.
- **Test**: 30 fungsi test, 11 paket, semuanya hijau (`make test`, pakai db `cdps_test`).

### C. Sprint 0 — frontend (`web-internal/`, commit `4f78d28` + perbaikan di `3b87938`)
Next.js 16 App Router, TS strict, tanpa UI framework. Halaman: `/login`, `/` (dashboard + ringkasan role), `/demo-tasks` + detail (tombol transisi dinamis, pesan BI verbatim, block-request/approve, tabel audit), `/notifications` (mark-read only), `/admin/employees` (+ Sync Sekarang), `/admin/role-mappings` (+ layered OD/Director), `/master-services` (format `Rp. X.XXX.XXX,00`, date picker efektif, riwayat versi). Proxy `/api/v1/*` → backend :8080. `web-client-portal/` masih shell kosong (by design — Wave 3, auth realm terpisah).

## 2. Cara menjalankan (environment dev)
```bash
# Prasyarat: Go 1.24+, Node 22, MariaDB/MySQL jalan di 127.0.0.1:3306
#   db: cdps & cdps_test, user cdps / password cdps_dev
make migrate-up && make seed
make run-mockhris   # :8081 — HRIS tiruan (dev only)
make run-backend    # :8080 — CDPS_DSN & CDPS_HRIS_BASE_URL bisa dioverride via env
cd web-internal && npm install && npm run dev   # :3000
```
Login dev: `budi@mea.co.id` (Sales staff), `dewi@mea.co.id` (Sales lead), `sinta@mea.co.id` (AM), `yohan@mea.co.id` (Director) — semua password `rahasia123`.
Test: `make test` (backend); `cd web-internal && npm run build` (frontend).

## 3. Verifikasi QC yang sudah dilakukan (end-to-end, browser nyata)
Login budi → buat demo task tanpa judul (422 `[data tidak lengkap…]`) → buat valid (`DEMO-202607-0003`) → `[To Do]→[In Progress]` → transisi ilegal ditolak dengan BI → `[Blocked]` sebagai staff ditolak 403 → ajukan block → notifikasi masuk ke dewi (lead) → dewi approve → status `[Blocked]` → audit trail lengkap → MSL: staff ditolak 403, Director buat layanan baru + ubah harga = versi 2, lookup historis mengembalikan versi 1. Screenshot UI diverifikasi.

## 4. Catatan teknis / keputusan kecil (bukan deviasi PRD)
- Prefix Master Service = `MSV-`; prefix `SVC-` (open item O1 di DECISIONS) belum disentuh — Sprint 0 tidak membuat entity Service.
- BI string baru yang tidak dipin PRD: penolakan role transisi & MSL (lihat §1B) — konsisten dengan pola `[...]`.
- Audit API mengekspos `actor_employee_id` (bukan `actor`); frontend sudah disesuaikan.
- `allowedDevOrigins: ['127.0.0.1']` di next.config (dev-only, Next 16 memblokir cross-origin dev assets).
- Tombol tulis MSL tetap tampil untuk staff; server yang menolak (403 BI ditampilkan verbatim). Boleh disembunyikan berbasis role di polish berikutnya.

## 5. Langkah berikutnya (sesuai Build Plan — jangan lompat wave)
1. **Exit review S0-12 formal**: demo di staging, disaksikan head dev + Nerissa; catat go/no-go Wave 1 di `docs/DECISIONS.md`.
2. **Eksternal (kritis)**: minta 2 endpoint HRIS asli ke maintainer (spec §8/kontrak); Sales Head kompilasi Master Service List riil.
3. **Wave 1 (money path)**: M0 Sales → M1 Leads → M4 Client Record → M5 Admin/Finance — baca PRD modulnya penuh + `docs/backlog/WAVE1_BACKLOG.md`; test-first untuk komisi, alokasi Σ=100%, rollup installment.
4. Infra: CI di GitHub Actions sudah ada (`.github/workflows/ci.yml`) — perlu dicek jalan di run pertama.
