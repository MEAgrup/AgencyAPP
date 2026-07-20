# HANDOFF — Sesi 2026-07-19: Redesain Auth (full lokal CDPS)

> Branch: `claude/hris-cdps-auth-system-nx6vff` (semua sudah di-push). Orchestrator/QC: Fable; eksekutor: Opus (backend), Sonnet (docs), Haiku (prompt UI). Lanjutkan chat berikutnya dari dokumen ini.

## 1. Apa yang berubah (keputusan final — DECISIONS.md 2026-07-19)

Rencana lama "login via HRIS `POST /auth/verify`" DIBATALKAN. HRIS kini **sumber data karyawan saja** (`GET /employees` + fallback CSV, tidak berubah). Auth sepenuhnya milik CDPS:

- **Provisioning:** admin set password temporer → `must_change_password=1` → wajib ganti saat login pertama (gate server-side 403 di semua route protected kecuali `me`/`logout`/`change-password`).
- **Lupa password:** reset oleh admin (tanpa email; notifikasi in-app deferral, katalog tetap FROZEN).
- **Policy:** min 8 karakter / maks 72 byte, bcrypt DefaultCost; lockout 15 menit setelah 5x gagal berturut-turut (423; password benar pun ditolak selama terkunci).
- **Otoritas set/reset:** Director → semua; Lead/SPV → divisi mapped-nya sendiri, TIDAK boleh target ber-layered-role (OD/Director) atau tanpa role-mapping (itu Director-only).
- **Bootstrap deployment segar:** CLI `go run ./cmd/setpass <employee_id> <temp_password>` (temuan QC: tanpa ini Director pertama tidak bisa login — chicken-and-egg).

## 2. Kondisi kode (semua test hijau)

- Migrasi `0037_local_auth`: tabel `employee_credentials` (terpisah dari `employees` supaya sync HRIS/CSV tak pernah menyentuh kredensial).
- `internal/auth/local.go`: `VerifyLocal` / `ChangePassword` / `SetPassword` / `ListCredentials` / `MustChangePassword` + lockout; `session.go` + `RevokeAllSessions`/`RevokeOtherSessions`. `hris_authenticator.go` & interface `Authenticator` DIHAPUS; `httpapi.New` kini tanpa param authn.
- Endpoint: `POST /auth/login` (respons + `must_change_password`), `GET /auth/me` (alias legacy `GET /api/v1/me` tetap hidup), `POST /auth/change-password`, `POST /auth/admin/set-password`, `GET /auth/admin/credentials` (`{"data":[...]}`, `[]` bukan null saat kosong). Body error selalu `{"message":"[...]"}`.
- String BI baru (diotorisasi, lihat DECISIONS): akun belum diaktifkan / akun terkunci / password minimal 8 / maksimal 72 / password lama tidak sesuai / wajib mengganti password terlebih dahulu / tidak memiliki akses mengatur password.
- Audit append-only: `password_set_admin`, `password_changed_self`, `account_locked` — tanpa hash/password.
- `cmd/mockhris`: handler auth/verify dihapus, employees tetap. `go.mod`: + `golang.org/x/crypto` **dipin v0.31.0** (versi terbaru memaksa go>=1.25; naikkan bersamaan dengan bump Go).

**Verifikasi yang sudah dilakukan:** `go vet` + `go build` bersih; suite penuh `CI=1 go test -p 1 ./...` hijau (fail-loud, tanpa silent-skip); smoke migrasi up→down→up; smoke end-to-end server hidup via curl: login temp → gate 403 → ganti password → akses pulih → login password lama 401 → lockout 423 di gagal ke-5 → audit bersih.

## 3. Dokumen yang sudah direvisi

`CLAUDE.md` (integrasi HRIS), `docs/HRIS_API_CONTRACT.md` (v2, §auth dihapus), `docs/prd/CDPS_Build_Plan.md` (6 titik, exit criteria Sprint 0 → login lokal), `docs/DECISIONS.md` (2 entry baru 2026-07-19: redesain auth + bootstrap CLI).

## 4. Pekerjaan berikutnya (urutan saran)

1. **UI internal (paralel, akun lain):** prompt siap pakai di `docs/handoff/PROMPT_UI_AUTH.md` — kontrak API final, string BI verbatim, halaman login/force-change/ganti-password/panel admin, interceptor 403. Branch FE sendiri; jangan sentuh backend.
2. **Provisioning riil saat go-live:** sync karyawan (CSV/HRIS) → `cmd/setpass` untuk Director pertama → Director/Lead provision sisanya via panel admin (atau endpoint langsung sebelum UI jadi).
3. ✅ **SUDAH DIEKSEKUSI (sesi lanjutan 2026-07-19, branch `claude/backend-auth-cdps-complete-m46ock`):** `ChangePassword` kini memanggil `registerFailure` yang sama dengan login saat `old_password` salah; counter shared, 423 setelah gagal ke-5, reset admin memulihkan — lihat entri baru `docs/DECISIONS.md` 2026-07-19 dan `docs/handoff/AUTH_UAT_RUNBOOK.md` skenario H. ~~Rekomendasi QC belum dieksekusi (kecil, opsional): endpoint `change-password` belum ikut lockout counter — pemegang sesi curian bisa brute-force old_password tanpa terkunci. Pertimbangkan menerapkan `registerFailure` yang sama di `ChangePassword`.~~
4. ✅ **SUDAH DIEKSEKUSI (sesi lanjutan 2026-07-19, branch `claude/backend-auth-cdps-complete-m46ock`):** runbook UAT jalur auth tersedia di `docs/handoff/AUTH_UAT_RUNBOOK.md` (skenario A-K: bootstrap setpass, login temp, force-change, reset admin, lockout login & change-password, karyawan dinonaktifkan HRIS → sesi mati, audit + panel admin). ~~UAT: tambahkan jalur auth ke runbook UAT berikutnya (login temp, force-change, reset admin, lockout, karyawan dinonaktifkan HRIS → sesi mati).~~

## 5. Catatan environment build (container sesi ini)

MariaDB di-install manual (`apt-get install mariadb-server`, jalankan `mysqld_safe`, buat db `cdps`/`cdps_test` + user `cdps`/`cdps_dev`) — container baru harus mengulang setup ini untuk test DB-backed. Awas: `pkill -f cdps` juga mematikan proses lain yang argumen-nya memuat "cdps" (termasuk sesi agent — pakai pola yang lebih spesifik seperti `pkill -f 'exe/cdps'`).
