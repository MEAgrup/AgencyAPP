# Auth Lokal — Laporan UAT teknis (2026-07-19)

**Hasil: PASS 25/25 assertion langkah runbook cakupan smoke, FAIL 0, SKIP 0**
(runbook `AUTH_UAT_RUNBOOK.md` skenario A (langkah 1-3), B (4-5), C (6-7), D
(8-11), G (25-29), H (30-35), J (39-41). Skrip repeatable
`backend/uat/auth_walk.py`, jalankan dari `backend/`: `python3 uat/auth_walk.py`
— reset state UAT di awal run, exit 0 bila 0 FAIL). Eksekusi LIMA kali:
executor Opus 4× + rerun QC orchestrator (pasca revisi kosmetik skrip: buang 2
sisa kode mati `if False`, koreksi klaim bukti HttpOnly) — kelimanya 25/25
PASS, 0 FAIL.

## Lingkungan
Stack dev container: MariaDB lokal; branch
`claude/cdps-auth-uat-smoke-et5wql` di-reset ke `b55246d` (= tip
`claude/backend-auth-cdps-complete-m46ock`, memuat seluruh auth lokal +
lockout change-password `067cddf`). Suite penuh fresh
`CI=1 go test -count=1 -p 1 ./...` di container yang sama SEBELUM walk: **34
paket hijau, 0 FAIL**, durasi paket DB >1s (prosedur anti-silent-skip
MariaDB); `go vet` + `go build` bersih. Boot: `migrate up` (termasuk
`0037_local_auth`), `cmd/mockhris` :8081 + `cmd/cdps` :8080 dengan
`employees_uat.csv` 43 baris, sync `43/43` bersih, `rolemapseed --apply` 31
mapping + 3 layered; `employee_credentials` KOSONG di awal (state deployment
segar skenario A).

## Aktor
| Peran runbook | Akun | Riil/fixture |
|---|---|---|
| Director (layered), bootstrap `cmd/setpass` + admin G/H/J | `UATDIR0001` | fixture O26 |
| Creative Lead — lockout change-password H.30-32 + pemulihan reset-admin H.35 | `UATCRE0001` | fixture O34 |
| Staff Creative — lockout login G + cross-counter H.33-34 + pemulihan simulasi | ARIF (`2111040039`) | riil |
| Staff Ads — J.41 non-admin 403 | KENNY (`2206060100`) | riil |

## Bukti kunci per bagian (status/pesan BI persis)
- **[A 1-3]** Deployment segar, `employee_credentials` kosong → login Director
  **401** `[akun belum diaktifkan, hubungi admin untuk pengaturan password
  awal]`; `setpass` pw<8 → exit error `setpass: password minimal 8 karakter`
  TANPA menulis baris kredensial; pw valid → row
  `must_change_password=1/failed_attempts=0/locked_until=NULL` + audit
  `password_set_admin` actor=`CLI-BOOTSTRAP`
  `after_json={"must_change_password":true,"via":"cli_bootstrap"}` tanpa hash;
  login dengan password temporer → **200** `must_change_password: true`.
- **[B 4-5]** Body login **200** `{employee, role, must_change_password:
  true}` + cookie sesi `cdps_session` ter-set; field kosong → **400**
  `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`.
- **[C 6-7]** Route protected non-exempt (`GET /notifications`) saat
  `must_change_password=true` → **403** `[wajib mengganti password terlebih
  dahulu]`; empat pengecualian tetap lolos: `GET /auth/me` **200**
  (`must_change_password: true`), alias legacy `GET /me` **200**,
  `POST /auth/logout` **204**, `POST /auth/change-password` TIDAK kena gate
  (respons **400** handler untuk body kosong, bukan 403 gate).
- **[D 8-11]** `POST /auth/change-password` sukses → **204**; DB
  `must_change_password=0/failed_attempts=0/locked_until=NULL/
  password_changed_at` ter-set; audit `password_changed_self`
  `after_json={"must_change_password":false}`; sesi LAIN (device berbeda)
  di-revoke → **401** `[sesi tidak valid, silahkan login kembali]` (sesi
  pengubah sendiri TETAP hidup); login dengan password LAMA → **401**
  `[email atau password salah]`; login dengan password BARU → **200**
  `must_change_password: false`.
- **[G 25-29]** 4× login salah → tiap **401** `[email atau password salah]`,
  `failed_attempts` naik 1→4; percobaan ke-5 → tetap **401** message yang sama
  TAPI DB memasang `locked_until=+15 menit` + counter reset ke 0 + audit
  `account_locked` `after_json={"lock_minutes":15}`; percobaan ke-6 dengan
  password BENAR → **423** `[akun terkunci sementara karena percobaan gagal
  berulang, coba lagi dalam 15 menit]`; pemulihan (a) tunggu-15-menit
  DISIMULASIKAN via `UPDATE locked_until=DATE_SUB(NOW(),INTERVAL 1 SECOND)` →
  login **200**; pemulihan (b) reset admin riil (Director set-password) →
  **204**, `failed_attempts=0/locked_until=NULL`, login dengan password
  temporer baru → **200**.
