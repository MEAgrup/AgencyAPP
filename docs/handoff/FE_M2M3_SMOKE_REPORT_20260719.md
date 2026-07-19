# FE — Laporan smoke test manual FE↔BE hidup M2/M3 (2026-07-19)

> Eksekusi butir "Smoke test manual FE↔BE hidup untuk M2/M3" dari
> `HANDOFF_SESSION_20260719B_FE_M2M3.md` §Langkah berikutnya #1, terhadap FE
> `/marketing`, `/marketing/[id]`, `/marketing/performance` (PR #17, sudah di main).
> Skrip repeatable: `backend/uat/fe_m2m3_smoke.js` (pola `fe_m0m1_smoke.js` —
> login riil via UI, klik alur sungguhan, Playwright Chromium headless).

## Hasil: **PASS 43 / FAIL 0** — nol HTTP ≥400 tak terduga, nol temuan aplikasi

Satu-satunya perbaikan sepanjang sesi ini adalah pada **skrip smoke itu sendiri**
(race harness, bukan bug FE/BE): setelah Submit Closing, `.alert.alertSuccess`
generik menangkap alert sukses lama ("Attempt ditandai Contacted.") yang masih
terpampang — di-fix dengan menunggu spesifik `text=Closing berhasil` + settle
`networkidle` sebelum logout. Tidak ada satu pun file `web-internal`/`backend`
yang perlu diubah.

## Setup

- Stack: MySQL 8 (`cdps` migrate penuh) + mock HRIS 43 karyawan (:8081) +
  `cmd/cdps` (:8080, initial sync 43/43) + rolemapseed UAT (31 mapping, 3 layered)
  + mslseed (32 MSL) — boot order `import_samples/README.md` §UAT.
- Data alur dasar: `w2_walk.py` PASS 50/0, `w3_walk.py` PASS 38/0 (SKIP 4 justified).
- Branch berjalan berisi cherry-pick `781eab0` (json tag `RegisterInput` — tanpa
  ini jalur import/registrasi M0/M1 yang dipakai smoke ini gagal di main).
- FE: `web-internal` `npm run dev` (Next 16.2.10, rewrite `/api/v1` → :8080).

## Cakupan (aktor riil per fixture UAT)

| Blok | Alur | Verifikasi kunci |
|---|---|---|
| S1 | Marketing staff (owner INSAN) create campaign → performance record | lahir `Draft` (badge tanpa bracket); edge sah saja (`Ubah ke Active`); staff tanpa form Reassign; budget IDR verbatim `Rp. 10.000.000,00`; CPL `—` saat 0 lead (div-0 → `—`, house #7) |
| S2 | Import single ber-campaign saat campaign **Draft** | summary verbatim `[1 lead berhasil diimport, …]`; campaign **auto-Active** (O13 intake gate); Source auto-derive Channel `TikTok Ads` → `Leads - Iklan` (M3 §2, campaign menang atas source baris) |
| S3 | Sales staff claim Pool → Contacted → Qualified → No-Nego (Auto Approved) → Closing `[Bayar Penuh (Lunas)]` | CLI-/TRX- terbit; hasil closing persisten (fix `781eab0`) |
| S4 | Lead #2 ber-campaign → claim → Not Qualified `[Tidak ada respon]` | pintu junk M2 |
| S5 | Owner: rollup + auto-metrics + edit budget | Leads Generated 2 / Real 1 / Won 1 / Total Won IDR; Quality `50%`; CPL `Rp. 5.000.000,00` (10jt/2); CPRL `Rp. 10.000.000,00`; ROAS numerik verbatim (`0.60`); junk `[Tidak ada respon]`×1; edit budget 20jt → CPL recompute `Rp. 10.000.000,00` |
| S6 | Gating: staff non-owner / lead non-owner / OD layered | staff non-owner: list & dashboard TANPA campaign orang lain (filter server), detail langsung → `[anda tidak memiliki akses ke data ini]`; lead: transisi ADA (division-wide) tapi budget TIDAK (M2 §5 R3 "monitor, not edit"), Reassign ADA; OD: semua terbaca, read-only murni |
| S7 | Reassign (lead) | target fiktif → `[data tidak ditemukan]`; positif dua arah owner berganti (M3-OA-6) |
| S8 | Lead: Active→Closed | `end_date` di-stamp server (Tanggal Selesai terisi); edge tersisa hanya `Ubah ke Archived` |
| S9 | Gate intake pasca-Closed + dashboard | import ditolak per baris dengan verbatim `[campaign belum/tidak aktif, lead tidak bisa diimport]`; dashboard join client-side utuh (nama+status+budget+quality) |

## Gate DoD

- Smoke: PASS 43/0; `badResponses` kosong (401 `/me` anonim, 404 `GET …/performance`
  pre-record, dan 403/404 pada jendela probe negatif = by design, di-allowlist eksplisit).
- `npm run lint` 0 error, `npm run build` sukses 33 rute; `go vet`/`go build` bersih;
  full suite `go test -p 1 ./...` hijau 41 package 0 FAIL (dijalankan sesi ini untuk
  cherry-pick `781eab0`; FE/BE tidak berubah lagi setelahnya).

## Status blok FE M2/M3

Smoke test manual FE↔BE hidup ✅ → M2/M3 selesai penuh. Sisa FE keseluruhan:
utang `DIVISIONS` lowercase (form admin/role-mappings) + prop `tone` `StatusBadge`
(kecil), lalu M15 Client Portal (terakhir, tunggu spec security O5).
