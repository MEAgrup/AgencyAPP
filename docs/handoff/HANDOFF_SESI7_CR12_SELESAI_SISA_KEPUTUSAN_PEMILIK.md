# HANDOFF — SESI 7: CR-12 selesai; yang tersisa hampir seluruhnya keputusan pemilik

> Dibuat 2026-09-06 di atas branch `claude/cdps-migration-cr12-pnamxw`,
> commit `d082e94` (+ commit dokumen sesi ini). **CI hijau** di `d082e94`
> — run #1676, kelima job sukses, event `push`.
>
> **Sesi 6 (`HANDOFF_SESI6_CR12_ASET_LAPORAN_LOKAL.md`) sudah dieksekusi
> seluruhnya:** Prioritas 1 (apply migrasi R3 ke live), Prioritas 2 (CR-12,
> delapan bagian), Prioritas 3 (beres-beres §4). Nol butir tersisa dari sana.
>
> ⚠️ **Jebakan penamaan berkas di folder ini masih berlaku.** Aturan `CLAUDE.md`
> "baca handoff bernomor tertinggi lebih dulu" MENYESATKAN di sini:
> `HANDOFF_INSIGHT_EDITABLE_CLIENT_PORTAL_20260908.md` punya tanggal nama berkas
> tertinggi tapi isinya kerja Gelombang 1 yang selesai lama. Rantai yang benar:
> `HANDOFF_LANJUT_SEMUA_BUILD_20260904.md` → `…_SESI2/SESI3_20260904.md` →
> `HANDOFF_REVISI_SALES_CREATIVE_PERFORMA_20260904.md` → `HANDOFF_SESI5_…` →
> `HANDOFF_SESI6_CR12_ASET_LAPORAN_LOKAL.md` → **dokumen ini**.

---

## 0. Baca ini dulu: tidak ada tiket build yang tersisa

Ini yang paling penting dan paling mudah salah dibaca. Setelah CR-12,
**nol tiket di `docs/backlog/**` yang bisa dikerjakan tanpa jawaban pemilik.**
Diperiksa 2026-09-06 dengan menyapu keempat belas berkas backlog untuk baris
berstatus ❌/🔴/⬜/TODO/belum:

| Berkas backlog | Sisa terbuka |
|---|---|
| `CLIENT_REPORT_PORTAL_BACKLOG.md` | 0 — CR-12 adalah yang terakhir |
| `CUTOVER_BACKLOG.md` | 0 |
| `LEADTIME_BACKLOG.md` | 2 — **LT-2 / LT-8, dua-duanya menunggu pemilik** |
| `PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md` | 0 (dulu 2, dua-duanya BASI — dikoreksi sesi ini, lihat §4) |
| sepuluh berkas lain | 0 |

Jadi **jangan mulai sesi berikutnya dengan mencari tiket**. Yang produktif:
dapatkan jawaban §3, atau kerjakan §5 (pekerjaan yang tidak butuh pemilik tapi
juga tidak ada di backlog mana pun).

---

## 1. Yang sesi 6 kirim

### 1.1 Prioritas 1 — migrasi R3 sudah hidup di live `CDPS SG`

`20260912010000_r3_tahap_funnel` di-apply lewat `apply_migration` per berkas
(konvensi O65 — bukan `db push`, bukan `psql -f`). Ledger live sekarang berujung
di berkas itu; sebelumnya berhenti di `20260911080000_harden_wrr_reaggregate_trigger_execute`.

**Gerbang TIDAK BERGERAK, sesuai harapan** (migrasi ini nol tabel/prefix/mesin/event baru):

| Gerbang | Sebelum | Sesudah |
|---|---|---|
| tabel `public` | 145 | **145** |
| `entity_prefix` | 40 | **40** |
| `sm_machines` | 31 | **31** |
| `notif_events` | 69 | **69** |

Yang diperiksa satu-satu: `client_platforms.tahap_fokus` = `varchar(16)`,
nullable, **`column_default` NULL** (tanpa DEFAULT itu disengaja — lihat sesi 6
§1.4, dan jangan ada yang "membantu" menambahkannya);
`client_report_insight.tahap_narasi` = `jsonb NOT NULL DEFAULT '[]'::jsonb`;
0 baris dengan narasi non-kosong.

