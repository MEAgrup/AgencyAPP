# AUTH — Runbook UAT jalur Auth Lokal CDPS

> Mengikuti pola `docs/handoff/W3_UAT_RUNBOOK.md` (setiap langkah mencantumkan
> **aktor**, **aksi** (endpoint), dan **hasil yang diverifikasi**: status persis,
> pesan BI persis dalam `[...]`, audit). Kegagalan di langkah mana pun = no-go,
> catat di `docs/DECISIONS.md`. Status/pesan/perilaku di runbook ini disalin
> persis dari kode (`internal/auth/local.go`, `internal/httpapi/auth_handlers.go`,
> `internal/httpapi/api.go`, `cmd/setpass/main.go`, `internal/hris/sync.go`) dan
> dari entri Decided 2026-07-19 ("AUTH DIREDESAIN", "Bootstrap kredensial…", dan
> entri lockout change-password) di `docs/DECISIONS.md`; rujukan `file:baris`
> dicantumkan untuk pesan/perilaku kunci. Body error selalu `{"message":"[...]"}`
> (field `.message`, BUKAN `.error`).
>
> **Cakupan:** jalur auth lokal end-to-end — bootstrap, login (temp & lockout),
> gate force-change, ganti password (sukses & lockout), validasi policy, admin
> set/reset password (matriks otorisasi Director/Lead + anti-eskalasi), sinkron
> HRIS→akses dicabut, dan audit/panel admin. **Tidak** mencakup UI/FE (lihat
> `docs/handoff/PROMPT_UI_AUTH.md` untuk kontrak yang dipakai FE) — runbook ini
> menembak API langsung (curl/HTTP client) terhadap stack backend.

## Prasyarat

1. **Dev** — boot stack backend (dari `backend/`): `migrate up` (termasuk
   `0037_local_auth`); sync karyawan (`cmd/mockhris` + `cmd/cdps` dengan
   `CDPS_SEED_CSV=…` seperti pola W2/W3) sehingga minimal ada: satu calon
   Director (belum ber-kredensial — untuk skenario bootstrap A), satu Lead/SPV
   divisi tertentu, satu staff divisi yang sama dengan Lead itu, satu staff/lead
   divisi LAIN, dan (bila memungkinkan) satu karyawan ber-layered-role OD/Director
   TAMBAHAN untuk uji anti-eskalasi Lead di skenario F.
2. **Dev** — pastikan tabel `employee_credentials` KOSONG untuk seluruh roster di
   atas sebelum langkah 1 (state "deployment segar") — bila stack bekas UAT lama,
   `TRUNCATE employee_credentials` (dev/UAT only, bukan produksi) atau pakai
   employee_id baru yang belum pernah di-`setpass`.
3. Semua `curl` di bawah memakai flag `-c cookies.txt -b cookies.txt` per-aktor
   (satu file cookie jar per sesi/aktor supaya sesi tidak saling menimpa) —
   ganti `cookies.txt` per aktor (`cookies_director.txt`, `cookies_staffA.txt`, dst).

---

## A. Bootstrap kredensial — Director pertama (deployment segar)

1. **Dev/Ops** — deployment segar: `employee_credentials` kosong untuk semua
   employee, termasuk calon Director. `POST /api/v1/auth/login` dengan email
   Director + password apa pun ⇒ **401** `[akun belum diaktifkan, hubungi admin
   untuk pengaturan password awal]` (`ErrNotProvisioned`, `local.go:87`,
   `auth_handlers.go:53-54`) — membuktikan chicken-and-egg tanpa bootstrap.
2. **Ops (host/DSN, bukan HTTP)** — jalankan dari folder `backend/`:
   ```bash
   CDPS_DSN=... go run ./cmd/setpass <director_employee_id> <TempPassword123>
   ```
   Password < 8 karakter atau > 72 byte ⇒ CLI exit dengan pesan
   `setpass: password minimal 8 karakter` / `maksimal 72 karakter`
   (`main.go:30-35`, validasi lokal CLI sebelum sentuh DB) — tanpa baris
   kredensial ditulis. ✔ dengan password valid: keluaran
   `password temporer di-set untuk <employee_id> (wajib ganti saat login
   pertama)`; baris `employee_credentials` lahir `must_change_password=1`,
   `failed_attempts=0`, `locked_until=NULL`; audit `password_set_admin`
   actor=`CLI-BOOTSTRAP`, `after_json` HANYA `{"must_change_password":true,
   "via":"cli_bootstrap"}` (tanpa hash/password, `main.go:67-71`).
