# HANDOFF — M15-C2 auth realm cluster SELESAI (PR #261); Supabase push BELUM dilakukan

> Ditulis 2026-08-31. Sesi ini menutup O4/O5 (dokumentasi), lalu membangun
> klaster auth Client Portal penuh (migrasi, domain, API, admin UI internal,
> app `web-client-portal` baru), membuka **PR #261**, dan menemukan bahwa
> **tiga migrasi terbaru di repo — termasuk LT-61 dari sesi sebelumnya —
> belum pernah diterapkan ke Supabase live**. **Baca §0 dan §2 dulu.**

## 0. Sebelum mulai kerja: cek keadaan repo dan PR dulu

1. `git fetch origin main && git log --oneline -5` — kalau PR #261 sudah
   di-merge, `main` akan memuat commit klaster auth M15-C2 + merge commit.
2. `mcp__github__pull_request_read(method: "get", pullNumber: 261)` — cek
   status. Kalau sesi ini berakhir sebelum merge selesai, lihat §1.
3. `mcp__github__list_pull_requests(state: "open")` — cek PR lain yang
   berjalan paralel (pola insiden dua-sesi-paralel pernah terjadi di repo
   ini — `DECISIONS.md` 2026-08-30 "Kinerja Sales #7").

## 1. Status PR #261

`https://github.com/MEAgrup/AgencyAPP/pull/261` — branch
`claude/vendor-admin-ui-handoff-qkv5ws` → `main`. Dua commit:
1. `docs: M15-C2 Client Portal — close O4+O5, revise security spec`
2. `feat(m15-c2): Client Portal auth realm — login, force-change,
   self-service reset, admin provisioning`

CI (`db-and-migrations`, `backend`, `api`, `core-engines`, `web-internal`,
`web-client-portal`) dipicu otomatis saat PR dibuka. Kalau sesi ini
berakhir sebelum semua job selesai/di-merge: cek
`pull_request_read(method: "get_check_runs")`, merge kalau semua hijau
(`mcp__github__merge_pull_request`), diagnosis dulu kalau ada yang merah
(lihat aturan "drive to green" di system prompt).

## 2. 🔴 TEMUAN PENTING — tiga migrasi belum diterapkan ke Supabase live

Dicek langsung via `mcp__Supabase__list_migrations` project `CDPS SG`
(`egddxfcnrtecheiykhlf`) sesi ini: migrasi TERAKHIR yang tercatat diterapkan
ke live adalah `20260902040000_fix_import_employee_credentials_email_change`.

