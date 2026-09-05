# BUILD PLAN — Penyelesaian Migrasi & Cutover (Go → Supabase + Vercel)

> **Dokumen standalone.** Lanjutkan di chat baru langsung dari file ini.
> Tanggal disusun: 2026-07-28. Basis: `main` @ `b8347ff`.
> Status besar: **port kode SELESAI & ter-merge**; sisa = **finishing + cutover**.
> Sumber kebenaran tetap `docs/prd/` + `CLAUDE.md` (house rules bit-for-bit).

---

## 0. Kondisi as-is (terverifikasi 2026-07-28)

**Sudah jalan:**
- `apps/api` — **161 route** TypeScript (Next.js), cakupan M0–M15 penuh (2 route `notifications` ditambahkan C-02, 2026-07-28).
- `packages/core` (7 engine: statemachine, money, ident, audit, permission, bi, notification, tz) + `packages/domain` (20 modul) — ber-test.
- Supabase **`CDPS SG`** (`egddxfcnrtecheiykhlf`, ap-southeast-1, PG17) — 5x tabel RLS-enabled, engine state machine sbg data (`sm_machines` 14, `sm_edges` 94, `sm_terminal_states` 20, `notif_events` 15), GoTrue + `custom_access_token_hook`.
- **Vercel live**: project `agency-app-api` (= `apps/api`) & `web-internal-mea` (= `web-internal`). QA manual FE sudah bisa dilakukan (login + baca data ⇒ hook aktif & kredensial ter-import).
- Go **DI-FREEZE** (DECISIONS 2026-07-22). Semua perubahan baru → `apps/api` + `web-internal`. **Jangan sentuh `backend/`.**

**Belum:** cutover produksi. Tabel bisnis (`clients`, `transactions`, `services`, dst.) masih **0 baris**; terisi baru `employees` (68), `employee_credentials` (68), `role_mappings` (38), `employee_layered_roles` (7), `leads`/`prospect_attempts` (3, sisa UAT), `perf_kpi_weights` (15), `perf_period_targets` (6).

**Aturan main selama plan ini:** house rules `CLAUDE.md` §Phase 0 wajib dipertahankan **bit-for-bit** (ID pasca-validasi, string BI `[...]` verbatim, audit append-only, derived read-only & recomputable, role matrix, IDR, katalog notifikasi **FROZEN 15 event**). PRD menang atas kode. Deviasi ⇒ entri `docs/DECISIONS.md`.

---

## 1. Peta tiket & urutan

| # | Tiket | Prioritas | Estimasi | Blocking cutover? |
|---|---|---|---|---|
| **C-00** | ~~CI mati — runner tidak teralokasi~~ ✅ **SELESAI 2026-07-28** | — | — | — |
| **C-01** | ~~O37 — otorisasi read (RLS ter-bypass)~~ ✅ **SELESAI 2026-07-28** | — | — | — |
| **C-02** | ~~Endpoint `notifications` di `apps/api`~~ ✅ **SELESAI 2026-07-28** | — | — | — |
| **C-03** | ~~UAT paritas end-to-end~~ ✅ **SELESAI 2026-07-31 — dijalankan terhadap deployment produksi, FAIL 0** | — | — | — |
| **C-04** | ~~Cutover data + aktor produksi~~ ✅ **DIKETOK 2026-09-04 — memformalkan cutover yang secara de facto SUDAH terjadi sejak ±28 Agustus** (lihat §C-04 + `DECISIONS.md`) | — | — | — |
| **C-05** | ~~Retire Go: arsip `backend/`, bersihkan CI & config Railway~~ ✅ **SELESAI 2026-09-04** — `backend/` → `archive/backend-go/`, job CI `backend` dicabut, 5 config Railway ditandai deprecated, `CLAUDE.md` diperbarui. Butir 5 (matikan service Railway) ✅ **selesai 2026-09-05 oleh pemilik — C-05 5/5** | — | — | — |
| **C-06** | `web-client-portal` (M15-C2) | ⚪ belum dimulai (O4/O5 RESOLVED 2026-08-31) | — | **TIDAK** (by design) |

**Urutan wajib:** ~~C-00~~ ✅ → ~~C-01~~ ✅ → ~~C-02~~ ✅ → ~~C-03~~ ✅ → ~~C-04~~ ✅ → ~~(gate go/no-go manusia)~~ ✅ **GO 2026-09-04 (Nerissa, COO)** → ~~C-05~~ ✅. **Jalur cutover SELESAI.**
C-06 di luar jalur cutover.

**Total realistis: ~1,5–2 minggu kerja Claude** + gate keputusan manusia (Yohan & Nerissa, OQ-1).

---

## C-00 — CI mati: runner tidak teralokasi ✅ SELESAI (2026-07-28)

> **RESOLVED.** Pemilik meng-upgrade akun/billing GitHub → runner kembali dialokasikan.
> **Bukti:** run `30328573444` attempt 2 — `runner_id: 1000001482` (sebelumnya `0`),
> **kelima job hijau**: `backend` (Go: `go vet` + `go test` 4m19s + migrate up/down smoke),
> `api`, `core-engines`, `web-internal`, dan **`db-and-migrations`** (seluruh invariant
> lolos: ident gap-free/WIB, append-only immutability, paritas predikat RLS, paritas
> custom claims Supabase Auth, idempotensi seed, verifikasi jumlah tabel).
> **Tindak lanjut SELESAI:** re-run CI di `main` (`b8347ff`, run `30278802079` attempt 2)
> → **`conclusion: success`**, kelima job hijau. **PR #55–#57 kini tervalidasi CI** —
> `main` tidak lagi berstatus "belum tervalidasi".
>
> Catatan untuk C-03: gate CI `db-and-migrations` mengharapkan **53 tabel** dan lolos,
> sedangkan `list_tables` di remote `CDPS SG` melaporkan lebih banyak. Bandingkan
> keduanya saat C-03 untuk memastikan tak ada objek manual/drift di remote.

<details><summary>Detail temuan asli (arsip)</summary>

**Temuan 2026-07-28:** **seluruh** run CI repo gagal — bukan hanya di branch ini, tetapi juga di **`main`** (mis. run `30278802079` = "Merge PR #57", run `30263081875` = "Merge PR #56") dan branch lain, setidaknya sejak 2026-07-27.

**Bukti diagnosis:**
- Semua job (`backend`, `api`, `core-engines`, `db-and-migrations`, `web-internal`) `conclusion: failure` **2–4 detik** setelah dibuat.
- Log tidak tersedia (HTTP 404) — tak ada eksekusi yang pernah terjadi.
- Job detail: **`runner_id: 0`, `runner_name: ""`** ⇒ **runner tidak pernah dialokasikan**.

**Kesimpulan:** ini **bukan** kegagalan test/kode. Repo `MEAgrup/AgencyAPP` privat ⇒ menit Actions ditagih; pola ini khas **kuota/spending limit GitHub Actions habis** (atau isu pembayaran/policy) di level organisasi.