3. **Director** — `POST /api/v1/auth/login` dengan password temporer dari
   langkah 2. ✔ **200** + `must_change_password: true` (lanjut ke skenario B).

---

## B. Login password temporer → force-change

4. **Director** (lanjutan langkah 3, atau aktor lain yang baru di-`set-password`
   admin) — `POST /api/v1/auth/login` `{email, password: <temp>}`. ✔ **200**;
   body `{employee, role, must_change_password: true}` (`identityOf`,
   `auth_handlers.go:32-38`); cookie sesi `cdps_session` (HttpOnly, TTL 12 jam,
   `auth_handlers.go:70-77`) ter-set.
5. **Aktor sama, field kosong** — `POST /api/v1/auth/login` `{}` atau salah satu
   field kosong ⇒ **400** `[data tidak lengkap, silahkan lengkapi semua
   pertanyaan wajib!]` (`auth_handlers.go:45-46`) — sebelum query DB apa pun.

---

## C. Gate force-change (403 + pengecualian)

6. **Aktor dari langkah 4** (masih `must_change_password=true`) — coba akses
   route protected APA PUN selain pengecualian (mis. `GET /api/v1/me` bukan,
   tapi coba endpoint modul lain seperti `GET /api/v1/clients` atau serupa yang
   tersedia di stack) ⇒ **403** `[wajib mengganti password terlebih dahulu]`
   (`api.go:229-231`, dicek SEBELUM handler endpoint dijalankan).
7. **Aktor sama** — verifikasi EMPAT pengecualian tetap 200/204 walau
   `must_change_password=true` (`forceChangeExempt`, `api.go:197-202`):
   - `GET /api/v1/auth/me` (dan alias legacy `GET /api/v1/me`) ⇒ 200, body
     berisi `must_change_password: true` (masih true, belum diganti).
   - `POST /api/v1/auth/logout` ⇒ 204 (revoke sesi ini; bila mau lanjut ke
     langkah berikut, login ulang dulu).
   - `POST /api/v1/auth/change-password` ⇒ TIDAK 403 gate (lanjut skenario D).

---

## D. Ganti password — sukses, revoke sesi lain, password lama mati

8. **Aktor** (login dua sesi berbeda device/browser — dua cookie jar, mis.
   `cookies_A.txt` dan `cookies_B.txt`, keduanya login sukses dengan password
   temporer yang sama) — dari **sesi A**: `POST /api/v1/auth/change-password`
   `{old_password: <temp>, new_password: "NewPass123"}`. ✔ **204 No Content**;
   server-side (`local.go:143-189`): `password_hash` di-update, `must_change_
   password=0`, `password_changed_at=NOW()`, `failed_attempts=0`,
   `locked_until=NULL`, **REVOKE SEMUA sesi LAIN** (`RevokeOtherSessions`,
   `keepToken`=cookie sesi A) — sesi A sendiri TETAP hidup; audit
   `password_changed_self`, `after_json={"must_change_password":false}`
   (`local.go:185-188`, tanpa hash/password).
9. **Sesi A** (yang baru ganti password) — `GET /api/v1/auth/me` ⇒ 200,
   `must_change_password: false`; akses route protected lain (yang tadi 403 di
   langkah 6) ⇒ sekarang lolos (200, bukan 403 lagi).
10. **Sesi B** (device lain, TIDAK ikut ganti password) — panggil endpoint
    protected APA PUN ⇒ **401** (sesi di-revoke, `ResolveSession` gagal,
    `[sesi tidak valid, silahkan login kembali]`, `api.go:211/216`). Sesi B
    harus login ulang.
11. **Aktor** — login ulang dengan **password LAMA (temp)** yang sudah diganti
    ⇒ **401** `[email atau password salah]` (`ErrInvalidCredentials` —
    hash lama sudah tak berlaku). Login dengan **password BARU** ⇒ 200,
    `must_change_password: false`.

---

## E. Validasi kelengkapan & policy panjang (change-password)

12. **Aktor authenticated** — `POST /auth/change-password` dengan
    `old_password`/`new_password` kosong/hilang ⇒ **400**
    `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`
    (`auth_handlers.go:109-111`, sebelum panggil `auth.ChangePassword`).
13. **Aktor** — `new_password` < 8 karakter (mis. `"abc123"`) dengan
    `old_password` benar ⇒ **400** `[password minimal 8 karakter]`
    (`ErrWeakPassword`, `local.go` `validatePassword` via `auth_handlers.go:
    125-126`) — dicek SETELAH old_password diverifikasi benar (§ urutan di
    `local.go:162-170`: hash lama dicek dulu, baru panjang baru).