- **[H 30-35]** (shared counter, perilaku baru `067cddf`): 4× change-password
  `old_password` salah → tiap **401** `[password lama tidak sesuai]`, counter
  naik 1→4 (KOLOM SAMA dengan login); percobaan ke-5 → **401** message yang
  sama + lock terpasang + audit `account_locked`; percobaan ke-6 dengan
  `old_password` BENAR → **423** string persis sama dengan login; cross-check
  (H.33): 2× gagal login + 3× gagal change-password pada aktor yang sama →
  progresi counter `1,2,3,4,0`, lock terpasang di kegagalan lintas-endpoint
  ke-5; H.34: login dengan password BENAR selama window terkunci (lock berasal
  dari jalur change-password) → tetap **423** (enforcement shared, bukan
  hanya counter shared); pemulihan dua jalur — simulasi tunggu (ARIF
  change-password lolos **204**) dan reset admin riil (Lead di-reset →
  **204**, `locked_until=NULL`, login temporer baru **200**).
- **[J 39-41]** Rantai audit lengkap via `GET /audit` (Director):
  `password_set_admin` (CLI-BOOTSTRAP & admin), `password_changed_self`,
  `account_locked` (dari kedua jalur login & change-password), semua
  `entity_type=employee_credential`, `after_json` bebas hash/plaintext (scan
  otomatis terhadap semua password fixture + pola bcrypt) — bersih;
  `GET /auth/admin/credentials` (Director) → **200**
  `{"data":[43 baris]}` non-null, field `has_password/must_change_password/
  locked_until/password_changed_at` per baris dicocokkan ke state DB aktual
  pasca skenario D/G/H (4 aktor diverifikasi, termasuk KENNY yang belum
  ber-kredensial di titik itu — `has_password: false`); staff biasa (KENNY,
  setelah punya kredensial) → **403** `[anda tidak memiliki akses untuk
  mengatur password karyawan ini]`.

## Tidak dijalankan (dengan alasan)
- **Skenario E (langkah 12-15, validasi policy change-password)** — di luar
  cakupan smoke minimal; ter-cover unit/handler test
  `internal/auth/auth_test.go::TestChangePassword_Flow` +
  `internal/httpapi/auth_handlers_test.go::TestAuthHTTP_ChangePasswordAndForceChangeGate`.
- **Skenario F (langkah 16-24, matriks otorisasi admin set/reset +
  anti-eskalasi)** — di luar cakupan smoke; ter-cover
  `TestSetPassword_Authorization`, `TestSetPassword_RevokesTargetSessionsAndAudits`,
  `TestListCredentials_Scoping`, `TestAuthHTTP_AdminSetPassword`,
  `TestAuthHTTP_CredentialsScoping`. Catatan: sebagian jalur F tetap teruji
  implisit di walk (set-password Director **204** sebagai precondition
  G/H/J; langkah 24 pemulihan reset = G.29/H.35).
- **Skenario I (langkah 36-38, HRIS deactivate → sesi mati)** — di luar
  cakupan smoke; ter-cover `internal/hris/hris_test.go` (assert sesi revoked
  pasca deactivation); jalur sync live juga sudah teruji Wave 2.
- **Langkah 42 (go/no-go)** = keputusan manusia (Nerissa/Yohan + head dev) —
  laporan ini bahannya.
- **Jalur tunggu-15-menit riil tidak ditunggu** (2 titik, G.28/H.35) —
  disimulasikan via `UPDATE locked_until` (pola test, diizinkan orkestrasi);
  jalur pemulihan reset-admin diuji RIIL di kedua titik.

## Temuan
1. NOL bug produk. Semua assertion (status, string BI karakter-per-karakter,
   state DB, audit) lolos tanpa workaround.
2. Revisi QC hanya pada SKRIP walk (kosmetik): 2 sisa kode mati `if False`,
   dan klaim bukti HttpOnly diturunkan jadi cek keberadaan cookie saja
   (atribut HttpOnly/TTL tidak di-assert secara terpisah — dicantumkan di
   deskripsi step 4).
3. Aktor Director/Lead Creative masih fixture O26/O34 (preseden Wave
   2/Wave 3) — pilih aktor riil saat runbook dijalankan di stack produksi.
4. Reset state di awal run (`TRUNCATE employee_credentials` + `DELETE FROM
   sessions`) = dev/UAT-only sesuai prasyarat runbook butir 2 — JANGAN
   dijalankan di produksi.