**Belum diterapkan ke live sama sekali:**
- `20260903010000_lt61_vendor_auth.sql` (sesi SEBELUMNYA — realm vendor LT-61)
- `20260904010000_lt61_vendor_account_admin_ui.sql` (sesi sebelumnya — admin
  UI provisioning vendor, PR #260 sudah di-merge ke `main`)
- `20260905010000_m15c2_client_portal_auth.sql` (sesi INI)
- `20260905020000_m15c2_client_contact_account_admin_ui.sql` (sesi ini)

**Konsekuensi konkret:** fitur "Akun Vendor" (`/admin/vendor-accounts`, dari
PR #260 yang SUDAH live di `main`/Vercel) kemungkinan besar **tidak
berfungsi di produksi saat ini** — halamannya akan memuat, tapi setiap
panggilan yang menyentuh `vendor_accounts`/`custom_access_token_hook`
cabang vendor akan gagal karena tabelnya belum ada di database live. Sama
untuk seluruh Client Portal auth (login klien, admin UI Kontak Klien) yang
baru dibangun sesi ini — kodenya sudah di `main` (setelah PR #261 merge),
tapi **tidak berfungsi sampai migrasi diterapkan**.

**Pemilik bertanya sesi ini apakah Supabase push diperlukan — JAWABANNYA:
YA, dan belum dilakukan.** Ini bukan sesuatu yang otomatis terjadi saat
`git push`/merge ke `main` — repo ini TIDAK punya job CI/CD yang menjalankan
`supabase db push` otomatis (dicek: nol referensi ke `db push` atau
`SUPABASE_ACCESS_TOKEN` di `.github/workflows/*.yml`). Migrasi hanya masuk
ke live lewat langkah manual terpisah: CLI `supabase db push` atau tool
`mcp__Supabase__apply_migration` satu per satu.

**Sengaja TIDAK dijalankan sesi ini** — ini perubahan ke database produksi
yang sedang melayani data karyawan/klien riil (`CDPS SG`, `ACTIVE_HEALTHY`),
dan pemilik hanya meminta *informasi*, bukan eksekusi. Urutan yang benar
kalau pemilik mau melanjutkan:

1. Terapkan keempat migrasi di atas **urut sesuai timestamp** (LT-61 dulu,
   baru M15-C2) ke `CDPS SG`, via `mcp__Supabase__apply_migration` (satu
   panggilan per file, isi `name`+`query` dari file `.sql`-nya) ATAU CLI
   `supabase db push` kalau project sudah di-link lokal.
2. Verifikasi pasca-apply: `select count(*) from information_schema.tables
   where table_schema='public'` harus **135** (sama seperti gate CI/lokal).
3. Smoke-test login vendor (kalau sudah ada akun terprovisi) dan — setelah
   ada kontak klien yang diprovisikan lewat `/admin/client-contacts` —
   login Client Portal.
4. **Gate manusia yang SUDAH dicatat migrasi `20260723071013` dan masih
   berlaku**: pastikan `custom_access_token_hook` di Supabase Dashboard →
   Auth → Hooks masih menunjuk fungsi yang sama (migrasi ini
   `CREATE OR REPLACE`-nya, jadi hook yang sudah aktif otomatis memakai
   versi baru — tidak perlu re-pilih di dashboard, tapi worth diverifikasi
   sekali).

Kalau pemilik minta sesi berikutnya push ke Supabase: baca urutan di atas,
konfirmasi dengan pemilik sebelum eksekusi (ini tindakan ke sistem
produksi bersama), lalu jalankan.

## 3. Apa yang SUDAH selesai sesi ini (kode, di PR #261)

Ringkasan penuh ada di deskripsi PR #261 dan `docs/DECISIONS.md` (dua entri
2026-08-31: "O4 dan O5 RESOLVED" dan "auth realm cluster BUILT"). Poin
kunci:

- `client_contacts` — realm auth non-HRIS **ketiga** (setelah karyawan-lokal
  dan vendor LT-61), multi-kontak per Client, `must_change_password` gate
  nyata (vendor tidak pernah punya ini).
- Login/ganti-password/`/client-portal/me` di `apps/api`; admin provisioning
  di `web-internal/admin/client-contacts`; app baru `web-client-portal`
  (login, force-change **yang benar-benar menahan halaman lain**,
  lupa/reset password self-service).
- **Koreksi ditemukan saat implementasi**: draft OQ-10 bilang "reuse lockout
  karyawan 5x/15menit" — ternyata realm karyawan SUDAH TIDAK punya lockout
  kustom sejak migrasi Supabase Auth (GoTrue yang pegang). Client Portal
  mengikuti arsitektur yang sungguhan ada, bukan draft usang. Dicatat
  `DECISIONS.md` + spec.
- Full suite hijau: `core` 296, `db` 53, `domain` 1661+1 skip (25 test baru),
  `api` 380+7 skip, `web-internal` 390. `db-rebuild.sh` 160 migrasi, gate
  135/37/30/67.

## 4. Yang BELUM selesai — dicatat eksplisit, bukan disembunyikan

Semua ini adalah keputusan yang SUDAH diambil pemilik (spec RESOLVED) tapi
implementasinya belum ditulis — task follow-up yang jelas, bukan open
question baru:

1. **Rate limiting per-IP** (login 10/IP/15menit, form komplain
   5/kontak/jam + 20/IP/jam, spec §5.2 OQ-5) — kodenya belum ada.
2. **Session TTL 4 jam idle** (spec §3.5) — Portal saat ini masih pakai
   default project-wide GoTrue (sama seperti realm lain), belum ada
   mekanisme idle-timeout sendiri di `web-client-portal`.
3. **SMTP + redirect URL Supabase project** — prasyarat infra murni
   (Dashboard → Auth) supaya jalur "lupa password" self-service (kode sudah
   ada, `POST /auth/client-portal/forgot-password` + `/reset-password`)
   benar-benar mengirim email. Di luar jangkauan repo/CLI.
4. **Parity-guard gap**: `route-parity.test.ts`/`shape-parity.test.ts`/
   `body-parity.test.ts` (`apps/api/src/lib/`) hanya memindai
   `web-internal/src` — panggilan endpoint milik `web-client-portal` sendiri
   TIDAK tercakup mekanisme itu. Kelas cacat sama yang O43 catat, permukaan
   baru belum ditutup. Perlu perluasan `parity-scan.ts` (`FE_SRC` jadi
   multi-root) kalau mau ditutup — cukup rumit untuk sesi tersendiri.
5. **Deploy `web-client-portal` — DIKONFIRMASI BELUM ADA.** PR #261
   membuktikan app-nya build bersih (`next build`, CI job `web-client-portal`
   hijau), tapi dicek langsung sesi ini (`mcp__Vercel__list_projects`, team
   `meagency`): hanya `web-internal-mea` dan `agency-app-api` yang terhubung
   ke repo ini. **Nol project Vercel untuk `web-client-portal`** — app-nya
   hidup di CI saja, tidak bisa diakses siapa pun sampai dibuatkan project
   baru (link ke repo ini, root directory `web-client-portal`) + env var
   (`BACKEND_URL` ke `agency-app-api`, `SUPABASE_JWT_SECRET`/`SUPABASE_JWT_PUBLIC_JWK`
   kalau route mana pun butuhnya langsung — cek yang dipakai `web-internal-mea`
   sebagai referensi). Prasyarat sebelum siapa pun bisa login ke Client
   Portal sungguhan.
6. **Surface data Client Portal** (Service Progress, Health Summary,
   embedded report, complaint form) — SAMA SEKALI belum disentuh. Klaster
   berikutnya per roadmap spec §7. `(portal)/page.tsx` masih halaman
   placeholder.
7. **OQ-8** (mekanisme token pass-through ke `mea-client-reporting`) masih
   terbuka — butuh koordinasi dengan pemilik sistem laporan itu, bukan
   blocker klaster lain.

## 5. Rekomendasi task berikutnya

Urutan yang masuk akal (tidak wajib linear, pemilik bisa reprioritaskan):

1. **Kalau pemilik minta**: push 4 migrasi tertunda ke `CDPS SG` (§2),
   verifikasi smoke-test.
2. Cek/rapikan deploy `web-client-portal` ke Vercel (§4 butir 5) — tanpa ini
   app baru cuma hidup di CI, tidak bisa diakses siapa pun.
3. Rate limiting per-IP (§4 butir 1) — kecil, murni app-level, tidak
   menunggu apa pun.
4. Session TTL 4 jam (§4 butir 2) — juga app-level, kecil.
5. Klaster Service Progress/Health Summary (surface data pertama yang
   sungguhan berguna bagi klien) — baca `docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md`
   §4.2 (allow-list field) sebelum mulai.
6. O4/OQ-8 (token pass-through embed) — paralel, tidak menunggu #5.

## 6. Berkas rujukan

| Berkas | Untuk apa |
|---|---|
| PR #261 | Diff lengkap klaster auth M15-C2 |
| `docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md` | Spec final (RESOLVED), termasuk koreksi OQ-10 dan status implementasi tiap OQ |
| `docs/DECISIONS.md` — cari "2026-08-31" | Dua entri: closing O4/O5, dan "auth realm cluster BUILT" (detail temuan lockout) |
| `packages/domain/src/client-portal-auth.ts` | Domain module realm auth Client Portal — mulai di sini untuk memahami gate per-Client |
| `supabase/migrations/20260905010000_*.sql` + `20260905020000_*.sql` | Migrasi yang BELUM diterapkan ke live (§2) |
| `web-client-portal/README.md` | Status app baru + daftar gap yang sama seperti §4 di sini |
| `apps/api/src/lib/parity-scan.ts` | Kalau mau menutup gap parity-guard (§4 butir 4) |