14. **Aktor** — `new_password` > 72 byte ⇒ **400** `[password maksimal 72
    karakter]` (`ErrPasswordTooLong`, `auth_handlers.go:127-128`). Catatan:
    aturan panjang HANYA berlaku untuk `new_password`; `old_password` cukup
    wajib diisi (tidak divalidasi panjangnya).
15. **Aktor** — `old_password` SALAH (apa pun `new_password`-nya) ⇒ **401**
    `[password lama tidak sesuai]` (`ErrOldPasswordMismatch`,
    `auth_handlers.go:123-124`) — DAN menaikkan counter lockout (lihat
    skenario H, langkah bekas ini adalah percobaan gagal ke-1 bila belum ada
    riwayat gagal).

---

## F. Admin set/reset password — matriks otorisasi + anti-eskalasi

16. **Director** — `POST /api/v1/auth/admin/set-password` `{employee_id,
    temp_password}` untuk karyawan divisi APA PUN, termasuk yang ber-layered-
    role (OD/Director) atau tanpa role-mapping. ✔ **204**; kredensial target
    di-upsert `must_change_password=1`, `failed_attempts=0`, `locked_until=
    NULL`; **REVOKE SEMUA sesi target** (`RevokeAllSessions`, `local.go`
    `SetPassword`); audit `password_set_admin` actor=Director.
17. **Lead/SPV divisi X** — set password staff DALAM divisi X yang sama DAN
    TANPA layered role. ✔ **204** (`adminMayManage` — `division.String ==
    admin.Role.Division` DAN `layered == 0`, `local.go:246-278`).
18. **Lead/SPV divisi X — negatif eskalasi (a): target ber-layered-role**
    (OD atau Director, meski divisi mapping-nya sama X) ⇒ **403**
    `[anda tidak memiliki akses untuk mengatur password karyawan ini]`
    (`layered > 0` di `adminMayManage`, `local.go:275-278`).
19. **Lead/SPV divisi X — negatif eskalasi (b): target TANPA role-mapping
    sama sekali** (kombinasi divisi×jabatan tidak ada di `role_mappings`) ⇒
    **403** yang sama (`division` NULL/`ErrNoRows` ⇒ `false, nil`,
    `local.go:265-268` — "no mapping => Director only"). Director yang
    mencoba target yang sama ⇒ **204** (Director tidak butuh mapping check).
20. **Lead/SPV divisi X — negatif beda divisi:** target staff divisi Y
    (Y≠X, tanpa layered role) ⇒ **403** yang sama (`division.String !=
    admin.Role.Division`, `local.go:270-272`).
21. **Staff biasa (bukan Lead/Director)** — coba `admin/set-password` APA PUN
    ⇒ **403** yang sama (gate awal `!admin.Role.Director && admin.Role.Level
    != LevelLead`, `local.go:195-197`) — ditolak sebelum query target apa pun.
22. **Siapa pun ber-otoritas (Director/Lead sah)** — `employee_id` target
    TIDAK ada di `employees` ⇒ **404** `[karyawan tidak ditemukan]`
    (`ErrEmployeeNotFound`, `local.go:204-206`, `auth_handlers.go:151`).
23. **Validasi field** — `admin/set-password` body kosong ⇒ **400**
    `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`;
    `temp_password` < 8 / > 72 byte ⇒ **400** pesan panjang yang sama dengan
    change-password (satu `validatePassword` dipakai ulang, `local.go:47`).
24. **Verifikasi reset memulihkan akses:** setelah admin set-password ke target
    yang SEDANG terkunci (skenario G/H), `failed_attempts` dan `locked_until`
    ikut ter-reset oleh `ON DUPLICATE KEY UPDATE …failed_attempts = 0,
    locked_until = NULL` (`local.go:227-231`) — target bisa login lagi
    (dengan password temporer baru) meski sebelumnya 423.

---

## G. Lockout via login

25. **Aktor** — 4× berturut-turut `POST /api/v1/auth/login` dengan password
    SALAH ⇒ tiap percobaan **401** `[email atau password salah]`
    (`registerFailure`, `local.go:117-133`, counter naik 1→2→3→4).