**CHECK-nya dibuktikan MENGGIGIT, bukan cuma dibaca definisinya.** Di dalam satu
blok `DO` yang sengaja dibatalkan lewat `raise exception` di akhir:
`tahap_fokus='retention'` **DITOLAK** oleh `ck_cp_tahap_fokus`, `'awareness'`
DITERIMA, dan sesudahnya diverifikasi **0 baris terisi** — nol perubahan data.
Pola ini layak ditiru: constraint yang ADA belum tentu constraint yang MENGGIGIT.

`get_advisors` security + performance sesudahnya: **nol temuan baru.**
Satu-satunya baris yang menyebut kedua tabel ini
(`multiple_permissive_policies` di `client_report_insight`) sudah ada sebelumnya.

### 1.2 Prioritas 2 — CR-12

Modul baru `packages/core/src/docassets/`, dipakai **ketiga** renderer:

| Berkas | Isi |
|---|---|
| `css.ts` | `DOC_CSS` ~23KB, pengganti Tailwind play CDN. **Berkas sumber biasa** — boleh disunting tangan, tambah aturan langsung di sana |
| `icons.ts` | 27 ikon Font Awesome 6.5.1 sebagai SVG ditempel + `ATRIBUSI_IKON`. Header berkasnya memuat **resep menambah ikon** |
| `chartjs.ts` | Chart.js 4.4.0 UMD ditempel. **GENERATED** — header memuat **resep meregenerasi** + sha256 yang dikunci tes |
| `print.ts` | `PRINT_BOOT` — `window.print()` menggantikan html2pdf |
| `parity-fixtures.ts` | Fixture khusus tes paritas (bukan fixture uji perilaku — alasannya ada di header berkasnya) |

Keputusan pemilik yang dieksekusi: opsi **"Ringan — nol permintaan internet"**.
Font sistem menggantikan Inter/Poppins (satu-satunya beda kasat mata), tombol
PDF pakai Print browser. CSP portal klien kini **nol host eksternal**.

### 1.3 Prioritas 3 + beres-beres tambahan sesi ini

- `DECISIONS.md` O72 → **RESOLVED** (gerbang §44 sudah mendarat, terverifikasi
  `supabase/tests/rls_checks.sql:1191`).
- `<Suspense>` untuk `useSearchParams()` di `ads/scanner` + `ads/screening`.
- Koreksi klaim KS-4 basi di `HANDOFF_LANJUT_SEMUA_BUILD_20260904.md`.
- CR-12 ditandai ✅ di `CLIENT_REPORT_PORTAL_BACKLOG.md`.
- **Baru sesi ini:** banner koreksi di `PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md`
  (§4 di bawah).

---

## 2. Angka verifikasi — ukur ulang terhadap ini

