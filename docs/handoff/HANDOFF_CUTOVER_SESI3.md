# HANDOFF — Cutover Sesi 3 (C-02 ✅ · C-03 ✅ bersyarat · O38 ✅ · sisa: C-04)

> **Dokumen standalone.** Lanjutkan chat berikutnya dari file ini.
> Tanggal: 2026-07-28. Pendahulu: `HANDOFF_CUTOVER_SESI1.md` → `HANDOFF_CUTOVER_SESI2.md`.

---

## 0. JAWABAN SINGKAT — apakah migrasi Supabase sudah selesai?

**Port kode-nya: SELESAI. Cutover-nya: BELUM.** Dua hal berbeda yang sering tertukar.

| Lapisan | Status |
|---|---|
| **Port Go → TypeScript/Supabase** (161 route, 7 engine, 20 modul domain) | ✅ **SELESAI**, sudah ter-merge di `main` |
| **Skema DB** — repo `supabase/migrations/` = project live `CDPS SG` | ✅ **SELESAI sesi ini** (O38) |
| **Verifikasi paritas** (C-03) | ✅ FAIL = 0, **tapi bersyarat** — 3 SKIP butuh akses deployment |
| **Cutover data + aktor produksi** (C-04) | ❌ **BELUM** — ini pekerjaan besar berikutnya |
| **Retire Go** (C-05) | ❌ belum (memang sesudah cutover) |
| **Client Portal** (C-06) | ⏸️ ditunda by design (O4/O5) |

**Sisa jalur ke go-live:** `C-03 (3 SKIP)` → **C-04** → gate go/no-go manusia → `C-05`.

**Tabel bisnis di `CDPS SG` masih KOSONG** (diverifikasi 2026-07-28):
`clients` 0 · `transactions` 0 · `services` 0 · `campaigns` 0 · **`master_services` 0** ·
`leads` 3 & `prospect_attempts` 3 (sisa UAT). Yang sudah terisi: `employees` **68**,
`employee_credentials` **68**, `role_mappings` **38**, `employee_layered_roles` **7**.

---

## 1. LOKASI TERAKHIR — mulai dari sini

| Item | Nilai |
|---|---|
| **Branch kerja** | `claude/handoff-cutover-sesi1-yh3o39` |
| **HEAD** | `b6eb5ee` — working tree **bersih**, semua ter-push |
| **Base** | `claude/cdps-supabase-migration-enh0gp` @ `94513a1` (= head PR #59) |
| **PR sesi ini** | **#60** (draft, **stacked** → base PR #59) — CI **hijau 5/5**, Vercel **Ready 2/2** |
| **PR pendahulu** | **#59** (draft → `main`) — **masih terbuka, belum di-merge** |
| **Rencana induk** | `docs/backlog/CUTOVER_BACKLOG.md` ⟵ **baca ini dulu** |
| **Report UAT** | `docs/handoff/CUTOVER_UAT_REPORT_20260728.md` |
| **Log keputusan** | `docs/DECISIONS.md` (4 entri Decided 2026-07-28 + O37/O38/O39 resolved) |
| **Tiket berikutnya** | **C-04** — cutover data + aktor produksi |

### ⚠️ URUTAN MERGE — jangan dibalik

Merge **#59 dulu, baru #60**, dan **jangan deploy migrasi dari `main` di antara keduanya**.

Alasannya konkret: PR #59 masih memuat migrasi C-01 versi lama
(`20260102000005_rls_leads_campaign_scope.sql`, memanggil `public.jwt_owns_lead`) yang
**terbukti gagal apply** ke `CDPS SG`. PR #60 yang memperbaikinya (rename → `…0009` +
`private.*`). Sendirian, #59 akan mematahkan deploy.

Alternatif yang juga aman: ganti base #60 ke `main` setelah #59 masuk, lalu merge #60
sebelum ada deploy migrasi apa pun.

---

## 2. Yang selesai sesi ini (3 commit)

```
b6eb5ee fix(db)!: O38 opsi A — repo migrasi mengikuti skema live CDPS SG
8bd2a3a test(cutover): C-03 UAT paritas — NO-GO, 1 blocker (drift skema) + perbaikan 500 quote-preview
b5e236b feat(api): C-02 — endpoint notifications (inbox + mark-read) & konfirmasi deviasi 404
```

### C-02 — endpoint `notifications` ✅
Route-nya sebelumnya **nol file**, jadi badge & halaman notifikasi FE memang rusak.
- `packages/domain/src/notification.ts` (baru): `list`/`unreadCount`/`inbox`/`markRead`/`parseId`
- `GET /api/v1/notifications` (+`?unread=1`) lewat **`readAsActor`**; filter menyaring
  **daftar saja**, `unread_count` tetap total (paritas Go — badge sama di kedua tab)