26. **Aktor** — percobaan ke-**5** (masih password salah) ⇒ **401** yang SAMA
    `[email atau password salah]` (respons gagal ke-5 tetap mismatch message,
    BUKAN 423) — TAPI di baliknya `registerFailure` mendeteksi
    `next >= MaxFailedAttempts` (5) dan MEMASANG `locked_until = NOW()+15
    menit` + reset counter ke 0 + audit `account_locked`
    (`after_json={"lock_minutes":15}`, `local.go:118-128`) — lock terpasang
    SETELAH respons ke-5 dikirim secara efektif (efek sampingnya sudah di DB
    saat klien menerima 401 itu).
27. **Aktor** — percobaan ke-**6**, dengan password **BENAR sekalipun** ⇒
    **423** `[akun terkunci sementara karena percobaan gagal berulang, coba
    lagi dalam 15 menit]` (`ErrLocked`, dicek SEBELUM verifikasi hash,
    `local.go:93-96`, `auth_handlers.go:55-56`) — password benar tidak
    membantu selama window terkunci.
28. **Pemulihan (a) — tunggu 15 menit:** setelah `locked_until` lewat, login
    dengan password benar ⇒ **200** normal (lock check `lockedUntil.Time.
    After(time.Now())` sudah false, `local.go:94`); counter+lock ikut
    ter-reset oleh jalur sukses (`local.go:106-110`).
29. **Pemulihan (b) — reset admin:** selama masih terkunci, Director/Lead
    berwenang `POST /api/v1/auth/admin/set-password` untuk aktor tsb ⇒
    kredensial baru + `locked_until=NULL` + `failed_attempts=0` (langkah 24)
    ⇒ login (dengan password temporer BARU) langsung 200 tanpa menunggu 15
    menit.

---

## H. Lockout via change-password (perilaku baru — shared counter)

> Latar: sebelum perubahan ini, `change-password` TIDAK ikut lockout —
> pemegang sesi curian (cookie valid, tidak tahu password lama) bisa
> brute-force `old_password` tanpa pernah terkunci. Lihat `docs/DECISIONS.md`
> entri 2026-07-19 (follow-up rekomendasi QC, `HANDOFF_SESSION_20260719_AUTH.md`
> §4 butir 3). Counter `failed_attempts` di sini adalah KOLOM YANG SAMA
> (`employee_credentials.failed_attempts`) dengan yang dipakai login §G — gagal
> di satu jalur menaikkan counter yang juga dibaca jalur lain
> (`local.go:138-142`).

30. **Aktor authenticated (sesi valid)** — 4× berturut-turut
    `POST /auth/change-password` dengan `old_password` SALAH (`new_password`
    apa pun yang valid-format) ⇒ tiap percobaan **401**
    `[password lama tidak sesuai]` (`local.go:162-167`, counter naik 1→2→3→4
    — SAMA kolom dengan login).
31. **Aktor sama** — percobaan ke-**5** (`old_password` masih salah) ⇒ **401**
    `[password lama tidak sesuai]` yang SAMA (bukan 423 di respons ini) — tapi
    `registerFailure` memasang lock (identik langkah 26): `locked_until =
    NOW()+15 menit`, counter reset 0, audit `account_locked`.
32. **Aktor sama** — percobaan ke-**6** `POST /auth/change-password`, kali ini
    `old_password` **BENAR** ⇒ tetap **423**
    `[akun terkunci sementara karena percobaan gagal berulang, coba lagi
    dalam 15 menit]` (lock dicek SEBELUM `bcrypt.CompareHashAndPassword`,
    `local.go:158-161`, `auth_handlers.go:121-122`) — password lama yang benar
    tidak membantu selama window terkunci, PERSIS pola login.
33. **Verifikasi silang counter shared:** ulangi langkah 30-31 tapi CAMPUR
    jalur gagal — mis. 2× gagal di `login` lalu 3× gagal di `change-password`
    (atau sebaliknya) — total 5 kegagalan lintas dua endpoint TETAP memicu
    lock di percobaan ke-5, membuktikan satu counter dipakai bersama, bukan
    dua counter independen.
