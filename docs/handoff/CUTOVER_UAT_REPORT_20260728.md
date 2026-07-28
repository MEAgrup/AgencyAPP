# CUTOVER UAT REPORT — C-03 (paritas end-to-end di stack TS/Supabase)

> Tanggal: **2026-07-28**. Tiket: `docs/backlog/CUTOVER_BACKLOG.md` §C-03.
> Basis kode: branch `claude/handoff-cutover-sesi1-yh3o39` (C-00 ✅ · C-01 ✅ · C-02 ✅).
> Oracle paritas: `backend/` (Go, DI-FREEZE — dibaca, tidak disentuh).

---

## 0. VERDICT — **NO-GO** (1 blocker)

| | |
|---|---|
| **PASS** | 76 |
| **FAIL** | **1** (blocker, §2 — C03-F1) |
| **SKIP** | 3 (§4 — semua beralasan, 2 di antaranya terhalang environment) |

DoD C-03 mensyaratkan **FAIL = 0**. Satu blocker tersisa dan **tidak bisa
diselesaikan dari sesi ini** karena menyentuh project Supabase live. Gate go/no-go
manusia **belum boleh** dibuka.

Satu defect lain (**C03-F2**, jalur uang) ditemukan dan **sudah diperbaiki + di-test**
dalam sesi ini.

---

## 1. Ringkasan cakupan

| Area | Alat | Hasil |
|---|---|---|
| House rules Phase 0 (7 aturan) | `apps/api/scripts/cutover-houserules-walk.mjs` **(baru)** | **21/21 PASS** |
| Kontrak FE↔API Wave 3 (M2/M3/M10/M13/M14) | `wave3-contract-smoke.mjs` | **34/34 wired** |
| Auth / JWT / sesi | `auth-smoke.mjs` | **12/13** (1 = artefak seed, §4) |
| Engine + domain + API (DB fresh) | vitest | core **112** · db **9** · domain **422** · api **104** |
| Invariant SQL | `supabase/tests/*.sql` | ident · immutability · rls · auth_claims → **PASS** |
| Build | `next build` | `apps/api` hijau · `web-internal` hijau (60 route) |
| **Drift skema repo ↔ `CDPS SG`** | Supabase MCP + diff lokal | **FAIL — lihat §2** |

Walk W1/W2/W3 dijalankan terhadap **API lokal** (build produksi `next start` +
Postgres 16 dengan 32 migrasi repo + seed), **bukan** terhadap Vercel — lihat
SKIP-1 di §4.

---

## 2. FAIL

### C03-F1 — 🔴 BLOCKER: repo migrasi ≠ skema project live; migrasi C-01 **gagal apply**

**Temuan.** `docs/backlog/CUTOVER_BACKLOG.md` §C-00 mencatat "jumlah tabel remote
dilaporkan lebih banyak dari gate CI 53 — cocokkan saat C-03". Hasil pencocokan:
jumlah tabel ternyata **sama (53/53)** dan **nama tabelnya identik**. Tetapi
pencocokan yang lebih dalam menemukan masalah yang jauh lebih serius.

| Objek | Repo (32 migrasi) | Live `CDPS SG` | Status |
|---|---|---|---|
| Tabel | 53 | 53 | ✅ identik (nama & jumlah) |
| Kolom | 526 | 526 | ✅ |
| Policy RLS | 44 | 44 | ✅ |
| Trigger | 24 | 24 | ✅ |
| Tabel RLS-enabled | 53 | 53 | ✅ |
| View | 0 | 0 | ✅ |
| **Index** | **119** | **122** | ⚠️ 3 index hanya di live |
| **Fungsi `public`** | **26** | **23** | 🔴 beda |
| **Migrasi tercatat** | **32** | **36** | 🔴 beda |

**Akar masalah: 4 migrasi hanya ada di project live dan tidak pernah ditulis ke
`supabase/migrations/`** (di-apply langsung lewat MCP):

- `20260724132631_fk_covering_indexes` → 3 index tambahan.
- `20260724134427_employee_display_name` → fungsi `employee_display_name`.
- `20260724161750_change_password` → fungsi `clear_must_change_password`.
- `20260727072443_harden_secdef_helpers_to_private_schema` → **memindahkan
  `jwt_owns_client` / `jwt_owns_lead` / `jwt_owns_transaction` (+`employee_display_name`)
  dari schema `public` ke schema `private`**, sebagai remediasi advisor lint 0029
  (terdokumentasi di `docs/handoff/SUPABASE_SECURITY_HARDENING_20260727.md`).

