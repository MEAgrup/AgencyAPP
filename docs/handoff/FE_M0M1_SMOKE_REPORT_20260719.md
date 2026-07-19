# Laporan Smoke Test FE↔BE — M0 Sales + M1 Leads (2026-07-19)

> Pola `FE_UAT_RUNBOOK.md` / `FE_SMOKE_REPORT_20260719.md`, untuk halaman baru
> `/sales`, `/sales/[id]`, `/leads`, `/leads/[id]` (branch `claude/fe-m0-m1-sales-leads-jazm79`).
> Stack: boot UAT README import_samples §"UAT login gate" (migrate → mockhris :8081 →
> cdps :8080 auto-sync 43 → rolemapseed 31+3 → mslseed 32) + `npm run dev` :3000.
> Skrip repeatable: **`backend/uat/fe_m0m1_smoke.js`** (Node + playwright-core,
> Chromium; login riil + klik UI sungguhan). Eksekusi terakhir: **PASS 24 / FAIL 0**.

## Aktor

| Peran | Akun |
|---|---|
| Sales staff A / B | `faesalabdul900@gmail.com` / `nandarumpaka@gmail.com` (SALES JASA) |
| Sales lead (superior) | `c.nurhayati14@gmail.com` (HEAD OF SALES JASA) |
| Marketing lead | `uat.marketing1@cdps.local` (fixture O34) |
| OD layered | `ORENDY9@GMAIL.COM` |

## Cakupan (24 langkah, semua PASS)

- **S1 Import Marketing (M1 §3):** single (= bulk 1 baris) → `[Pool]`; bulk 3 baris
  (1 valid, 1 tanpa telepon, 1 duplikat pool) → summary & alasan tolak **verbatim**
  (`[1 lead berhasil diimport, 2 ditolak (duplikat/data tidak lengkap)]`,
  `[data tidak lengkap, baris tidak diimport]`, `[lead sudah ada & sedang diproses, tidak diimport]`).
- **S2–S3 Pool & klaim kompetitif (M1 §6):** claim A → PRSP; tombol jadi "Sudah diklaim";
  B melihat "1 sales mengerjakan", klaim kedua sah → "2 sales mengerjakan".
- **S4 Lifecycle M0 (scouted):** registrasi → PRSP; Contacted; Qualified Form (platform
  checklist, picker MSL, preview Estimasi Nilai/Komisi **read-only dari server**);
  Negotiation Required (harga diedit) → Pending Approval; owner melihat status menunggu,
  bukan panel keputusan.
- **S5 Superior:** panel keputusan hanya untuk Sales lead; Revise/Reject disabled tanpa
  catatan; Approve → Closing Form.
- **S6 Closing:** skema `[Termin]` 2 cicilan Σ = nilai approved → sukses, CLI-/TRX- tampil
  + link Client Record.
- **S7 Not Qualified:** taksonomi M1-OA-8 verbatim tercatat & tampil.
- **S8 OD layered read-only:** form registrasi tersembunyi, detail terbaca tanpa tombol
  aksi, tombol Claim tidak ada.
- **S9 `/leads/[id]`:** kontes 2 attempt + histori audit render.
- Nol HTTP ≥400 tak terduga; console error hanya 401 `/me` anonim di `/login` (by design).

## Temuan & perbaikan (semua sudah di-commit di branch ini)

1. **[BE, blocker] `module1_leads.RegisterInput` tanpa json tag** — wire format
   accidental PascalCase (`LeadName`); FE (dan konvensi seluruh endpoint lain) memakai
   snake_case → `POST /api/v1/leads` selalu `[data tidak lengkap...]`. Fix: json tag
   snake_case pada struct + selaraskan `backend/uat/w120_walk.py`, `w2_walk.py`,
   `w3_walk.py` (5 baris payload register). Test `module1_leads` + `httpapi` hijau
   (test Go memakai struct langsung — tak terdampak). Kelas bug yang sama dengan catatan
   lama M12 `TransitionResult From/To` (handoff W2/W3 §Utang).
2. **[FE, UX] Alert sukses closing hilang seketika** — alert + link Client Record dirender
   di dalam section ber-gate `status === Approved/Auto Approved`; setelah sukses status
   jadi `Closed-Success` → section unmount. Fix: hasil closing dirender di section
   sendiri di luar gate status.
3. **[Skrip] race hidrasi React di `/login`** — `fill` sebelum hidrasi membuat controlled
   input kosong (POST login kosong → 400). Fix di skrip: `waitUntil: 'networkidle'`.

## Verifikasi akhir

- `node backend/uat/fe_m0m1_smoke.js` → **PASS 24 / FAIL 0** (exit 0).
- `go test -p 1` `./internal/module1_leads/ ./internal/httpapi/` → ok (DB MySQL nyata).
- `npm run lint` 0 error; `npm run build` sukses.

## Catatan lingkungan

- MySQL 8 Ubuntu: `SET GLOBAL log_bin_trust_function_creators=1` wajib sebelum migrate
  (trigger audit immutability); lihat handoff `HANDOFF_SESSION_20260719_FE_M0M1.md`.
- Prasyarat skrip: `npm i playwright-core` + Chromium (`/opt/pw-browsers/chromium` di CCR).