**Dampak (penting):**
1. Merge terakhir ke `main` (**PR #55, #56, #57**) masuk **tanpa verifikasi CI**. Perlakukan `main` sebagai *belum tervalidasi* sampai CI hijau kembali.
2. **C-03 dan C-05 bergantung pada gate CI** (`db-and-migrations` menjalankan invariant `ident`/`immutability`/`rls`/`auth_claims`). Tanpa CI, gate go/no-go kehilangan bukti otomatisnya.

**Tindakan (HANYA bisa manusia — Claude tak punya akses billing):**
1. GitHub → Organization `MEAgrup` → **Settings → Billing** → cek kuota Actions / spending limit; naikkan limit atau perbarui metode pembayaran.
2. Setelah pulih: **re-run** CI di `main` (`b8347ff`) untuk memvalidasi kembali PR #55–#57 yang lolos tanpa CI.
3. Bila ternyata bukan billing, cek Organization → Settings → **Actions → General** (policy runner/actions yang diizinkan).

**DoD:** satu run CI di `main` selesai dengan runner ter-assign (`runner_name` terisi) dan seluruh job hijau.

</details>

---

## C-01 — O37: otorisasi jalur baca ✅ SELESAI (2026-07-28)

> **RESOLVED — opsi (c) dipilih & dieksekusi.** Detail lengkap di `docs/DECISIONS.md`
> (entri Decided 2026-07-28). Ringkas:
> - `withClaims` (@cdps/db) + `readAsActor`/`actorClaims` (apps/api) → **61 handler GET**
>   kini membaca sebagai role `authenticated` dgn klaim pemanggil, jadi RLS BERLAKU.
>   Tulis tak berubah (service-role + RPC SECURITY DEFINER).
> - Gate app-layer hanya untuk aturan endpoint: `canReadPool`/`leadListScope`
>   (port 1:1 dari Go) + `leads.ForbiddenError` → 403 ber-pesan BI.
> - Migrasi **20260724132631** menambah arm `jwt_owns_lead_campaign` supaya RLS =
>   predikat Go `canReadLead` (tanpa itu Marketing staff kehilangan lead campaign sendiri).
> - **Temuan tambahan yang ikut ditutup:** 13 handler GET pembawa data (a.l. `/clients`,
>   `/reminders`, `/transactions/{id}/commission`, `/leads`) ternyata **tanpa autentikasi
>   sama sekali** — semua kini di-gate `requireActor`.
> - **Deviasi tercatat:** penolakan baca SATU lead kini 404 (row ter-filter RLS), bukan 403
>   seperti Go. Endpoint LIST tetap 403.
> - **Bukti:** `rls_checks.sql` §10-13 (gagal bila policy dikembalikan ke baseline);
>   `reads_rls.test.ts` 5 test; demo PG16: lintas-scope service-role **1** baris vs
>   `authenticated` **0** baris. Seluruh suite + invariant hijau, tabel tetap 53.

<details><summary>Uraian masalah asli (arsip)</summary>


**Masalah (akar, terverifikasi):** `apps/api/src/lib/db.ts` membuat satu koneksi proses-wide dari `DATABASE_URL` sebagai **role privileged/service** → **RLS tidak berlaku di semua route baca**. Write relatif aman (lewat RPC `SECURITY DEFINER`: `ident_next`, `sm_transition`, `notify_emit`, …), tapi **read tidak ter-scope** oleh RLS maupun gate app-layer. Akibat: user terautentikasi mana pun bisa membaca data di luar scope perannya (Pool board, Leads DB, finance, dst.). Celah **lintas-modul**, bukan spesifik satu modul.

**Keputusan yang harus diambil dulu (arsitektur — butuh Yohan/Nerissa):**

- **(a) Koneksi ber-JWT-user** — set `request.jwt.claims` per request (gaya PostgREST) supaya policy RLS yang sudah ada aktif.
  *Plus:* satu sumber kebenaran izin (policy SQL), sudah ada `supabase/tests/rls_checks.sql` sbg gate paritas.
  *Minus:* tiap request perlu `SET LOCAL` dalam transaksi (pooler transaction-mode — `prepare:false` sudah dipakai); perlu audit performa; policy RLS harus benar-benar lengkap untuk semua tabel baca.
- **(b) Gate izin app-layer per read** — port helper dari Go: `canReadPool`, `leadListScope`, `canReadLead` (`backend/internal/module1_leads/reads.go`) + padanannya di modul lain, ke `packages/domain`.
  *Plus:* eksplisit, mudah di-unit-test, mirror perilaku Go yang sudah lolos UAT W1–W3.
  *Minus:* logika izin jadi dua tempat (RLS + app), risiko divergen.
- **(c) Kombinasi** — RLS sebagai jaring pengaman + gate app-layer untuk aturan yang sulit diekspresikan di policy.
  **Rekomendasi teknis: (c)**, dengan (a) sebagai fondasi dan (b) hanya untuk aturan kompleks (mis. co-pursuit, scope Marketing staff). Alasan: konsisten dengan niat desain awal (`db.ts` sudah menyebut "RLS = jaring baca") tanpa mengorbankan paritas perilaku Go.

**Langkah kerja (setelah keputusan):**
1. Inventarisasi seluruh route baca `apps/api/src/app/api/v1/**/route.ts` (GET) → tabel yang disentuh → aturan visibilitas per PRD/`PERMISSIONS.md`.
2. Implementasi mekanisme terpilih di `apps/api/src/lib/db.ts` (+ helper baru, mis. `dbAsActor(actor)`).
3. Port helper scope dari Go bila (b)/(c).
4. Test permission per role **termasuk OD/Director berlapis** (DoD `CLAUDE.md`): staff = data sendiri, lead/SPV = divisi, OD = read-only semua, Director = penuh.
5. Perbarui/`extend` `supabase/tests/rls_checks.sql` bila policy berubah.
6. Catat keputusan di `docs/DECISIONS.md` (tutup O37).

</details>

**DoD:** ada test yang **gagal sebelum fix & lulus sesudahnya** untuk minimal 3 kasus lintas-scope (mis. Sales staff A tidak bisa membaca lead milik staff B; Marketing staff tidak melihat Pool penuh; OD tidak bisa menulis). CI hijau. O37 tertutup di DECISIONS.

---

## C-02 — Endpoint `notifications` di `apps/api` ✅ SELESAI (2026-07-28)

> **RESOLVED.** Dua route baru + satu modul domain; **NOL migrasi**, **NOL event baru**
> (katalog tetap **15 FROZEN**), **NOL string BI baru** (`[id tidak valid]` di-port
> verbatim dari Go `handleMarkRead`).
>
> - **`packages/domain/src/notification.ts`** (baru): `list(sql, actor, unreadOnly)`,
>   `unreadCount(sql, actor)`, `inbox(...)` = komposisi keduanya (dipakai route supaya
>   `data` + `unread_count` datang dari SATU transaksi/snapshot), `markRead(sql, actor, id)`,
>   `parseId(raw)`. Semua query membawa predikat `recipient_employee_id = actor.employeeId`.
> - **`GET /api/v1/notifications`** (+ `?unread=1`) — lewat `readAsActor` (pola C-01), jadi
>   policy `notifications_select` benar-benar berjalan. `?unread=1` menyaring **daftar saja**;
>   `unread_count` tetap TOTAL karena badge header menampilkan angka yang sama di kedua tab.
> - **`POST /api/v1/notifications/{id}/read`** — verb & path identik Go. Lewat `db()` +
>   RPC `mark_notification_read` (satu-satunya jalur UPDATE). **Tidak ada** route DELETE.
> - `notificationToWire` + `inboxToWire` di `apps/api/src/lib/wire.ts`; `id` tetap **string**
>   (kolom `bigint`, postgres.js kembalikan int8 sebagai string = tipe FE `NotificationItem.id`).
>
> **Keputusan kecil ter-log:** modul ini **sengaja** mengulang predikat kepemilikan di SQL
> meski C-01 memutuskan visibilitas baris = urusan RLS. Alasan: `notifications_select` adalah
> satu kesamaan tunggal (`recipient = jwt_employee_id()`) yang merupakan *definisi* kepemilikan,
> bukan kebijakan multi-arm seperti `leads_select` yang bisa divergen — dan jalur tulis
> (`markRead`) berjalan sebagai service-role tanpa policy sama sekali, jadi predikatnya wajib
> eksplisit di sana. Sesuai instruksi §C-02 butir 1 backlog ini.
>
> **Mark-read = idempoten & senyap (paritas Go):** id tak dikenal, milik orang lain, atau sudah
> dibaca → 0 baris berubah, tetap `200 {"status":"ok"}`. 404/403 di sini justru membocorkan
> apakah id notifikasi orang lain ada.
>
> **Bukti (lokal, PG16 fresh + 53 migrasi + seed):** `@cdps/domain` **422** (+11 `notification.test.ts`:
> own-only, urutan newest-first, idempotensi mark-read tanpa geser timestamp, no-op lintas-penerima,
> DELETE ditolak trigger, `?unread=1` menyaring list tapi tidak count, plus 3 test lewat `withClaims`
> — penerima lain **0** baris, **Director pun 0** baris karena notifikasi bukan data oversight).
> `@cdps/api` **101** (+3 wire), `@cdps/core` 112, `@cdps/db` 9. Typecheck 4 workspace bersih;
> `next build` hijau (dua route terdaftar); invariant ident/immutability/rls/auth_claims **PASS**;
> tabel tetap **53**.
>
> **Smoke e2e nyata** (API `next start` → PG lokal, token HS256): tanpa auth **401** di kedua route;
> penerima A hanya melihat 2 barisnya & B hanya 1; mark-read → `unread_count` 2→1; mark ulang tak
> mengubah apa pun; **B menandai notifikasi A → unread A tetap 1**; `/notifications/abc/read` →
> **400 `[id tidak valid]`**.

<details><summary>Uraian tiket asli (arsip)</summary>

**Masalah:** engine notifikasi sudah di-port (`packages/core/src/notification.ts`: `CATALOG` 15 event FROZEN, `emit()` → RPC `notify_emit`) dan tabel `notifications` + `notif_events` sudah ada, **tetapi tidak ada route `notifications` di `apps/api`** (terverifikasi: nol file). FE sudah memanggilnya:
- `web-internal/src/lib/use-unread-count.ts` → `GET /notifications?unread=1`, membaca `res.unread_count` (polling 30 dtk, badge header).
- `web-internal/src/app/(shell)/notifications/page.tsx` → daftar + tandai dibaca.

**Kontrak yang harus dipenuhi** (`web-internal/src/lib/types.ts`):
```ts
NotificationsResponse { data: NotificationItem[]; unread_count: number }
```
Referensi perilaku (frozen, jangan didesain ulang): `backend/internal/httpapi/notification_handlers.go` → `handleListNotifications`, `handleMarkRead`.

**Langkah kerja:**
1. `packages/domain/src/notification.ts` (baru): `listNotifications(sql, actor, {unreadOnly})`, `markRead(sql, actor, id)` — hanya notifikasi milik `recipient_employee_id` aktor.
2. Route: `GET /api/v1/notifications` (+ `?unread=1`), `POST|PATCH /api/v1/notifications/{id}/read` — samakan verb dengan Go.
3. Mapper wire di `apps/api/src/lib/wire.ts` (`notificationToWire`), bungkus list `{ data: [...], unread_count: n }` (konvensi FE/Go).
4. **Immutability:** hanya `read_at` yang boleh berubah; tak ada path DELETE (house rule §8 — notifikasi tak pernah bisa dihapus).

**DoD:** unit test (milik-sendiri saja, mark-read idempoten, tak ada DELETE), badge FE hidup saat QA, nol event katalog baru.

</details>

**Sisa untuk C-03:** QA badge di FE ter-deploy (Vercel) belum dijalankan — smoke di atas membuktikan
kontrak API-nya, bukan render badge-nya. Masukkan ke walk C-03.

---

## C-03 — UAT paritas end-to-end ✅ **SELESAI 2026-07-31 — dijalankan terhadap DEPLOYMENT, FAIL = 0**

> ### ✅ DITUTUP 2026-07-31 — report `docs/handoff/CUTOVER_UAT_REPORT_20260731.md`
>
> Run **`30600363211`** (job `probe` `91061467877` · job `uat` `91061496685`), di-approve pemilik
> di environment `c03-production`, `confirm_write: YA`, commit `437ac24`, `BASE=https://agency-app-api.vercel.app`.
> **Hasil: 22/22 · 34/34 · 13/13 — PASS 69 · FAIL 0**, tanpa satupun baris SKIP di output skrip.
> Artifact `c03-output` (id `8781965829`, **kedaluwarsa 2026-10-29**).
>
> **Yang akhirnya terbukti** dan tidak pernah terbukti di report 2026-07-28: konfigurasi env
> Vercel, kunci JWT produksi, dan perilaku pooler Supabase. **SKIP-1 ✅ · SKIP-3 ✅.**
>
> **SKIP-2 (QA badge notifikasi di FE ter-deploy) PINDAH ke daftar QA UI C-04** — butuh mata di
> browser, tidak bisa diotomatiskan tanpa menyimpan password user produksi sebagai secret.
> Ia tidak menahan DoD C-03 (*report tersimpan · FAIL = 0 · tiap SKIP beralasan*).
> Keputusan: `docs/DECISIONS.md` 2026-07-31.
>
> 🟠 **Residu produksi lebih besar dari yang diumumkan sebelum approval** — bukan *"2 lead
> `ZZC03`"* melainkan **3 lead** (yang ketiga bernama `Smoke`, **tanpa marker `ZZC03`**, jadi
> prosedur bersih-bersih berbasis prefix akan melewatkannya) + 3 `prospect_attempts` +
> 7 baris `audit_log` + **38 `performance_snapshots`** + **38 notifikasi
> `m14.performance.published`** ke 38 karyawan riil. Rincian & konsekuensinya: report §5.
>
> Tutorial jalur laptop (masih sahih sebagai alternatif):
> `docs/handoff/TUTORIAL_C03_LANGKAH_DEMI_LANGKAH.md`.

