# FE — Laporan smoke test manual FE↔BE hidup (2026-07-19)

> Eksekusi butir "Smoke test manual FE↔BE hidup" dari
> `HANDOFF_SESSION_20260719_FRONTEND_W2W3.md` §Langkah berikutnya #1, terhadap
> PR #14 (frontend Wave 2 workspace + dashboard Wave 3). Runbook yang dibakukan
> dari eksekusi ini: `FE_UAT_RUNBOOK.md`.

## Setup

- Stack: MariaDB (`cdps` migrate 0001–0036) + mock HRIS 43 karyawan (:8081) +
  `cmd/cdps` (:8080, initial sync 43/43) + rolemapseed UAT (31 mapping, 3 layered)
  + mslseed (32 MSL) — persis boot order `import_samples/README.md` §UAT.
- Data alur: `backend/uat/w2_walk.py` **PASS 50/50** + `w3_walk.py` **PASS 38/38,
  SKIP 4 (justified)** → klien/strategy/brief/asset/ADC/booking/sesi/health/
  performance hidup di DB.
- FE: `web-internal` `npm ci && npm run dev` (Next 16.2.10, rewrite `/api/v1` →
  :8080). Browser: Playwright Chromium headless.

## Fase 1 — read-path 10 role × 29 rute + click-through detail

10 role (Director O26, AM staff, Account lead, Creative lead O34, Ads lead O34,
KOL staff O34, LS staff O34, Finance O33, Marketing lead, OD layered riil) login
via UI dan menyusuri alur brief→task→metric→booking→board→health→performance.
Instrumen: console error, pageerror, semua respons `/api/v1` ≥400, deteksi error
overlay/404/body kosong.

**Hasil akhir: BERSIH** — sisa temuan hanya `GET /me` 401 saat halaman `/login`
anonim (by design: cek sesi sebelum login, satu per role).

## Temuan awal → fix (commit `fix(web): smoke test FE-BE hidup — cermin gate server…`)

Kelima temuan sekelas: **FE menembak endpoint yang gate server-nya pasti menolak**,
lalu menampilkan pesan 403/404 mentah sebagai error state — bukan bug backend
(semua gate terverifikasi benar terhadap kode module6/10/14/15).

| # | Halaman | Gejala | Akar (gate server) | Fix FE |
|---|---|---|---|---|
| 1 | `/tasks/block-requests` | Director langsung alert `[anda tidak memiliki akses ke data ini]` | `portal.go TeamPortalFor`: division kosong = 403 (Director fixture tanpa divisi bawaan) | tunda fetch sampai divisi dipilih + prompt info |
| 2 | `/account/briefs` | AM staff selalu 403 `divisions/Creative/brief-queue` | `ListDivisionQueue`: CanReadAll / Account lead / anggota divisi saja (interview 2026-07-12) | cermin gate; tombol divisi hanya yang boleh; info alert bila tak ada |
| 3 | `/livestream/briefs/[id]` | LS staff: seluruh halaman jadi error 403 padahal brief boleh dibaca | `canSeeSession` (M10 §6.1): OD/Director/Account lead/AM pemilik — staf divisi eksekusi TIDAK | fetch brief & sessions dipisah; gate `canSeeSessions`; info note |
| 4 | `/kol` | Finance 403 brief-queue padahal cuma butuh Buka Langsung CPR | idem #2 utk divisi KOL | gate `canSeeQueue` + info note; form Buka Langsung tetap |
| 5 | `/performance` | Marketing lead 404 `[data tidak ditemukan]`; LS staff dilink ke skor yang pasti 404 | M14 hanya 4 role type (Creative/Ads/KOL/AM) — divisi lain tanpa konfigurasi KPI | info state "di luar cakupan M14" utk lead & staff divisi non-M14 |

Verifikasi pasca-fix: rerun fase 1 penuh (bersih) + 7 asersi konten per halaman
(semua PASS).

## Fase 2 — write-path via UI: **PASS 7/7**

| Aksi | Bukti |
|---|---|
| M13 scan (Director, `/health`) | "Pemindaian bulan 202606 selesai: 0 klien, 0 band-drop ditandai." |
| M13 toggle ROAS (`/health/CLI-202607-0001`) | Status flip Excluded→Included→default |
| M14 scan (Director, `/performance`) | "Pemindaian selesai: 0 snapshot…" (idempoten, periode sudah di-scan walk) |
| M8 metric entry (PIC Ads KENNY, `/ads/ADC-202607-0001`) | "Metric entry berhasil dicatat." + rollup Metrik/ROAS ter-refresh |

**Catatan (bukan bug, perilaku backend saat ini):** `LogMetricEntry` M8 tidak
punya gate status kampanye — entry pada `[Ended]` diterima (§5 Flow 1; total &
ROAS derived on read). Kalau produk mau melarang entry pasca-`[Ended]`, itu
keputusan PRD/backend, bukan FE.

## Pola UI yang dikonfirmasi disengaja (bukan temuan)

- `/tasks` default "Task Saya" → kosong untuk Director (tanpa task pribadi).
- `/ads` & `/kol`: Booking/CPR/ADC dibuka via input ID (M8/M9 tanpa endpoint list agregat).
- `/health`: navigasi ke detail via `/clients` (tanpa list klien di landing).

## Gate DoD

`npm run lint` 0 error 0 warning; `npm run build` hijau (29 rute); suite backend
tidak disentuh (perubahan FE-only, 5 file halaman).

## Status blok frontend W2+W3 setelah sesi ini

Smoke test manual FE↔BE hidup ✅ → sisa: **review manusia + merge PR #14**, lalu
utang kecil `DIVISIONS` lowercase legacy Wave 1 di form admin role-mappings
(file bersama, tetap di luar scope PR ini).
