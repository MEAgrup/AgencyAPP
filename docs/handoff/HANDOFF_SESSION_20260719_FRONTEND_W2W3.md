# Handoff — Frontend Wave 2 (workspace operasional) + Dashboard Wave 3

> Sesi 2026-07-18/19. Lanjutan `HANDOFF_SESSION_20260718B.md` (UAT teknis backend W3
> selesai). Blok ini = **frontend** `web-internal` untuk Wave 2 + dashboard Wave 3.

## Lokasi & branch

- **Repo:** `MEAgrup/AgencyAPP` — clone di `/home/user/AgencyAPP` (container CCR).
- **Branch:** `claude/frontend-wave-2-dashboard-wave-3-jt46td` (base `main` @ `f9fbbe1`,
  sudah berisi seluruh backend Wave 1–3 + UAT W3 PASS 38/38).
- **PR:** **#14** (draft, open) → main. Tip terakhir: `609e2bb`.
- Urutan commit: `0d45004` nav Sidebar → `406642e` WIP M6/M12 → `1f19ca0` build 9 modul
  → `609e2bb` revisi QC.

## Status: ±90% dari blok ini

| Tahap | Status |
|---|---|
| Recon kontrak API 9 modul (brief verbatim dari `backend/internal/httpapi`) | ✅ 9/9 |
| Panduan konvensi (CONVENTIONS.md, Next 16.2.10 gotchas) | ✅ |
| Build halaman 9 modul | ✅ 9/9 |
| `npm run lint` + `next build` | ✅ 0 error 0 warning, 29 rute |
| QC per modul (endpoint/field vs backend, pesan BI verbatim, computed read-only, transisi, gating role, IDR/`—`) | ✅ 9/9 |
| Revisi temuan QC | ✅ semua fixed (lihat §Temuan) |
| Smoke test manual FE↔BE hidup (login mock HRIS, klik alur utama) | ❌ belum |
| Review manusia + merge PR #14 | ❌ menunggu Yohan/Nerissa |

## Cakupan halaman (semua `'use client'`, pola Wave 1, tanpa dependency baru)

- **Wave 2:** `/account` (+services/[id], strategies/[id], briefs, briefs/[id],
  complaints, complaints/[id]) — M6; `/tasks` (+[id], block-requests) — M12;
  `/creative` (+briefs/[id], assets/[id], daily-output) — M7; `/ads` (+[id]) — M8;
  `/kol` (briefs/[id], bookings, payment-requests/[id], dll) — M9; `/livestream`
  (+briefs/[id], sessions/[id]) — M10.
- **Wave 3:** `/board` + `/board/my-tasks` — M11; `/health` + `/health/[clientId]` — M13;
  `/performance` (+[id], config) — M14.
- Sidebar: seksi **Delivery** & **Visibilitas** (`web-internal/src/components/Sidebar.tsx`).
- Per modul: `web-internal/src/lib/<area>.ts` (types + fungsi API 1:1 endpoint backend).

## Pola kerja (yang diminta Yohan)

Fable = orchestrator + QC + revisi; eksekutor build = **Opus** (M6/M12/M8), **Sonnet**
(recon semua modul + M7/M9/M10/M11), **Haiku** (M13/M14). Dua kali kena session limit
(reset 11:00 & 16:10 UTC) — workflow di-resume dari cache journal, sebagian revisi
akhir dikerjakan Fable langsung. Brief recon: scratchpad sesi (`fe_briefs/*.md`) —
hilang saat container mati; kontrak sebenarnya tetap di kode backend.

## Temuan QC penting (sudah di-fix di `609e2bb`)

1. **Casing divisi** (akar blocker terbanyak): backend kanonik kapital
   (`"Account"/"Creative"/"Ads"/"KOL"/"Live Stream"`, lihat
   `module6_account/strategy.go:51`, `module12_task/task.go`); FE awalnya lowercase →
   antrian divisi mati, gating tidak pernah match. Semua dibetulkan.
2. **OD layered wajib read-only** di semua tombol aksi (M6 strategy/brief/komplain,
   M9 booking/creator-list/aksi Finance).
3. **M14:** staff murni dilarang team-rollup (403) → halaman kini tampilkan link skor
   sendiri; config GET terbuka semua role, PUT tetap Director-only; pesan BI verbatim
   `[total bobot KPI harus berjumlah 100]`; periode target dikunci saat edit (UPSERT).
4. **M13:** scan/toggle ROAS wajib divisi Account (bukan sekadar level), Director menang
   atas OD layered; snapshot 404 tidak lagi memblokir preview/trend/toggle.
5. **M6:** submit Brief plan-gated di-disable sampai Strategy approved.

## Utang / catatan lintas modul (BELUM di-fix, di luar scope PR ini)

- **`lib/types.ts` `DIVISIONS` lowercase legacy Wave 1** dipakai form
  `admin/role-mappings` — admin bisa menulis mapping divisi lowercase sementara seed/
  batch riil kapital. Layak entri DECISIONS + normalisasi backend ATAU perbaiki form.
  (FE modul baru sudah tahan dua arah via `toLowerCase()` di titik kritis.)
- M6: tanpa endpoint list service/client generik & GET service tunggal — workspace pakai
  intake queue + input ID manual; "plan-gated vs Direct" di-derive dari ada/tidaknya
  Strategy (bisa mislabel; butuh endpoint status service bila mau rapi).
- M12: `TransitionResult` JSON key `From`/`To` (struct Go tanpa json tag) — kalau backend
  menambah json tag lowercase, parser FE (lib/tasks.ts dkk) ikut disesuaikan.
- M7: antrian landing pakai endpoint M6 `GET /divisions/Creative/brief-queue`; block-request
  per asset pakai heuristik audit-scan (tidak ada endpoint list per-asset).
- M15-C2 Client Portal tetap DITUNDA (bukan scope blok ini; O4/O5 prasyarat).

## Langkah berikutnya (chat baru)

1. **Smoke test manual**: jalankan backend (setup = `HANDOFF_WAVE2_SESSION3.md` §Setup;
   DB `cdps` migrate 0001–0036, boot UAT = README import_samples §UAT, mock HRIS 43
   karyawan) + `cd web-internal && npm ci && npm run dev`; login per fixture UAT
   (`employees_uat.csv`) dan klik alur: brief kanban M6 → task M12 → metric entry M8 →
   booking M9 → sesi M10 → board M11 → health M13 → performance M14. Perbaiki temuan.
2. Pertimbangkan UAT runbook frontend ringkas (pola W2/W3 runbook, langkah per role).
3. **Review & merge PR #14** (manusia). Setelah merge: sisa frontend = M0/M1 (sales/leads
   workspace), M2/M3 (marketing/campaign), M15 portal (terakhir, tunggu spec security).
4. Bereskan utang `DIVISIONS` lowercase (butir pertama §Utang) — kecil tapi menyentuh
   file bersama Wave 1, sengaja tidak disentuh di PR ini.

## Environment penting

- `web-internal`: Next.js **16.2.10** — BREAKING vs pengetahuan model; baca
  `web-internal/node_modules/next/dist/docs/01-app/` (params dynamic route = Promise +
  `use(params)`). Build: `npm run build`; lint: `npm run lint` (eslint 9, React Compiler
  aktif — hindari hooks kondisional & mutable dep).
- GitHub via MCP (`mcp__github__*`), tanpa `gh` CLI. Push pakai
  `git push -u origin claude/frontend-wave-2-dashboard-wave-3-jt46td`.
