# HANDOFF — Sesi 2026-07-19B: Smoke test FE↔BE merged + peta jalan ke live

> Lanjutan `HANDOFF_SESSION_20260719_FRONTEND_W2W3.md`. Sesi ini **menutup blok
> frontend Wave 2 + dashboard Wave 3**: smoke test manual FE↔BE hidup dieksekusi,
> 5 fix diterapkan, **PR #15 → PR #14 → main semuanya MERGED**. Dokumen ini =
> status pasca-merge + apa yang tersisa sampai go-live.
>
> **UPDATE 2026-07-19 (revisi 2, pasca-verifikasi lintas-sesi):** dua track FE
> paralel ternyata sudah jalan di sesi lain — **FE M2+M3 sudah MERGED ke main**
> (PR #17, main `3ab9693`) dan **FE M0+M1 selesai dibangun** di branch
> `claude/fe-m0-m1-sales-leads-vnpgxd` (= `jazm79` + merge ke atas main terbaru +
> verifikasi; **belum ada PR-nya — itu tindakan pertama chat berikutnya**).
> Tabel status & progress di bawah sudah direvisi mengikuti kenyataan ini.

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
| **M0 Sales workspace** | `/sales` + `[id]` | 🟡 **selesai di `vnpgxd`, belum PR/merge** |
| **M1 Leads workspace** | `/leads` + `[id]` | 🟡 **selesai di `vnpgxd`, belum PR/merge** |
| **M2 Marketing workspace** | `/marketing` + performance | ✅ **merged PR #17** (main `3ab9693`) |
| **M3 Campaign workspace** | `/marketing/[id]` detail campaign | ✅ **merged PR #17** |
| **M15-C1 Team Portal (internal)** | — (`/portal/me`, `/portal/management` belum ada halaman; `/portal/team` baru dipakai `tasks/block-requests`) | ❌ **belum ada FE** — backend sudah UAT PASS, TIDAK menunggu O5 |
| **M15-C2 Client Portal** | `web-client-portal/` | ❌ **kosong (0 file)** — app terpisah, tunggu security spec O5 |

Catatan: backend M0–M3 **sudah selesai + UAT PASS** (Wave 1 & Wave 3).
⚠ Branch `vnpgxd` **bukan FE-only**: menambah **read surface backend M0/M1**
(5 file: `module0_sales/reads.go`, `module1_leads/reads.go`,
`httpapi/leads_sales_read_handlers(+_test).go`, `routes_leads_sales.go`) — pola
aditif read-only preseden `module8_ads/read.go`; klaim "full suite hijau" perlu
diverifikasi ulang saat review PR. Konflik Sidebar seksi **Akuisisi** (kedua track
menambahnya) sudah ter-resolve di merge `vnpgxd` (berisi `/sales`, `/leads`,
`/marketing`, `/marketing/performance`).

## Pekerjaan berikutnya (urutan disarankan — revisi 2)

1. **Buka PR dari `claude/fe-m0-m1-sales-leads-vnpgxd` → main, review, merge.**
   Perhatian review: 5 file backend read API (bukan FE-only) — DoD backend berlaku
   (permission tests per role, gofmt/vet, suite fresh). PR belum dibuka karena
   sesi pembuatnya berhenti sebelum klik Create PR.
2. **Smoke test FE↔BE hidup untuk M0/M1 + M2/M3** (keduanya masuk TANPA smoke,
   pola sama seperti PR #14 dulu): perluas `FE_UAT_RUNBOOK.md` bagian aktor
   Sales/Leads/Marketing, jalankan pola Playwright yang sama. Aktor: Sales staff
   `saffiramarwah` / Head `c.nurhayati14`, Marketing lead `UATMKT0001`.
3. **Rapikan PR #13 (CI testutil)**: fix `Clean` satu-koneksi TERNYATA SUDAH di
   main (via `2327b50`, ikut PR #14) — nilai unik tersisa = fail-loud anti
   silent-skip (`CI` env → Fatal; belum ada di main, terverifikasi grep) + cherry
   -pick docs `02415f1`. Rebase ke main + buang duplikat, baru merge.
4. **PR #18 Railway deploy backend** (draft, sesi lain): review terpisah —
   menyentuh `db.go` DSN & `main.go` PORT; pastikan default lokal tetap jalan.
5. **FE M15-C1 Team Portal internal** (`/portal/me` landing staf, `/portal/management`
   Director/OD): backend sudah UAT PASS, TIDAK menunggu O5 — kecil (2–3 halaman).
6. **Bereskan utang `DIVISIONS` lowercase legacy Wave 1** di form `admin/role-mappings`
   (`lib/types.ts`). Kecil tapi file bersama; 1 PR sendiri + entri DECISIONS
   atau normalisasi backend.
7. **M15-C2 Client Portal** (TERAKHIR): butuh security spec **O5** dulu (realm auth
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
| Frontend web-internal | ~88% | M2–M14 ✅ merged; M0/M1 🟡 tinggal PR+merge; sisa M15-C1 portal FE + smoke M0–M3 + utang kecil |
| Client Portal (M15-C2 BE+FE) | ~5% | Ditunda, tunggu security spec O5 |
| Deploy/infra | mulai | PR #18 Railway (draft, belum teruji build Docker) |
| Prep data/integrasi go-live | tersendat | 5 item manusia di atas |
| **Rata-rata tertimbang → live penuh (incl. portal)** | **± 77%** | |
| **→ go-live internal (web-internal only, portal excluded)** | **± 87%** | gated oleh 5 item manusia + deploy, bukan kode aplikasi |

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
