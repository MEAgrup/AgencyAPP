# HANDOFF — C1 bagian 1: MESIN LAPORAN KLIEN (mingguan/bulanan) — Sesi 44

> Rantai: … → SESI42 (Kelas B, PR **#183**) → SESI43 (Kelas C4–C7, PR **#184**)
> → **SESI44 (ini, terbaru — C1 bagian 1: mesin report + skema).**
> Baca yang bernomor tertinggi lebih dulu.
>
> **Status: mesin `@cdps/core/report` + 3 tabel SELESAI & teruji. `clients.total_sales`
> MASIH nol penulis — itu bagian 2 (domain + API + FE), lihat §2.**

---

## 0. CARA MELANJUTKAN

### 0.0 Posisi branch & PR
| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | `claude/mea-tiktok-report-engine-ooxiso` (PR draft). Branch ini **superset `main`**: ia sudah memuat #182/#183/#184. |
| **Migrasi** | **119** total (satu baru: `20260819000000_client_report_engine.sql`). |
| **Gate** | `tabel public` 118→**121** (dinaikkan di `ci.yml` **dan** `scripts/db-rebuild.sh`, satu commit). `entity_prefix` 35 / `sm_machines` 23 / `notif_events` 58 **TETAP** — nol prefix, nol mesin, nol event baru. |
| **Keputusan** | `docs/DECISIONS.md` **2026-08-19** (baris teratas) — 4 keputusan wawancara pemilik. |

### 0.1 Aturan main (tak berubah) — lihat SESI42 §0.1 + `CLAUDE.md`
- Migrasi HANYA lewat `supabase/migrations/**`; DB lokal HANYA `scripts/db-rebuild.sh`.
- Tes domain WAJIB serial; **rebuild DB setelah migrasi baru**. Wire snake_case lewat `apps/api/src/lib/wire.ts`.
- `route-parity` `KNOWN_GAPS` harus tetap **kosong**.

### 0.2 Setup di container baru
```bash
service postgresql start                       # atau: pg_ctlcluster 16 main start
su postgres -c "psql -d postgres -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm ci
bash scripts/db-rebuild.sh --yes               # harus lapor 'tabel public 121'
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
```

---

## 1. Yang SELESAI sesi ini (jangan ulang)

Pemilik mengirim tool HTML **"MEA TikTok Report Engine"** sebagai format output target
(yang dijanjikan SESI43 §2.1), plus permintaan tambahan **pilihan mingguan / bulanan**.
Wawancara 4 pertanyaan → `DECISIONS.md` 2026-08-19.

### 1.1 `packages/core/src/report/` — mesin murni `cdps.report.tiktok.v1`
Saudara `baseline/` (DOM-free, tanpa dependensi xlsx, tanpa jam sendiri). **Memakai
ulang** `baseline/sheet.ts` (`readSheet`), `baseline/angka.ts` (`n`,`rp`,`div`,`pct`),
`baseline/detect.ts` (12 signature), dan `baseline/metrik.ts` `toko()` — **satu pembaca,
satu angka**: GMV di laporan bulanan tak akan pernah berbeda dari GMV di baseline toko.

| Berkas | Isi |
|---|---|
| `types.ts` | `PeriodeTipe`, 4 `TtamType`, `ReportBench` (11 ambang), `VOLUME_BENCH_KEYS` (hanya `sesi_live` + `quad_klik`), `Rentang`. |
| `bench.ts` | `REPORT_BENCH_V1` (cermin `report_benchmark` versi 1) + **`prorateBench(bench, hari)`** — skalakan HANYA ambang volume. |
| `detect.ts` | 4 signature **Ads Manager** (kolom, bukan nama berkas) + `colIndex` (lookup kolom case-insensitive) + **`rentangOf(meta)`** (dua ujung tanggal — bagian yang `periodeOf` buang) + `hariAntara` (inklusif). |
| `metrik.ts` | `kpiToko`, `kanal`, `adsReport`, `liveReport` (+ per hari-dalam-minggu, jam siaran nol hasil), `videoReport` (toko+afiliasi), `kuadranProduk` (relatif + benchmark), `affiliateReport`, `tokpedReport`, `ttamReport`. |
| `skor.ts` | 6 dimensi berbobot Σ=1.00 (gmvmax .22 / live .22 / video .18 / kartu .14 / affiliate .12 / produk .12). Berkas absen ⇒ **netral 5** + catatan, bukan hukuman. |
| `insight.ts` | Poin + rekomendasi tinggi/sedang + outlook + indikator, **kata periode diparameterkan** ("bulan lalu"/"minggu lalu"). |
| `payload.ts` | `buildReportPayload` + `ENGINE_VERSI='cdps-report-v1'`. |
| `run.ts` | `runReport`, `resolveRentang`, **`gmvRunRateBulanan`** (satuan `clients.total_sales`). |
| `render.ts` | `renderBody` / `renderReportHtml(payload, 'klien'\|'internal')` + `chartData`. Nomor seksi **dihitung saat render** (klien tanpa Tokopedia tak dapat lompatan "8 … 10"). |

**5 perbedaan sadar dari tool pemilik** (semuanya di `DECISIONS.md`, jangan "diperbaiki" balik):
1. deteksi **signature kolom**, bukan nama berkas (berkas di-rename = hilang diam-diam);
2. benchmark **tabel berversi**, bukan input di browser (dua AM = dua skor, laporan lama tak reproducible);
3. kolom opsional absen ⇒ `null` ⇒ render `—`, **bukan** `Rp0`;
4. blok internal **tidak dirender** di mode Klien (bukan `display:none` — itu meninggalkan catatan internal di View Source berkas yang diteruskan ke klien);
5. uang format rumah `Rp. 1.234.567,00`, pembagian-nol `—`.

### 1.2 Migrasi `20260819000000_client_report_engine.sql` — 3 tabel
- **`report_benchmark`** — 11 ambang **bulanan** berversi, append-only (trigger), nol policy (default-deny, pola `riset_awal_benchmark`). Versi 1 = `DEFAULT_BENCH` tool.
- **`client_reports`** — satu baris per **(`client_platform_id` × `periode_tipe` × `periode_mulai` × `periode_akhir`)** (UNIQUE). `payload` jsonb immutable (trigger). Kolom turunan yang **di-denormalisasi untuk query, bukan sumber kebenaran**: `skor`, `skor_label`, `gmv_net`, `gmv_kotor`, **`gmv_runrate_bulanan`**, `benchmark_versi` (FK, NOT NULL), `engine_versi` (NOT NULL), `hari_periode`, `rentang_dari_berkas`.
- **`client_report_berkas`** — provenance (sha256 + tipe + baris), beku, CASCADE dari laporan.
- RLS Account-scope dengan arm lead/divisi **di-inline** ⇒ **nol baris baru di ledger O48** (`rls_checks` §42 hijau).

### 1.3 Verifikasi (DB fresh 119 migrasi)
- core **286** hijau (252 + **34** tes report baru) · domain **1404** hijau, 1 skipped (+**5** tes `report_schema.reals.test.ts`).
- `tsc --noEmit` core + domain bersih.
- `db-rebuild.sh --yes`: semua gate + 4 invariant SQL (`ident`/`immutability`/`rls`/`auth_claims`) hijau.
- ⚠️ `interview.test.ts` "counts WORKING days" — flake tergantung tanggal container (SESI43 §4.5). **Hijau hari ini.**

---

## 2. BERIKUTNYA — C1 bagian 2 (inilah yang menutup gap)

Mesin & tempatnya ada; **belum ada yang memanggilnya**. Urutan yang disarankan:

### 2.1 `packages/domain/src/report.ts` (paling penting)
Tiru **persis** `riset-awal.ts` `submitBaseline` (baca dulu — pola upload sudah matang):
browser parse xlsx → `{filename, aoa, sha256, ukuranBytes}`; **server** yang
`readSheet` → `detect`/`detectTtam` → `runReport` → simpan.

- `createReport(sql, actor, input)` dalam `withTransaction`:
  1. validasi `client_platform_id` **aktif** & milik klien (pesan BI: pinjam `MSG_PLATFORM_NOT_FOUND` / `MSG_PLATFORM_INACTIVE` dari `riset-awal.ts`);
  2. `generatedAt` dari **jam server** (`serverGeneratedAt()` di `riset-awal.ts`), jangan jam browser;
  3. baca `report_benchmark` versi aktif → `runReport(slots, {periodeTipe, bench, benchmarkVersi, klien, generatedAt, akunSendiri})`;
  4. INSERT `client_reports` + `client_report_berkas`; UNIQUE bentrok ⇒ `ConflictError` (BI `[laporan untuk toko & periode ini sudah ada]`);
  5. **tulis `clients.total_sales`** = Σ `gmv_runrate_bulanan` dari laporan **TERBARU per platform aktif** klien (bukan hanya laporan yang baru masuk) + satu baris `audit_log`. Ini gap C1 yang sesungguhnya.
- `listReports` / `getReport` (baca) + `renderReportHtml` untuk unduh.
- Berkas **ambigu** toko-vs-afiliasi: `detect()` mengembalikan `ambiguous` — ikuti `riset-awal.ts` (tolak dengan `MSG_AMBIGU`, minta AM konfirmasi tipe), jangan menebak diam-diam.
- Jalankan read lintas-scope pada **service-role `db()` + gate in-app**, pola `getRecapDetail` (hindari jebakan O52 join-erasure) — lihat SESI43 §4.4.
- Izin: tulis = AM pemilik klien + lead Account + Director; baca = ditambah OD.

### 2.2 API + wire
`POST /clients/{id}/reports`, `GET /clients/{id}/reports`, `GET /reports/{id}`,
`GET /reports/{id}/html?mode=klien|internal`. Daftarkan wire baru di `wire.ts`
(`*ToWire`, snake_case, **`null` eksplisit bukan `omitempty`**) + registry shape-parity.

### 2.3 FE `web-internal`
Panel di halaman klien: pilih toko → **pilih Mingguan / Bulanan** → drop berkas
`.xlsx` (parse + sha256 di browser, `parseExportFile` di `lib/riset-awal.ts` bisa
dipakai ulang apa adanya) → POST → tampilkan laporan + tombol unduh HTML
Klien/Internal. **`KNOWN_GAPS` route-parity harus tetap kosong.**

### 2.4 Sesudah itu
- **B4-residual**: baseline pertumbuhan majemuk per-kuartal dari `client_reports` (kini floor statis `clients.gmv_baseline`).
- **C2 / C3** tetap DITUNDA (butuh pipeline affiliate-link tracking yang belum ada) — jangan mulai tanpa keputusan pemilik baru.

---

## 3. Jebakan khusus sesi ini
1. **`gmv_runrate_bulanan` adalah SATUAN, bukan hiasan.** `clients.total_sales` dibandingkan dengan `gmv_baseline`/`target_gmv` yang **per-bulan**. Menulis GMV mingguan mentah ke sana menjatuhkannya ~4× dan mencrater Health Score klien tanpa sebab performa.
2. **Jangan pro-rate ambang rasio.** Hanya `VOLUME_BENCH_KEYS`. ROI 8× tidak jadi lebih mudah di minggu yang lebih pendek.
3. **`n(v, raw)`**: Seller Center `raw=false` (titik = ribuan), Ads Manager/TTAM `raw=true` (titik = desimal). Salah flag = SETIAP angka iklan bergeser 1000×.
4. **Mode Klien tidak boleh me-render blok internal**, bukan menyembunyikannya. Ada tes yang menjaga ini (`render > OMITS internal remarks…`).
5. **Dua gate untuk satu angka**: `tabel public` ada di `ci.yml` DAN `db-rebuild.sh`. Naikkan keduanya dalam satu commit (pelajaran PR #170).
6. `report_benchmark` **nol policy** — dibaca hanya lewat service-role. Jangan memberi `authenticated` SELECT (reverse-engineering ambang menghancurkan sinyal).

## 4. Sumber kebenaran
- `docs/DECISIONS.md` 2026-08-19 (baris teratas) — 4 keputusan + 5 perbedaan sadar dari tool.
- `docs/backlog/WAVE2_GAP_AUDIT.md` — C1 kini 🟡 bagian 1 selesai.
- Kode: `packages/core/src/report/**` + `supabase/migrations/20260819000000_client_report_engine.sql` + `packages/domain/src/report_schema.reals.test.ts`.
- Pola yang harus ditiru untuk bagian 2: `packages/domain/src/riset-awal.ts` (`submitBaseline`) + `web-internal/src/lib/riset-awal.ts` (`parseExportFile`).