34. **Login DITOLAK juga selama window ini:** selagi masih terkunci
    (langkah 32), `POST /api/v1/auth/login` dengan password BENAR ⇒ **423**
    yang sama (lock adalah properti akun, dicek di kedua endpoint — bukti
    lockout benar-benar shared, bukan hanya "counter shared tapi enforcement
    terpisah").
35. **Pemulihan:** sama seperti §G — tunggu 15 menit (login/change-password
    lolos normal setelahnya) ATAU admin/Director `set-password` (langkah 29)
    memulihkan segera (`locked_until=NULL`, `failed_attempts=0`).

---

## I. Karyawan dinonaktifkan di HRIS → sync → akses dicabut

36. **Dev** — pilih satu karyawan aktif ber-kredensial DAN sesi login hidup
    (login dulu, simpan cookie). Ubah `status_aktif` karyawan itu jadi 0 di
    sumber HRIS/CSV (`internal/hris/sync.go`), lalu jalankan sync ulang
    (`cmd/cdps` sync cycle atau trigger manual sesuai pola boot W2/W3).
    ✔ sync mendeteksi transisi aktif→nonaktif (`priorActive` dibanding baru,
    `sync.go:47`) ⇒ **REVOKE semua sesi karyawan itu**
    (`UPDATE sessions SET revoked_at=…`, `sync.go:67`) + audit
    `hris_sync:deactivated` (`sync.go:76`).
37. **Sesi lama (sebelum deactivate)** — panggil endpoint protected APA PUN
    ⇒ **401** (`[sesi tidak valid, silahkan login kembali]` — sesi sudah
    revoked).
38. **Login baru** dengan email karyawan nonaktif itu ⇒ **401**
    `[email atau password salah]` (query awal `VerifyLocal` menolak baris
    `status_aktif=0` dengan pesan generik yang sama seperti email tak
    terdaftar — TIDAK ada pembocoran status akun, `local.go:64-71`).

---

## J. Audit immutable + panel admin kosong

39. **Director/Lead berwenang (OD bila tersedia, read-only)** — telusuri
    audit log seluruh skenario A-I: `password_set_admin` (bootstrap CLI DAN
    admin endpoint), `password_changed_self`, `account_locked` (dari kedua
    jalur login & change-password), `hris_sync:deactivated`. ✔ tiga aksi
    pertama ber-`entity_type=employee_credential`; `hris_sync:deactivated`
    ber-`entity_type=employee` (ditulis jalur sync, `sync.go:74-77`). Actor
    tercatat (`CLI-BOOTSTRAP` untuk bootstrap, employee_id admin untuk
    set-password, employee_id sendiri untuk self-change, actor sync untuk
    deactivation), `after_json` TIDAK PERNAH memuat `password_hash`
    atau plaintext password (hanya flag/metadata seperti
    `{"must_change_password":true}`, `{"lock_minutes":15}`) — konsisten house
    rule #3 (immutable, append-only, tanpa materi rahasia).
40. **Director/Lead** — `GET /api/v1/auth/admin/credentials` di stack yang
    BELUM punya roster (atau filter kosong bila API mendukung) ⇒ **200**
    `{"data":[]}` — array kosong `[]`, BUKAN `null` (kontrak `PROMPT_UI_AUTH.md`
    §2.6). Dengan roster terisi ⇒ tiap baris `has_password` (boolean dari
    `password_hash IS NOT NULL`), `must_change_password`, `locked_until`
    (ISO8601 atau null), `password_changed_at` (ISO8601 atau null) —
    cocokkan dengan state DB aktual pasca skenario D/G/H.
41. **Staff biasa** — `GET /api/v1/auth/admin/credentials` ⇒ **403**
    `[anda tidak memiliki akses untuk mengatur password karyawan ini]`
    (scope sama dengan set-password — non-Director & non-Lead, atau Lead
    tanpa divisi valid).

---

## K. Penutup — Go/No-Go

42. **Nerissa/Yohan + head dev** — putuskan go/no-go jalur auth (pola langkah
    penutup W1/W2/W3); catat hasil + temuan (termasuk SKIP terdokumentasi bila
    ada, mis. menunggu 15 menit riil untuk pemulihan lock vs manipulasi jam
    sistem/`locked_until` langsung di DB test) di `docs/DECISIONS.md`.
    **Catatan wajib dibawa:** (1) lockout change-password (skenario H) adalah
    perilaku BARU sesi 2026-07-19 lanjutan, sebelumnya endpoint ini tidak ikut
    lockout — pastikan versi kode yang diuji sudah termasuk perubahan ini
    (`internal/auth/local.go` fungsi `ChangePassword` memanggil
    `registerFailure` pada `old_password` mismatch); (2) O26/O33/O34 (fixture
    Director/Finance/divisi tanpa lead riil, lihat `docs/DECISIONS.md`) masih
    relevan bila runbook ini dijalankan di stack UAT fixture, bukan produksi
    riil — pilih aktor Lead/Director sesuai roster yang tersedia di stack
    yang dipakai.
