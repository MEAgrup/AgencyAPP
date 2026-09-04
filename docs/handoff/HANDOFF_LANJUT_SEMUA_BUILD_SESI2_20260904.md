# HANDOFF — LANJUT SEMUA BUILD, SESI 2 (peta pekerjaan sisa se-proyek)

> Dibuat 2026-09-04 di atas `main` sesudah PR yang menyertakan handoff ini di-merge.
> **Melanjutkan** `HANDOFF_LANJUT_SEMUA_BUILD_20260904.md` (ditulis sesi sebelumnya di
> branch `claude/baca-handoff-lanjutkan-task-pftmbi`, PR #281 — **masih draft, belum
> merge** saat dokumen ini ditulis). Dokumen itu memetakan SELURUH pekerjaan sisa CDPS
> dengan sangat detail (§2 enam keputusan pemilik, §3 tiket kode tersisa, §4 gate
> cutover, §5 tiga backlog basi yang dikoreksi bersamanya) — **belum digantikan**, cuma
> dilanjutkan. Dokumen ini hanya mencatat apa yang berubah sesi ini: tiga item §0
> ditutup (migrasi live, bug O67, dan penemuan bahwa B-03 sudah mendarat), sisanya
> (§2 keputusan pemilik, §3 tiket, §4 gate cutover) **carry-over apa adanya** dari
> dokumen sesi sebelumnya kecuali disebut lain di sini.

## 0. TL;DR — kerjakan berurutan

| # | Pekerjaan | Status | Siapa | Blocking? |
|---|---|---|---|---|
| 1 | Terapkan migrasi `20260910010000_gelombang4_adsscanner.sql` ke live `CDPS SG` | ✅ **SELESAI sesi ini** | — | — |
| 2 | UAT dua engine TikTok dengan export **asli** (Ads Scanner + Report Engine) | ⬜ belum | Yohan/tim Ads sedia berkas, Claude jalankan | 🟠 belum pernah kena data nyata |
| 3 | Bug `!/aktif/i.test(status)` (O67) — "Nonaktif" terbaca AKTIF | ✅ **SELESAI sesi ini** | — | — |
| 4 | Jawab **6 keputusan** yang menahan kode (§2) | ⬜ belum | Yohan | 🟡 tiap jawaban membuka 1 tiket |
| 5 | Tiket kode yang tersisa (§3) — **B-03 dicoret, sudah mendarat** | ⬜ sebagian | Claude | 🟡 |
| 6 | Gate GO cutover → C-05 pensiun Go (§4 handoff sesi sebelumnya) | ⬜ belum | Yohan | 🟡 |
| — | **PR #281 (branch `…-pftmbi`) masih draft, belum di-merge** — lihat §5 di bawah | ⬜ perlu keputusan | Nerissa/Yohan | 🟡 tidak blocking kode, tapi dua dokumen sumber kebenaran berisiko tidak sinkron |

---

## 1. Yang SUDAH dikerjakan sesi ini (jangan diulang)

### 1.1 ✅ Migrasi Gelombang 4 diterapkan ke live

Diterapkan via `mcp__Supabase__apply_migration` (project `egddxfcnrtecheiykhlf`, **bukan** `db push`
— O65). Gerbang **sebelum → sesudah**: tabel **144 → 146**, `entity_prefix` **39 → 40** (+`ASR`),
`sm_machines` tetap **31**, `notif_events` tetap **67** (sesuai catatan migrasi: nol event katalog
baru). `get_advisors security` sesudahnya: **hanya satu temuan baru**, `adsscanner_benchmark`
RLS-enabled-no-policy — pola SENGAJA yang sama dengan `report_benchmark`/`report_benchmark_shopee`
(dibaca hanya lewat service-role), bukan regresi. **`/ads/scanner` di produksi sudah hidup.**

