# HANDOFF — LT-61 core SELESAI (backend + auth realm), FE vendor BELUM — mulai dari sini

> Ditulis 2026-08-30/31. Sesi ini menyelesaikan LT-61 core (lihat §1) dan
> membuka **PR #257**. **Baca §0 dulu** sebelum menyentuh apa pun — ada
> pekerjaan paralel dari sesi lain di repo ini, dan riwayatnya sudah pernah
> menabrak (lihat §0.2).

## 0. Sebelum mulai kerja: cek keadaan repo dulu

### 0.1 Status PR #257 (pekerjaan sesi ini)

Sesi ini membuka `https://github.com/MEAgrup/AgencyAPP/pull/257` dari branch
`claude/baca-handoff-lanjutkan-task-2jxe5m` ke `main`, dan **men-subscribe
PR activity** supaya CI/review event masuk otomatis ke sesi ini. Sesi ini
BERNIAT menunggu CI hijau lalu merge sendiri — tapi kalau sesi berikutnya
mulai SEBELUM itu selesai (mis. sesi diteruskan lebih cepat dari CI):

```
mcp__github__pull_request_read(method: "get", owner: "MEAgrup", repo: "AgencyAPP", pullNumber: 257)
```

- **Kalau sudah `merged`**: bagus, lanjut dari `main` langsung (`git pull origin main`).
- **Kalau masih `open`**: cek CI (`get_check_runs`). Kalau hijau semua dan tidak ada
  percakapan review yang butuh jawaban, boleh langsung merge
  (`mcp__github__merge_pull_request`). Kalau merah, root-cause dulu — tapi
  kemungkinan besar sudah dibuktikan hijau lokal (lihat §1, "Full suite
  hijau"), jadi kalau CI merah di PR itu kemungkinan flake infra atau state
  DB CI yang beda dari lokal, bukan bug baru.
- **Kalau ternyata sudah di-close TANPA merge** oleh siapa pun (manusia atau
  sesi lain) — JANGAN buka ulang begitu saja. Baca kenapa (komentar PR),
  karena itu persis pola insiden §0.2 di bawah.

### 0.2 ⚠️ Preseden: dua sesi paralel PERNAH membangun ulang fitur yang sama tanpa sadar

`docs/DECISIONS.md` 2026-08-30 "Kinerja Sales #7" mencatat: sesi
`claude/detail-plan-pending-work-4bkonu` (PR #256) membangun ULANG seluruh
fitur Kinerja Sales + Renewal secara independen, dengan desain BERBEDA dari
PR #255 yang sudah lebih dulu merged — dua sesi sama-sama jalan dari titik
mulai yang sudah basi tanpa saling tahu. Baru ketahuan saat mau di-merge.
Pemilik terpaksa memutuskan satu dibuang.

**Pelajaran untuk sesi ini:** SEBELUM mulai kerja FE vendor:
1. `git fetch origin main` dan baca 10-15 commit terakhir — jangan asumsikan
   posisi `main` masih sama dengan yang tertulis di handoff ini.
2. Cek `mcp__github__list_pull_requests(state: "open")` — kalau ada PR lain
   yang menyentuh `livestream.ts`, `permission.ts`, `vendor_accounts`, atau
   apa pun berbau "vendor"/"LT-61", STOP dan baca PR itu dulu sebelum
   menulis kode yang mungkin duplikat.
3. Cek `docs/DECISIONS.md` bagian atas (Decided terbaru) — kalau ada entri
   baru soal vendor/LT-61 yang bukan dari sesi ini, itu tandanya ada sesi
   lain yang sudah jalan di area yang sama.

## 1. Apa yang SUDAH selesai (LT-61 core) — jangan dikerjakan ulang

**Backend LT-61 (realm auth vendor + gate tulis/baca) sudah selesai dan
teruji penuh**, di-push ke PR #257 (commit `d8cc372`, `cbd1d54`,
`e3ea32a` di branch `claude/baca-handoff-lanjutkan-task-2jxe5m`):

- Migrasi `supabase/migrations/20260903010000_lt61_vendor_auth.sql` —
  `vendor_accounts`, cabang baru `custom_access_token_hook`,
  `jwt_vendor_id()`, `live_stream_sessions_select` diperluas.
- `packages/core/src/permission.ts` — `Actor.vendorId`, `isVendorActor`,
  `actorFromVendorClaims`.
- `packages/domain/src/livestream.ts` — `canVendorWriteSession`,
  `resolveLiveVendorId`, `createSession`/`confirmByVendor`/`logResults`
  bisa dijalankan vendor (additive, TIDAK PERNAH `reconcile`/`flagDiscrepancy`).
- `apps/api/src/lib/auth.ts`/`db.ts` — `requireActor`/`actorClaims` sudah
  bisa resolve token vendor (coba employee dulu, fallback ke vendor).
- Route baru `GET /api/v1/vendor/sessions`.
- Wire + FE type (`SessionWire.vendor_id`, `web-internal` `Session.vendor_id`)
  — HANYA field, BUKAN halaman.
- Test lengkap: `livestream.test.ts` "LT-61: vendor self-service" (6 kasus)
  + `permission.test.ts`. Full suite hijau: core 293, db 53, domain 1617,
  api 383, web-internal 379; `db-rebuild.sh --yes` 156 migrasi, gate 134
  tabel/37 prefix/30 mesin/67 event, 4 invariant lolos.

**Spec lengkap + rasional desain:** `docs/prd/CDPS_Module10_Addendum_LT61_Vendor_Portal_Spec.md`
(status: IMPLEMENTED core). **Keputusan pemilik (2 putaran AskUserQuestion):**
`docs/DECISIONS.md` — cari "LT-61 SELESAI (core)" dan baris 2026-08-30
sebelumnya. **Ringkasan cakupan tulis vendor:** `createSession` (vendor
sendiri yang bikin jadwal) + `confirmByVendor` + `logResults` — additive ke
jalur AM/Direksi, TIDAK PERNAH `reconcile`/`flagDiscrepancy`.

**Kalau ada keraguan soal desain LT-61 core** (mis. mau audit ulang gate-nya),
itu task TERPISAH — jangan menulis ulang `canVendorWriteSession`/
`resolveLiveVendorId`/cabang hook dari nol tanpa alasan baru.

## 2. Temuan konkret yang PERLU diketahui sebelum mulai FE vendor

**Login vendor lewat endpoint yang ADA HARI INI akan GAGAL**, meskipun
auth/claims-nya sudah benar. Sudah ditelusuri sampai baris kodenya:

`apps/api/src/app/api/v1/auth/login/route.ts` (`POST /api/v1/auth/login`) —
alurnya: `passwordGrant` (GoTrue) → `actorFromToken` (SEKARANG sudah bisa
resolve vendor, berkat fallback LT-61) → **`auth.getMe(sql, actor)`**
(`packages/domain/src/auth.ts:54-63`) yang query `select ... from employees
where employee_id = actor.employeeId`. Untuk vendor, `actor.employeeId`
berisi `vendors.id` (mis. "VND-...") — baris itu TIDAK ADA di `employees`,
jadi `getMe` melempar `NotFoundError`, dan route ini menerjemahkannya jadi
`401 [sesi tidak valid, silahkan login kembali]`.

**Artinya:** vendor dengan password yang BENAR tetap akan ditolak kalau
FE vendor memakai route login yang sama apa adanya. Ini bukan bug LT-61 core
(di luar cakupan spec yang disetujui — spec eksplisit tidak menjanjikan FE),
tapi WAJIB diperbaiki sebagai bagian pertama pekerjaan FE vendor. Dua opsi:
(a) cabang di route yang sama: kalau `permission.isVendorActor(actor)`,
lewati `auth.getMe` dan kembalikan profil vendor (nama vendor, dari tabel
`vendors`) alih-alih `Me` karyawan; (b) route terpisah
`POST /api/v1/vendor/auth/login`. Belum diputuskan yang mana — lihat §3.

## 3. Task berikutnya: FE vendor — TANYAKAN dulu ke pemilik sebelum membangun

Mengikuti pola PERSIS yang dipakai sepanjang LT-60/LT-61 (jangan menebak
keputusan produk/UX, tanyakan lewat `AskUserQuestion`), pertanyaan yang
BELUM terjawab dan menentukan bentuk FE:

1. **FE vendor tinggal di mana?** Opsi: (a) app Next.js baru terpisah
   (mirip pola `web-client-portal` yang juga masih kosong — realm auth
   benar-benar terpisah dari `web-internal`), atau (b) satu route group baru
   di `web-internal` dengan layout/auth berbeda (lebih murah, tapi harus
   hati-hati supaya token vendor TIDAK PERNAH bisa menyentuh halaman
   internal manapun — cek proteksi route/middleware). Belum ada preseden
   nyata untuk vendor secara spesifik; `web-client-portal/README.md` adalah
   kontrak desain terdekat (untuk Client Portal, bukan vendor, tapi
   prinsipnya sama: realm terpisah).
2. **Cakupan halaman minimum**: login, daftar Session milik vendor (pakai
   `GET /api/v1/vendor/sessions` yang sudah ada), detail satu Session +
   form buat jadwal baru (`POST /briefs/{id}/sessions`, vendor perlu tahu
   Brief id-nya — BELUM ada endpoint "daftar Brief milik vendor", cuma ada
   "daftar Session milik vendor"), form konfirmasi jadwal, form isi hasil.
   Perlu diputuskan urutan MVP-nya (semua sekaligus, atau login+lihat dulu
   baru form berikutnya).
3. **Rate limiting login** (syarat minimum spec §5, belum dibangun karena
   belum ada halaman login) — mekanisme apa: batas di level route API
   (in-memory/DB counter) atau serahkan ke Supabase Auth bawaan?
4. **Perbaikan `auth.getMe`/route login** (§2 di atas) — cabang di route yang
   sama, atau route terpisah?

**Rekomendasi urutan kerja sesi berikutnya:**
1. Kerjakan §0 dulu (cek keadaan repo, PR, parallel work).
2. Ajukan keempat pertanyaan §3 lewat `AskUserQuestion` SEBELUM menulis kode
   FE apa pun — ini yang menentukan struktur app/folder, jadi salah tebak di
   sini mahal untuk diperbaiki belakangan.
3. Perbaiki dulu temuan §2 (login vendor gagal) — ini blocker teknis nyata,
   bukan sekadar "belum dibangun": tanpa ini, FE vendor tidak bisa login
   sama sekali walau semua halamannya sudah jadi.
4. Baru bangun FE sesuai jawaban §3.

## 4. Belum dibangun sama sekali (di luar FE, dicatat supaya tidak lupa)

- Admin UI provisioning akun vendor (sekarang manual insert ke
  `vendor_accounts` — sengaja, spec §7).
- Kasus multi-vendor-per-klien (`resolveLiveVendorId` ambil satu vendor
  paling baru kalau ada lebih dari satu pilar `live` — keterbatasan
  terdokumentasi, spec §2).

## 5. Berkas rujukan

| Berkas | Untuk apa |
|---|---|
| `docs/prd/CDPS_Module10_Addendum_LT61_Vendor_Portal_Spec.md` | Spec lengkap LT-61, status IMPLEMENTED (core), §8 daftar yang belum dibangun |
| `docs/DECISIONS.md` — cari "LT-61 SELESAI (core)" | Rasional desain implementasi (kenapa reuse `permission.Actor`, kenapa `allowVendor` per-edge, dst.) |
| `docs/backlog/LEADTIME_BACKLOG.md` Fase 5b (LT-61) | Ringkasan status ticket |
| `packages/domain/src/livestream.ts` | `canVendorWriteSession`, `resolveLiveVendorId`, `edge()` `allowVendor`, `listVendorSessions` |
| `packages/domain/src/livestream.test.ts` | Suite "LT-61: vendor self-service" — pola fixture (`seedLiveVendor`, `vendorActor`) untuk dipakai ulang test FE/API baru |
| `packages/core/src/permission.ts` | `Actor.vendorId`, `isVendorActor`, `actorFromVendorClaims` |
| `apps/api/src/lib/auth.ts` | `requireActor` fallback vendor — DAN §2 temuan `auth.getMe` yang belum kompatibel |
| `apps/api/src/app/api/v1/vendor/sessions/route.ts` | Satu-satunya route vendor yang sudah ada hari ini |
| `web-client-portal/README.md` | Kontrak desain realm terpisah yang sudah disepakati (preseden desain terdekat untuk pertanyaan §3.1) |
| PR #257 (`https://github.com/MEAgrup/AgencyAPP/pull/257`) | Diff lengkap LT-61 core, status merge — cek §0.1 |