(`20260723064826_rls_harden_execute_surface` juga hanya ada di live sebagai migrasi
terpisah, tetapi isinya = §9 `20260102000003_rls_baseline.sql` di repo — beda
pengemasan, bukan beda isi.)

**Dampak konkret — dan ini yang membuatnya blocker.** Migrasi C-01
`20260102000005_rls_leads_campaign_scope.sql` (di PR #59, belum di-merge) menulis:

```sql
CREATE POLICY leads_select ON public.leads FOR SELECT TO authenticated
USING (... OR jwt_owns_lead(id) OR jwt_owns_lead_campaign(id));
```

`jwt_owns_lead` **tidak berkualifikasi schema**. Di repo ia ada di `public`; di
live ia sudah pindah ke `private`. Policy `leads_select` yang live memang sudah
terikat ke `private.jwt_owns_lead`:

```
(jwt_can_read_all() OR created_by = jwt_employee_id()
 OR (jwt_is_lead() AND origin_division = jwt_division())
 OR private.jwt_owns_lead(id))          ← dibaca langsung dari CDPS SG
```

**Bukti empiris (bukan dugaan).** Skema live direproduksi lokal (32 migrasi repo
minus `…0005`, lalu `ALTER FUNCTION … SET SCHEMA private` untuk ketiga fungsi),
dan `leads_select` hasil reproduksi **cocok byte-for-byte** dengan yang live. Lalu
`20260102000005` di-apply ke atasnya:

```
psql:supabase/migrations/20260102000005_rls_leads_campaign_scope.sql:44:
ERROR:  function jwt_owns_lead(character varying) does not exist
```

**Deploy C-01 ke `CDPS SG` akan gagal di tengah jalan.**

Efek samping kedua: migrasi itu juga membuat `public.jwt_owns_lead_campaign`
sebagai `SECURITY DEFINER` + `GRANT EXECUTE ... TO authenticated` — persis pola
yang baru saja dihilangkan hardening 2026-07-27, sehingga **advisor lint 0029 akan
muncul lagi**.

**Kenapa CI tidak menangkapnya.** Gate `db-and-migrations` membangun DB dari
`supabase/migrations/` saja. Di dunia itu `jwt_owns_lead` memang ada di `public`,
jadi migrasi lolos dan CI hijau — sementara produksi akan patah. CI tidak pernah
melihat skema live.

**Rekomendasi (butuh keputusan pemilik — lihat §5, O38).** Dua opsi:

- **(A) Repo mengikuti live (disarankan).** Back-port keempat migrasi live ke
  `supabase/migrations/` dengan urutan yang benar, lalu ubah `…0005` menjadi
  sadar-schema (`private.jwt_owns_lead`, dan `jwt_owns_lead_campaign` dibuat di
  `private` + di-`REVOKE` dari `anon`/`authenticated`). Hasil: repo = live,
  hardening keamanan dipertahankan, CI memvalidasi skema yang sebenarnya.
- **(B) Live mengikuti repo.** Kembalikan keempat fungsi ke `public`. **Tidak
  disarankan** — membatalkan remediasi advisor yang sudah disetujui dan
  menghidupkan lagi 4 WARN lint 0029.

Apa pun pilihannya, C-03 **tidak bisa PASS** sampai repo dan live satu definisi.

---

## 3. Defect yang DITEMUKAN & SUDAH DIPERBAIKI di sesi ini

### C03-F2 — 🟠 `POST /api/v1/sales/quote-preview` selalu 500 (jalur uang M0)

**Gejala.** Setiap quote yang berhasil dihitung berakhir **HTTP 500**:

```
[api] unhandled error →500: TypeError: Do not know how to serialize a BigInt
```

**Akar masalah — tiga cacat sekaligus di satu route.** Route mengembalikan objek
domain **mentah** (`json({ quote })`), padahal:

1. `sales.Quote` membawa `estimasiNilai` / `totalKomisi` bertipe `money.Money`
   = **bigint**, yang `JSON.stringify` **selalu** lempar TypeError. Go menandai
   field yang sama persis `json:"-"` — kontrak itu hilang saat port.
2. **Amplop salah**: FE memanggil `api.post<Quote>('/sales/quote-preview', …)`
   dan Go menulis quote **top-level**; route TS membungkusnya `{ quote }`.
3. **Casing salah**: camelCase, sedangkan kontrak FE (`web-internal/src/lib/sales.ts`)
   snake_case.

Artinya kalkulator harga & komisi yang dipakai salesperson **rusak total** di
produksi — bukan rusak untuk data tertentu.

**Kenapa lolos selama ini.** Test domain memanggil `buildQuote` langsung (bigint
sah di JS), dan test `apps/api` menguji wire mapper — sementara route ini satu-
satunya yang **tidak punya** wire mapper. Tidak ada test yang melintasi batas HTTP-nya.

**Perbaikan.** `quoteToWire` di `apps/api/src/lib/wire.ts` (snake_case, top-level,
hanya string IDR — persis `json:"-"` milik Go + house rule #4: klien tak pernah
menerima skalar uang mentah). Route memakainya.

**Bukti sesudah perbaikan** (HTTP nyata):

```json
{ "lines": [ { "service_id": "MSV-202607-0001", "name": "Ads Management",
    "quantity": 1, "unit": "", "standard_price_idr": "Rp. 10.000.000,00",
    "komisi_idr": "Rp. 500.000,00", "subtotal_idr": "Rp. 10.000.000,00" } ],
  "estimasi_nilai_idr": "Rp. 10.000.000,00", "total_komisi_idr": "Rp. 500.000,00" }
```

3 test regresi ditambahkan, termasuk yang mengunci bug-nya: `JSON.stringify(quote)`
**harus** lempar TypeError sementara `JSON.stringify(quoteToWire(quote))` tidak.

---

## 4. SKIP (beralasan)

**SKIP-1 — walk terhadap Vercel `agency-app-api` tidak dijalankan.** Backlog §C-03
meminta walk terhadap deployment, bukan lokal. **Terhalang environment**: network
policy sesi ini menolak `*.vercel.app` di level proxy —
`gateway answered 403 to CONNECT (policy denial)` untuk
`agency-app-api.vercel.app:443`. Selain itu walk per-role butuh kredensial login
riil tiap divisi, yang tidak tersedia di sesi ini.
**Mitigasi yang dijalankan:** seluruh walk dieksekusi terhadap **build produksi
yang sama** (`next start`, bukan dev server) di atas Postgres 16 dengan 32 migrasi
repo + seed, memakai token per-role yang ditandatangani. Yang **tidak** terbukti:
konfigurasi env Vercel, kunci JWT ES256 produksi, dan perilaku pooler Supabase.
**Untuk diselesaikan:** jalankan ulang skrip §1 dengan `BASE=<url vercel>` +
`SUPABASE_JWT_SECRET` produksi dari mesin yang boleh keluar ke internet.

**SKIP-2 — QA badge notifikasi di FE ter-deploy.** Diwariskan dari C-02. Kontrak
API-nya sudah terbukti (`{ data, unread_count }`, 401 tanpa auth, `[id tidak valid]`),
tetapi render badge di `web-internal` ter-deploy belum pernah dilihat. Sama seperti
SKIP-1, butuh akses ke deployment.

**SKIP-3 — `auth-smoke`: `GET /me` dengan cookie valid → 401.** **Bukan cacat kode.**
Skrip meng-hardcode `EMP-202607-0001`, yang ada di project live (68 karyawan
ter-import) tetapi **tidak ada** di seed lokal 10 baris. Diverifikasi: dengan
`EMP-0001` (ada di seed), `/me` mengembalikan **200** baik lewat bearer maupun
cookie; dengan employee yang tidak ada, 401 justru perilaku yang benar. Akan PASS
sendiri saat dijalankan terhadap deployment (SKIP-1).

---

## 5. Temuan untuk log keputusan

**O38 (BARU, blocking) — sumber kebenaran skema: repo atau project live?**
Lihat §2. Butuh keputusan pemilik antara opsi (A) dan (B). Sampai diputuskan,
**jangan merge PR #59** ke `main` dan jangan deploy migrasi ke `CDPS SG`.

**O39 (BARU, non-blocking) — pintu registrasi lead tidak ber-gate role.**
`POST /api/v1/leads` bisa dipanggil aktor mana pun yang terautentikasi, termasuk
**OD** (yang menurut `CLAUDE.md` §6 read-only) dan divisi non-Sales. Diverifikasi
di walk: OD berhasil membuat lead (201).
**Ini BUKAN regresi cutover** — `backend/internal/httpapi/leads_handlers.go`
(`handleRegisterLead`) dan `module1_leads.Register` juga **tidak punya gate role**,
jadi TypeScript **paritas** dengan Go dan lolos UAT W1 dengan perilaku yang sama.
Yang perlu diputuskan pemilik: apakah house rule §6 harus ditegakkan di sini
(perubahan perilaku dari sistem lama), atau pintu registrasi memang sengaja terbuka.

**Deviasi 404 vs 403 — sesuai keputusan 2026-07-28, dicatat TERDOKUMENTASI, bukan FAIL.**
Diverifikasi di walk: baca satu lead lintas-scope → **404**; endpoint LIST → **403**
ber-pesan BI. Persis seperti yang disetujui.

---

## 6. Detail house rules (21/21)

| # | Aturan | Uji | Hasil |
|---|---|---|---|
| 1 | ID `PREFIX-YYYYMM-NNNN`, dicetak hanya setelah gate wajib | `LEAD-202607-0006`, `PRSP-202607-0006` | PASS |
| 2 | Pesan BI `[...]` verbatim | field kosong → `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` | PASS |
| 3 | Transisi ilegal diblokir **server-side** | New Lead→Qualified ditolak · New Lead→Contacted diterima (200) · ulang → **409 `[transisi status tidak diizinkan]`** | PASS |
| 4 | Audit append-only | `immutability_checks.sql` (audit_log + notifications, UPDATE & DELETE) | PASS |
| 5 | Field turunan read-only | PATCH `total_sales` ditolak | PASS |
| 6 | IDR `Rp. X.XXX.XXX,00` | quote-preview → `Rp. 10.000.000,00` (setelah perbaikan C03-F2) | PASS |
| 7 | Div-by-zero → `—`, bukan error | rollup tim tanpa data → 200, nol `NaN`/`Infinity` | PASS |
| — | Role Matrix | Account staff → Pool **403 BI** · Sales staff → 200 · OD baca semua → 200 · Director → 200 | PASS |
| — | O37 jalur baca | pemilik → 200 · lintas-scope → **404** | PASS |
| — | C-02 notifikasi | tanpa auth **401** · `{data, unread_count}` · `[id tidak valid]` **400** | PASS |

---

## 7. Cara mengulang report ini

```bash
npm ci
# Postgres 16 lokal + 32 migrasi + seed (lihat HANDOFF_CUTOVER_SESI2 §5)
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cdps"
(cd apps/api && npm run build && DATABASE_URL=$DATABASE_URL \
   SUPABASE_JWT_SECRET=c03-uat-local-secret npx next start -p 3111 &)

export BASE=http://127.0.0.1:3111 SUPABASE_JWT_SECRET=c03-uat-local-secret
node apps/api/scripts/cutover-houserules-walk.mjs   # 21/21
node apps/api/scripts/wave3-contract-smoke.mjs      # 34/34
node apps/api/scripts/auth-smoke.mjs                # 12/13 (lihat SKIP-3)
```

Untuk mengulang bukti C03-F1 (butuh DB kedua):

```bash
createdb -h 127.0.0.1 -p 5433 -U postgres cdps_live
for f in $(ls supabase/migrations/*.sql|sort|grep -v 20260102000005); do
  psql -h 127.0.0.1 -p 5433 -U postgres -d cdps_live -v ON_ERROR_STOP=1 -q -f "$f"; done
psql -h 127.0.0.1 -p 5433 -U postgres -d cdps_live -c \
  "create schema if not exists private;
   alter function public.jwt_owns_client(text)      set schema private;
   alter function public.jwt_owns_lead(text)        set schema private;
   alter function public.jwt_owns_transaction(text) set schema private;"
psql -h 127.0.0.1 -p 5433 -U postgres -d cdps_live -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260102000005_rls_leads_campaign_scope.sql
# → ERROR: function jwt_owns_lead(character varying) does not exist
```

---

## 8. Langkah berikutnya

1. **Pemilik memutuskan O38** (repo ikut live, atau live ikut repo). **Blocking.**
2. Eksekusi keputusan itu → repo dan `CDPS SG` satu definisi → CI memvalidasi
   skema yang sebenarnya.
3. Jalankan ulang walk §7 dengan `BASE=<vercel>` dari mesin yang boleh keluar
   internet + kredensial per-role → menutup SKIP-1, SKIP-2, SKIP-3.
4. Perbarui report ini menjadi **FAIL = 0** → baru buka gate go/no-go manusia (C-04).