- `POST /api/v1/notifications/{id}/read` lewat RPC `mark_notification_read`. **Tidak ada DELETE**
- Nol migrasi, nol event baru (**15 FROZEN**), nol string BI baru

**Dua perilaku sengaja — jangan "diperbaiki" tanpa baca alasannya:** mark-read
**idempoten & senyap** (id orang lain → 200, 0 baris berubah; 404/403 akan membocorkan
apakah id itu ada), dan modul ini **mengulang predikat kepemilikan di SQL** karena
`notifications_select` adalah satu kesamaan tunggal yang *adalah* definisi kepemilikan
(bukan multi-arm seperti `leads_select`), sementara jalur tulis berjalan sebagai
service-role tanpa policy sama sekali.

### Deviasi 404 dikonfirmasi ✅
**Nol kode berubah** — perilaku sudah terpasang sejak C-01; statusnya naik dari
*menunggu konfirmasi* → *disetujui*. Baca satu lead lintas-scope → **404**; endpoint
LIST → **403** ber-pesan BI.

### C-03 — UAT paritas ✅ (FAIL = 0, bersyarat)
Report lengkap: `docs/handoff/CUTOVER_UAT_REPORT_20260728.md` — **PASS 77 · FAIL 0 · SKIP 3**.
Alat baru: **`apps/api/scripts/cutover-houserules-walk.mjs`** — menguji ketujuh house
rules Phase 0 di **batas HTTP** sebagai beberapa role, plus Role Matrix, jalur baca O37,
dan permukaan notifikasi C-02. **21/21 PASS**. Skrip inilah yang menemukan C03-F2.

### C03-F2 — bug jalur uang, ditemukan & diperbaiki ✅
`POST /api/v1/sales/quote-preview` **selalu 500** (`Do not know how to serialize a BigInt`)
— kalkulator harga & komisi salesperson **rusak total** di produksi. Tiga cacat dalam satu
route: bigint tak bisa di-serialize (Go menandai field yang sama `json:"-"`), amplop
`{quote}` padahal FE & Go pakai **top-level**, dan casing camelCase padahal kontrak FE
snake_case. Diperbaiki dengan `quoteToWire` + 3 test regresi.
**Lolos selama ini** karena test domain memanggil `buildQuote` langsung (bigint sah di JS)
dan route ini satu-satunya yang **tidak punya** wire mapper.

### O38 — repo migrasi = skema live ✅ (blocker cutover, ditutup)
**4 migrasi yang hanya hidup di produksi** di-back-port **verbatim** (tidak dirapikan —
repo harus mereproduksi produksi, bukan tafsirannya):
`…0005_fk_covering_indexes` · `…0006_employee_display_name` · `…0007_change_password` ·
`…0008_harden_secdef_helpers_to_private_schema`.
Migrasi C-01 dinomori ulang `…0005` → **`…0009`** dan dibuat **sadar-schema**
(`private.jwt_owns_lead`; helper baru dibuat di `private` supaya lint 0029 tak hidup lagi).
`rls_harden_execute_surface` **sengaja tidak** di-back-port — diverifikasi isinya sudah
identik dengan `rls_baseline` §9.

**Bukti paritas (rebuild 36 migrasi vs `CDPS SG`):** tabel 53/53 · kolom 526/526 ·
fungsi `public` 23/23 · policy 44/44 · trigger 24/24 · index **122/122** (repo tadinya 119).
Schema `private` 5 vs 4 — delta **persis** `jwt_owns_lead_campaign` = perubahan C-01 yang
memang belum di-deploy. **Migrasi yang tadinya gagal kini apply BERSIH 36/36.**

### O39 — diputuskan: dibiarkan ✅
Pintu registrasi lead tetap tanpa gate role (OD & divisi non-Sales bisa bikin lead).
Sama seperti Go yang lolos UAT W1 ⇒ paritas terjaga, bukan regresi. Penyimpangan terhadap
`CLAUDE.md` §6 diterima sebagai **utang terdokumentasi**.

---

## 3. Bukti verifikasi (semua dijalankan ulang setelah O38)

| Gate | Hasil |
|---|---|
| **CI PR #60** | **hijau 5/5** — `db-and-migrations` · `backend` · `api` · `core-engines` · `web-internal` |
| Vercel | **Ready 2/2** |
| `typecheck --workspaces` | bersih (4 workspace) |
| `@cdps/core` · `db` · `domain` · `api` | **112** · **9** · **422** · **104** |
| Invariant SQL | ident · immutability · **rls** · auth_claims → **PASS** |
| House-rules walk | **21/21** |
| Kontrak FE↔API Wave 3 | **34/34 wired** |
| auth-smoke | **12/13** (1 = artefak seed, lihat §5 SKIP-3) |
| `next build` | hijau — `apps/api` & `web-internal` |
| Jumlah tabel | **53** |

