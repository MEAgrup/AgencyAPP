# HANDOFF — LT-61 FE SELESAI (M16 Fase 5 tuntas); backlog dikenal HABIS — cek pemilik dulu

> Ditulis 2026-08-30. Sesi ini menuntaskan LT-61 (backend core dari sesi
> sebelumnya + FE vendor baru), menemukan dan memperbaiki dua cacat nyata di
> jalan, dan men-**merge PR #258** ke `main`. **Baca §0 dulu.**

## 0. Sebelum mulai kerja: cek keadaan repo dulu

1. `git fetch origin main && git log --oneline -10` — pastikan posisi `main`
   masih seperti yang tertulis di sini (`68b2c68`, merge PR #258). Jangan
   asumsikan tanpa cek — pola insiden dua-sesi-paralel PERNAH terjadi di repo
   ini (`DECISIONS.md` 2026-08-30 "Kinerja Sales #7": dua sesi membangun ulang
   fitur yang sama tanpa saling tahu).
2. `mcp__github__list_pull_requests(state: "open")` — kalau ada PR lain yang
   sedang berjalan, baca dulu sebelum menulis kode yang mungkin tumpang tindih.
3. **§3 di bawah ini penting:** sepengetahuan sesi ini, HAMPIR SELURUH backlog
   yang tercatat (M0–M17, Wave 1–3) sudah selesai atau diblokir keputusan
   pemilik — bukan diblokir kode. Jangan mulai "mencari kerjaan" dengan
   menebak-nebak; tanyakan ke pemilik lebih dulu (lihat §3).

## 1. Apa yang SUDAH selesai sesi ini (LT-61 FE) — jangan dikerjakan ulang

Melanjutkan `docs/handoff/HANDOFF_LT61_CORE_SELESAI_FE_VENDOR_20260830.md`
(backend LT-61 core, PR #257, sudah di-merge duluan oleh sesi ini setelah CI
hijau). Sesi ini menjawab keempat pertanyaan §3 handoff itu lewat
`AskUserQuestion`, lalu membangun dan men-**merge PR #258**
(`https://github.com/MEAgrup/AgencyAPP/pull/258`, sha merge `68b2c68`):

1. **Lokasi FE:** route group baru `/vendor` di `web-internal` (bukan app
   Next.js terpisah).
2. **Cakupan MVP:** semua sekaligus — login, daftar Session
   (`/vendor`), buat jadwal baru (`/vendor/sessions/new`), konfirmasi + catat
   hasil (`/vendor/sessions/[id]`).
3. **Rate limiting login:** diserahkan ke default Supabase Auth, nol
   mekanisme baru di CDPS.
4. **Perbaikan blocker login:** cabang di route yang sama.

**Yang dibangun:**
- **Fix blocker (§2 handoff sumber):** `POST /auth/login` bercabang pada
  `permission.isVendorActor(actor)` SEBELUM memanggil `auth.getMe` (yang
  selalu query `employees` — untuk vendor Actor, `employeeId` berisi
  `vendors.id`, baris yang tidak ada di tabel itu, jadi sebelumnya vendor
  dengan password BENAR tetap 401). `auth.getVendorMe` baru (sengaja sempit —
  TIDAK PERNAH mengirim `vendors.catatan_kinerja`) melayani cabang login dan
  route baru `GET /vendor/me`.
- **Celah discovery ditutup:** `livestream.listVendorBriefs` + route baru
  `GET /vendor/briefs` — vendor sebelumnya hanya punya `GET /vendor/sessions`
  (Session miliknya) tapi nol cara tahu Brief id untuk bikin Session baru.
  Memakai ulang `resolveLiveVendorId` (logika sama persis `createSession`)
  supaya daftar ini tidak pernah menawarkan Brief yang nanti ditolak.
- **🔴 Temuan RLS nyata, diperbaiki di PR yang sama:** `listVendorBriefs`
  menyentuh `briefs`/`services`/`clients`/`strategi`/`strategi_pillar` —
  KELIMA tabel itu ber-policy SELECT berbasis klaim KARYAWAN
  (`jwt_employee_id()`/`jwt_division()`/`jwt_is_lead()`), jadi lewat
  `readAsActor` (RLS sungguhan) hasilnya SELALU kosong untuk vendor manapun.
  Diperbaiki dengan pola preseden `recap.ts` (`DECISIONS.md` 2026-08-14): baca
  lewat `db()` (privileged), karena fungsinya sudah menggerbang penuh di TS.
  **Dibuktikan MERAH-lalu-HIJAU** lewat `withClaims` di `livestream.test.ts`,
  bukan diasumsikan. `GET /vendor/me` tetap `readAsActor` (`vendors_select`
  sudah `TO authenticated USING (true)`), juga dibuktikan lewat `withClaims`
  di `auth.test.ts`.
- **🔴 Temuan CI nyata KEDUA, tidak terkait LT-61, diperbaiki di commit
  terpisah:** `interview.test.ts` "counts WORKING days" gagal DUA KALI
  independen di CI (bukan flake — direproduksi identik). Root cause: fixture
  test itu menandai hari libur pakai `current_date` (UTC mentah), sedangkan
  `working_days_between`'s pemanggil sungguhan (`getKelolaKlienTimeline`)
  menghitung via `wib_date(now())` (WIB = UTC+7). Keduanya selisih 7 jam
  setiap hari (17:00–23:59 UTC = 00:00–06:59 WIB) — persis jendela waktu saat
  CI PR ini berjalan. Diperbaiki dengan mengganti `current_date` →
  `wib_date(now())` di fixture-nya saja (satu file test, nol kode produksi).
  Dibuktikan merah-lalu-hijau lokal pada jam yang sama persis dengan CI.
- **FE:** `web-internal/src/lib/vendor-auth-context.tsx` (realm auth
  TERPISAH penuh dari `auth-context.tsx` karyawan — endpoint `/vendor/me`
  sendiri, sessionStorage key sendiri), `app/vendor/layout.tsx` (guard +
  header minimal, TANPA Sidebar/Header internal), `login`/list/buat-jadwal/
  detail pages. Detail page vendor SENGAJA tidak memanggil `GET /briefs/{id}`
  seperti versi internal (gate Brief itu employee-only, akan 403 untuk
  vendor).

**Test baru:** `auth.test.ts` (+3, termasuk 1 di bawah RLS asli lewat
`withClaims`), `livestream.test.ts` (+6 `listVendorBriefs`, termasuk 1 yang
membuktikan celah RLS). Suite penuh hijau pada DB lokal yang dibangun ulang
dari 156 migrasi: core 293, db 53, domain 1620, api 383, web-internal 379.
Nol migrasi/tabel/prefix/mesin/event baru (134/37/30/67 TETAP). Detail penuh:
`docs/DECISIONS.md` 2026-08-30 "LT-61 SELESAI (core + FE)",
`docs/prd/CDPS_Module10_Addendum_LT61_Vendor_Portal_Spec.md` (status
IMPLEMENTED core+FE), `docs/backlog/LEADTIME_BACKLOG.md` Fase 5.

**Kalau ada keraguan soal desain LT-61** (core ATAU FE), itu task TERPISAH —
jangan menulis ulang tanpa alasan baru. M16 Fase 5 (Portal vendor Live) kini
**SELESAI PENUH**, keduanya (a) dan (b).

## 2. Cara verifikasi lokal (dipakai sesi ini, kemungkinan berguna lagi)

Sandbox ini punya Postgres 16 terpasang tapi mati secara default:
```
pg_ctlcluster 16 main start
bash scripts/db-rebuild.sh --yes        # DROP + rebuild dari nol, 156 migrasi
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
npm test --workspace=packages/core -- --reporter=dot
npm test --workspace=packages/db -- --reporter=dot
npm test --workspace=packages/domain -- --reporter=dot
npm test --workspace=apps/api -- --reporter=dot
cd web-internal && npm test -- --reporter=dot && npx tsc --noEmit -p tsconfig.json && npm run build
```
Ini membuka jalur verifikasi PENUH sebelum push — dipakai untuk menangkap
temuan RLS #1 di atas SEBELUM sempat sampai ke CI, dan untuk mereproduksi +
membuktikan perbaikan temuan CI #2. `db-and-migrations` di CI menjalankan
suite `domain` sekitar jam **17:00–23:59 UTC setiap hari** akan menabrak
jendela WIB yang sama dengan temuan #2 — kalau muncul lagi test lain yang
gagal hanya pada jam segitu, cek dulu pola `current_date` vs `wib_date(now())`
sebelum menyimpulkan flake.

## 3. Task berikutnya: TANYAKAN dulu ke pemilik — backlog dikenal HABIS

Berbeda dari handoff-handoff sebelumnya (yang selalu punya satu tiket
berikutnya jelas), sesi ini men-survei tiga dokumen status utama dan
KETIGANYA melaporkan "selesai kecuali menunggu pemilik":

1. **`docs/backlog/LEADTIME_BACKLOG.md`** (M16+M17) — Fase 0–5 ✅ SELESAI
   PENUH (LT-61 menutup Fase 5 sesi ini). Fase 6 (LT-1..LT-11) 🟡 BERJALAN:
   LT-1/3/4/5/10/11 sudah terpasang/dikonfirmasi; **LT-2 dan LT-8 masih
   "menunggu pemilik"** (daftar & urutan kerja Store Operation — pemilik
   sendiri yang bilang "akan saya berikan menyusul" 2026-08-29). TIDAK ada
   kode yang bisa ditulis untuk LT-2/LT-8 tanpa jawaban itu.
2. **`docs/backlog/WAVE3_GAP_AUDIT.md`** — M2/M3/M11/M13/M14 ✅ HABIS. M15
   non-Client-Portal (Team Portal) ✅ HABIS. Client Portal (M15-G3..G7,
   `web-client-portal`) **ditunda pemilik**, diblokir `O4`+`O5` (spec belum
   ditulis/disetujui — lihat `web-client-portal/README.md`).
3. **`docs/backlog/PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md`** — sisi
   engineering migrasi Go→TS/Supabase **100% selesai**. Satu-satunya sisa
   adalah **C-05** (pencabutan mekanis `backend/`), dan itu menunggu **satu
   gate manusia**: keputusan go/no-go pemilik untuk cutover produksi
   (`docs/backlog/CUTOVER_BACKLOG.md` C-04). Baca
   `docs/handoff/HANDOFF_CUTOVER_SESI26.md` (nomor tertinggi) untuk posisi
   PERSIS thread ini — sesi ini TIDAK menyentuhnya sama sekali dan tidak
   memverifikasi apakah ada perkembangan sejak SESI26.

**Rekomendasi konkret untuk sesi berikutnya:**
1. Jangan langsung menebak salah satu dari ketiga celah di atas dan mulai
   membangun — ketiganya butuh jawaban pemilik, bukan desain Claude.
2. Kalau pemilik memberi instruksi baru secara langsung (lewat prompt
   sesi baru), itu yang dikerjakan — dokumen ini bukan pembatas, hanya
   peta "di mana posisi backlog sekarang" supaya tidak menduplikasi kerja
   atau salah asumsi status.
3. Kalau TIDAK ada instruksi baru dan pemilik minta "lanjutkan kerja
   backlog", ajukan `AskUserQuestion` menanyakan mana dari LT-2/LT-8,
   Client Portal spec (`O4`/`O5`), atau gate cutover (C-04 go/no-go) yang
   mau diprioritaskan — jangan pilih sendiri, ketiganya punya konsekuensi
   produk/keamanan yang berbeda.
4. Sebelum menjawab "backlog kosong", baca ulang ketiga dokumen di atas
   sendiri — status di sini adalah snapshot 2026-08-30, bisa saja pemilik
   sudah menjawab sesuatu di antara sesi ini dan sesi berikutnya.

## 4. Berkas rujukan

| Berkas | Untuk apa |
|---|---|
| PR #258 (`https://github.com/MEAgrup/AgencyAPP/pull/258`) | Diff lengkap LT-61 FE + kedua perbaikan (RLS, timezone test), sudah **MERGED** |
| `docs/handoff/HANDOFF_LT61_CORE_SELESAI_FE_VENDOR_20260830.md` | Handoff sumber yang diselesaikan sesi ini (backend core + 4 pertanyaan FE) |
| `docs/prd/CDPS_Module10_Addendum_LT61_Vendor_Portal_Spec.md` | Spec LT-61 lengkap, status IMPLEMENTED (core+FE) |
| `docs/DECISIONS.md` — cari "LT-61 SELESAI (core + FE)" | Rasional lengkap: 4 jawaban `AskUserQuestion`, temuan RLS, temuan timezone |
| `web-internal/src/app/vendor/**` | FE vendor: layout, login, daftar, buat-jadwal, detail |
| `web-internal/src/lib/vendor-auth-context.tsx` | Auth-context vendor, realm terpisah dari karyawan |
| `packages/domain/src/auth.ts` `getVendorMe` / `livestream.ts` `listVendorBriefs` | Domain baru sesi ini |
| `apps/api/src/app/api/v1/vendor/{me,briefs}/route.ts` | Route baru sesi ini |
| `packages/domain/src/interview.test.ts` (fixture "counts WORKING days") | Perbaikan bug timezone test, tidak terkait LT-61 |
| `docs/backlog/LEADTIME_BACKLOG.md` §0/Fase 6 | Status M16/M17 keseluruhan — LT-2/LT-8 menunggu pemilik |
| `docs/backlog/WAVE3_GAP_AUDIT.md` | Status Wave 3 — Client Portal satu-satunya sisa, ditunda pemilik |
| `docs/backlog/PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md` + `docs/handoff/HANDOFF_CUTOVER_SESI26.md` | Status cutover Go→TS — C-05 menunggu gate go/no-go pemilik |
