# FE — Laporan smoke test manual FE↔BE hidup M0/M1 (2026-07-20)

> Eksekusi utang "Smoke test manual FE↔BE hidup utk M0/M1" dari
> `HANDOFF_SESSION_20260719_FE_M0M1.md`, terhadap branch
> `claude/fe-m0-m1-sales-leads-vnpgxd` (merge jazm79 + main M2/M3).
> Pola & instrumen = `FE_UAT_RUNBOOK.md` / `FE_SMOKE_REPORT_20260719.md`.
> Pola kerja: Fable = orchestrator + QC + revisi; eksekutor Opus (boot stack),
> Sonnet (sweep read-path + write-path Playwright).

## Setup

- Stack: MySQL 8 (`cdps`, migrate penuh) + mock HRIS 43 karyawan (:8081) +
  `cmd/cdps` (:8080, sync 43/43) + rolemapseed UAT (31 mapping, 3 layered) +
  mslseed (32 MSL) — boot order `import_samples/README.md` §UAT.
- Data alur: `backend/uat/w120_walk.py` **PASS 32/32** (deal M0 end-to-end:
  LEAD/PRSP/CLI/TRX/INST hidup di DB).
- FE: `web-internal` `npm run dev` (Next 16.2.10, rewrite `/api/v1` → :8080).
  Browser: Playwright Chromium headless.
- Aktor: Sales staff riil (saffira), Sales lead riil (Cucu N.), Marketing staff
  riil (arivlokananta), Marketing lead fixture, OD layered riil (orendy9),
  Director fixture, Finance fixture (kontrol negatif). Password UAT bersama.

## Fase 1 — read-path 7 role × rute M0/M1: **21/21 PASS** (setelah fix)

Instrumen: console error, pageerror, semua respons `/api/v1` ≥400, deteksi
error-overlay Next. Asersi per role: scope list (Sales staff tanpa kolom Owner,
lead/OD/Director dengan Owner), gating tab `/leads` (Pool/Database/Import persis
matriks §2), OD murni read-only (form registrasi & tombol aksi & Klaim hilang),
klik list→detail, Finance `/leads` = "Tidak ada tampilan untuk role Anda" tanpa
tembakan 4xx.

## Fase 2 — write-path via UI: **11/11 PASS** (setelah fix)

| # | Langkah | Bukti verbatim |
|---|---|---|
| 1 | Import satu baris (Marketing) | `[1 lead berhasil diimport, 0 ditolak (duplikat/data tidak lengkap)]` |
| 2 | Bulk import 2 valid + 1 cacat | `[2 lead berhasil diimport, 1 ditolak …]`; Daftar Penolakan: `[data tidak lengkap, baris tidak diimport]` |
| 3 | Klaim dari Pool (Sales staff) | `Berhasil klaim — Prospect PRSP-… dibuat.` |
| 4 | Tandai Contacted | badge `Contacted`; audit 1→2 |
| 5 | Qualified Lead Form (platform, kategori, MSL picker) | badge `Qualified` |
| 6 | Negosiasi (Negotiation Required, lines default) | `Negotiation - Pending Approval` |
| 7 | Keputusan Approve + note (Sales lead) | `Negotiation - Approved` |
| 8 | Closing Form (primary terkunci, Σ alokasi 100%, `[Bayar Penuh (Lunas)]`) | 201 + banner `Closing berhasil. Client ID: CLI-… · Transaction ID: TRX-…` + link Client Record |
| 9 | NEGATIF registrasi kosong (bypass validasi browser) | `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` |
| 10 | Registrasi UI positif + duplikat telepon | `Lead terdaftar: LEAD-… · attempt PRSP-…` lalu `[anda sudah memiliki prospek aktif untuk lead ini]` |
| 11 | OD buka detail Closed-Success | 0 tombol aksi, render bersih |

## Temuan awal → fix (commit `fix(web+api): smoke test FE-BE hidup M0/M1 …` + commit sesi ini)

| # | Gejala | Akar | Fix |
|---|---|---|---|
| 1 | `/sales` utk Finance/Marketing dkk: alert 403 mentah dari sidebar | FE fetch `GET /attempts` tanpa gate; server hanya izinkan Sales/OD/Director | FE cermin gate (`canSeeAttempts`) + info alert pengarah ke Import Marketing (pola smoke W2/W3) |
| 2 | 403 read M0/M1 berbunyi `[anda tidak memiliki akses untuk melakukan transisi ini]` | reads reuse `RoleDeniedMessage` (pesan transisi); modul lain pakai string generik akses data | `forbidden()` reads → `[anda tidak memiliki akses ke data ini]` (preseden DECISIONS W3-M3-C1); pesan transisi tetap utk write |
| 3 | **Registrasi Lead Sales via UI SELALU ditolak** `[data tidak lengkap…]` apa pun isinya | `RegisterInput` tanpa tag json — payload snake_case FE decode jadi zero value (walk API lama lolos karena kirim PascalCase) | tag json snake_case (kontrak = `lib/leads.ts`, konsisten `BulkRow`); payload register di `w120/w2/w3_walk.py` diselaraskan |
| 4 | Banner sukses closing (CLI/TRX + link) tak pernah tampil — form hilang begitu status jadi Closed-Success | banner dirender di dalam seksi yang digated `status === Approved/Auto` | banner diangkat ke luar gate status (render selama `closeResult` ada) |

Temuan #3 kelas kontrak (pintu intake Sales M0 §3 mati total di UI); #4 kelas UX
kritis (deal closed tanpa konfirmasi CLI/TRX di layar). Keduanya diverifikasi
ulang end-to-end (fase 2 rerun penuh, 11/11).

## Perilaku yang dikonfirmasi disengaja (bukan temuan)

- "No Negotiation Required" ⇒ `Negotiation - Auto Approved` (lewati review
  superior) — sesuai M0 §5.
- Tombol claim Pool berlabel `Claim` (istilah PRD M1).
- Detail `/sales/[id]` via URL langsung oleh role tanpa akses ⇒ alert BI 403
  kanonik, halaman tidak crash (pola modul lain).
- `GET /me` 401 di `/login` anonim = by design.

## Gate DoD

- `go vet ./...`, `go build ./...` bersih; test `module0_sales`,
  `module1_leads`, 5 test handler read M0/M1 hijau; **full suite `go test -p 1
  ./...` hijau** (lihat commit).
- `npm run lint` 0 error 0 warning; `npm run build` sukses (50 rute).
- `w120_walk.py` rerun pasca-perubahan kontrak: **32/32 PASS**.

## Status blok FE M0/M1 setelah sesi ini

Smoke test manual FE↔BE hidup ✅ (read 21/21, write 11/11). Sisa: review manusia
+ merge PR branch ini. Utang lama tetap: `platform` satu string join (M4-OA-2),
Kategori Bisnis input teks, `DIVISIONS` lowercase legacy di form role-mappings.