---

## 4. TIKET BERIKUTNYA — C-04 (cutover data + aktor produksi)

Uraian lengkap: `docs/backlog/CUTOVER_BACKLOG.md` §C-04. Ini **pekerjaan terbesar yang
tersisa** dan sebagian besar **memblokir pada keputusan manusia**, bukan pada kode.

### 4.1 Data
1. **Konfirmasi ulang ke pemilik:** data di Railway/MySQL sekarang **riil atau masih UAT**?
   Asumsi tercatat = UAT (OQ-2/A1). Bila ternyata riil ⇒ butuh rencana ekspor-impor
   per-entitas mengikuti rantai FK `LEAD → ATTEMPT → CLIENT → SERVICE → TRX → INST`.
   **Jangan improvisasi — catat keputusan dulu.**
2. **Import karyawan riil** — route sudah ada: `POST /api/v1/admin/employee-import`
   (Director-only, satu transaksi: sync `employees` → provision credentials → link GoTrue).
   Sumber = CSV/spreadsheet admin (OQ-4: endpoint HRIS tidak dipakai lagi).
   **Status: sudah jalan — 68 karyawan + 68 kredensial ada di live.** Verifikasi apakah
   itu roster final atau masih perlu koreksi.
3. **Import lead historis** sesuai **O22** (Pilihan B: `Qualify` ATAU prospek `Hot/Warm`,
   6 bulan terakhir).
4. **🔴 Master Service List masih 0 baris** — **wajib terisi sebelum closing bisa jalan
   sama sekali.** Bahan sudah ada: `docs/handoff/MSL_DRAFT_KOMPILASI.csv` +
   `MSL_KALKULATOR_VALIDASI.md`. Admin UI-nya sudah ada (`/master-services`).
   **Ini kandidat pekerjaan pertama C-04 karena paling konkret dan tidak menunggu siapa pun.**

### 4.2 Keputusan manusia yang masih terbuka (memblokir C-04)
| # | Isi | Butuh dari |
|---|---|---|
| **O34** | Aktor Wave 2 + lead Marketing/BD — butir (a)–(e); kini masih fixture UAT | Pemilik |
| **O33** | Roster HR riil **tidak punya divisi Finance** sama sekali ⇒ seluruh flow M5 tanpa aktor | Pemilik |
| **O26** | NIK + email Director (Yohan & Nerissa) untuk layered role | Pemilik |
| **O35** | Sub-tim Creative M7 §3 (3 keputusan berurutan) | Nerissa |
| **O24/O25** | `commission_rule` riil + anomali sheet kalkulator | Sales Head |
| **O9** | Target periode M14 (non-blocking, `is_placeholder`) | SPV Ads + OD |

**DoD C-04:** tak ada fixture UAT tersisa di jalur produksi; login riil semua role lolos;
MSL terisi & ber-versi.

---

## 5. Sisa C-03 — 3 SKIP (tutup sebelum gate go/no-go)

Ketiganya berakar pada **satu** hal: walk belum pernah menyentuh **deployment Vercel**.
Yang sudah terbukti = **kode + skema**. Yang belum = **konfigurasi deployment**
(env Vercel, kunci JWT **ES256** produksi, perilaku pooler Supabase).

- **SKIP-1** — walk W1/W2/W3 terhadap Vercel `agency-app-api`. **Terhalang environment:**
  network policy sesi ini menolak `*.vercel.app` (`gateway answered 403 to CONNECT`), dan
  kredensial login per-role tidak tersedia.
- **SKIP-2** — QA badge notifikasi di FE ter-deploy (kontrak API-nya sudah terbukti).
- **SKIP-3** — `auth-smoke` `GET /me` cookie → 401. **Bukan cacat kode:** skrip meng-hardcode
  `EMP-202607-0001` yang ada di live (68 karyawan) tapi **tidak ada** di seed lokal 10 baris.
  Diverifikasi: dengan `EMP-0001`, `/me` → **200** lewat bearer maupun cookie.

**Cara menutup ketiganya sekaligus** — dari mesin yang boleh keluar internet:

```bash
export BASE=https://<url-agency-app-api>            # deployment Vercel
export SUPABASE_JWT_SECRET=<secret produksi>        # atau siapkan token ES256
node apps/api/scripts/cutover-houserules-walk.mjs   # target 21/21
node apps/api/scripts/wave3-contract-smoke.mjs      # target 34/34
node apps/api/scripts/auth-smoke.mjs                # target 13/13
```
Lalu perbarui `CUTOVER_UAT_REPORT_20260728.md` → **FAIL = 0 tanpa SKIP**.

---