Catatan angka: handoff sesi sebelumnya menyebut baseline 143 tabel/39 prefix; pengukuran langsung
sesi ini menemukan 144/39 sebelum migrasi (kemungkinan drift kecil sejak handoff ditulis atau
snapshot berbeda) — yang penting delta-nya (+2 tabel, +1 prefix) persis cocok dengan isi migrasi,
jadi hasilnya tetap tervalidasi.

### 1.2 ✅ Bug O67 diperbaiki — `"Nonaktif"` tidak lagi terbaca AKTIF

`packages/core/src/adsscanner/tiktok/skor.ts` — `!/aktif/i.test(status)` (substring polos tanpa
batas kata) diganti `!/\baktif\b/i.test(status)` (batas kata, **bukan** daftar nilai tertutup,
karena vocabulary status asli TikTok Seller Center masih belum diverifikasi data nyata — UAT §1.2
belum jalan). Diperiksa: pola ini hanya ada di SATU tempat (`skor.ts`), tidak disalin ke
`skuscreener`/`report/shopee`. Test baru: `Nonaktif` dan `Dinonaktifkan` kini `DIBLOKIR` dengan
pesan blocker yang benar; test "FLAGGED" lama (mendokumentasikan bug sebagai perilaku yang
diharapkan) dihapus. `@cdps/core`: **532/532** lolos (dari 530). Typecheck bersih.

### 1.3 ✅ Tiket B-03 (M6B Plan) — ternyata SUDAH MENDARAT, backlog-nya yang basi

Handoff sesi sebelumnya (§3 di sana) mengutip B-03 sebagai tiket "nol prasyarat, siap
dikerjakan" langsung dari `docs/backlog/M6ABC_BACKLOG.md` **tanpa verifikasi ke kode** — persis
jebakan yang handoff itu sendiri peringatkan di §5-nya untuk tiga berkas lain, tapi luput
menyisir berkas ini juga. Cek kode membuktikan sudah lengkap:

- `transitionPlan` (pembungkus tunggal `sm_transition`) + seluruh gerbang SIAPA/KAPAN sudah ada
  di `packages/domain/src/plan.ts`: `submitPlanPeriode`/`approvePlanPeriode`/`returnPlanPeriode`/
  `activatePlanPeriode`, dipakai job B-09 (`sweepPeriodeTransitions`).
- Dites tuntas di `plan.test.ts` — 6 skenario yang persis dideskripsikan tiket ini (aktivasi AM
  langsung, approval SPV, auto-aktivasi tanpa lead, `Menunggu Persetujuan` untuk `Turun >10%`,
  tidak menahan periode 1, kedaluwarsa).
- `docs/STATE_MACHINES.md` §6d **sudah** mencatat ini eksplisit: *"GERBANG = domain (B-03,
  MENDARAT)"* — dua dokumen bersaudara (`STATE_MACHINES.md` vs `M6ABC_BACKLOG.md`) tidak sinkron,
  dan yang basi adalah backlog.
- Deskripsi tiket sendiri juga usang secara substansi: "periode 1 butuh persetujuan SPV" sudah
  digantikan deviasi pemilik 2026-08-28 (AM aktivasi langsung).

**Nol kode ditulis untuk ini** — `M6ABC_BACKLOG.md` baris B-03 dicoret + `DECISIONS.md` dicatat.
Seluruh M6B Plan (B-00..B-11) sekarang **tuntas 100%** — B-11 sendiri sudah menandai "MENUTUP M6B".

---

## 2. Enam keputusan pemilik yang masih menahan kode (BELUM DIJAWAB — carry-over)

Sama seperti handoff sesi sebelumnya, isi belum berubah karena Yohan belum menjawab. Detail penuh
tiap baris ada di `docs/DECISIONS.md` bagian `Open` (nomor baris dipertahankan supaya jawaban bisa
ditempel langsung di sana):

