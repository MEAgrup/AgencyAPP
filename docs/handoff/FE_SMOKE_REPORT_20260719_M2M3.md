# FE — Laporan smoke test manual FE↔BE hidup M2/M3 (2026-07-19)

> Eksekusi butir #1 "Langkah berikutnya" dari `HANDOFF_SESSION_20260719B_FE_M2M3.md`
> terhadap PR #17 (frontend M2 Marketing Performance + M3 Campaign, sudah merge ke
> `main` @ `3ab9693`). Pola = `FE_SMOKE_REPORT_20260719.md`; runbook induk =
> `FE_UAT_RUNBOOK.md`. Skrip Playwright eksekusi ini DI-COMMIT:
> `web-internal/uat/m2m3_smoke.js` (sebelumnya skrip smoke hanya hidup di
> scratchpad sesi dan hilang bersama container).

## Setup

- Stack: MariaDB (`cdps`, `go run ./cmd/migrate up` OK) + mock HRIS 43 karyawan
  (:8081) + `cmd/cdps` (:8080, initial sync 43/43) + rolemapseed UAT (31 mapping,
  3 layered) + mslseed (32 MSL) — persis boot order `import_samples/README.md` §UAT.
- Data alur: `backend/uat/w2_walk.py` **PASS 50/50** + `w3_walk.py` **PASS 38,
  FAIL 0, SKIP 4 (justified)**.
- FE: `web-internal` `npm ci && npm run dev` (Next 16.2.10, rewrite `/api/v1` →
  :8080). Browser: Playwright Chromium headless (`/opt/pw-browsers/chromium`).
- Aktor: Marketing **staff** riil `arivlokananta@gmail.com` (PUBLIC RELATION →
  Marketing/staff) + Marketing **lead** fixture `uat.marketing1@cdps.local`
  (UATMKT0001). Lead M1 disuntik via `POST /leads/bulk` (FE M1 belum ada —
  sesuai catatan handoff).

## Hasil — 19/19 PASS, nol temuan produk

| Blok | Langkah | Hasil |
|---|---|---|
| Login | A6 password salah → alert `[email atau password salah]` verbatim, tetap di `/login`; login staff sukses | PASS |
| Create (negatif) | submit tanpa Online/Offline → `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` verbatim, tanpa CMP- ke-mint | PASS |
| Create (valid) | redirect `/marketing/CMP-202607-XXXX`, badge `Draft` tanpa bracket | PASS |
| Lifecycle | tombol edge sah saja; `Draft→Active` via UI | PASS |
| Linkage M1 | `POST /leads/bulk` campaign_id → imported=1 (sesi cookie FE) | PASS |
| Performance record | create budget 5jt → `Rp. 5.000.000,00`; edit → `Rp. 7.500.000,00` ter-refresh | PASS |
| Auto-Metrics | Lead-by-Dashboard=1; CPL IDR; **ROAS `0.00`** (pembagi budget≠0 — bukan div-0); **CPRL `—`** (real_leads=0, div-0 house rule #7); semua read-only | PASS |
| Dashboard M2 | join client-side id+nama+status badge+budget tampil benar | PASS |
| Close | `Active→Closed` → `end_date` ter-stamp server (Tanggal Selesai ≠ `—`), rollup+metrics di-refetch | PASS |
| Rollup | Leads Generated=1, Total Value Won `Rp. 0,00` (IDR verbatim) | PASS |
| Gate lead | list & dashboard division-wide; detail non-owner: transisi ADA, form budget TIDAK ADA (M2 §5 R3 "monitor, not edit"), reassign ADA; `Closed→Archived` → terminal tanpa tombol | PASS |
| Higiene | nol response 4xx/5xx tak terduga (whitelist: 401 `/me` anonim, 401 uji login, 422 uji create, 404 performance pre-record); nol console error | PASS |

Kriteria lulus runbook §D ikut diverifikasi ulang: `npm run lint` 0 error 0 warning,
`npm run build` hijau (tidak ada perubahan kode app di sesi ini).

Tiga FAIL pada run pertama semuanya bug asersi skrip smoke (race teks alert; salah
ekspektasi ROAS `—` padahal pembaginya budget≠0 → `0.00` benar; regex rollup salah
spasi) — diperbaiki di skrip, bukan di produk.

## Temuan produk

**Tidak ada.** Kontrak gotcha handoff (status tanpa bracket, refetch pasca
transition, gate budget ≠ gate transisi, prefix `/marketing/campaigns`, metrik
verbatim) terverifikasi hidup di browser.

## Utang — DILUNASI di sesi yang sama (lanjutan, acc pemilik produk)

Kedua utang di bawah DIBAYAR setelah laporan ini ditulis (entri DECISIONS
2026-07-19; commit `4c9328a` backend, `653731d` StatusBadge, + commit FE types):

1. `DIVISIONS` lowercase legacy Wave 1 (`lib/types.ts`, form `/admin/role-mappings`)
   — akar: backend menyimpan verbatim dan SEMUA gate permission membandingkan
   case-sensitive terhadap konstanta kapital (`"Marketing"`, `"Live Stream"`
   ber-spasi) ⇒ mapping tulisan admin membuat karyawan kehilangan seluruh
   permission divisi diam-diam. Fix dua lapis: `permission.NormalizeDivision`
   + `ErrBadDivision` di `UpsertRoleMapping` (menutup form/CSV/rolemapseed
   sekaligus; uji live: POST `marketing`→tersimpan `Marketing`, `live stream`→
   `Live Stream`, `growth`→422 `[division harus salah satu dari: ...]`) +
   `DIVISIONS` FE diganti 8 nilai kanonik kapital. Bonus temuan eksekutor:
   `listDivisionQueue` (`lib/tasks.ts`) interpolasi path tanpa
   `encodeURIComponent` — satu-satunya outlier vs sibling-nya; diperbaiki
   (uji live `GET /divisions/Live%20Stream/brief-queue` → 200).
2. Prop opsional `tone` di `StatusBadge` — 3 render inline badge campaign
   (list/detail/dashboard) kini lewat komponen bersama; pemakai lama tak berubah.

Regresi pasca-fix: `m2m3_smoke.js` diulang → **19/19 PASS**; lint 0/0; build hijau;
test backend `internal/admin` + `core/permission` hijau (DB riil, bukan skip).
