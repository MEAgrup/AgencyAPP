# HANDOFF — C1 bagian 2: MESIN LAPORAN KLIEN (domain + API + FE) — Sesi 45

> Rantai: … → SESI43 (Kelas C4–C7, PR **#184**) → SESI44 (C1 bagian 1: mesin +
> skema) → **SESI45 (ini, terbaru — C1 bagian 2: domain + API + FE).**
> Baca yang bernomor tertinggi lebih dulu.
>
> **Status: C1 SELESAI. `clients.total_sales` kini punya PENULIS TUNGGAL** —
> mesin laporan. Gap C1 (§6.2 #5 Health Score) tertutup.

---

## 0. CARA MELANJUTKAN

### 0.0 Posisi branch & PR
| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | `claude/wave2-gap-audit-sesi44-6pygqj` (PR draft). Superset `main`: memuat #182/#183/#184 + SESI44 (C1 bagian 1) + sesi ini. |
| **Migrasi** | **119** total (tak ada migrasi baru sesi ini — bagian 2 murni domain/API/FE di atas skema bagian 1). |
| **Gate** | `tabel public` **121** (dari bagian 1) · `entity_prefix` 35 / `sm_machines` 23 / `notif_events` 58 **TETAP** — nol prefix/mesin/event baru. |
| **Keputusan** | `docs/DECISIONS.md` **2026-08-19** baris teratas ("C1 bagian 2"). |

### 0.1 Aturan main (tak berubah) — lihat SESI44 §0.1 + `CLAUDE.md`
- Tes domain WAJIB serial (`--no-file-parallelism`); rebuild DB setelah migrasi baru.
- Wire snake_case lewat `apps/api/src/lib/wire.ts`; `null` eksplisit, bukan `omitempty`.
- `route-parity` `KNOWN_GAPS` **tetap kosong**.

### 0.2 Setup di container baru
```bash
service postgresql start
su postgres -c "psql -d postgres -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm ci                                          # apps/* + packages/*
bash scripts/db-rebuild.sh --yes                # harus lapor 'tabel public 121'
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
# web-internal BUKAN root workspace — install terpisah untuk typecheck FE:
( cd web-internal && npm ci )
```

---

## 1. Yang SELESAI sesi ini (jangan ulang)

### 1.1 `packages/domain/src/report.ts` — pemanggil mesin + penulis `total_sales`
Meniru **persis** `riset-awal.ts` `submitBaseline`: browser mem-parse xlsx →
`{filename, aoa, sha256, ukuranBytes}`; **server** yang `readSheet` →
`detectTtam`/`detect` → `runReport` → simpan.

- **`createReport(sql, actor, clientId, input)`** dalam `withTransaction`:
  1. validasi tipe periode (`mingguan`/`bulanan`) + klien ada + izin tulis;
  2. platform **aktif** & milik klien (`for update`; pinjam `MSG_PLATFORM_NOT_FOUND`/`MSG_PLATFORM_INACTIVE`);
  3. deteksi tiap berkas server-side — `detectTtam` (4 signature Ads Manager) dulu, lalu `baseline.detect` (12 signature); ambigu toko-vs-afiliasi ⇒ tolak `MSG_AMBIGU` (minta `tipe_override`); wajib ada `shop_tt` ⇒ `MSG_TOKO_WAJIB`;
  4. rentang: `resolveRentang` dari berkas; bila tak terbaca, pakai `periode_mulai`/`periode_akhir` AM (`rentang_dari_berkas=false`), tolak bila keduanya kosong;
  5. baca `report_benchmark` versi **aktif** → `runReport` (jam server `serverGeneratedAt()`, bukan browser);
  6. INSERT `client_reports` + `client_report_berkas`; UNIQUE bentrok ⇒ `ConflictError` (`[laporan untuk toko & periode ini sudah ada]`);
  7. **`recomputeTotalSales`**: `clients.total_sales` = Σ `gmv_runrate_bulanan` laporan **terbaru per platform aktif** (`distinct on (client_platform_id) order by periode_akhir desc, id desc`) + baris `audit_log` `total_sales_recomputed`.
- **`listReports`/`getReport`/`renderReport`** (baca, scope-gated: AM pemilik / lead Account / OD / Director). Read lintas-scope pakai service-role `db()` + gate in-app.
- Izin: `canWriteReport` (AM pemilik + lead Account + Director), `canReadReport` (+ OD). Error class dipinjam dari `./account` ⇒ `mapError` sudah menanganinya (nol perubahan `http.ts`).

### 1.2 API + wire
- Rute: `POST /clients/{id}/reports`, `GET /clients/{id}/reports`, `GET /reports/{id}`, `GET /reports/{id}/html?mode=klien|internal` (text/html; mode Klien tak me-render blok internal).
- `wire.ts`: `ClientReportSummaryWire`/`ClientReportBerkasWire`/`ClientReportDetailWire` + mapper. Registrasi di `shape-parity.test.ts` `WIRE_TO_FE` + `FE_FILES` (`report.ts`).
- **`client_platform_id` ditambah ke `PlatformWire` + FE `Platform` + `ClientPlatformRow` (domain `getClient`)** — panel FE butuh id toko. Aditif; `wire.test.ts` platform expectation diperbarui.

### 1.3 FE `web-internal`
- `src/lib/report.ts` (data layer, mirror wire) + `src/components/clients/ReportPanel.tsx` (pilih toko → Mingguan/Bulanan → drop `.xlsx` → POST → daftar laporan + unduh HTML Klien/Internal via `<a target=_blank>` ke `/api/v1/reports/{id}/html`). Dipasang di `clients/[id]/page.tsx` setelah seksi Platform. Reuse `parseExportFile` apa adanya.

### 1.4 Verifikasi (DB fresh 119 migrasi)
- core **286** · domain **1420** (+1 skip; +16 `report.domain.test.ts`) · api **351** hijau.
- `tsc --noEmit` core + domain + api + **web-internal** bersih.
- `db-rebuild.sh --yes`: 121 tabel + semua gate + 4 invariant hijau.
- `route-parity` / `body-parity` / `shape-parity` / `gate-reachability` / `wire.test` hijau (`KNOWN_GAPS` kosong).

---

## 2. BERIKUTNYA
- **B4-residual**: baseline pertumbuhan majemuk per-kuartal dari `client_reports` (kini floor statis `clients.gmv_baseline`) — kini datanya ADA (`client_reports.gmv_runrate_bulanan` per periode).
- **C2 / C3** tetap DITUNDA (butuh pipeline affiliate-link tracking yang belum ada) — jangan mulai tanpa keputusan pemilik baru.
- **M15 Client Portal** nanti bisa merender laporan dari payload yang sama (satu angka, banyak muka).

## 3. Jebakan khusus sesi ini
1. **`gmv_runrate_bulanan` = SATUAN `total_sales`, bukan hiasan.** Menulis GMV mingguan mentah ke `total_sales` menjatuhkannya ~4× dan mencrater Health Score. `recomputeTotalSales` menjumlah kolom run-rate, bukan `gmv_net`.
2. **Rentang fallback**: DB butuh `periode_mulai`/`periode_akhir` `NOT NULL`, tapi mesin bisa mengembalikan `''` bila berkas tak berheader tanggal. Domain memakai tanggal AM dan menandai `rentang_dari_berkas=false` — jangan menebak.
3. **`detectTtam` dulu, baru `detect`**: Ads Manager & Seller Center disjoint, tapi urutan ini eksplisit. File live/video sendirian TANPA `linked_accounts` = **ambigu** (bukan bug) — perlu `tipe_override`.
4. **web-internal BUKAN root workspace** — `npm ci` root tak menginstalnya; typecheck FE butuh `cd web-internal && npm ci` (xlsx dll.).
5. **Setiap wire `*Wire` WAJIB terdaftar** di `shape-parity` `WIRE_TO_FE` menunjuk tipe FE nyata, dan file FE baru WAJIB masuk `FE_FILES` — kalau tidak, "unregistered wire interfaces" / "missing FE types".

## 4. Sumber kebenaran
- `docs/DECISIONS.md` 2026-08-19 (dua baris teratas — bagian 1 & 2).
- `docs/backlog/WAVE2_GAP_AUDIT.md` — C1 kini ✅.
- Kode: `packages/domain/src/report.ts` (+ `report.domain.test.ts`), `apps/api/src/app/api/v1/clients/[id]/reports/**` + `reports/[id]/**`, `apps/api/src/lib/wire.ts` (`clientReport*ToWire`), `web-internal/src/lib/report.ts` + `components/clients/ReportPanel.tsx`.
- Pola yang ditiru: `riset-awal.ts` (`submitBaseline`) + `recap.ts` (`getRecapDetail`, izin scope).