| Suite | Hasil |
|---|---|
| `packages/core` | **663** lulus (582 → 663, +81 tes CR-12) |
| `packages/domain` | **1859** lulus + 1 skip (tidak berubah) |
| `packages/db` | **53** lulus (tidak berubah) |
| `apps/api` | **442** lulus (435 → 442, +7); `route-parity` `KNOWN_GAPS` **tetap kosong** |
| `web-internal` | **553** lulus, `tsc` bersih, `npm run build` sukses |
| `web-client-portal` | **19** lulus, `npm run build` sukses (10 route) |
| `db-rebuild.sh --yes` | **180** migrasi, gerbang 145/40/31/69, keempat invariant lolos |
| CI GitHub | **hijau** di `d082e94` (run #1676) |

⚠️ **Koreksi angka terhadap handoff sesi 6:** `web-internal` build sekarang
**49 halaman**, bukan 48. Itu **bukan** akibat CR-12 — angka 48 diukur sebelum
merge PR #296; nol halaman ditambah sesi 6. `ads/scanner` dan `ads/screening`
dua-duanya tetap `○ (Static)` sesudah dibungkus `<Suspense>`.

---

## 3. Butuh keputusan pemilik — JANGAN ditebak

Daftar sesi 6 §6, diperbarui. **Ini sekarang jalur kritis satu-satunya.**

| ID | Pertanyaan | Yang terblokir | Berubah? |
|---|---|---|---|
| **O74** | Rentang sehat rasio antar-anak-tangga funnel: (a) berlaku semua kategori atau per kategori klien? (b) angka `good`/`warn` masing-masing? (c) ambangnya rate (period-independent) atau volume (perlu pro-rate mingguan)? | Kolom "Rentang sehat" di laporan **internal** berisi `—` untuk 4 dari 5 baris. Laporan tetap terbit, semua angkanya benar | tidak |
| **SCR-UI-1** | Arah sudah YA (Ads boleh me-LIST klien), **scope belum**: semua klien, atau hanya klien ber-layanan Ads aktif? Pemilik sudah menulis default aman = hanya ber-layanan Ads | Picker klien Ads (melebarkan RLS `clients_select`) | tidak |
| **KS-4** | Daftar komponen + bobot skor Sales di M14 (Σ=100) | Bobot M14 Sales. Registrasinya sudah mendarat dengan bobot 0 (PR #295) | ⚠️ klaim basi soal `closing_ratio` sudah dikoreksi sesi 6 — yang kosong **hanya bobotnya** |
| **LT-2 / LT-8 / LT-1 sisa** | Daftar & urutan kerja Store Operation + alasan pengembalian brief | Pipeline `STORE_OPS` (satu migrasi seed, nol kode TS) + bobot dua role type | tidak |
| **X-12** | Komponen disiplin periode Plan | Saran Claude sudah diajukan 2026-09-05, menunggu pemilik + OD | tidak |
| **O65** | Rekonsiliasi ledger migrasi live — 4 pasang versi kembar terverifikasi nyata (`20260901010000` s/d `20260901040000`) | Tiket sendiri; rekomendasi O65 sendiri: bukan pekerjaan yang boleh menumpang tiket fitur | tidak |
| **O46** | 3 arm visibility RLS lebih sempit dari Go | Klaim paritas RLS. **Tidak pernah memblokir cutover**, dan Go-nya sekarang sudah mati — jadi pertanyaannya berubah jadi "apakah masih relevan?" | ⚠️ konteksnya berubah, lihat §4 |

**Lapisan tahap Shopee** (R3 butir (g)) tetap tiket terpisah, dan masih masuk
akal dikerjakan **setelah O74 dijawab** supaya benchmark tidak disentuh dua kali.

---

## 4. Yang sesi ini koreksi: `PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md` seluruhnya basi

Dokumen itu masih menyatakan Fase 4 **~45%**, Fase 5 (C-05) **~15% "belum boleh
dimulai"**, gabungan **~88%**, dan `backend/` masih ada. Semuanya sudah tidak
benar sejak 2026-09-04/05:

- C-05 **SELESAI 5/5**, `backend/` → `archive/backend-go/`, job CI `backend` dicabut.
- Service Railway **DIHENTIKAN pemilik 2026-09-05**, dump final MySQL diamankan
  di luar GitHub lebih dulu.
- Gate GO sudah dilewati; butir 6 & 7 di §5 dokumen itu sudah dikerjakan.

Ditandai dengan **banner koreksi di paling atas** + tiga baris fase diperbaiki
+ butir 6/7 dicoret. Dokumennya **disimpan sebagai riwayat keputusan, bukan peta
kerja** — rujukan yang berlaku: `DECISIONS.md` 2026-09-05 (C-05) dan `CLAUDE.md`
§Stack.

Satu-satunya yang masih hidup dari dokumen itu: **O46**. Perhatikan bahwa
konteksnya berubah — dulu ia "memblokir klaim paritas terhadap Go"; Go sudah
mati, jadi pertanyaan sesungguhnya sekarang adalah apakah tiga arm RLS itu
**cukup untuk kebutuhan operasional hari ini**, bukan apakah ia cocok dengan Go.
Itu pertanyaan yang lebih baik, dan pemilik perlu menjawabnya dalam bentuk itu.

---

## 5. Kalau pemilik belum sempat menjawab — yang bisa dikerjakan tanpa mereka

Diurutkan dari yang paling jelas manfaatnya. **Semuanya opsional**; nol di
antaranya memblokir apa pun.

1. **PR untuk `claude/cdps-migration-cr12-pnamxw` belum dibuat.** Sengaja —
   belum diminta. Branch sudah di-push dan CI hijau; tinggal dibuka kalau
   pemilik mau. Ini butir dengan nilai tertinggi karena kerjanya sudah selesai
   dan hanya menunggu jalur review.
2. **Lapisan tahap Shopee tanpa benchmark.** Kalau O74 lama dijawab, bagian
   tahap Shopee yang TIDAK bergantung rentang sehat (anak tangga funnel + tiga
   blok metrik + belanja per tahap) tetap bisa dikirim, dengan kolom "Rentang
   sehat" berisi `—` persis seperti TikTok hari ini. Untung-ruginya: klien
   Shopee dapat lapisan yang sama lebih cepat; ruginya benchmark akan disentuh
   dua kali. **Ini keputusan, bukan default — tanyakan dulu.**
3. **`docs/backlog/` punya 14 berkas dan beberapa sudah 100% selesai.** Pola
   yang sama dengan §4: dokumen selesai yang tidak ditandai selesai akan
   menyesatkan sesi berikutnya. Menyapunya sekali itu murah.
4. **`report_benchmark` untuk tahap belum punya baris apa pun** — begitu O74
   dijawab, isinya migrasi seed, bukan kode. Menyiapkan bentuk migrasinya
   (tanpa angka) tidak berguna; jangan dikerjakan lebih awal.

---

## 6. Aturan rumah yang paling sering menggigit — DIPERBARUI

Enam butir sesi 6 semuanya masih berlaku. **Baca yang lama di
`HANDOFF_SESI6_CR12_ASET_LAPORAN_LOKAL.md` §5** — terutama butir 1 (perintah
build yang benar), butir 2 (`admin.test.ts`/`client.test.ts` hanya hijau di DB
yang baru rebuild), dan butir 3 (nyalakan Postgres + set password dulu).

Tujuh butir **baru**, semuanya terbukti menggigit di sesi 6:

1. **Backslash di CSS hilang saat ditanam ke template literal TS.** Selektor
   `.md\:p-6`, `.text-\[10px\]`, `.mb-0\.5` memuat backslash; di dalam
   `` `…` `` TypeScript memakannya sebagai escape, jadi string runtime-nya jadi
   `.md:p-6` dan **seluruh varian `md:` diam-diam berhenti cocok**. Gandakan
   (`\\`) saat menanam. Ini gagal sebagai "56 kelas hilang", bukan sebagai
   pesan yang menyebut escape.
2. **Backtick di dalam komentar CSS menutup template literal.** Menulis
   `/* \`.kpi-card\` bukan hiasan */` di dalam `DOC_CSS` membuat TS mengira
   string-nya berakhir di situ. Galatnya berbunyi "Property 'kpi' does not
   exist on type '<seluruh CSS>'" — jauh dari penyebabnya.
3. **`npx vitest run` HIJAU bukan berarti aman — jalankan `tsc` juga.**
   `tsc` menangkap `ttam_video_views` (seharusnya `ttam_videoviews`) di fixture
   paritas; slot itu diam-diam diabaikan, jadi satu blok laporan tidak pernah
   dirender dan tes tetap hijau. Pakai `npm run typecheck --workspaces --if-present`.
4. **cdnjs DIBLOKIR proxy egress sesi Claude; npm registry TIDAK.** Untuk
   menempel pustaka vendor, pakai `npm pack <paket>@<versi>` lalu ekstrak —
   jangan `curl` ke cdnjs, dan jangan menyimpulkan pustakanya tak terjangkau.
5. **Path Chromium Playwright: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.**
   Bukan `/opt/pw-browsers/chromium/…` — direktori itu ada tapi tidak memuat
   binernya. Install Playwright dengan `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.
6. **`node_modules` sering belum ada saat container datang.** `npm install` di
   root TIDAK memasang `web-internal` dan `web-client-portal` — keduanya bukan
   anggota workspace dan butuh `npm install` sendiri di direktorinya.
7. **Handoff bisa salah, dan sesi 6 menemukan tiga.** Rencana §3 sesi 6
   menyebut (a) `viewBox` ikon boleh diseragamkan `0 0 512 512` — **salah**,
   lebar Font Awesome 384–640 dan `fa-users` akan terpotong; (b) `fa-spin` ada
   di adsscanner — **salah**, ia hanya ada di `PDF_BOOT` yang tiket itu hapus;
   (c) "152 token statis + empat kelas dinamis" — **kurang**, itu hanya
   renderer TikTok; Shopee dan adsscanner menambah `FLAG_WARNA`, `GATE_CLS`,
   `BUCKET_META[].cls`, `status-${cls}`, `roiCls`, `vonisBadgeCls`.
   Periksa klaim handoff terhadap kode sebelum membangun di atasnya.

---

## 7. Cara kerja penjaga CR-12 — supaya tidak dilemahkan tanpa sadar

Tiga tes menjaga klaim "nol permintaan internet". Kalau salah satunya merah,
**perbaiki penyebabnya, jangan longgarkan tesnya.**

**`packages/core/src/docassets/css-parity.test.ts`** — dua jaring:

- **Jaring 1** merender 10 dokumen (TikTok penuh/minimal/pra-R3, Shopee
  penuh/bersih/minimal, adsscanner; klien + internal), menarik setiap token dari
  setiap `class="…"`, dan menuntut setiap token punya aturan di `DOC_CSS`. Ini
  satu-satunya yang menangkap kelas yang DISUSUN saat jalan.
- **Jaring 2** memindai sumber ketiga renderer untuk token literal, menangkap
  cabang yang kebetulan tidak dilewati fixture. Token yang memuat `${…}`
  ditandai penanda NUL (`\u0000`) lalu dilewati — **bukan diganti spasi**, karena
  `bg-${warna}-50` adalah SATU token dan spasi memecahnya jadi `bg-` dan `-50`.
- **Terbukti menggigit**: ada tes yang mencabut satu aturan dari salinan
  `DOC_CSS` lalu menuntut pemeriksaan yang sama jadi merah.
- **`assertPadat()`** mencegah fixture yang membusuk jadi halaman kosong lolos
  sebagai hijau. Kalau ia melempar, **perbaiki fixture-nya, jangan turunkan
  ambangnya** — pesannya sudah bilang begitu.

**`docassets.test.ts`** membuktikan "nol permintaan keluar" **dari keluaran**
renderer, 3 renderer × 2 mode. **`report-csp.test.ts`** menjaga sisi CSP-nya.

Daftar 27 ikon **diturunkan dari sumber renderer**, bukan diketik ulang di tes —
jadi ikon baru yang lupa didaftarkan langsung merah.

---

## 8. Prompt siap tempel untuk chat berikutnya

```
Baca docs/handoff/HANDOFF_SESI7_CR12_SELESAI_SISA_KEPUTUSAN_PEMILIK.md.

Baca §0 dulu: setelah CR-12 tidak ada tiket build tersisa yang bisa
dikerjakan tanpa jawaban pemilik. Jangan mulai dengan mencari tiket.

Kalau saya belum memberi jawaban untuk §3, kerjakan §5 dan tanyakan dulu
mana yang saya mau — jangan pilih sendiri, terutama butir 2 (lapisan tahap
Shopee tanpa benchmark) yang itu keputusan, bukan default.

Kalau saya SUDAH menjawab salah satu di §3, kerjakan yang itu.

Baca §6 sebelum menjalankan test atau build apa pun — enam jebakan sesi 6
(di HANDOFF_SESI6 §5) plus tujuh yang baru, semuanya sudah terbukti
menggigit. Jangan lemahkan penjaga di §7 kalau ada yang merah.

Jangan menebak apa pun yang ada di §3; itu keputusan saya.
```
