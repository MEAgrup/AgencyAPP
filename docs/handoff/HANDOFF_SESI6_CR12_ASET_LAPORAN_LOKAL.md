# HANDOFF — SESI 6: CR-12 (aset dokumen laporan berhenti dari CDN)

> Dibuat 2026-09-05 di atas branch `claude/qa-client-reporting-feature-0pvt4b`,
> setelah R3 (`459502a`) + merge `origin/main@96e845d` (PR #295 KS-4b).
>
> **Sesi 5 (`HANDOFF_SESI5_APPLY_MIGRASI_ROLLBACK_PR_MENGGANTUNG.md`) sudah
> dieksekusi seluruhnya** dan punya banner koreksi sendiri di atas — baca banner
> itu, jangan isi aslinya, untuk §2.2/§3.1/§5.
>
> ⚠️ **Jebakan penamaan berkas di folder ini.** Aturan `CLAUDE.md` "baca handoff
> bernomor tertinggi lebih dulu" **menyesatkan di sini**:
> `HANDOFF_INSIGHT_EDITABLE_CLIENT_PORTAL_20260908.md` punya tanggal nama berkas
> TERTINGGI tapi isinya kerja Gelombang 1 (CR-01…CR-11) yang selesai lama. Rantai
> yang benar-benar mutakhir: `HANDOFF_LANJUT_SEMUA_BUILD_20260904.md` (induk) →
> `…_SESI2/SESI3_20260904.md` → `HANDOFF_REVISI_SALES_CREATIVE_PERFORMA_20260904.md`
> → `HANDOFF_SESI5_…` → **dokumen ini**.

---

## 0. Kerjakan berurutan

1. **Apply migrasi `20260912010000_r3_tahap_funnel.sql` ke live `CDPS SG`** — §1.
   Nomor satu karena kode R3 sudah di `main` tapi skema live belum punya kolomnya,
   jadi `createReport` di produksi akan gagal di `select … tahap_fokus`.
2. **CR-12** — §3. Ini tugas build utama sesi ini, rencananya sudah lengkap dan
   sudah disetujui pemilik.
3. **Beres-beres nol-biaya** — §4. Tiga baris dokumen basi + satu pengerasan
   `<Suspense>`.
4. Jangan sentuh yang ada di §6 tanpa jawaban pemilik.

---

## 1. TUGAS PERTAMA — apply migrasi R3 ke live

### 1.1 Kenapa nomor satu

`packages/domain/src/report.ts:305` sekarang menjalankan:

```sql
select platform, active, client_id, store_link, tahap_fokus from client_platforms …
```

Kolom `tahap_fokus` **belum ada di live**. Ledger live (dibaca 2026-09-05 lewat
`mcp__Supabase__list_migrations`, proyek `egddxfcnrtecheiykhlf`) berhenti di
`20260911080000_harden_wrr_reaggregate_trigger_execute`. Jadi begitu `main`
ter-deploy, **setiap pembuatan laporan TikTok di produksi melempar** sampai
migrasinya di-apply.

### 1.2 Cara mengerjakan

Konvensi O65 — **`apply_migration` per berkas, BUKAN `db push`**, dan bukan
`psql -f` (itu yang melahirkan drift O38):

```
mcp__Supabase__apply_migration
  project_id: egddxfcnrtecheiykhlf
  name: 20260912010000_r3_tahap_funnel
  query: <isi supabase/migrations/20260912010000_r3_tahap_funnel.sql>
```

### 1.3 Gerbang verifikasi sebelum → sesudah

Migrasi ini **nol tabel baru, nol prefix baru, nol mesin state baru** — jadi
keempat angka gerbang harus **TIDAK BERGERAK**:

| Gerbang | Sebelum | Sesudah (harus sama) |
|---|---|---|
| tabel `public` | 145 | 145 |
| `entity_prefix` | 40 | 40 |
| `sm_machines` | 31 | 31 |
| `notif_events` | 69 | 69 |

Yang **harus** berubah, dan wajib diperiksa satu-satu:

```sql
-- 1. kolom baru ada, nullable, tanpa default
select column_name, is_nullable, column_default
  from information_schema.columns
 where table_name = 'client_platforms' and column_name = 'tahap_fokus';
-- harap: YES, NULL   ← kalau column_default TIDAK null, itu BUG (lihat §1.4)

-- 2. CHECK-nya menggigit
select conname from pg_constraint where conname = 'ck_cp_tahap_fokus';
-- lalu buktikan menolak:
--   update client_platforms set tahap_fokus = 'retention' where id = <any>;  ⇒ harus ERROR

-- 3. kolom insight baru
select column_name, is_nullable, column_default
  from information_schema.columns
 where table_name = 'client_report_insight' and column_name = 'tahap_narasi';
-- harap: NO, '[]'::jsonb

-- 4. baris lama tidak rusak
select count(*) from client_report_insight where tahap_narasi <> '[]'::jsonb;
-- harap: 0 (belum ada yang menulis narasi tahap di live)
```

Lalu `mcp__Supabase__get_advisors` (security + performance) — pola yang sama
menemukan `leads_unrespon_tick` terbuka untuk `anon` di sesi 5, jadi jangan
dilewat.

### 1.4 ⚠️ Kenapa `tahap_fokus` SENGAJA tanpa DEFAULT

Kalau ada yang "membantu" menambahkan `DEFAULT 'awareness'`, **setiap klien lama
di live tiba-tiba berfokus Awareness tanpa seorang pun memutuskannya** — dan
laporan berikutnya akan memasang lencana "FOKUS PERIODE INI" atas nama AM yang
tidak pernah memilihnya. `NULL` = belum ditetapkan adalah keadaan yang sah dan
laporannya tetap terbit (ketiga tahap ditampilkan setara, tanpa lencana). Ini
diuji di `report.domain.test.ts` ("accepts a store with no stage set").

---

## 2. Posisi sebenarnya per 2026-09-05

### 2.1 Yang R3 kirim (sudah di branch, PR dibuat sesi ini)

**Permintaan pemilik #1 — laporan per tahap Awareness/Consideration/Conversion.**

- `packages/core/src/report/tahap.ts` **(baru)** — `buildTahap(M, bench, fokus)`:
  anak tangga funnel + tiga blok metrik + belanja media per tahap.
  **Nol angka baru** — semuanya proyeksi ulang metrik yang sudah dihitung lewat
  `div`/`fx` yang sama. Nol jalur input manual.
- Empat seksi baru dirender **setelah** Ringkasan Eksekutif; sembilan seksi
  teknis lama tetap utuh sebagai lampiran (pilihan pemilik: lapisan di atas,
  bukan pengganti).
- `client_platforms.tahap_fokus` — **manual, milik AM**, di-stempel ke
  `payload.tahap.fokus` saat laporan dibuat. Verb-nya `report.setTahapFokus`
  bergerbang `canWriteReport` (AM pemilik / lead Account / Director), **sengaja
  BUKAN** `client.updatePlatform` yang bergerbang `canEditProfile`
  (Lead/OD/Director) — itu akan membuat AM pemilik tidak bisa mengisi satu-satunya
  field yang laporannya minta darinya.
- `client_report_insight.tahap_narasi` — prosa per tahap, ikut revisi
  append-only. **Angka tetap beku; yang bisa disunting hanya sarannya.**

**Permintaan pemilik #2 — QA fitur edit teks + download.** Hasil audit: rantainya
**sudah ada dan jalan** (revisi append-only, gerbang terbit, `InsightEditor`, dua
mode render). Yang ditambal: dua bug nyata, lihat §2.2.

### 2.2 Dua bug yang ketemu saat QA dan sudah diperbaiki

1. **Tombol "Unduh" tidak mengunduh.** `/reports/{id}/html` mengirim `text/html`
   tanpa `Content-Disposition` dan tautannya `target="_blank"`, jadi AM yang mau
   mengirim laporan ke klien harus Ctrl+S dan dapat berkas bernama `html.html`.
   Sekarang `?download=1` → `attachment` dengan nama dari server
   (`Laporan-<Toko>-<periode>[-INTERNAL].html`; nama disusun server karena sufiks
   `-INTERNAL` satu-satunya pembeda dua salinan di folder unduhan). Panel jadi
   empat aksi: Lihat/Unduh × Klien/Internal.
2. **`clientPortal.reportHtml` tidak pernah men-dispatch `payload_schema`.**
   Setiap laporan **Shopee** yang diterbitkan diserahkan ke renderer **TikTok**,
   yang membaca kunci (`kpi.harian`, `kanal.items`) yang tidak ada di payload
   Shopee — jadi satu-satunya halaman yang klien datangi di portal **melempar**,
   bukan merender. Kini mencerminkan dispatch `report.renderReport`.

### 2.3 Bug di kerjaan sendiri, ketangkep smoke test — jangan diulang

Versi pertama `tahap.ts` menggantung benchmark `cvr_toko` pada baris **Pesanan**.
Smoke test dengan angka Cottonella asli menangkapnya: pembagi baris itu
**BERGERAK** — dengan berkas Showcase Ads ia jadi Add to Cart (42 dari 849 =
4,95% → **hijau**), tanpa berkas itu jadi Pengunjung (42 dari 20.543 = 0,19% →
**merah**). Toko yang sama, dua vonis berlawanan, ditentukan berkas mana yang
kebetulan diunggah.

Perbaikannya: **nol rasio antar-anak-tangga dinilai**; yang dinilai adalah
`konversi_total` (pesanan ÷ pengunjung) yang dua angkanya tidak pernah berubah.
Ada tes regresi khusus untuk ini ("does NOT turn green just because the ads file
made add-to-cart the denominator") — **jangan dilonggarkan**.

### 2.4 Verifikasi R3 + merge (DB fresh, 180 migrasi)

| Suite | Hasil |
|---|---|
| `packages/core` | **582** lulus (+23 tes tahap) |
| `packages/domain` | **1859** lulus + 1 skip (+11 tes R3, +1 dari PR #295) |
| `packages/db` | **53** lulus |
| `apps/api` | **435** lulus — `route-parity` `KNOWN_GAPS` **tetap kosong** |
| `web-internal` | **553** lulus, `tsc` bersih, `npm run build` sukses (48 halaman) |
| `web-client-portal` | `npm run build` sukses |

---

## 3. TUGAS UTAMA SESI INI — CR-12

> Satu-satunya tiket yang masih terbuka di
> `docs/backlog/CLIENT_REPORT_PORTAL_BACKLOG.md:37`.
> **Keputusan pemilik 2026-09-05: opsi "Ringan — nol permintaan internet."**

### 3.1 Masalahnya

Dokumen laporan menarik **5 hal dari internet** saat dibuka:

| Berkas | Baris | Yang ditarik |
|---|---|---|
| `packages/core/src/report/render.ts` | 748–752 | Tailwind play CDN, Chart.js, html2pdf, FontAwesome CSS, Google Fonts |
| `packages/core/src/report/shopee/render.ts` | 412–416 | lima-limanya, sama |
| `packages/core/src/adsscanner/tiktok/render.ts` | 182 | Tailwind saja (nol chart, nol ikon, nol font) |

Konsekuensinya menyentuh persis pekerjaan R3: laporan yang AM **unduh lalu kirim
ke klien** rusak begitu CDN tak terjangkau — chart hilang, seluruh layout hancur
(Tailwind play CDN itu **compiler yang jalan di browser**, bukan stylesheet),
ikon jadi kotak, tombol PDF mati diam-diam. Jaringan kantor klien yang memblok
CDN, koneksi lambat, atau berkas dibuka offline setelah diunduh — ketiganya
kejadian normal.

### 3.2 Bagian 1 — modul aset dokumen bersama

Berkas baru `packages/core/src/docassets/`, dipakai **ketiga** renderer supaya
tidak lahir tiga salinan:

| Berkas | Isi |
|---|---|
| `css.ts` | `DOC_CSS` — stylesheet statis pengganti Tailwind play CDN |
| `icons.ts` | `ICON_SVG: Record<string,string>` + helper `ikon(nama)` |
| `chartjs.ts` | `CHART_JS` — Chart.js 4.4.0 UMD ditempel (GENERATED) |
| `print.ts` | `PRINT_BOOT` — pengganti `PDF_BOOT` berbasis `window.print()` |
| `index.ts` | re-export |

Tetap murni seperti tetangganya (`report/`, `baseline/`): **nol DOM, nol `fs`,
nol jam sendiri**. Semuanya konstanta string.

### 3.3 Bagian 2 — Tailwind → CSS statis (bagian paling berisiko)

Kelas yang dipakai **terhingga dan sudah ditelusuri habis**: 152 token statis di
renderer TikTok, plus empat kelas dinamis:

- `bg-${warna}-50` / `border-${warna}-200` / `text-${warna}-800` /
  `text-${warna}-700` ← `kartuInternal` (`render.ts:70-73`).
  **Keempat pemanggilnya memakai default `'slate'`** — sudah diperiksa satu-satu
  (`render.ts:358,359,383`; `shopee/render.ts:173`).
- `bg-${warna(s)}-50` / `-100` / `text-${warna(s)}-700` ← `seksiSkor`
  (`render.ts:315`). `warna(s)` ∈ **{emerald, amber, red}**, habis.
- `md:grid-cols-${cols}` ← `grid()` (`render.ts:52`). **Nol pemanggil mengirim
  argumen kedua**, jadi selalu `4`. Tetap definisikan 2/3/4/6 supaya pemanggil
  baru tidak diam-diam rusak.
- `KUADRAN_META` warna adalah **hex di `style=`**, bukan kelas — tidak relevan.

⚠️ **Penjaga WAJIB, bukan opsional: `docassets/css-parity.test.ts`.**
Render seluruh fixture yang sudah ada (TikTok penuh, TikTok minimal, Shopee,
adsscanner, kedua mode) → tarik setiap token dari setiap `class="…"` → assert
setiap token punya definisi di `DOC_CSS`.

Ini yang mengubah "ada kelas yang kelewat" dari **bug visual senyap** (laporan
klien tampak rusak dan **tidak ada tes yang merah**) menjadi tes merah. Pola dan
alasannya sama dengan `route-parity.test.ts` / `shape-parity.test.ts`.
**Buktikan menggigit**: hapus satu aturan dari `DOC_CSS` → tes harus merah.

### 3.4 Bagian 3 — FontAwesome → SVG ditempel

29 ikon terpakai (sudah didaftar): `fa-arrow-down-short-wide`, `fa-arrow-trend-up`,
`fa-arrows-left-right-to-line`, `fa-bullhorn`, `fa-bullseye`, `fa-cart-shopping`,
`fa-chart-line`, `fa-circle-dot`, `fa-circle-info`, `fa-diagram-project`,
`fa-eye`, `fa-file-pdf`, `fa-film`, `fa-fire-flame-curved`, `fa-flag-checkered`,
`fa-hourglass-half`, `fa-lightbulb`, `fa-list-check`, `fa-magnifying-glass-chart`,
`fa-shield-halved`, `fa-shield-heart`, `fa-spin`, `fa-spinner`, `fa-store`,
`fa-table-cells-large`, `fa-ticket`, `fa-triangle-exclamation`, `fa-users`,
`fa-video` (+ `fa-solid` yang cuma penanda gaya).

- Path dari `@fortawesome/free-solid-svg-icons` — kode MIT, **ikon CC BY 4.0**,
  jadi **butuh atribusi**: satu blok komentar di `icons.ts` **dan** satu baris di
  footer dokumen. Bukan cuma di repo.
- `<i class="fa-solid fa-x"></i>` → `<svg viewBox="0 0 512 512"><path d="…"/></svg>`
  dengan `fill="currentColor"` supaya mewarisi warna. **Nol beda visual.**
- `fa-spin` (adsscanner) → animasi CSS di `DOC_CSS`.
- Ikon tak dikenal **jangan** merender kotak kosong senyap: tes mendaftar 29 nama
  itu dan assert `ICON_SVG` memuat semuanya.

### 3.5 Bagian 4 — Google Fonts → font sistem

`STYLE` (`render.ts:654-655`) menyebut `'Inter'` dan `'Poppins'` yang hanya ada
kalau Google Fonts termuat. Ganti:

```
body          → ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
                "Helvetica Neue", Arial, sans-serif
.font-display → tumpukan sama, bobot 700
```

**Ini satu-satunya beda kasat mata yang pemilik sudah setujui.** `<link>` Google
Fonts dicabut dari ketiga renderer.

### 3.6 Bagian 5 — html2pdf → Print browser

`PDF_BOOT` (`render.ts:625-640`) + padanan Shopee (`shopee/render.ts:331-336`)
diganti `PRINT_BOOT`:

- Tombol tetap ada, label **"Unduh PDF (Ctrl+P)"**, `onclick` → `window.print()`.
  Tidak lagi bisa menghilang sendiri karena pustaka gagal termuat.
- `pdfName()` (`render.ts:520`) **tetap dipakai** — jadi `document.title`, karena
  dialog Print memakai title sebagai nama berkas usulan. Jadi
  `Laporan-Cottonella-2026-08-01.pdf` tetap default. Jangan dibuang.
- `@media print` diperkuat: `.no-print{display:none}` yang sudah ada, **plus**
  `-webkit-print-color-adjust:exact` (tanpa ini seluruh warna kartu & badge
  hilang di PDF), `break-inside:avoid` pada kartu/tabel/seksi, dan tinggi canvas
  chart yang tetap.

### 3.7 Bagian 6 — Chart.js ditempel

Hanya renderer TikTok & Shopee (adsscanner nol chart).

- Vendor `chart.umd.min.js` **4.4.0** — versi yang persis dipakai sekarang.
  **Jangan naik versi di tiket ini.**
- `docassets/chartjs.ts`: satu string, header komentar berisi versi + lisensi MIT
  + sha256, ditandai **GENERATED — jangan disunting**.
- Tes: string non-kosong, memuat banner `4.4.0`, dan sha256-nya cocok dengan yang
  tercatat di header — supaya "seseorang menyunting berkas generated" jadi tes
  merah, bukan misteri.
- Ukuran ~200KB per dokumen. **Biaya yang pemilik sudah terima.**

### 3.8 Bagian 7 — CSP portal klien diperketat

`apps/api/src/app/api/v1/client-portal/reports/[id]/html/route.ts:29-38` sekarang
mem-allow-list `cdn.tailwindcss.com`, `cdnjs.cloudflare.com`,
`fonts.googleapis.com`, `fonts.gstatic.com`. Setelah CR-12 keempatnya **tidak
boleh lagi ada** — kalau ditinggal, CSP-nya berbohong tentang apa yang dokumen
ini butuh, dan celahnya tetap terbuka untuk renderer yang lalai.

Menjadi:
```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src 'self' data:; connect-src 'none'; form-action 'none'; frame-ancestors 'self'
```

⚠️ **Dua tes wajib**: (a) CSP tidak memuat host eksternal apa pun; (b) HTML yang
dirender tidak memuat `src="http`/`href="http` untuk sumber daya. Yang kedua itu
inti CR-12 — "nol permintaan keluar" harus **dibuktikan dari keluarannya**, bukan
dipercaya dari niatnya.

### 3.9 Verifikasi CR-12

1. `scripts/db-rebuild.sh --yes`, lalu seluruh suite (lihat §5 untuk jebakannya).
2. **`cd web-internal && npm run build`** dan **`cd web-client-portal && npm run build`**
   — lihat §5 butir 1, JANGAN pakai bentuk lain.
3. `css-parity.test.ts` hijau **dan terbukti menggigit**.
4. Tes "nol permintaan keluar" untuk 3 renderer × 2 mode.
5. **Bukti mata, bukan cuma tes** — render laporan dengan angka Cottonella
   (fixture smoke R3), buka di Chromium **dengan host eksternal diblok**
   (`page.route('**', r => r.abort())` untuk host non-`data:`): seluruh canvas
   tergambar, ikon seksi tampil, layout utuh, tombol Print memunculkan dialog.
   Kirim berkasnya ke pemilik untuk perbandingan sebelum vs sesudah — **beda font
   adalah satu-satunya yang boleh berubah.**
6. `route-parity` `KNOWN_GAPS` tetap kosong; `shape-parity` hijau.

### 3.10 Yang TIDAK disentuh CR-12

`archive/backend-go/**` (arsip read-only), versi Chart.js (tetap 4.4.0),
`client_reports` (beku), dan **nol migrasi** — CR-12 murni kode + aset.

---

## 4. Beres-beres nol-biaya (ikutkan di PR CR-12)

1. **`docs/DECISIONS.md` baris ~503, baris `Open` `O72` BASI** — masih berbunyi
   "gerbang TIDAK ADA di `main`", padahal baris `Decided` 2026-09-04 menyatakan
   §44 sudah mendarat. Terverifikasi: `supabase/tests/rls_checks.sql:1191`.
   Tandai RESOLVED — kelas kerja yang sama dengan yang PR #281 lakukan.
2. **`useSearchParams()` tanpa `<Suspense>`** di
   `web-internal/src/app/(shell)/ads/scanner/page.tsx:79` dan
   `ads/screening/page.tsx:83`. **Sekarang TIDAK memerahkan build** — karena
   `(shell)/layout.tsx` mengembalikan `null`/"Memuat…" selagi `loading`, jadi
   badan halaman tak pernah dieksekusi saat prerender. Tapi itu kebetulan yang
   rapuh. Pola yang benar sudah ada di `tasks/page.tsx:287` dan
   `account/rekap/page.tsx:334` (inner component + `<Suspense>`) — tiru itu.
3. **Klaim `KS-4` di `HANDOFF_LANJUT_SEMUA_BUILD_20260904.md` §2 basi** — handoff
   bilang closing ratio "belum dihitung `salesperf.ts`". Kenyataannya
   `closing_ratio_qualified_pct` **sudah ada** sebagai `MetricKey`
   (`packages/domain/src/salesperf.ts:215`) + CHECK DB `ck_sales_targets_metric_key`.
   Yang benar-benar belum ada: daftar komponen + bobot skor Sales di M14.
4. `docs/backlog/CLIENT_REPORT_PORTAL_BACKLOG.md:37` → CR-12 jadi ✅ setelah
   selesai.

---

## 5. Aturan rumah yang paling sering menggigit (terbukti di sesi ini)

1. **JANGAN verifikasi build dengan `npx next build <dir>` dari root.**
   `web-internal` **bukan** anggota npm workspace (root `"workspaces":
   ["apps/*","packages/*"]`), jadi ada dua salinan fisik `next@16.2.10`. Bentuk
   itu memakai CLI salinan root sementara bundel server me-`require`
   `work-async-storage.external.js` dari salinan `web-internal` → dua instance
   `AsyncLocalStorage` → `Invariant: Expected workStore to be initialized`, dan
   **nol** halaman ter-prerender. Sesi lalu ini sempat dilaporkan sebagai "cacat
   pre-existing" — **salah**, sudah dicoret di `DECISIONS.md`.
   **Pakai `cd web-internal && npm run build`** (yang CI pakai). Terbukti: 48
   halaman ter-prerender, `/account/briefs` & `/marketing/performance` dua-duanya
   `○ (Static)`.
2. **`admin.test.ts` ("hari libur") dan `client.test.ts` ("Hold Service
   two-step") HANYA hijau di DB yang baru `db-rebuild.sh`.** Keduanya menghitung
   baris `audit_log`/notifikasi miliknya sendiri dengan `toBe(1)`, dan `audit_log`
   immutable sehingga cleanup-nya tidak bisa menghapusnya. Jalankan suite domain
   dua kali tanpa rebuild ⇒ keduanya merah (`expected 7 to be 1`). **Bukan
   regresi.** Angka 1859 diukur pada rebuild bersih.
3. **Sebelum menjalankan test yang butuh DB**, nyalakan Postgres dan set
   password-nya dulu — container sering datang tanpa keduanya:
   ```
   service postgresql start
   su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
   export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
   ```
4. **Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration`.** Jangan
   `psql -f` (itu yang melahirkan drift O38), jangan `db push` untuk live (O65).
5. **`PayloadInsight` ↔ `ShopeePayloadInsight` harus tetap BENTUK IDENTIK.** Itu
   yang membuat SATU editor dan SATU baris `client_report_insight` melayani dua
   mesin. Menambah field di satu sisi saja memecah keduanya — R3 menambahkan
   `tahap_narasi` ke **dua-duanya** (Shopee mengembalikan `[]`), dan ada tes
   paritas kunci di `shopee.test.ts` yang mengunci itu.
6. **`INSIGHT_COLS` adalah satu-satunya daftar kolom insight.** R3 menemukan
   `resetReportInsight` punya daftar kolom tulis-tangan KETIGA, sehingga
   `tahap_narasi` hilang senyap saat "kembalikan ke insight mesin". Sudah
   disatukan. Jangan tulis daftar keempat.

---

## 6. Butuh keputusan pemilik — JANGAN ditebak

| ID | Pertanyaan | Yang terblokir |
|---|---|---|
| **O74** | Rentang sehat untuk rasio antar-anak-tangga funnel (klik/impresi, ATC/klik, dll). Tiga hal: (a) berlaku semua kategori atau per kategori klien? (b) angka `good`/`warn` masing-masing? (c) ambangnya rate (period-independent) atau volume (perlu pro-rate mingguan)? | Kolom "Rentang sehat" di laporan **internal** berisi `—` untuk 4 dari 5 baris. Laporan tetap terbit, semua angkanya benar. **Tidak memblokir CR-12.** |
| **SCR-UI-1** | Arah sudah dijawab YA (Ads boleh me-LIST klien), tapi **scope belum**: semua klien, atau hanya klien ber-layanan Ads aktif? Pemilik sudah menulis default aman = hanya ber-layanan Ads. | Implementasi picker klien Ads (melebarkan RLS `clients_select`). |
| **KS-4** | Daftar komponen + bobot skor Sales di M14 (Σ=100). Registrasinya sudah mendarat dengan bobot 0 (PR #295). | Bobot M14 Sales. |
| **LT-2 / LT-8 / LT-1 sisa** | Dinyatakan pemilik 2026-09-05: **belum ada feedback tim** Store Operation & AI Optimizer. | Pipeline `STORE_OPS` (satu migrasi seed, nol kode TS) + bobot dua role type itu. |
| **X-12** | Saran Claude sudah diajukan 2026-09-05, menunggu pemilik + OD. | Komponen disiplin periode Plan. |
| **O65** | Rekonsiliasi ledger migrasi live — 4 pasang versi kembar terverifikasi nyata (`20260901010000` s/d `20260901040000`). Rekomendasi O65 sendiri: **bukan pekerjaan yang boleh menumpang tiket fitur.** | Tiket sendiri, butuh ketokan pemilik untuk opsi (a)/(b)/(c). |

Lapisan tahap **Shopee** juga tiket terpisah (R3 butir (g)) — masuk akal
dikerjakan **setelah O74 dijawab** supaya tidak dua kali menyentuh benchmark.

---

## 7. Prompt siap tempel untuk chat berikutnya

```
Baca docs/handoff/HANDOFF_SESI6_CR12_ASET_LAPORAN_LOKAL.md dan kerjakan
berurutan sesuai §0.

Prioritas 1 — apply migrasi 20260912010000_r3_tahap_funnel.sql ke live
CDPS SG (project egddxfcnrtecheiykhlf) lewat apply_migration per berkas,
BUKAN db push. Verifikasi gerbang sebelum/sesudah persis seperti §1.3:
keempat angka (145/40/31/69) harus TIDAK bergerak, kolom tahap_fokus
harus nullable TANPA default, dan CHECK-nya harus terbukti menolak nilai
'retention'. Lalu jalankan get_advisors.

Prioritas 2 — kerjakan CR-12 sesuai rencana lengkap di §3 (delapan
bagian). Keputusan pemilik sudah diambil: opsi "Ringan — nol permintaan
internet" (font sistem, tombol PDF pakai Print browser). Yang paling
penting jangan dilewat: css-parity.test.ts di §3.3 harus ada DAN
dibuktikan menggigit, dan tes "nol permintaan keluar" di §3.8.

Prioritas 3 — beres-beres §4.

Baca §5 dulu sebelum menjalankan test atau build apa pun — enam jebakan
di situ semuanya sudah terbukti menggigit, termasuk perintah build yang
benar.

Jangan menebak apa pun yang ada di §6; itu keputusan pemilik.
```
