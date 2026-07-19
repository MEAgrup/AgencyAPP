# HANDOFF — Sesi 2026-07-19B/C: seluruh FE internal selesai + merge; peta jalan ke live

> Menggantikan revisi-revisi sebelumnya dokumen ini (riwayat di git). Ditulis di
> akhir sesi 2026-07-19C setelah SEMUA pekerjaan kode FE internal selesai dan
> ter-merge. Baca bersama `FE_UAT_RUNBOOK.md` + `FE_SMOKE_REPORT_20260719.md`.

## Rantai merge sesi 2026-07-19 (urut)

| PR | Isi | Status |
|---|---|---|
| #15 → #14 | FE Wave 2 workspace + dashboard Wave 3 + smoke test + 5 fix cermin-gate | ✅ merged (`ace2902`) |
| #17 | FE M2 Marketing + M3 Campaign (sesi paralel B) | ✅ merged (`3ab9693`) |
| #20 | FE M0 Sales + M1 Leads + **read API backend M0/M1** (branch `vnpgxd`, review orchestrator: gate permission OK, test 3 paket hijau, build 33 rute) | ✅ merged (`61395e4`) |
| #13 | CI hardening: fail-loud anti silent-skip (`CI` env → Fatal) + entri DECISIONS; duplikat fix `Clean` dibuang saat resolusi | ✅ merged (`0971974`) |
| #18 | Railway deploy config (Dockerfile backend, `$PORT`, `DATABASE_URL`→DSN, `/healthz`, `BACKEND_URL` di next.config) — review: default lokal tak berubah, test db hijau | ✅ merged (`5b3d962`) |
| #16 | Dokumen handoff ini + **FE M15-C1 Team Portal + pelunasan utang `DIVISIONS`** (commit `113111b`) + runbook/laporan smoke diperluas | ✅ merged (lihat git log terakhir) |

## Yang baru dibangun sesi C (di PR #16)

1. **FE M15-C1 Team Portal** — `lib/portal.ts` (typed 1:1 `portal_handlers.go`, reuse
   tipe M11/M12/M14) + 3 halaman: `/portal` (Portal Saya: task terbuka urut SLA-risk
   dari server, skor preview bulan berjalan, trend), `/portal/team` (rollup divisi +
   klien + antrian block read-only — aksi tetap satu pintu di `/tasks/block-requests`),
   `/portal/management` (Director+OD: semua klien × band/trend/komponen penarik).
   Gate cermin FE lengkap (edge 404 divisi non-scored M14 tidak ditembak). Nav seksi
   **Portal** per role. Entri DECISIONS 2026-07-19.
2. **Utang `DIVISIONS` lowercase LUNAS** — `lib/types.ts` kini kanon kapital backend
   (`Marketing/Sales/Finance/Account/Creative/Ads/KOL/Live Stream`); satu-satunya
   pemakai = form `admin/role-mappings` (backend tidak memvalidasi kanon — form
   adalah penjaganya). DB UAT dicek: nol mapping lowercase telanjur. Entri DECISIONS.
3. **Smoke test FE↔BE hidup M0–M3 + portal** — stack UAT penuh (mock HRIS 43,
   `w2_walk` 50/50 + `w3_walk` PASS), Playwright: fase-1 read-path 8 role × 37
   kunjungan rute + click-through detail = **0 temuan**; fase-2 write **4/4 PASS**
   (registrasi lead via UI + negatif required; Portal Tim Director pilih-divisi →
   rollup termuat). Runbook diperluas (§B2 B12–B19, §C6). Lint 0/0, build **36 rute**.

## Status FE web-internal: SEMUA modul internal punya FE

M0 ✅ M1 ✅ M2 ✅ M3 ✅ M4/M5 ✅ M6 ✅ M7 ✅ M8 ✅ M9 ✅ M10 ✅ M11 ✅ M12 ✅ M13 ✅ M14 ✅ M15-C1 ✅.
Satu-satunya kode tersisa = **M15-C2 Client Portal** (`web-client-portal/` masih 0 file)
— **DITUNDA resmi**, jangan mulai tanpa O4 (embeddability) + O5 (security spec).

## ⚠ Keputusan manusia yang masih menggantung

1. **M8 metric entry tanpa gate status** — entry pada kampanye `[Ended]` diterima
   backend (§5 Flow 1, ROAS derived on read). Larang atau biarkan? (bila larang →
   ticket backend + string BI baru).
2. **Teks info UI** di halaman-halaman fix cermin-gate + portal = teks bantuan bebas,
   BUKAN pesan BI `[...]` resmi PRD — konfirmasi nada/frasa.
3. **Catatan probe by-design** (bukan bug, pola konsisten M13): detail campaign M2
   menembak `GET …/performance` dan menerima 404 sebagai "belum ada record" (render
   form create). Smoke sudah mem-whitelist pola ini.

## ⛔ Blocker go-live NON-KODE (item manusia — tidak berubah)

nik_email.csv; sales_map.csv + MSL final; form pelengkap 239 klien; NIK+email riil
OD/Director (O26); endpoint HRIS produksi. Plus eksekusi deploy riil: config Railway
sudah merged (PR #18) tapi **setup project Railway + MySQL + env vars = tindakan
manusia** (panduan: `docs/DEPLOY_RAILWAY.md`).

## Pekerjaan kode berikutnya (sudah tipis)

1. (Opsional, kecil) Halaman FE yang memakai fixture: verifikasi ulang saat aktor
   riil O26/O33/O34 masuk.
2. **M15-C2 Client Portal** — HANYA setelah O4+O5 diputus. Realm auth terpisah,
   allow-list data layer, app `web-client-portal` dari nol.
3. Responsif/UX polish & UAT manusia (runbook `FE_UAT_RUNBOOK.md` siap dipakai
   non-teknis).

## Progress → live

| Lapisan | Progress | Catatan |
|---|---|---|
| Backend M0–M15-C1 | ~97% | semua wave + UAT PASS; sisa keputusan M8 gate (kecil) |
| FE web-internal | ~95% | SEMUA modul internal ada FE + smoke hijau; sisa polish/UAT manusia |
| Client Portal M15-C2 (BE+FE) | 0% | ditunda resmi (O4/O5) |
| Deploy/infra | config ✅ | eksekusi Railway = manusia (`docs/DEPLOY_RAILWAY.md`) |
| Data/integrasi go-live | tersendat | 5 item manusia |
| **→ go-live internal (tanpa portal klien)** | **± 92%** | sisa = item manusia + deploy + UAT manusia |
| **→ live penuh (incl. portal klien)** | **± 80%** | M15-C2 belum dimulai (by decision) |

## Setup ulang container (ephemeral)

Sama seperti sebelumnya: MariaDB + DB `cdps`/`cdps_test`(+`_test2`) user `cdps`/`cdps_dev`
+ `log_bin_trust_function_creators=1` → `go run ./cmd/migrate up` → mockhris :8081 →
cdps :8080 → rolemapseed `--apply` → mslseed `--apply` → `w2_walk.py` + `w3_walk.py` →
`web-internal: npm ci && npm run dev`. Login UAT: password `rahasia123`.
Next.js 16.2.10 BREAKING — baca `web-internal/node_modules/next/dist/docs/`; React
Compiler: hindari `useCallback` dengan dep turunan (pindah ke `useEffect` + flag
`cancelled`, lihat `account/briefs/page.tsx`).
