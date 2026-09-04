# HANDOFF — sesi 7: PR #278 & #279 MERGED. Gelombang 1–4 tuntas di `main`.

**Tanggal:** 2026-09-04. **BACA INI DULU.** Rantai sebelumnya jadi riwayat:
`…_UI_20260903` → `…_SC08_20260903` → `…_G2G3G4_20260903` → `…_SESI5_20260903`
→ `…_SESI6_20260903`.

> **SESI6 sebagian USANG sekarang.** §0 dan §5 di sana berbunyi "PR draf, masih
> open, jangan merge sendiri" — itu benar SAAT ITU. Pemilik (Yohan) memberi
> instruksi merge di akhir sesi 6, dan keduanya sudah di-merge. Yang MASIH
> akurat dan sering dirujuk dari SESI6: §1.2–§1.4 (keputusan bentuk + dua
> gerbang penolak), §1.6 (empat keputusan tampilan UI), §2 (pola apply migrasi
> live), §4 (enam jebakan). Dari **SESI5**: §2 pola apply migrasi empat langkah
> dan §6 tujuh jebakan lingkungan — keduanya masih berlaku penuh.

**Branch sesi ini:** `claude/baca-handoff-lanjutkan-task-pftmbi` — sudah
di-reset dari `origin/main` pasca-merge (PR-nya sudah merged, jadi pekerjaan
lanjutan = perubahan segar di atas main, bukan tumpukan baru di riwayat lama).

---

## 0. Posisi persis — SALIN KE SESI BERIKUTNYA