> **Report: `docs/handoff/CUTOVER_UAT_REPORT_20260728.md`.**
> **PASS 77 · FAIL 0 · SKIP 3.** DoD FAIL = 0 **terpenuhi**, tetapi ketiga SKIP berakar
> pada satu hal yang sama: walk belum pernah dijalankan terhadap **deployment Vercel**
> (network policy sesi memblokir `*.vercel.app`; kredensial per-role tak tersedia).
> Yang terbukti = **kode + skema**; yang belum = **konfigurasi deployment**.
> ⇒ perlakukan sebagai **lolos bersyarat**; tutup SKIP dulu sebelum gate C-04.
>
> **✅ C03-F1 (semula blocker, → O38 opsi A — DITUTUP): repo migrasi ≠ skema project live.** Jumlah & nama tabel ternyata
> **cocok 53/53** (catatan C-00 terjawab), tetapi **4 migrasi hanya ada di live** dan tak pernah
> ditulis ke repo — termasuk `harden_secdef_helpers_to_private_schema` yang memindahkan
> `jwt_owns_{client,lead,transaction}` dari `public` ke schema `private`. Akibatnya migrasi C-01
> `20260724132631` (menulis `jwt_owns_lead(id)` tanpa kualifikasi schema) **GAGAL apply ke live** —
> terbukti empiris: `ERROR: function jwt_owns_lead(character varying) does not exist`. CI hijau
> karena gate `db-and-migrations` membangun dari repo saja.
> **Perbaikan (O38 opsi A):** 4 migrasi live-only di-back-port **verbatim** (`…0005_fk_covering_indexes`,
> `…0006_employee_display_name`, `…0007_change_password`, `…0008_harden_secdef_helpers_to_private_schema`),
> dan migrasi C-01 dinomori ulang `…0005`→`…0009` + dibuat sadar-schema (`private.jwt_owns_lead`;
> helper baru dibuat di `private` supaya lint 0029 tidak hidup lagi).
> **Bukti:** rebuild 36 migrasi **apply bersih**; tabel 53 · kolom 526 · fungsi `public` 23 · policy 44 ·
> trigger 24 · **index 122** semuanya cocok dengan `CDPS SG`; schema `private` 5 vs 4 dengan delta
> **persis** `jwt_owns_lead_campaign` (= perubahan C-01 yang memang belum di-deploy).
> **Sisa (non-blocking):** penomoran versi migrasi repo (`202601…`) belum selaras dengan riwayat remote
> (`202607…`) — selaraskan sebelum ada yang menjalankan `supabase db push`.
>
> **🟠 C03-F2 — DITEMUKAN & SUDAH DIPERBAIKI:** `POST /sales/quote-preview` **selalu 500**
> (`Do not know how to serialize a BigInt`) — kalkulator harga & komisi salesperson rusak total.
> Route mengembalikan objek domain mentah: bigint tak bisa di-serialize, amplop `{quote}` bukan
> top-level, dan camelCase bukan snake_case. Diperbaiki dengan `quoteToWire` (memulihkan `json:"-"`
> milik Go + house rule #4). 3 test regresi ditambahkan.
>
> **Hasil hijau:** house rules **21/21** (skrip baru `apps/api/scripts/cutover-houserules-walk.mjs`),
> kontrak Wave-3 **34/34 wired**, auth **12/13** (1 = artefak seed), core 112 · db 9 · domain 422 ·
> api 104 (DB fresh), invariant ident/immutability/rls/auth_claims **PASS**, tabel 53, build hijau.
>
> **SKIP:** walk terhadap **Vercel tidak bisa dijalankan** — network policy sesi menolak
> `*.vercel.app` (`403 to CONNECT`) dan kredensial per-role tidak tersedia; walk dieksekusi
> terhadap build produksi yang sama secara lokal. QA badge FE ter-deploy juga tertunda.
> Detail & cara menutupnya di §4 report.

<details><summary>Uraian tiket asli (arsip)</summary>

**Tujuan:** membuktikan stack TS/Supabase berperilaku **sama** dengan Go yang sudah lolos UAT W1/W2/W3 — sebelum Go dimatikan.

**Bahan yang sudah ada (pakai ulang, jangan bikin baru):**
- `docs/handoff/W1-20_UAT_RUNBOOK.md`, `W2_UAT_RUNBOOK.md`, `W3_UAT_RUNBOOK.md` (+ report pembandingnya).
- `docs/handoff/WAVE1_EXIT_UAT_RUNBOOK.md`, `WAVE3_FE_API_CONTRACT_SMOKE_20260727.md`.
- Skrip: `apps/api/scripts/auth-smoke.mjs`, `apps/api/scripts/wave3-contract-smoke.mjs`.

**Langkah kerja:**
1. Jalankan walk W1/W2/W3 terhadap **Vercel `agency-app-api`** (bukan lokal) memakai akun tiap role.
2. Verifikasi eksplisit house rules: format ID `PREFIX-YYYYMM-NNNN`, **string BI `[...]` verbatim**, transisi ilegal ditolak server-side, audit append-only, derived field (ROAS/CPL/Speed/Health/komisi) **recompute-from-log**, format IDR `Rp. X.XXX.XXX,00`, div-by-zero → `—`.
3. Tulis report `docs/handoff/CUTOVER_UAT_REPORT_<tanggal>.md` (pola report sebelumnya: PASS/FAIL/SKIP + alasan).
4. **Cek drift skema:** bandingkan jumlah tabel remote `CDPS SG` vs gate CI `db-and-migrations` ("expect 53") — bila beda, telusuri migrasi yang belum ter-apply / objek manual. Jangan diamkan.

**DoD:** report tersimpan, FAIL = 0, tiap SKIP beralasan tertulis. Ini bahan **gate go/no-go manusia**.

</details>

**Untuk menutup C-03:** (1) ~~keputusan O38~~ ✅ (2) ~~repo = live~~ ✅
(3) ~~skrip siap dijalankan terhadap deployment~~ ✅ **2026-07-29**
(4) ~~eksekusi dari mesin ber-akses~~ ✅ **2026-07-31 lewat GitHub Actions** —
QA UI manual (SKIP-2) pindah ke C-04. **Keempatnya tertutup ⇒ C-03 SELESAI.**

> 🔴 **Sebelum 2026-07-29 langkah (4) TIDAK BISA berhasil, dan itu tidak terlihat dari report.**
> `cutover-houserules-walk` menyematkan id **seed** (`EMP-0001`…`EMP-0009`) di source; tak satupun
> ada di live (69 karyawan). Registrasi lead-nya menulis `sales_pemegang` ⇒ terhadap deployment
> walk gagal di **foreign key**, bukan di house rule — "21/21 dari Vercel" mustahil. Itu **cacat
> kembaran SKIP-3** (`auth-smoke` menyematkan `EMP-202607-0001`, kebalikannya), satu kelas:
> identitas aktor adalah konstanta source, bukan sesuatu yang diresolusi dari environment yang
> diuji. **Sudah diperbaiki:** `apps/api/scripts/lib/actors.mjs` (env override → discovery
> `/admin/employees` ⋈ `/admin/role-mappings` → fallback seed; 17 unit test), `BYPASS` Vercel
> diterima ketiga skrip. **Efek samping:** slot `sales_lead` selama ini dideklarasikan lalu tak
> dipakai ⇒ tingkat **`lead` (scope divisi)** belum pernah diuji walau C-03 mengklaim mencakup
> Role Matrix; ceknya ditambahkan ⇒ **target walk 21 → 22**. Keputusan: `docs/DECISIONS.md`
> 2026-07-29. **Bukti lokal:** auth-smoke **13/13** (SKIP-3 hilang bahkan di sandbox) · walk
> **22/22** · wave3 **34/34** · `@cdps/api` **211** test · typecheck bersih.

**Cara menjalankan langkah (4): `docs/handoff/CUTOVER_C03_DEPLOYMENT_RUNBOOK.md`**
(env yang dibutuhkan, cara membaca blok `aktor terpakai`, jejak `ZZC03` yang ditinggalkan walk,
checklist QA UI, DoD). Itu menutup ketiga SKIP sekaligus → report jadi FAIL = 0 tanpa SKIP →
baru buka gate C-04.

---

## C-04 — Cutover data + aktor produksi 🟠

**Data (Opsi A re-seed/import — sesuai DECISIONS OQ-2/A1):**
1. Konfirmasi ulang ke pemilik: apakah data di Railway/MySQL sekarang **riil** atau masih UAT? (Asumsi tercatat: UAT.) Bila ternyata riil ⇒ butuh rencana ekspor-impor per-entitas mengikuti rantai FK `LEAD → ATTEMPT → CLIENT → SERVICE → TRX → INST`; jangan improvisasi, catat keputusan dulu.
2. Import karyawan riil via route yang sudah ada: `POST /api/v1/admin/employee-import` (Director-only, satu transaksi: sync `employees` → provision credentials → link GoTrue). Sumber = **CSV/spreadsheet admin** (OQ-4: endpoint HRIS tidak dipakai lagi).
3. ~~Import lead historis sesuai **O22** (Pilihan B: `Qualify` ATAU prospek `Hot/Warm`, 6 bulan terakhir)~~ — ❌ **GUGUR 2026-07-30 sebagai konsekuensi O47.** O22 memutuskan **APA** yang diimpor; O47 memutuskan tooling-nya **ditinggalkan** (riwayat pra-CDPS cukup arsip spreadsheet), jadi tidak ada lagi jalur yang mengeksekusinya dan tidak ada yang perlu dibangun. **Konsekuensi untuk gate C-04: butir ini keluar dari daftar ❌** — CDPS produksi mulai dari data bersih, by decision. `POST /leads/bulk` tetap hidup untuk impor **operasional** (bukan historis).
4. Master Service List — **alat seed SELESAI (2026-07-28), tinggal dijalankan ke live.** Seed kanonik = **`supabase/seed/msl_kalkulator.csv` (32 layanan rate card aktif)**, BUKAN `MSL_DRAFT_KOMPILASI.csv` (180 baris itu harga deal historis untuk impor W1-19, dan masih menunggu Sales Head — lihat Decided 2026-07-28). CLI: `npm run msl:seed -w @cdps/api -- --actor <NIK> [--apply]`, dry-run default, idempoten, menulis lewat `msl.createService`/`updateService` sehingga tervalidasi + terversi + teraudit. Terverifikasi end-to-end di Postgres lokal termigrasi (32 dibuat → rerun 32 dilewati; quote M0 terhitung benar di keempat `pricing_mode`). **✅ SUDAH DI-APPLY KE LIVE `CDPS SG` 2026-07-28** oleh Yohan, aktor NIK `2101180004`: dry-run `dibuat=32` (nol tulis) → apply `dibuat=32 error=0` → rerun `dilewati=32` (idempotensi terbukti). `master_services` **32 baris**, bukan 0 lagi. Sisa: QA UI `/master-services` + `/sales/kalkulator` di deployment. Runbook: `docs/handoff/MSL_KALKULATOR_VALIDASI.md` §"Cara seed ke sistem"; detail apply: `HANDOFF_CUTOVER_SESI4.md` §3.1.

**Aktor produksi (keputusan manusia — masih terbuka):**
- **O50 ✅ selesai sejauh yang mungkin 2026-07-31** — **4 akun dihapus penuh** (`…02`, `…03`,
  `…05`, `…07`: `employees` + `employee_credentials` + `employee_layered_roles` + `auth.users`,
  ber-`audit_log`). Roster **69 → 65**. **6 tombstone permanen**, semuanya nonaktif + ban GoTrue:
  `…01`/`…04` terkunci riwayat (lead + audit), `…06`/`…08`/`…09`/`…10` terkunci trigger
  immutability `performance_snapshots` (**DB menolak DELETE** — residu run C-03, lihat di bawah).
  **Nol fixture aktif · nol bisa login.**
- ✅ **DoD sudah dirumuskan ulang & disetujui pemilik 2026-07-31** — *"nol fixture UAT yang
  **aktif atau bisa login**"*, lengkap dengan tiga kueri pengukur (lihat DoD di bawah).
  **O50 tertutup penuh.** `DECISIONS.md` 2026-07-31.
- ⚠️ **Pelajaran yang berlaku umum:** `UPDATE employees SET status_aktif=false` **TIDAK**
  mencabut akses — GoTrue tetap menerbitkan token. Pakai **`set_employee_banned(nik, true)`**,
  yang menulis `status_aktif` **dan** `auth.users.banned_until`.
- ⚠️ **Sebab-akibat yang layak diingat sebelum menjalankan smoke ke produksi lagi:** run C-03
  `POST /performance/snapshots/scan` menyentuh **seluruh** karyawan aktif termasuk fixture, dan
  hasilnya **tidak bisa ditarik**. Ia mengubah 4 fixture yang tadinya bisa dihapus menjadi
  permanen. Smoke yang menulis ke produksi punya biaya yang tidak selalu terlihat saat dijalankan.
- **Headcount untuk keputusan apa pun kini 59 aktif**, bukan 69. Ini khususnya mengubah dasar **O35**.
- **O34** butir (a)–(e) — aktor Wave 2 + lead Marketing/BD (kini masih fixture UAT).
- **O33** — aktor Finance. **O26** — NIK + email Director. **O35** — sub-tim Creative M7 §3 (butuh 3 keputusan berurutan; gate lead-divisi existing tetap berlaku sementara).
- **O9** — target periode M14 (non-blocking, `is_placeholder`).

**QA UI di deployment (dikumpulkan di sini, jangan tercecer):**
- `/master-services` + `/sales/kalkulator` — sisa dari seed MSL 2026-07-28.
- **Badge notifikasi `web-internal`** — eks **SKIP-2** C-03, dipindah ke sini 2026-07-31.
  Kontrak API-nya sudah terbukti dua kali; yang belum pernah dilihat adalah render badge-nya.
  🔎 **Kerjakan SEBELUM membersihkan residu C-03:** run C-03 meninggalkan **38 notifikasi
  belum-dibaca** di produksi (sebelumnya tabel `notifications` kosong) — itu justru bahan uji
  badge yang tidak akan ada lagi setelah dibersihkan.

**Residu produksi dari run C-03 `30600363211` (2026-07-31) — wajib masuk daftar bersih-bersih:**
- **3 lead + 3 `prospect_attempts`**: `LEAD-202607-0004` (`ZZC03 Alpha …`), `LEAD-202607-0005`
  (`ZZC03 OD …`), dan **`LEAD-202607-0006` bernama `Smoke`** — yang terakhir **tanpa marker
  `ZZC03`**, jadi prosedur "cari prefix `ZZC03`" di runbook **akan melewatkannya**.
- **38 `performance_snapshots`** (`PERF-202606-0001`…`0038`, periode 2026-06, `computed_by='system'`)
  \+ **38 notifikasi `m14.performance.published`** ke 38 karyawan riil — dihitung dari produksi
  yang nol klien & nol transaksi, jadi angkanya benar secara mesin dan tak bermakna secara bisnis.
- **7 baris `audit_log` TIDAK boleh dihapus** — aturan rumah #3 tanpa pengecualian untuk data uji.
- ⚠️ **Setelah O50 dieksekusi, jalankan ulang workflow C-03 sekali.** Slot `finance_staff` run
  2026-07-31 diresolusi ke fixture `9900000007`; begitu fixture hilang, discovery memilih Finance
  riil (3 orang aktif) — run ulang = konfirmasi terakhir sebelum gate GO, biayanya satu klik approval.

**DoD (dirumuskan ulang 2026-07-31, disetujui pemilik — `DECISIONS.md`):**

1. ✅ **Nol fixture UAT yang AKTIF atau BISA LOGIN di jalur produksi.**
   Menggantikan rumusan lama *"nol fixture UAT tersisa di jalur produksi"*, yang **mustahil
   secara harfiah**: 6 baris terakhir terkunci — 2 oleh riwayat yang mereka tulis (aturan rumah
   #3), 4 oleh trigger immutability `performance_snapshots`. Satu-satunya cara mencapai nol
   harfiah adalah membongkar jaminan immutability di produksi, yang harganya jauh melebihi
   nilai 6 baris nonaktif.
   **Cara mengukurnya — tiga-tiganya harus nol, dan wajib dibaca dari live:**
   ```sql
   select count(*) from public.employees
     where employee_id like '99%' and status_aktif;                    -- 0
   select count(*) from public.employees e join auth.users u on u.id = e.auth_user_id
     where e.employee_id like '99%'
       and (u.banned_until is null or u.banned_until <= now());        -- 0
   select count(*) from public.employees e join public.role_mappings rm
     on upper(rm.divisi)=upper(e.divisi) and upper(rm.jabatan)=upper(e.jabatan)
     where e.employee_id like '99%' and e.status_aktif;                -- 0
   ```
   **Status: TERPENUHI 2026-07-31** — 4 akun dihapus penuh, 6 tombstone semuanya
   `status_aktif=false` + `banned_until='infinity'`, nol muncul di headcount aktif 59.
   **Yang TIDAK ditoleransi rumusan baru ini:** fixture yang masih aktif, masih bisa login,
   masih terhitung headcount, atau masih memegang layered role. Rumusan ini melonggarkan
   **keberadaan baris**, bukan **akses**.
2. **Nol data uji yang bisa disalahartikan sebagai data bisnis** — residu C-03 di atas
   dibersihkan sejauh yang diizinkan skema, dan yang tidak bisa dihapus dicatat sebagai
   dikenal (bukan didiamkan).
3. **Login riil semua role lolos** di deployment.
4. ~~MSL terisi & ber-versi~~ ✅ **terpenuhi 2026-07-28** (32 layanan ber-versi di `CDPS SG`).

---

## C-05 — Retire Go ✅ **SELESAI 2026-09-04** (4 dari 5 butir; butir 5 eksekusi pemilik)

> **Hasil eksekusi 2026-09-04, sesudah gate GO diketok Nerissa (COO):**
> 1. ✅ Job CI `backend` (Go + service MySQL, 39 baris) **dicabut** dari `.github/workflows/ci.yml`.
>    Job tersisa: `web-internal`, `web-client-portal`, `api`, `core-engines`, `db-and-migrations`.
> 2. ✅ `backend/` → **`archive/backend-go/`** (328 berkas, `git mv` — terdeteksi rename, bukan
>    hapus+tambah) + `archive/backend-go/README.md`. ⚠️ **Tag `backend-go-final` GAGAL di-push** —
>    pembuatan tag diblokir **proxy sesi Claude** (`send-pack: unexpected disconnect`, 11 percobaan,
>    annotated dan lightweight sama-sama gagal; REST API menjawab eksplisit "Write access to this GitHub
>    API path is not permitted through this proxy" — jadi bukan ruleset repo dan bukan gangguan jaringan). Tag ADA secara lokal. Karena butir ini
>    **memindahkan** dan bukan menghapus, isinya tetap terbaca di repo, jadi syarat "jangan hapus
>    tanpa tag" tetap terpenuhi secara substansi — **jangkar permanennya commit `133f717`**
>    (`git show 133f717:backend/cmd/import/main.go`). Kalau pemilik mau tag-nya ada di remote,
>    push manual dengan kredensial sendiri.
> 3. ✅ Lima config mati ditandai deprecated (bukan dihapus): `archive/backend-go/railway.json`,
>    `web-internal/railway.json`, `archive/backend-go/Dockerfile`, `docs/DEPLOY_RAILWAY.md`, dan
>    — di luar daftar asli — `.github/workflows/railway-mysql-backup.yml`, yang **sengaja
>    dipertahankan** sampai service Railway benar-benar mati (ia satu-satunya jalan mengambil dump
>    sekali lagi tanpa laptop ber-klien MySQL).
> 4. ✅ `CLAUDE.md` §Stack diperbarui + entri `DECISIONS.md`. **78 komentar provenance** di 61
>    berkas TS ikut dialihkan `backend/` → `archive/backend-go/`. Sed-nya menyingkap satu
>    referensi yang ternyata **kode nyata, bukan komentar**: `GO_SEED_CSV` di
>    `apps/api/scripts/mslseed/csv.test.ts` membaca `seed/msl_kalkulator.csv` dari pohon Go.
>    Berbahaya karena tesnya `it.skipIf(!existsSync(...))` — path yang salah akan **diam-diam jadi
>    skip**, bukan merah. Diverifikasi jalan: 16/16 hijau termasuk cek byte-identical.
> 5. ✅ **Matikan service Railway — SELESAI 2026-09-05, dieksekusi pemilik (Nerissa).** Dump final
>    MySQL diambil & disimpan di luar GitHub lebih dulu (dikonfirmasi 2026-09-04). **C-05 kini 5/5
>    dan jalur cutover Go/MySQL → TS/Supabase TUTUP SEPENUHNYA.**

### Spesifikasi asli (untuk rujukan)

Baru dikerjakan **setelah** gate go/no-go GO. Sesuai OQ-8: Go+MySQL **diarsip read-only**.

> **✅ Dua prasyarat C-05 sudah ditutup pemilik 2026-07-30** (DECISIONS.md) — C-05 sekarang
> menunggu **gate GO saja**:
> - **O47 RESOLVED** — `cmd/import` **ditinggalkan**, tidak diport. Riwayat klien pra-CDPS cukup
>   hidup di spreadsheet. Konsekuensi: **Fase 3 pensiun Go selesai 4/4** dan **T3 gugur**
>   (`POST /leads/bulk` sendiri tetap hidup — jalur operasional, bukan historis).
> - **Retensi PII RESOLVED** — `backend/testdata/import_samples/` (7 CSV + README) **sudah dihapus
>   dari repo**, jadi butir 2 di bawah tidak lagi berisiko mengarsipkan roster HR riil.
>   `go vet`/`go build`/`go test ./cmd/... ./internal/seed/...` diverifikasi **hijau** sesudahnya
>   (`backend/testdata/employees.csv` yang tersisa adalah fixture sintetis yang dibaca `cmd/cdps`).
>   ⚠️ **Sisa yang masih terbuka:** PII tetap ada di **histori git** — scrub butuh `git filter-repo`
>   \+ re-clone terkoordinasi, keputusan & eksekusi pemilik.

1. **CI:** hapus job `backend` (Go + service MySQL) dari `.github/workflows/ci.yml` — saat ini masih menjalankan `go vet`/`go test`/migrasi MySQL atas kode beku (buang waktu CI & bisa merah palsu). Sisakan job `api`, `core-engines`, `db-and-migrations`, `web-internal`.
2. **Repo:** arsipkan `backend/` (opsi: pindah ke `archive/backend-go/` + README "read-only, referensi paritas", atau tag rilis terakhir lalu hapus). **Jangan hapus tanpa tag** — dan sejak O47 diputus *"tinggalkan"*, tag itu jadi **satu-satunya tempat** spesifikasi tiga alur klien `cmd/import` (`gen-form`, `clients-dryrun/apply`, `dormant-dryrun/apply`) masih bisa dibaca. Menghapus tanpa tag membuat keputusan O47 tak bisa dibatalkan. Catatan: Go **bukan lagi** oracle paritas satu-satunya untuk bentuk respons — `apps/api/src/lib/shape-parity.test.ts` ber-anchor tipe FE dan **selamat** dari pengarsipan ini (89 converter, `NESTED_INLINE_UNCHECKED` kosong).
3. **Config mati:** `backend/railway.json`, `web-internal/railway.json`, `backend/Dockerfile`, `docs/DEPLOY_RAILWAY.md` → tandai deprecated/arsip.
4. **Docs:** perbarui `CLAUDE.md` (§Stack: Go→TypeScript/Next di Vercel, MySQL→Supabase Postgres) + entri `DECISIONS.md` "cutover selesai, Go diarsip".
5. **Infra:** matikan service Railway (**manual, Anda** — Claude tak punya akses Railway). Simpan backup DB MySQL terakhir sebelum dimatikan → `docs/handoff/RUNBOOK_BACKUP_MYSQL_RAILWAY.md` (skrip + workflow sudah ada; verifikasinya 4 lapis, bukan sekadar `mysqldump`).

**DoD:** CI hijau tanpa job Go; `CLAUDE.md` mencerminkan stack sebenarnya; Railway mati & ter-backup.

---

## C-06 — `web-client-portal` (M15-C2) 🟡 SEBAGIAN BESAR MENDARAT lewat Gelombang 1 — O4/O5 RESOLVED

> ### ✅ Dikoreksi 2026-09-04 — paragraf di bawah ("masih hanya `README.md`") sudah BASI
> `web-client-portal` punya **9 halaman** di `main`: `login`, `lupa-password`,
> `reset-password`, `(portal)/` beranda, `(portal)/laporan`, `(portal)/laporan/[id]`,
> `(portal)/progres`, `(portal)/komplain`, `(portal)/akun/password` — plus **realm auth
> terpisah**, data layer allow-list, CSP, dan **19 tes** dengan `npm run build` sukses.
> Semua mendarat lewat **CR-09** (Gelombang 1, `HANDOFF_INSIGHT_EDITABLE_CLIENT_PORTAL_20260908.md`),
> di atas domain `client-portal.ts` (22 tes) + `client-portal-auth.ts` dan 5 rute portal.
> **Sisa C-06 = audit ulang M15-G3…G7 terhadap yang sudah ada**, bukan membangun dari nol.
> Yang secara sadar TIDAK dibangun di Gelombang 1 dan tetap terbuka: surface
> invoice/pembayaran (OQ-6: nol di v1) dan riwayat komplain untuk klien (M15 Rule 6
> submit-only).

_Paragraf asli 2026-07-28:_ Masih hanya `README.md` — belum ada kode/migrasi ditulis. Prasyarat **O4/O5 RESOLVED 2026-08-31** (`docs/DECISIONS.md`; spec final `docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md`, kesepuluh Open Question dijawab pemilik). M15-C2 boleh dijadwalkan sebagai klaster kerja normal (Rules → Flow → Example → System Requirements → PR kecil per klaster, pola M15-C1) — auth realm mengikuti pola LT-61 vendor (`supabase/migrations/20260903010000_lt61_vendor_auth.sql`), bukan `local.go` Go yang sudah pensiun. **Realm auth terpisah + data layer allow-list** — bukan view internal yang di-trim izin (`CLAUDE.md`). Tidak memblokir cutover.

---

## 2. Gate & exit criteria

**Gate go/no-go cutover (PIC: Yohan & Nerissa — OQ-1):**
- [x] **C-00 selesai** — CI hijau kembali (run `30328573444`); `main` re-run hijau (run `30278802079`), PR #55–#57 tervalidasi.
- [x] **C-01 selesai** — O37 tertutup di DECISIONS (opsi c).
- [x] **C-02 selesai** — badge & halaman notifikasi hidup (2026-07-28; §C-02 di atas sudah RESOLVED, kotak ini sebelumnya tertinggal tidak tercentang).
- [x] **C-03 SELESAI 2026-07-31 — dijalankan terhadap deployment produksi, FAIL = 0.** Run `30600363211` (job `uat`, di-approve pemilik di environment `c03-production`): walk aturan rumah **22/22** · wave3 contract smoke **34/34** · auth smoke **13/13** — **PASS 69 · FAIL 0**, nol SKIP di ketiga skrip. **SKIP-1 dan SKIP-3 TERTUTUP.** Report: `docs/handoff/CUTOVER_UAT_REPORT_20260731.md`. **SKIP-2 (badge notifikasi) DIPINDAHKAN ke C-04, bukan dihapus** — keputusan `DECISIONS.md` 2026-07-31 (PR #87): ia QA UI, bukan paritas, dan menahan seluruh C-03 karena satu cek browser 3 menit menyembunyikan bahwa paritasnya sudah tuntas. 🟠 **Konsekuensi yang harus dibaca bersama C-04:** slot `finance_staff` walk terisi fixture O50 `9900000007` (report §5.3) ⇒ sesudah fixture dinonaktifkan, **walk wajib dijalankan ulang** — kalau tidak, discovery tidak menemukan aktor Finance dan baris itu jatuh jadi SKIP.
- [x] **C-04 — SELESAI 2026-09-04 (diketok Nerissa, COO).** Yang mengubah statusnya bukan pekerjaan baru melainkan **pembacaan ulang live**: cutover ternyata sudah terjadi de facto sejak ±28 Agustus — `clients` **10**, `transactions` **11**, `installments` **1**, `leads` **348** (bukan 6 data uji seperti yang tercatat 31 Juli), dengan dua transaksi dibuat SALES RIIL: TRX-202608-0010 `lindahijab.id` Rp. 72.150.000,00 `[Lunas]` (Maya Amalia, SALES JASA) dan TRX-202608-0009 `Julieete jewelery` Rp. 22.200.000,00 (Mohamad Faesal, SALES JASA); 310 attempt aktif dipegang tim sales asli termasuk HEAD OF SALES JASA. Butir `❌ konfirmasi data Railway riil-atau-UAT` **gugur** — pertanyaannya sudah tidak relevan begitu produksi berjalan sebulan di Supabase. Butir aktor O34/O26/O35/O9 tetap terbuka sebagai pekerjaan operasional biasa, **bukan** penahan gate: tak satu pun menghalangi tim bekerja, dan menahan gate atasnya berarti pura-pura sistem belum dipakai padahal uang riil sudah masuk. _Status lama:_ ~~SEBAGIAN.~~ ✅ MSL 32 layanan ber-versi di live (2026-07-28) · ✅ karyawan riil: **69** di `employees`/`employee_credentials`/`auth.users`/`auth.identities` (69/69/69/69) · ✅ **O42 dieksekusi 2026-07-29** — divisi `Marketing` hidup, `role_mappings` **39**. ~~❌ **O22** impor lead historis~~ → **GUGUR 2026-07-30** (konsekuensi O47: tooling ditinggalkan, produksi mulai dari data bersih) · ❌ keputusan aktor **O34/O26/O35/O9** · ❌ konfirmasi data Railway riil-atau-UAT · ⚠️ `Marketing`/`lead` kosong (struktur organisasi, keputusan sadar).
- [x] **Backup MySQL Railway terakhir tersimpan** + **OQ-2 terverifikasi untuk dekomisi** — **DITUTUP 2026-07-31.** Pemilik menyatakan berkasnya sudah diunduh, disimpan **di luar GitHub**, sha256 **cocok**, dan passphrase ada di password manager; **pelonggaran DoD penyimpanan disetujui** (1 salinan, tanpa PIC kedua — `DECISIONS.md` 2026-07-31 + report §6.1). Verifikasi 4 lapis, sha256, dan syarat "keluar dari GitHub" **tidak** ikut dilonggarkan. **✅ OQ-2 SELESAI 2026-07-31** (run `30604816629`): 50 tabel · 239 baris · **rantai FK jalur uang NOL** ⇒ C-04 butir 1 tidak aktif; batas DECISIONS 2026-07-29 tertutup. **✅ Dump diambil & terverifikasi 4 lapis** (run `30607919027`, sha256 `1b9ecffd…47cb3e`) — dan lapis 4 menyingkap bahwa `mysqldump` polos atas DB ini menghasilkan backup yang MySQL sendiri **tolak muat ulang** (7 trigger ber-`;` nyasar; lihat `BACKUP_MYSQL_RAILWAY_REPORT_20260731.md` §5.1). **❌ Sisa: berkasnya masih hanya artifact ber-retensi 30 hari** — butir ini baru boleh `[x]` sesudah tersimpan di luar GitHub dengan sha256 dicocokkan. Runbook: `docs/handoff/RUNBOOK_BACKUP_MYSQL_RAILWAY.md`. Sama seperti C-03, ia **tidak lagi butuh laptop dengan klien MySQL**: `.github/workflows/railway-mysql-backup.yml` menjalankannya dari GitHub Actions dengan dua repository secret. Dump diverifikasi 4 lapis (struktur · baris · 7 trigger imutabilitas · restore sungguhan) dan **wajib terenkripsi** — repo ini publik dan artifact-nya bisa diunduh siapa saja. Butir ini baru boleh dicentang setelah berkasnya tersimpan **di luar** GitHub (artifact kedaluwarsa 30 hari), sha256 cocok, dan report-nya di-commit.
- [x] **Rencana rollback DITUTUP 2026-09-04 — tanpa angka N, karena N sudah kehilangan artinya.** Keputusan Nerissa (COO): **opsi A — akui cutover sudah terjadi, matikan Railway.** Alasannya dihitung, bukan ditebak: rencana rollback (`RENCANA_ROLLBACK_CUTOVER.md` §0) menetapkan sendiri bahwa yang menutup jendela rollback **bukan tanggal melainkan transaksi riil pertama** — dan peristiwa itu sudah lewat ±28 Agustus. Sesudahnya rollback menuntut importer mundur menyusuri rantai FK `LEAD → ATTEMPT → CLIENT → SERVICE → TRX → INST` yang **sengaja tidak pernah dibangun** (O47). Jadi Railway yang tetap hidup N hari tidak membeli jalan mundur apa pun — ia hanya biaya bulanan plus rasa aman palsu. Nilai ARSIP data lama tetap aman: **dump final MySQL sudah diambil dan disimpan di luar GitHub (dikonfirmasi pemilik 2026-09-04)**. Jaring pengaman yang benar-benar dipakai adalah Skenario A (Vercel *Promote to Production* + backup Supabase), yang tidak menyentuh Railway sama sekali. _Butir lama:_ ~~(Railway tetap hidup N hari pasca-cutover sebelum dimatikan).~~ **Dokumen resmi: `docs/handoff/RENCANA_ROLLBACK_CUTOVER.md`** (PR #87) — kerangka lengkap; **dua prasyarat 🔶-nya (#1 backup, #2 OQ-2) sudah TERPENUHI 2026-07-31** lewat PR #86 dan diperbarui di §3.1. Sisa: prasyarat #3/#4 (Railway hidup? kredensial lama berlaku?) + **satu angka N yang disepakati Yohan+Nerissa**. Draf pertimbangan N = 14 hari ada di `RUNBOOK_BACKUP_MYSQL_RAILWAY.md` §7 (ditandai digantikan).

> Legenda: `[x]` selesai · `[~]` sebagian/bersyarat · `[ ]` belum.
> **✅ GATE GO DIBUKA 2026-09-04 (Nerissa, COO) dan C-05 SUDAH DIEKSEKUSI hari yang sama.**
> Go tidak lagi berjalan di CI — job `backend` dicabut. Oracle paritas untuk **bentuk respons**
> adalah `shape-parity.test.ts` (ber-anchor tipe FE, selamat pasca-arsip); untuk **perilaku**,
> `archive/backend-go/` boleh dibaca tapi tidak dijaga hijau lagi.

**Sesudah GO:** ~~eksekusi C-05~~ ✅ **SELESAI PENUH.** Butir 1–4 dikerjakan 2026-09-04; butir 5
(matikan service Railway) dieksekusi pemilik 2026-09-05. **Nol sisa — jalur cutover tutup.**

---

## 3. Cara verifikasi lokal (dari HANDOFF_FASE1_SESI14, masih berlaku)

```bash
npm install                                   # root workspace (apps/* + packages/*)
npm run typecheck --workspaces --if-present
npm test -w @cdps/core                        # engine + string BI
npm test -w @cdps/api                         # auth cookie/token, wire mappers
(cd apps/api && npm run build)                # gate deploy Vercel
(cd web-internal && npm install && npx tsc --noEmit && npm run build)
```
Integration DB (butuh Postgres 17 + `DATABASE_URL`) — jalankan migrasi `supabase/migrations/*.sql` urut, lalu `supabase/seed.sql`, lalu `npm test -w @cdps/db` & `-w @cdps/domain`.
**Catatan:** suite `@cdps/domain` menuntut **DB fresh** (re-run tanpa drop ⇒ akumulasi notifikasi `scanReminders` bikin false-fail).
Invariant SQL (mirror CI): `supabase/tests/{ident,immutability,rls,auth_claims}_checks.sql`.

---

## 4. Aturan untuk chat lanjutan

1. **Jangan sentuh `backend/`** (beku). Semua perubahan → `apps/api`, `packages/*`, `web-internal`, `supabase/`.
2. Baca PRD modul terkait di `docs/prd/` + `docs/STATE_MACHINES.md` + `docs/DATA_MODEL.md` **sebelum** implementasi.
3. **Nol string BI baru** kecuali diotorisasi & dicatat di DECISIONS (preseden W1-09). Katalog notifikasi **FROZEN 15 event** — jangan tambah sepihak.
4. PR kecil per tiket, sebut tiket + section PRD di commit (mis. "C-02 notifications (Phase 0 §9)").
5. Setiap deviasi/ambiguitas PRD ⇒ **STOP** & tulis baris **Open** di `docs/DECISIONS.md`, jangan pilih diam-diam.
6. Mulai dari **C-01** — ini celah keamanan aktif, bukan sekadar utang teknis.