| # | Pertanyaan | Kalau tidak dijawab |
|---|---|---|
| **SCR-UI-1** 🔴 | Apakah divisi **Ads** perlu bisa **me-LIST klien**? `/ads/screening` & `/ads/scanner` masih minta ID klien sebagai kolom teks. | Beban mengetik ID tetap ada untuk scan pertama tiap klien |
| **LT-2 + LT-8** ⬜ | Daftar & urutan kerja divisi **Store Operation**, dan alasan pengembalian brief-nya. Dijanjikan "menyusul" 2026-08-29. | Pipeline `STORE_OPS` sengaja tetap kosong (M16 Rule 12) |
| **LT-1 sisa** 🟡 | Konfirmasi target normalisasi **24 jam** `kecepatan_review_am` + bobot `role_type` AI Optimizer & Store Operation (Σ=0). | Skor AM dua divisi itu tidak pernah terbentuk |
| **KS-4 / KS-4b** 🔴 | Rasio "closing ratio 35% dari qualified leads" belum dihitung `salesperf.ts`; `role_type` **Sales** belum terdaftar di M14/skor `PERF-`. | Kinerja Sales punya dashboard tapi tidak punya skor |
| **X-12** 🟡 | "Rumah" komponen KPI *point log buruk* — pemilik: "menyusul". | Job B-09 boleh catat ke audit log, TIDAK boleh klaim memengaruhi Performance Score |
| **O65** 🔴 | Perlukah ledger migrasi live direkonsiliasi ke nama berkas repo? | Tidak blocking hari ini; jebakan kalau ada yang `db push` ke live (dilarang) |

Plus tiga butir gate cutover (§4 handoff sesi sebelumnya, belum berubah): konfirmasi data Railway
riil-atau-UAT, angka **N hari** Railway tetap hidup pasca-cutover (Yohan + Nerissa), dan
memindahkan backup MySQL keluar dari GitHub Actions artifact (retensi 30 hari).

---

## 3. Tiket kode yang masih terbuka (carry-over, B-03 dicoret dari daftar sesi sebelumnya)

Diurut dari yang paling siap dikerjakan — **belum ada yang dikerjakan sesi ini selain B-03**
(yang ternyata sudah selesai, lihat §1.3).

| Tiket | Modul | Isi | Prasyarat |
|---|---|---|---|
| **X-08** | M6B | Daftar metrik **manual** ditulis eksplisit di UI, tidak dicampur diam-diam dengan yang auto (contoh: jam live vendor dari M10 de-facto manual). | nol — siap |
| **CR-12** | Gelombang 1 | Vendor Tailwind/Chart.js/FontAwesome **lokal** untuk dokumen laporan (pengerasan CSP, bukan blocker). | nol — siap |
| **LT-12 / LT-14** | M16 | 3 CHECK constraint DB (`wrr_divisi`, `wrr_catatan_divisi`, `strategi_dispatch`) menghadang divisi/asset_type baru di level DB. `wrr_aggregate` punya 3x `CREATE OR REPLACE` — hanya migrasi terakhir hidup. | nol — siap, tapi sentuh DB ⇒ migrasi |
| **O60** | invariant RLS | Detektor ledger O48 buta terhadap arm lead/divisi di balik `SECURITY DEFINER` (10 policy `strategi_*` pakai `private.jwt_*`). | nol — siap |
| **O59-b** | invariant notifikasi | Gerbang notifikasi ukur JUMLAH, bukan NAMA. | nol — siap |
| **O48 sisa** | invariant RLS | 38 policy terdaftar eksplisit `rls_checks.sql` §42 — daftar hanya boleh menyusut. | berjalan |
| **O47b sisa** | PII | 26 ref pembahasan PII di dokumen (rewrite histori TIDAK perlu). | nol — siap |
| **W2-C2 / W2-C3** | M9/M7 | `Attributed GMV` masih diketik manual Coordinator, M9 §10.3 minta read-only via trackable link. | 🔴 pipeline affiliate-link tracking — tiket besar tersendiri |
| **M15-G3…G7** | M15 Portal | Sisa gap-audit Client Portal — audit ulang dulu, jangan asumsikan kosong (CR-09 sudah mendaratkan 9 halaman). | audit ulang |
| **O7** | M13 Health | Mekanisme capture CSAT. | keputusan Phase 2 |
| **O8** | M12 | Validasi Task-SLA vs Brief-SLA + retuning threshold Revision Count. | butuh data live pasca Wave 2 |
| **C-05** | pensiun Go | Hapus job `backend` dari CI, arsipkan `backend/` bertag, tandai deploy Railway deprecated. | 🔴 gate GO (§4) |