| | |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP`, default branch `main` |
| **Merge** | **#278 → `c11027c`** lalu **#279 → `547f579`**, keduanya merge-commit (BUKAN squash — lihat §1) |
| **`main` sekarang** | Pohonnya **byte-identical** dengan `82007e8`, commit yang CI luluskan 13/13. Merge tidak memperkenalkan kombinasi baru yang belum teruji. |
| **Rencana 4 gelombang** | **G1 ✅ · G2 ✅ · G3 ✅ · G4 ✅ — SEMUA tuntas di sisi kode.** Nol tiket kode tersisa di `CLIENT_REPORT_PORTAL_BACKLOG.md` |
| **Live `CDPS SG`** | ⚠️ **TERTINGGAL SATU migrasi**: `20260910010000_gelombang4_adsscanner.sql`. Live 143 tabel / prefix 39 · `main` 145 / 40. G2+G3 sudah diterapkan sesi 5. |
| **Keputusan pemilik terbuka** | **NOL** untuk G1–G4. Sisa: **SCR-UI-1** (nice-to-have) + **O65** (ledger migrasi live, lama terbuka) |
| **⚠️ Belum pernah terjadi** | (a) belum ada laporan (TikTok/Shopee) yang **diterbitkan lalu dibaca kontak klien sungguhan**; (b) **Ads Scanner belum pernah kena export TikTok ASLI**; (c) atribusi `MTR-` belum kena klien yang punya kampanye `Shopee Ads` aktif. Ketiganya aksi pemilik/AM. |

---

## 1. Kenapa merge-commit, bukan squash — jangan diulang salah

#279 **bertumpuk** di atas #278: 6 commit #278 ada di dalam riwayat #279.
Kalau #278 di-squash, keenam commit itu runtuh jadi satu commit baru, sementara
#279 masih membawa keenam aslinya — merge #279 lalu mencoba menerapkan ulang
perubahan yang sudah ada, dan hasilnya konflik atau perubahan ganda.

**Urutannya juga bukan selera:** #278 dulu, baru #279. Kalau #279 di-merge
duluan, ia menyeret commit #278 ke `main` sekalian, dan #278 jadi PR ber-diff
nol yang membingungkan riwayat.

Pola yang sama berlaku untuk tumpukan berikutnya (preseden: #276→#277).

---

## 2. LANGKAH #1 SESI BERIKUTNYA — terapkan migrasi G4 ke live

Ini sekarang **tidak lagi terblokir** (sesi 6 menahannya karena PR belum
merge; sudah merge). Ini pekerjaan terkecil risikonya dari semua yang tersisa
dan ia **memblokir pemakaian nyata** — tanpa ini `/ads/scanner` di produksi
akan 500 di setiap query.

**Berkas:** `supabase/migrations/20260910010000_gelombang4_adsscanner.sql`

**WAJIB pakai `mcp__Supabase__apply_migration` per berkas, BUKAN
`supabase db push`** (O65: ledger live memakai timestamp saat apply, jadi nama
berkas repo tidak cocok dan `db push` akan mencoba menerapkan ulang ~100
migrasi yang isinya sudah ada, lalu gagal massal di `CREATE`).

**Pola empat langkah (SESI5 §2, jangan dikarang ulang):**

1. Diff daftar relasi live vs lokal-pra-migrasi **DUA ARAH** — nol drift baru
   boleh apply.
2. Cek tabel yang kena `ADD CONSTRAINT` benar-benar kosong / lolos
   constraint-nya.
3. Grep DDL-nya lebih dulu: nol `DROP`/`UPDATE`/`TRUNCATE`.
4. Sesudah apply, cocokkan gate hitungan dengan lokal.

**Yang memudahkan migrasi INI dibanding yang sebelumnya** (sudah diverifikasi
saat menulisnya):

- Murni `CREATE TABLE` + `CREATE INDEX` + `CREATE TRIGGER` + `INSERT`. **Nol**
  `DROP`/`UPDATE`/`TRUNCATE`, **nol** `ALTER TABLE` pada tabel yang sudah ada.
- Satu-satunya sentuhan ke tabel lama: `INSERT INTO entity_prefix` satu baris
  (`ASR`).
- Karena tidak ada `ADD CONSTRAINT` pada tabel berisi, langkah (2) trivial.

**Gate yang harus cocok sesudah apply:**

```
tabel public    145   (dari 143)
entity_prefix    40   (dari 39, +ASR)
sm_machines      31   (TETAP — scan tidak punya siklus status)
notif_events     67   (TETAP — alat kerja internal, nol event katalog baru)
```

Sesudah berhasil: catat di `DECISIONS.md` (pola baris "Migrasi Gelombang 2+3
DITERAPKAN ke live" sesi 5), dan perbarui baris **Live `CDPS SG`** di §0
handoff berikutnya.

---

## 3. Sisa pekerjaan, berurut

1. **Migrasi G4 ke live** — §2 di atas.
2. **UAT Ads Scanner dengan export TikTok Shop ASLI.** Jalur terbesar yang
   tersisa dan yang paling mungkin memunculkan temuan nyata. Sisi TikTok belum
   pernah kena data sungguhan **untuk dua mesin sekaligus** (laporan TikTok dan
   Ads Scanner). UAT Shopee yang setara memunculkan **SHP-1** (GMV kotor =
   bersih, selisih Rp 295 juta) dan **SHP-3** (3 berkas mendarat di slot SALAH)
   — dua bug yang **tidak satu pun test sintetis menangkap**. Butuh berkas dari
   pemilik/AM: Analitik Produk, Ads Produk, Video Kreator, Video Toko, Ads Live.
3. **Verifikasi temuan O67 bersamaan dengan UAT itu.** Filter blocker status
   produk `!/aktif/i.test(status)` (`packages/core/src/adsscanner/tiktok/skor.ts`)
   adalah substring polos **tanpa batas kata**, jadi "Nonaktif"/"Dinonaktifkan"
   (bentuk NEGASI, sama-sama mengandung "aktif") terbaca AKTIF dan **tidak
   diblokir**. Diport apa adanya dengan komentar peringatan (port setia, O67) —
   tapi sekarang ia jalan di produksi. Cek terhadap string status asli Seller
   Center; kalau memang salah, perbaikannya kecil (batas kata) TAPI mengubah
   isi bucket `DIBLOKIR`, jadi butuh entri `DECISIONS.md` karena menyimpang
   dari port setia.
4. **`adslive`** — slot diterima tapi tidak pernah dibaca engine (port setia
   atas input mati-tapi-tak-berbahaya). Menunggu keputusan manusia apakah Ads
   Live layak jadi komponen skor. UI sengaja **tidak** menagih berkas itu.
5. **UAT lain milik pemilik/AM:** (a) terbitkan satu laporan ke kontak klien
   sungguhan dan pastikan terbaca di portal; (b) uji atribusi `MTR-` dengan
   klien yang PUNYA kampanye `Shopee Ads` aktif.
6. **SCR-UI-1** (perlukah divisi Ads bisa me-LIST klien?) — tidak blocking, tapi
   sekarang relevan untuk DUA halaman (`/ads/screening` dan `/ads/scanner`),
   jadi menjawabnya sekali menguntungkan keduanya. Portofolio Ads Scanner sudah
   meringankan gejalanya tanpa melebarkan RLS (tombol "scan baru" per klien yang
   sudah punya scan), jadi urgensinya turun — bukan hilang. Melebarkan
   `clients_select` tetap keputusan akses data yang butuh entri sendiri.
7. **Tiket kosmetik/utang kecil** kalau ada waktu:
   - kelas badge `badgeSuccess`/`badgeWarning`/`badgeDanger` **tidak ada** di
     `globals.css` — badge di `ReportPanel` tampil tanpa warna sejak Gelombang 1
     (SESI5 §6.6). Kode baru pakai `badge-green`…`badge-darkgray` yang benar.
   - 1 error lint `react-hooks/static-components` di
     `web-internal/src/app/(shell)/admin/employees/page.tsx` — PRE-EXISTING, CI
     tidak menjalankan lint `web-internal` (SESI5 §6.5).
   - **Dua test domain yang rapuh** (lihat §5) — layak tiket sendiri.

---

## 4. Verifikasi — angka `main` saat ini

Diukur pada DB hasil `scripts/db-rebuild.sh` **fresh**, pada pohon yang
sekarang ada di `main`:

```
db-rebuild    172 migrasi · 145 tabel · entity_prefix 40 · 4 invariant SQL LOLOS
@cdps/core    530/530
@cdps/db      53/53
@cdps/domain  1801 lulus / 1 skip
@cdps/api     398/398
web-internal  506/506 · tsc bersih · next build hijau (/ads/scanner terdaftar)
web-client-portal  19/19
typecheck     4 workspace + web-internal bersih
eslint        @cdps/api --max-warnings 0 bersih
CI            13/13 job hijau di 82007e8 = pohon `main` sekarang
```

Cara menjalankan ulang (lingkungan sesi baru):

```bash
service postgresql start                       # container restart mematikannya
su postgres -c "psql -c \"alter user postgres password 'postgres'\""
npm ci                                         # root (apps/* + packages/*)
cd web-internal && npm ci && cd ..             # TERPISAH — bukan npm workspace!
bash scripts/db-rebuild.sh --yes
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
npm test --workspaces --if-present
npm run typecheck --workspaces && npm run lint -w @cdps/api -- --max-warnings 0
cd web-internal && npm run typecheck && npm test && npm run build
```

---

## 5. Jebakan yang akan memakan waktu Anda (kumulatif)

**Dari sesi ini:**

1. **Suite `@cdps/domain` HANYA hijau di DB yang baru `db-rebuild.sh`, sekali.**
   `admin.test.ts` ("hari libur") dan `client.test.ts` ("Hold Service two-step")
   menghitung baris `audit_log`/notifikasi milik mereka sendiri dengan `toBe(1)`,
   tapi `audit_log` immutable sehingga cleanup mereka tidak bisa menghapusnya.
   Jalankan suite dua kali tanpa rebuild ⇒ `expected 7 to be 1` (angkanya =
   berapa kali Anda menjalankannya). **Pre-existing, bukan dari Gelombang 4** —
   tapi ia akan membuat Anda mengira diff Anda merusak sesuatu. **Rebuild dulu
   sebelum percaya kegagalan di dua berkas itu.**
2. **Squash pada PR bertumpuk = konflik.** Lihat §1.
3. **`normId` memotong ID ke 15 digit pertama** — fixture test WAJIB berbeda di
   dalam 15 digit itu, bukan di digit ke-16. Dua ID yang beda di ekor jadi kunci
   join yang SAMA, SKU kedua menimpa yang pertama, dan kegagalannya terbaca
   seperti bug engine (bukan).
4. **Jangan `delete from audit_log`** di `afterEach` — immutable, dan
   percobaannya membuat SETIAP test di berkas itu merah dengan pesan yang
   menutupi kegagalan asli.
5. **OD dan Director adalah FLAG** di `permission.makeRole({od:true})` /
   `{director:true}`, **bukan** `level`. `Actor` juga membawa `divisi` di
   samping `role`.
6. **`JsonParam` bukan export `@cdps/db`** — alias LOKAL per modul
   (`Parameters<TransactionSql['json']>[0]`). Interface TS tidak memenuhi index
   signature `JSONValue`, jadi payload/config butuh `as unknown as JsonParam`.
7. **Persentase payload Ads Scanner adalah FRAKSI** (`0.05` = 5%), payload SKU
   Screener **percent-NUMBER** (`2.0` = 2%). Karena itu
   `adsscanner-ui.ts:fmtPct` MENGALIKAN 100 dan `skuscreener-ui.ts:fmtPct`
   TIDAK. **Jangan "rapikan" jadi satu formatter generik** — gagalnya bukan
   crash, tapi CTR 5% yang terbaca `0,05%` atau `500%`. Ada test yang memaku
   kedua arah.

**Masih berlaku dari SESI5 §6** (tujuh jebakan lingkungan, tidak diulang di
sini): `web-internal` bukan npm workspace · Postgres mati tiap container
restart · `route-parity` bisa hijau secara VAKUUM (probe langsung!) ·
`shape-parity` butuh DUA pendaftaran per `*Wire` baru · lint & badge
pre-existing · data klien tidak masuk repo.

---

## 6. Peta berkas Gelombang 4 (semua sudah di `main`)

**Engine (O67, mendarat lebih dulu):** `packages/core/src/adsscanner/tiktok/`
— `detect` → `metrik` → `skor` → `insight` → `payload` → `render` → `run`,
murni & DOM-free. Payload `cdps.adsscanner.tiktok.v1`.

**Migrasi:** `supabase/migrations/20260910010000_gelombang4_adsscanner.sql`.
Headernya memuat rationale "kenapa bukan `client_reports`" (tiga alasan yang
berdiri sendiri) dan "kenapa `konfigurasi` jsonb bukan 11 kolom" — **baca
sebelum mengubah bentuknya.**

**Domain:** `packages/domain/src/adsscanner.ts` (`runAdsScan`,
`getAdsScanRun`, `listAdsScanRuns`, `adsScanPortfolio`, `renderAdsScanHtml`,
`adsScanCategories`), didaftarkan di `packages/domain/src/index.ts`.

**Test:** `packages/domain/src/adsscanner.domain.test.ts` (36 test, namespace
`ZZAS-`). Math engine-nya TIDAK diulang di sini (sudah 30 test di
`packages/core/src/adsscanner/tiktok/adsscanner.test.ts`). Yang diuji: deteksi
4 slot + kedua gerbang penolak, immutability (UPDATE dan DELETE),
izin per peran termasuk OD/Director berlapis, **recompute-from-payload**, dan
row-scope portofolio.

**Rute (6):** `apps/api/src/app/api/v1/adsscanner/**` (4) +
`apps/api/src/app/api/v1/clients/[id]/adsscanner/**` (2).
Wire: `apps/api/src/lib/wire.ts` (`adsScanRun*ToWire`,
`adsScanPortfolioRowToWire`).

**FE:** `web-internal/src/lib/adsscanner.ts` (tipe wire + pembaca payload +
fetch + gate), `web-internal/src/lib/adsscanner-ui.ts` (+ `.test.ts`, 19 test),
`web-internal/src/components/adsscanner/{PortfolioTable,ScanResultView}.tsx`,
halaman `web-internal/src/app/(shell)/ads/scanner/page.tsx`, baris nav di
`web-internal/src/lib/nav.ts`. Didaftarkan di `shape-parity.test.ts` **dua
tempat**: `WIRE_TO_FE` map DAN `FE_FILES` array.

**Prefix:** `packages/core/src/ident.ts` (`ASR`); gate hitungan di
`scripts/db-rebuild.sh` + `.github/workflows/ci.yml` (dua gerbang untuk angka
yang sama — naikkan KEDUANYA atau lokal hijau & CI merah).

**Rencana & backlog:** `docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md` (§7 punya
blockquote status yang mencatat dua premisnya yang kedaluwarsa dan satu poinnya
yang TERBALIK), `docs/backlog/CLIENT_REPORT_PORTAL_BACKLOG.md` (AS-01..AS-05
semuanya ✅).

**Keputusan:** `docs/DECISIONS.md` — dua baris teratas: AS-05 (tujuh
sub-keputusan tampilan + dua ralat) dan Gelombang 4 AS-01..AS-04 (delapan
sub-keputusan (a)–(h) + daftar "yang TIDAK dikerjakan").
