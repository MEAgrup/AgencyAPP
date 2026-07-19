# Handoff — Frontend M2 Marketing + M3 Campaign (workspace Akuisisi)

> Sesi 2026-07-19 (lanjutan `HANDOFF_SESSION_20260719_FRONTEND_W2W3.md`; PR #14/#15
> sudah merge). Blok ini = frontend `web-internal` untuk M2 (Marketing Performance)
> + M3 (Campaign CMP-). Backend kedua modul sudah ada sejak Wave 3 (UAT PASS).

## Lokasi & branch

- **Branch:** `claude/fe-m2-m3-marketing-campaign-iacc5y` (base `main` @ `ace2902`).
- **PR:** #17 → main. Urutan commit: `25dfc00` lib → `50074ab` landing →
  `9fb551c` detail + dashboard + Sidebar + revisi QC (+ commit handoff ini).
- Status blok: **selesai & QC PASS** — lint 0 error, `next build` OK 32 rute.
  Smoke test FE↔BE hidup BELUM (sama seperti posisi PR #14 saat diserahkan).

## Cakupan

- `src/lib/marketing.ts` — types + fungsi 1:1 endpoint (kontrak verbatim dari
  `httpapi/{campaign,marketing}_handlers.go`, `module3_campaign/*.go`,
  `module2_marketing/*.go`), peta transisi MCampaign, `campaignBadgeTone`,
  helper PATCH lokal (pola `lib/clients.ts`).
- `/marketing` — list + create campaign (M3 §3/§5).
- `/marketing/[id]` — detail: transisi (edge sah saja), reassign (M3-OA-6,
  lead/Director), rollup funnel, performance record M2 (create/edit budget),
  auto-metrics + junk breakdown.
- `/marketing/performance` — dashboard Lead/Staff split (M2 §5), join client-side
  `listCampaigns` × `performance-dashboard` (Metrics tidak bawa nama/status/owner).
- Sidebar: seksi **Akuisisi** sebelum Delivery.

## Pola kerja

Fable = orchestrator + QC + revisi. Eksekutor: **Opus** (lib + detail page),
**Sonnet** (landing), **Haiku** (dashboard + Sidebar). Brief kontrak di scratchpad
sesi (hilang saat container mati) — kontrak sebenarnya tetap di kode backend.

## Gotcha kontrak yang WAJIB dipertahankan

1. **Status campaign TANPA bracket** (`Draft/Active/Paused/Closed/Archived`) —
   beda dari mayoritas modul lain yang pakai `[...]`. Badge tone dipetakan lokal
   di `lib/marketing.ts` (`badgeTone` bersama akan jatuh ke gray).
2. **Hasil POST /transition** = `statemachine.Result` tanpa json tag → keys
   `From`/`To` KAPITAL. Jangan parse; selalu refetch. Transisi ke `Closed`
   men-stamp `end_date` server-side → refetch juga rollup+metrics (jendela
   atribusi 3 bulan M3-OA-4 bergeser).
3. **Gate budget M2 ≠ gate transisi M3**: budget hanya owner campaign atau
   Director (lead non-owner = "monitor, not edit", M2 §5 R3); transisi boleh
   lead division-wide.
4. Prefix path M3 = `/api/v1/marketing/campaigns` (BUKAN `/api/v1/campaigns` —
   itu milik M8 Ad Campaign ADC-, entitas berbeda, M3-OA-1).
5. Semua metrik M2 + rollup M3 read-only — FE render string verbatim
   (`"—"`, `"26%"`, `"4.38"`, `*_idr`), tidak pernah menghitung/format ulang.
6. `StatusBadge` belum menerima prop `tone` → badge campaign dirender inline
   `badge badge-{tone}`. Kandidat penyeragaman kecil (tambah prop opsional
   `tone` di `StatusBadge`, lalu ganti 3 call site marketing).

## Langkah berikutnya (chat baru)

1. **Smoke test manual FE↔BE hidup** untuk M2/M3: boot backend + mock HRIS per
   `docs/handoff/FE_UAT_RUNBOOK.md`; login fixture Marketing staff/lead
   (`employees_uat.csv`), klik alur: create campaign → Active → import leads
   (M1, bila FE-nya sudah ada; kalau belum, via API/seed) → performance record →
   metrics → dashboard → Closed → rollup. Perbaiki temuan.
2. **Sisa frontend:** M0/M1 (sales/leads workspace — recon kontrak
   `routes_leads_sales.go` dulu), lalu M15 Client Portal (TERAKHIR, tunggu spec
   security; app terpisah `web-client-portal`, realm auth sendiri).
3. Utang lama masih terbuka: `DIVISIONS` lowercase legacy Wave 1 di
   `lib/types.ts` (form admin/role-mappings) — lihat handoff 20260719 §Utang.
4. Opsional rapi-rapi: prop `tone` di `StatusBadge` (butir 6 di atas).
