# FE — Runbook UAT frontend `web-internal` (Wave 2 workspace + dashboard Wave 3)

> Pola W2/W3 runbook, versi ringkas untuk frontend: setiap langkah mencantumkan
> **aktor** (fixture UAT), **rute yang diklik**, dan **hasil yang diverifikasi** di
> layar. Prasyarat stack = boot order `backend/testdata/import_samples/README.md`
> §"UAT login gate" (migrate → mockhris :8081 → cdps :8080 → rolemapseed → mslseed),
> lalu data alur di-seed via `python3 backend/uat/w2_walk.py` + `w3_walk.py`
> (keduanya harus PASS penuh dulu), lalu `cd web-internal && npm ci && npm run dev`
> (rewrite `/api/v1/*` → `127.0.0.1:8080` sudah di `next.config.ts`).
> Password semua akun UAT: `rahasia123`.
>
> Eksekusi otomatis langkah-langkah ini: skrip Playwright yang dipakai smoke test
> 2026-07-19 (lihat `FE_SMOKE_REPORT_20260719.md`). Kegagalan = catat di
> `docs/DECISIONS.md`, jangan merge PR frontend sebelum bersih.

## A. Login lintas peran (gate)

| # | Aktor | Verifikasi |
|---|---|---|
| A1 | `uat.director1@cdps.local` (Director O26) | Login → redirect `/`; header menampilkan nama + badge Director |
| A2 | `syifanuralya@gmail.com` (AM staff riil) | Login sukses |
| A3 | `Anthy.handayani@gmail.com` (Account lead riil) | Login sukses |
| A4 | `uat.creative1@cdps.local`, `uat.ads1@cdps.local`, `uat.kol1@cdps.local`, `uat.livestream1@cdps.local`, `uat.finance1@cdps.local`, `uat.marketing1@cdps.local` (fixture O33/O34) | Login sukses |
| A5 | `ORENDY9@GMAIL.COM` (OD layered riil; uji case email) | Login sukses walau email tersimpan uppercase |
| A6 | Password salah | Alert error BI, tetap di `/login` |

## B. Read-path per role (klik alur brief→task→metric→booking→board→health→performance)

Setiap rute: halaman render tanpa error overlay/crash, tanpa panggilan API 4xx/5xx
yang tidak diantisipasi (401 `GET /me` saat masih anonim di `/login` = by design).
Dari tiap halaman list, klik entri pertama ke halaman detail.

| # | Aktor | Rute → detail | Verifikasi kunci |
|---|---|---|---|
| B1 | Director | seluruh 23 rute nav (Delivery + Visibilitas + admin + finance + notifications + master-services) | semua render; detail terbuka dari list (`/account`→strategy, `/account/briefs`→BRF, `/creative`→BRF/AST, `/kol`→BRF, `/livestream`→BRF, `/clients`→CLI, `/performance`→staff) |
| B2 | AM staff | `/account`, `/account/briefs`, `/account/complaints`, `/health`, `/board`, `/board/my-tasks`, `/performance` | `/account/briefs`: **info alert** "tidak memiliki akses ke antrean divisi mana pun" (gate `ListDivisionQueue` — AM staff murni tanpa queue), TANPA tembakan 403 |
| B3 | Account lead | `/account` + detail strategy, `/account/briefs` (kanban Creative/Ads/KOL) + detail BRF, `/health`, `/board`, `/performance` + detail staff | kanban berisi kartu; badge status persis `[...]` |
| B4 | Creative lead | `/creative` + detail brief & asset, `/creative/daily-output`, `/tasks`, `/tasks/block-requests`, `/board/my-tasks`, `/performance` | daily output terisi dari audit log; block-requests: antrian divisi Creative |
| B5 | Ads lead | `/ads` (antrean brief Ads + Buka Kampanye by ID), `/tasks`, `/board`, `/performance` | ADC dibuka via input ID (M8 tanpa endpoint list agregat) |
| B6 | KOL staff | `/kol` + detail brief, `/board/my-tasks`, `/performance` + skor sendiri | queue KOL terlihat utk anggota divisi |
| B7 | LS staff | `/livestream` + detail brief LS | detail brief render; seksi Session = **info note** "hanya terlihat oleh AM pemilik, Account Lead/SPV, OD, dan Direktur" (M10 §6.1), TANPA menenggelamkan halaman |
| B8 | Finance | `/finance`, `/finance/reminders`, `/kol` | `/kol`: form **Buka Langsung** (BKG/CPR by ID) tetap tersedia; antrean brief = info note, TANPA 403 |
| B9 | Marketing lead | `/board`, `/performance`, `/health` | `/performance`: **info state** divisi di luar cakupan M14 (Creative/Ads/KOL/AM), TANPA tembakan 404 |
| B10 | OD layered | `/account`, `/tasks`, `/creative`, `/ads`, `/kol`, `/livestream`, `/board`, `/health`, `/performance` + semua detail | semua terbaca (CanReadAll); semua tombol aksi disembunyikan/disabled (read-only) |
| B11 | Director | `/tasks/block-requests` | tanpa divisi terpilih: prompt "Pilih divisi terlebih dahulu" (portal/team butuh divisi); setelah pilih divisi → antrian tampil |

## C. Write-path via UI (sampel per engine)

| # | Aktor | Aksi | Verifikasi |
|---|---|---|---|
| C1 | Director | `/health` → "Jalankan Pemindaian" (confirm) | alert sukses "Pemindaian bulan YYYYMM selesai: N klien, N band-drop ditandai." |
| C2 | Director | `/health/CLI-…` → toggle ROAS "Aktifkan/Nonaktifkan" lalu "Kembalikan ke Default" | Status flip Included↔Excluded lalu kembali default; OD/role non-Account: tombol disabled |
| C3 | Director | `/performance` → "Jalankan Pemindaian" | alert sukses "Pemindaian selesai: N snapshot…" |
| C4 | Ads staff PIC (KENNY) | `/ads/ADC-…` → isi Metric Entry (periode, Spend, GMV) → submit | "Metric entry berhasil dicatat."; rollup Metrik (Spend/GMV/ROAS 🔒 read-only) ter-refresh. Catatan: backend M8 §5 Flow 1 TANPA gate status — entry pada `[Ended]` sah |
| C5 | (negatif) siapa pun | submit form wajib yang dikosongkan (mis. Metric Entry tanpa Spend) | browser/server menolak; bila server: pesan BI persis `[...]` dirender verbatim di alert |

## D. Kriteria lulus

1. Nol `FAIL` di B & C; nol console error selain 401 `/me` anonim di `/login`.
2. Setiap pesan BI dirender **verbatim** dalam `[...]` — tidak diparafrasa FE.
3. Field computed (ROAS, skor, IDR `Rp. X.XXX.XXX,00`, `—` untuk div-0/null) hanya tampil, tidak pernah bisa diedit.
4. `npm run lint` 0 error 0 warning; `npm run build` hijau.