⚠️ **Sebelum memulai tiket manapun dari tabel ini, ulangi cek yang menemukan B-03 basi**: `ls`
artefaknya dulu (`packages/domain/src/<modul>.ts`, `supabase/migrations | grep <modul>`,
`grep -rn` fungsi yang disebut tiket) sebelum percaya status "siap"/"belum" apa adanya.

---

## 4. Aturan rumah yang paling sering dilanggar (tidak berubah dari sesi sebelumnya)

Lihat `CLAUDE.md` untuk lengkapnya. Yang paling menggigit:

1. ⛔ Jangan bangun apa pun di `backend/` — oracle paritas saja sampai C-05.
2. Migrasi live HANYA lewat `apply_migration` **per berkas** (O65), bukan `db push`. Lokal HANYA
   lewat `scripts/db-rebuild.sh`. Jangan pernah `psql -f`.
3. Gerbang hitungan ada DUA tempat — `.github/workflows/ci.yml` **dan** `scripts/db-rebuild.sh`.
4. Prefix baru wajib masuk `packages/core/src/ident.ts` di commit yang SAMA dengan migrasinya.
5. `KNOWN_GAPS` di `apps/api/src/lib/route-parity.test.ts` harus tetap KOSONG.
6. Batas camelCase↔snake_case hanya lewat `apps/api/src/lib/wire.ts`. Kunci yang HILANG lebih
   berbahaya daripada `null` — kirim `null` eksplisit, jangan `omitempty`.
7. **Status di berkas backlog bisa lebih tua dari kode** (lihat §1.3 di atas) — selalu cek
   artefak kode dulu sebelum percaya tabel status di `docs/backlog/*.md`.

---

## 5. ⚠️ PR #281 (branch `claude/baca-handoff-lanjutkan-task-pftmbi`) — masih draft

Sesi sebelumnya yang menulis handoff pertama masih membuka **PR #281** ("docs: peta pekerjaan
sisa se-proyek + koreksi 3 status backlog yang basi"), berisi `HANDOFF_LANJUT_SEMUA_BUILD_20260904.md`
(dokumen sumber sesi ini) plus koreksi 3 berkas backlog basi lain (`RISET_AWAL_BASELINE_BACKLOG.md`,
`M6D_BACKLOG.md`, `CUTOVER_BACKLOG.md` C-06) yang **BELUM ada di `main`**. PR itu **belum di-merge**
saat dokumen ini ditulis dan **terpisah** dari PR sesi ini.

**Perlu keputusan Nerissa/Yohan:** merge PR #281 juga (supaya 3 koreksi backlog basi itu masuk
`main`), atau tutup sebagai superseded kalau isinya dianggap cukup terwakili oleh dokumen ini.
Dokumen ini **tidak** menduplikasi ketiga koreksi tersebut — cek PR #281 langsung kalau perlu.

---

## 6. Prompt siap tempel untuk chat berikutnya

> Baca `docs/handoff/HANDOFF_LANJUT_SEMUA_BUILD_SESI2_20260904.md`. Cek dulu status PR #281
> (§5) — kalau belum diputuskan, tanyakan ke Nerissa. Lalu pilih SATU tiket "nol — siap" dari §3
> (X-08, CR-12, O60, O59-b, atau O47b sisa — semuanya belum ada yang dikerjakan), **verifikasi
> dulu ke kode** (pola §1.3) sebelum mulai menulis apa pun, baca PRD terkait penuh, lalu kerjakan
> dengan tes. Jangan mulai tiket yang §2 tandai menunggu jawaban pemilik.
