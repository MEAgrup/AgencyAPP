# HANDOFF — Sesi 2026-07-19B: Smoke test FE↔BE merged + peta jalan ke live

> Lanjutan `HANDOFF_SESSION_20260719_FRONTEND_W2W3.md`. Sesi ini **menutup blok
> frontend Wave 2 + dashboard Wave 3**: smoke test manual FE↔BE hidup dieksekusi,
> 5 fix diterapkan, **PR #15 → PR #14 → main semuanya MERGED**. Dokumen ini =
> status pasca-merge + apa yang tersisa sampai go-live.

## Yang selesai sesi ini

- **Smoke test manual FE↔BE hidup** (butir terakhir checklist PR #14): stack UAT
  mock-HRIS (43 karyawan) + backend + `web-internal npm run dev`, data alur dari
  `w2_walk.py` (50/50) + `w3_walk.py` (38/38), Playwright Chromium.
  - Fase-1 read-path: 10 role fixture × 29 rute + click-through → bersih.
  - Fase-2 write-path: PASS 7/7 (scan M13/M14 Director, toggle ROAS M13, metric
    entry M8 via UI oleh PIC Ads).
  - Laporan lengkap: `docs/handoff/FE_SMOKE_REPORT_20260719.md`.
  - Runbook UAT frontend (pola W2/W3): `docs/handoff/FE_UAT_RUNBOOK.md`.
- **5 fix cermin-gate** (commit `70b27d0`, 5 file halaman FE-only): FE tidak lagi
  menembak endpoint yang gate server-nya pasti menolak (semua gate backend
  diverifikasi benar — module6/10/14/15). File: `/tasks/block-requests`,
  `/account/briefs`, `/livestream/briefs/[id]`, `/kol`, `/performance`.
- **Merge:** PR #15 (`cea9416`) → branch PR #14; PR #14 (`ace2902`) → **main**.
  Tip main sekarang `ace2902`. Tidak ada PR open tersisa dari blok ini.

## ⚠ Dua item review manusia yang MASIH terbuka (bukan blocker merge, tapi perlu diputus)

1. **M8 `LogMetricEntry` tanpa gate status kampanye** — metric entry pada kampanye
   `[Ended]` diterima (§5 Flow 1; total & ROAS derived on read). **Keputusan
   PRD/backend**: apakah perlu ditolak pasca-`[Ended]`? Bila ya → ticket backend
   (tambah gate + string BI), bukan FE. Bila tidak → catat sebagai keputusan.
2. **Teks info baru di 5 halaman** (mis. "Antrean Brief divisi KOL hanya dapat
   dibuka oleh…") = **teks bantuan UI bebas, BUKAN** pesan validasi BI `[...]`
   resmi PRD. Konfirmasi nada/frasa MEA sudah pas.

## Status frontend keseluruhan (web-internal)

| Modul | Rute FE | Status |
|---|---|---|
| M4/M5 money path | `/clients`, `/finance`, `/finance/transactions/[id]`, `/finance/reminders` | ✅ (Wave 1 FE) |
| MSL admin | `/master-services`, `/sales/kalkulator`, `/admin/*` | ✅ |
| **M6 Account** | `/account` + services/strategies/briefs/complaints | ✅ (Wave 2) |
| **M12 Task** | `/tasks` + [id]/block-requests | ✅ |
| **M7 Creative** | `/creative` + briefs/assets/daily-output | ✅ |
| **M8 Ads** | `/ads` + [id] | ✅ |
| **M9 KOL** | `/kol` + bookings/briefs/payment-requests | ✅ |
| **M10 Live Stream** | `/livestream` + briefs/sessions | ✅ |
| **M11 Board** | `/board` + my-tasks | ✅ (Wave 3) |
| **M13 Health** | `/health` + [clientId] | ✅ |
| **M14 Performance** | `/performance` + [id]/config | ✅ |
| **M0 Sales workspace** | — | ❌ **belum ada FE** (pipeline/closing) |
| **M1 Leads workspace** | — | ❌ **belum ada FE** (intake/qualify) |
| **M2 Marketing workspace** | — | ❌ **belum ada FE** |
| **M3 Campaign workspace** | — | ❌ **belum ada FE** |
| **M15 Client Portal** | `web-client-portal/` | ❌ **kosong (0 file)** — app terpisah, tunggu security spec O5 |

Catatan: backend M0–M3 **sudah selesai + UAT PASS** (Wave 1 & Wave 3). Yang kurang
murni lapisan FE-nya.

## Pekerjaan berikutnya (urutan disarankan)

1. **FE M0 Sales + M1 Leads workspace** (Wave 1 modules, money path sudah ada FE-nya
   tapi sales pipeline & leads intake belum). Ini layar harian tim Sales — nilai
   operasional tertinggi. Pola: recon `backend/internal/httpapi` verbatim →
   `src/lib/<area>.ts` typed 1:1 → halaman `'use client'` pola Wave 1/2 →
   lint+build+smoke.
2. **FE M2 Marketing + M3 Campaign workspace** (backend Wave 3 sudah ada). Fixture
   Marketing-lead `UATMKT0001` sudah ada di roster UAT.
3. **Bereskan utang `DIVISIONS` lowercase legacy Wave 1** di form `admin/role-mappings`
   (`lib/types.ts` — admin bisa menulis mapping divisi lowercase sementara seed/batch
   riil kapital). Kecil tapi menyentuh file bersama; layak 1 PR sendiri + entri
   DECISIONS atau normalisasi backend.
4. **M15 Client Portal** (TERAKHIR): butuh security spec **O5** dulu (realm auth
   terpisah, allow-list data layer — bukan internal view yang di-trim). Backend
   M15-C2 juga masih ditunda. Jangan mulai sebelum O5 diputus.

## ⛔ Blocker go-live NON-KODE (item manusia — belum berubah sejak Wave 1)

Ini yang menahan **UAT go-live W1-20** (bukan UAT teknis, yang sudah PASS):
- `nik_email.csv` — mapping NIK↔email riil untuk auth produksi.
- `sales_map.csv` + MSL final — pemetaan sales & Master Service List riil.
- Form pelengkap **239 klien** (mandatory-field validation sebelum ID di-generate).
- **NIK + email riil OD/Director** (kini fixture `UATDIR0001/0002`, `2409230432` OD).
- **Endpoint HRIS produksi** (`GET /employees` + token) — kini mock HRIS CSV.

Sampai kelima ini masuk, go-live tetap jalan di mode fixture/mock (cukup untuk
demo & UAT, tidak untuk produksi).

## Estimasi progress → live (kasar, jujur)

| Lapisan | Progress | Catatan |
|---|---|---|
| Backend (engine + M0–M14) | ~95% | Semua wave built + UAT PASS; sisa M15-C2 portal (ditunda O5) |
| Frontend web-internal | ~70% | M4–M14 ✅; M0/M1/M2/M3 workspace ❌ |
| Client Portal (M15 BE+FE) | ~5% | Ditunda, tunggu security spec O5 |
| Prep data/integrasi go-live | tersendat | 5 item manusia di atas |
| **Rata-rata tertimbang → live penuh (incl. portal)** | **± 72%** | |
| **→ go-live internal (web-internal only, portal excluded)** | **± 82%** | gated oleh 5 item manusia, bukan kode |

## Setup ulang container (ephemeral — smoke test / UAT)

Persis `import_samples/README.md` §UAT + `HANDOFF_WAVE2_SESSION3.md` §Setup:
1. `apt-get install -y mariadb-server`; `service mariadb start`; buat DB
   `cdps`/`cdps_test`/`cdps_test2` + user `cdps@localhost`/`@127.0.0.1` pw `cdps_dev`;
   `SET GLOBAL log_bin_trust_function_creators=1`.
2. `cd backend`: `go run ./cmd/migrate up` → mockhris :8081 → cdps :8080 →
   `rolemapseed --apply` → `mslseed --actor 2101180004 --apply`.
3. Seed alur: `python3 uat/w2_walk.py && python3 uat/w3_walk.py`.
4. `cd web-internal && npm ci && npm run dev` (rewrite `/api/v1`→:8080 sudah ada).
5. Login: email riil/fixture + password `rahasia123`. Skrip Playwright smoke ada
   di scratchpad sesi (hilang saat container mati; pola terdokumentasi di
   `FE_UAT_RUNBOOK.md`).

## Konvensi FE (tetap berlaku)

Next.js **16.2.10** (BREAKING vs pengetahuan model — baca
`web-internal/node_modules/next/dist/docs/`). Dynamic route params = `Promise` +
`use(params)`. React Compiler aktif (eslint 9): hindari hooks kondisional & dep
mutable — kalau `useCallback`+dep memicu "preserve-manual-memoization", pindah
fetch ke dalam `useEffect` dengan flag `cancelled` (lihat `account/briefs/page.tsx`).
Pesan BI `[...]` verbatim; computed read-only; IDR `Rp. X.XXX.XXX,00`; div-0/null → `—`.