## 6. Utang teknis yang ditemukan tapi SENGAJA tidak dikerjakan

1. **🟡 Penomoran versi migrasi repo ≠ riwayat remote.** Repo memakai `202601…`,
   riwayat migrasi `CDPS SG` memakai `202607…` (waktu apply). Sudah begitu **sejak awal**
   dan di luar scope O38; deploy selama ini lewat `apply_migration` per-migrasi.
   **Bahaya:** begitu ada yang menjalankan `supabase db push`, CLI akan menganggap
   **seluruh** migrasi belum ter-apply dan mencoba apply ulang.
   **Selaraskan sebelum memakai jalur CLI.** Non-blocking untuk C-03/C-04.
2. **O39** — gate role pintu registrasi lead (sudah diputuskan: dibiarkan).
3. **`clear_must_change_password` & `employee_display_name`** ada di DB tetapi **tidak
   dipanggil kode TypeScript mana pun** (diverifikasi: nol referensi di `apps/`+`packages/`).
   Peninggalan era Go/auth lama. Tidak berbahaya; bersihkan saat C-05 kalau memang mati.

---

## 7. Cara verifikasi (terbukti jalan di sesi ini)

```bash
npm ci                                        # node_modules TIDAK ada di clone baru
npm run typecheck --workspaces --if-present

# Postgres lokal (16 tersedia di sandbox)
PGBIN=/usr/lib/postgresql/16/bin
mkdir -p /tmp/pgdata /tmp/pgrun && chown -R postgres:postgres /tmp/pgdata /tmp/pgrun
su postgres -c "$PGBIN/initdb -D /tmp/pgdata -U postgres --auth=trust"
su postgres -c "$PGBIN/pg_ctl -D /tmp/pgdata -o '-p 5433 -k /tmp/pgrun -c listen_addresses=127.0.0.1' -l /tmp/pg.log start"
createdb -h 127.0.0.1 -p 5433 -U postgres cdps
for f in $(ls supabase/migrations/*.sql|sort); do psql -h 127.0.0.1 -p 5433 -U postgres -d cdps -v ON_ERROR_STOP=1 -q -f "$f"; done
psql -h 127.0.0.1 -p 5433 -U postgres -d cdps -q -f supabase/seed.sql
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cdps"

npm test -w @cdps/core                        # 112
npm test -w @cdps/db                          # 9
npm test -w @cdps/domain                      # 422 — WAJIB DB FRESH (drop+recreate)
npm test -w @cdps/api                         # 104
for t in ident immutability rls auth_claims; do
  psql -h 127.0.0.1 -p 5433 -U postgres -d cdps -v ON_ERROR_STOP=1 -q -f supabase/tests/${t}_checks.sql; done

# Walk terhadap API yang benar-benar jalan
(cd apps/api && npm run build)
(cd apps/api && DATABASE_URL=$DATABASE_URL SUPABASE_JWT_SECRET=lokal npx next start -p 3111 &)
BASE=http://127.0.0.1:3111 SUPABASE_JWT_SECRET=lokal node apps/api/scripts/cutover-houserules-walk.mjs
```

**Catatan sandbox:** proses server bernama `next-server`, **bukan** `next start` —
`pkill -f "next start"` TIDAK akan mematikannya dan port 3111 tetap terpakai
(gejalanya: build lama yang menjawab request, membingungkan saat verifikasi perbaikan).

---

## 8. Aturan main (jangan dilanggar)

1. **Jangan sentuh `backend/`** (Go beku, hanya oracle paritas).
2. Perubahan → `apps/api`, `packages/*`, `web-internal`, `supabase/`.
3. Baca PRD modul di `docs/prd/` + `STATE_MACHINES.md` + `DATA_MODEL.md` sebelum implementasi.
4. **Nol string BI baru** tanpa entri DECISIONS; katalog notifikasi **FROZEN 15 event**.
5. **Semua route baca WAJIB `requireActor` + `readAsActor`** — jangan pernah `db()` di handler GET (itulah O37).
6. **Notifikasi tak pernah bisa dihapus** — jangan pernah menambah route/fungsi DELETE.
7. **Helper RLS SECURITY DEFINER hidup di schema `private`**, bukan `public` — menaruhnya
   di `public` menghidupkan kembali advisor lint 0029.
8. **Setiap route yang mengembalikan objek domain WAJIB lewat wire mapper.** Mengembalikan
   objek domain mentah itulah penyebab C03-F2 (bigint → 500).
9. **Jangan apply migrasi langsung ke `CDPS SG` lewat MCP tanpa menuliskannya ke
   `supabase/migrations/`.** Itu persis yang menciptakan blocker O38.
10. Ambiguitas/deviasi PRD ⇒ **STOP**, tulis baris **Open** di `docs/DECISIONS.md`.
