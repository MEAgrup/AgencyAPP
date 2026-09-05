# HANDOFF — LANJUT SEMUA BUILD (peta pekerjaan sisa se-proyek)

> ### 🔴 BLOCKER LIVE BARU (2026-09-04, sesudah PR #287): **4 migrasi menunggu di-apply**
> `HANDOFF_REVISI_SALES_CREATIVE_PERFORMA_20260904.md` (SESI 4) mendaratkan 13 dari 14
> tiket rencana Nerissa — `[Unrespon]` lead aging, export CSV Leads, Creative massal,
> dan empat tiket performa — lewat **PR #287** (`main@24dcbba`). Gate lokal kini
> **145/40/31/69** (event katalog naik ke v14). **Merge-nya TIDAK menyentuh DB live**,
> jadi empat migrasi baru masih menunggu `apply_migration` ke `CDPS SG`. Itu pekerjaan
> pertama sesi berikutnya, menggantikan §0 #1 dokumen ini yang sudah selesai.
> Satu tiket sengaja ditahan: **P2 §5** (pangkas round-trip `withClaims`).
>
> ### ⚠️ BACA `HANDOFF_LANJUT_SEMUA_BUILD_SESI3_20260904.md` LEBIH DULU
> Sesi paralel menghabiskan **SELURUH §0 nomor 1–3** dokumen ini selagi PR-nya masih
> draft, lewat PR **#282** (`main@9a55613`) dan **#283/#284/#285** (`main@c28545b`).
> Rantai lanjutannya: SESI2 → **SESI3 (terbaru)**. Yang **sudah tidak berlaku** di sini:
> - **§0 #1 / §1.1** — migrasi `20260910010000_gelombang4_adsscanner` **SUDAH diterapkan
>   ke live `CDPS SG`**; gerbangnya kini 145/40/31/67. Jangan apply ulang.
> - **§0 #2 / §1.2** — **UAT export TikTok ASLI sudah dijalankan.** Ia menemukan dua bug
>   nyata yang sudah diperbaiki: **O70** (export Analitik Produk asli ternyata 5 seksi,
>   kolom dibaca dari seksi yang salah — `f339916`) dan **O71** (video tanpa caption
>   ikut dihitung, dinamai "(tanpa caption)" — `a4ba14a`). Ini persis yang §1.2
>   perkirakan akan ditemukan.
> - **§0 #3 / §1.3** — bug O67 `!/aktif/i.test(status)` **SUDAH diperbaiki** (batas kata),
>   commit `2230e08`.
> - **§3 B-03** — ternyata **sudah mendarat**; barisnya di `M6ABC_BACKLOG.md` yang basi,
>   bukan tiketnya yang terbuka. Ini contoh keempat dari pola yang §5 dokumen ini catat.
>
> Yang **baru** dan tidak ada di dokumen ini: **Sidebar IA v3** (9 grup, accordion, kotak
> cari, Papan Divisi) + grup nav "MEA AI Tools", dan temuan **O72** — invariant "nol
> `SECURITY DEFINER` untuk `anon`" ternyata tidak punya penjaganya.
>
> Sisanya — **§2** (enam keputusan pemilik), **§3** tiket lain, **§4** gate cutover,
> **§5** tiga backlog basi, **§7** aturan rumah & jebakan lingkungan — **tetap berlaku
> apa adanya** dan tidak diduplikasi di SESI2/SESI3.

> Dibuat 2026-09-04 di atas `main@35b7046`. **Ini bukan handoff satu fitur.** Handoff
> sebelumnya (`HANDOFF_ADVERTISER_TOOLS_SESI7_20260904.md`) menutup rantai Gelombang 1–4
> alat advertiser. Dokumen ini menjawab pertanyaan yang lebih besar: **apa saja yang belum
> selesai di SELURUH CDPS, dan apa urutan mengerjakannya.**
>
> Metode: menyisir 13 berkas `docs/backlog/`, bagian `Open` `docs/DECISIONS.md` (108 baris),
> `docs/prd/CDPS_Build_Plan.md`, dan **memverifikasi klaim tiap berkas terhadap kode yang
> benar-benar ada di `main`**. Verifikasi itu penting: **tiga berkas backlog ternyata basi**
> dan membaca mereka apa adanya akan membuat sesi berikutnya membangun ulang barang yang
> sudah jadi (persis jebakan yang `PROMPT_PAKET_A_WIRE_PARITY.md` §0 catat pernah terjadi
> di sesi #77). Koreksinya sudah didorong bersama handoff ini.

---

## 0. TL;DR — kerjakan berurutan

| # | Pekerjaan | Siapa | Blocking? |
|---|---|---|---|
| **1** | **Terapkan migrasi `20260910010000_gelombang4_adsscanner.sql` ke live `CDPS SG`** | Claude (`apply_migration`) | 🔴 **YA — `/ads/scanner` MATI di produksi hari ini** |
| **2** | UAT dua engine TikTok dengan export **asli** (Ads Scanner + Report Engine) | Yohan/tim Ads sedia berkas, Claude jalankan | 🟠 belum pernah kena data nyata |
| **3** | Perbaiki bug `!/aktif/i.test(status)` (O67) — "Nonaktif" terbaca AKTIF | Claude | 🟠 salah baca data klien |
| **4** | Jawab **6 keputusan** yang menahan kode (§2) | Yohan | 🟡 tiap jawaban membuka 1 tiket |
| **5** | Tiket kode yang tersisa (§3) | Claude | 🟡 |
| **6** | Gate GO cutover → C-05 pensiun Go (§4) | Yohan | 🟡 |

---

## 1. Yang WAJIB dikerjakan lebih dulu (operasional, bukan fitur baru)

### 1.1 🔴 Migrasi Gelombang 4 belum ada di produksi

Terverifikasi langsung ke `CDPS SG` (`egddxfcnrtecheiykhlf`) hari ini:

| Gerbang | Live | `main` | Selisih |
|---|---|---|---|
| Tabel `public` | **143** | **145** | `adsscanner_run`, `adsscanner_benchmark` |
| `entity_prefix` | **39** | **40** | `ASR-` |
| `sm_machines` | 31 | 31 | — |
| `notif_events` | 67 | 67 | — |

`select … where table_name='adsscanner_run'` ⇒ **0**. Artinya halaman `/ads/scanner` sudah
ter-deploy tetapi **setiap kueri-nya gagal** di produksi. Ini konsekuensi sadar dari urutan
kerja yang benar (migrasi hanya di-apply SESUDAH PR merge — lihat ralat di SESI7 §6);
PR-nya sudah merge, jadi gerbangnya sudah lewat.

**Cara mengerjakannya (O65 — jangan `supabase db push` ke live):**

```
mcp__Supabase__apply_migration
  project_id: egddxfcnrtecheiykhlf
  name: 20260910010000_gelombang4_adsscanner
  query: <isi persis supabase/migrations/20260910010000_gelombang4_adsscanner.sql>
```

Sesudahnya verifikasi ulang keempat gerbang di tabel atas ⇒ harus **145 / 40 / 31 / 67**,
lalu `get_advisors security` ⇒ tidak boleh ada temuan baru (tabel ini RLS-enabled dengan
**nol** policy tulis; SELECT-nya cermin `screening_run`).

### 1.2 🟠 UAT export asli — sisi TikTok belum pernah kena data nyata

Yang **sudah** kena data asli: Shopee Report Engine (`docs/handoff/UAT_SHOPEE_FIM_MOTOR_20260903.md`
— deteksi berkas naik 8/15 → 15/15, salah-slot 3 → 0 lewat SHP-3).

Yang **belum**: keduanya sisi TikTok — **TikTok Report Engine** dan **TikTok Ads Scanner**
(Gelombang 4). Pola SHP-3 memberi tahu apa yang akan ditemukan: nama berkas mentah dari
Seller Centre tidak sama dengan konvensi penamaan tim, dan deteksi berbasis isi baru jalan
kalau nama gagal. Berkas yang dibutuhkan untuk Ads Scanner: **Analitik Produk** (wajib —
tanpa ini domain menolak `MSG_ANALITIK_WAJIB`), plus opsional `adsvideo`, `adsproduk`,
`adslive`.

### 1.3 🟠 Bug O67 — `"Nonaktif"` terbaca sebagai AKTIF

`!/aktif/i.test(status)` adalah pencocokan substring **tanpa batas kata**, jadi
`"Nonaktif"` dan `"Dinonaktifkan"` keduanya mengandung `aktif` ⇒ dianggap AKTIF ⇒ SKU yang
seharusnya dikeluarkan ikut dihitung. Perbaikannya kecil (batas kata / daftar nilai
tertutup) tetapi **wajib disertai tes** dengan ketiga varian, dan wajib dicek apakah pola
yang sama disalin ke tempat lain.

---

## 2. Keputusan pemilik yang menahan kode (Yohan)

Tiap baris di bawah = **satu tiket yang tidak bisa dimulai** sebelum dijawab. Semuanya
sudah ada di bagian `Open` `docs/DECISIONS.md` — nomor barisnya dipertahankan supaya
jawabannya bisa langsung ditempel di sana.

| # | Pertanyaan | Kalau tidak dijawab |
|---|---|---|
| **SCR-UI-1** 🔴 | Apakah divisi **Ads** perlu bisa **me-LIST klien**? Sekarang `/ads/screening` dan `/ads/scanner` meminta ID klien sebagai **kolom teks**, karena gerbang bacanya berbasis kepemilikan Account, bukan Ads. | Beban mengetik ID tetap ada (Portofolio Ads Scanner sudah menguranginya untuk scan ke-2 dst, **bukan** untuk scan pertama) |
| **LT-2 + LT-8** ⬜ | **Daftar & urutan kerja divisi Store Operation**, dan **alasan pengembalian brief**-nya. Dijanjikan "menyusul" 2026-08-29. | Pipeline `STORE_OPS` sengaja tetap **kosong** (M16 Rule 12). Mengisinya = **satu migrasi seed, nol kode TS** |
| **LT-1 sisa** 🟡 | Konfirmasi angka target normalisasi **24 jam** untuk `kecepatan_review_am` (sekarang `is_placeholder=true` ⇒ komponennya **dikecualikan**, jadi bobot 10%-nya de-facto no-op), + bobot `role_type` **AI Optimizer** dan **Store Operation** (keduanya masih Σ=0) | Skor AM untuk dua divisi itu tidak pernah terbentuk |
| **KS-4 / KS-4b** 🔴 | Contoh OKR 2026-08-29 menyingkap **gap desain, bukan jawaban**: rasio *"closing ratio 35% dari qualified leads"* **belum dihitung** `salesperf.ts`. Dan `role_type` **`Sales`** belum terdaftar di M14 / skor `PERF-`. | Kinerja Sales punya dashboard tapi tidak punya skor |
| **X-12** 🟡 | "Rumah" komponen KPI untuk *point log buruk*. Pemilik: *"rumahnya akan dibuat menyusul"*. | **Batas tegas sampai rumahnya ada:** job B-09 boleh mencatat keterlambatan ke audit log, **tidak boleh** mengklaim ia memengaruhi Performance Score, dan **tidak boleh mengarang bobotnya** |
| **O65** 🔴 | Perlukah **ledger migrasi live direkonsiliasi** ke nama berkas repo? Isi skema live == repo, tapi daftar nama di `supabase_migrations` berbeda wholesale. | Tidak memblokir apa pun hari ini; menjadi jebakan saat ada yang menjalankan `db push` ke live (yang memang dilarang) |

**Plus tiga butir gate cutover yang bukan pertanyaan desain melainkan otoritas Anda** (§4):
konfirmasi data Railway riil-atau-UAT, angka **N hari** Railway tetap hidup pasca-cutover
(Yohan + Nerissa), dan memindahkan **backup MySQL** keluar dari GitHub Actions artifact
(retensi 30 hari — kalau lewat, backup-nya hilang).

---

## 3. Tiket kode yang masih terbuka

Diurut dari yang paling siap dikerjakan.

| Tiket | Modul | Isi | Prasyarat |
|---|---|---|---|
| **B-03** | M6B Plan | Gerbang transisi mesin #16 di atas edge yang **sudah** terdaftar (B-01): periode 1 butuh persetujuan SPV; periode 2…n auto-aktif 00:00 WIB lewat job B-09; `Menunggu Persetujuan` **hanya** untuk `Turun >10%`. Plus wrapper domain `transitionPlan`. | nol — siap |
| **X-08** | M6B | Daftar metrik **manual** ditulis eksplisit di UI, tidak dicampur diam-diam dengan yang auto. Contoh konkretnya: PE-3 mendaftar 6 metrik "auto", tapi **jam live vendor** datang dari M10 yang vendornya melapor di luar sistem ⇒ de-facto manual. | nol — siap |
| **CR-12** | Gelombang 1 | Mem-vendor Tailwind/Chart.js/FontAwesome **lokal** untuk dokumen laporan. CSP-nya sudah allow-list eksplisit, jadi ini pengerasan, bukan blocker. | nol — siap |
| **LT-12 / LT-14** | M16 | 3 CHECK constraint DB (`wrr_divisi`, `wrr_catatan_divisi`, `strategi_dispatch`) menghadang divisi/asset_type baru **di level DB** walau sudah terdaftar di registry. Dan `wrr_aggregate` punya riwayat `CREATE OR REPLACE` tiga kali — hanya migrasi terakhir yang hidup. | nol — siap, tapi sentuh DB ⇒ butuh migrasi |
| **O60** | invariant RLS | Detektor ledger O48 **buta** terhadap arm lead/divisi yang bersembunyi di balik `SECURITY DEFINER`: §42 `rls_checks.sql` mencari teks `jwt_is_lead\|jwt_division` di predikat, dan 10 policy `strategi_*` memakai `private.jwt_*`. | nol — siap |
| **O59-b** | invariant notifikasi | Gerbang notifikasi mengukur **JUMLAH**, bukan **NAMA** — O59 membuktikan itu tidak cukup. | nol — siap |
| **O48 sisa** | invariant RLS | 38 policy terdaftar eksplisit di ledger `rls_checks.sql` §42; daftar itu **hanya boleh menyusut**. | berjalan |
| **O47b sisa** | PII | 26 ref pembahasan PII di dokumen (rewrite histori **tidak** diperlukan — `main` terbukti tidak menjangkau commit `f8faf12`). | nol — siap |
| **W2-C2 / W2-C3** | M9 / M7 | `Attributed GMV` masih **diketik manual** Coordinator, padahal M9 §10.3 minta *"read-only, populated via trackable link, never estimated"*; plus monthly review-and-lock M7 §8 Rule 3. | 🔴 **pipeline affiliate-link tracking belum dibangun** — ini tiket besar tersendiri, bukan tambalan |
| **M15-G3…G7** | M15 Portal | Sisa gap-audit Client Portal. Sebagian besar sudah terlampaui Gelombang 1 (CR-09 mendaratkan **9 halaman** portal + auth realm terpisah + CSP) — **audit ulang dulu**, jangan asumsikan masih kosong. | audit ulang |
| **O7** | M13 Health | Mekanisme capture **CSAT**. Sampai ada, komponen `Satisfaction` tetap **N/A + bobot diredistribusi**. | keputusan Phase 2 |
| **O8** | M12 | Validasi Task-SLA vs Brief-SLA + retuning threshold Revision Count per divisi. | butuh **data live pasca Wave 2** |
| **C-05** | pensiun Go | Hapus job `backend` dari `.github/workflows/ci.yml` (masih menjalankan `go vet`/`go test`/migrasi MySQL atas kode beku) · arsipkan `backend/` **dengan tag** · tandai `railway.json`/`Dockerfile`/`DEPLOY_RAILWAY.md` deprecated · perbarui `CLAUDE.md` + entri `DECISIONS.md`. | 🔴 **gate GO** (§4) |

---

## 4. Gate cutover (C-04 → C-05) — hanya Anda yang bisa menutupnya

`PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md`: **Fase 0·1·2·3 = 100% dan semuanya di `main`.**
Yang tersisa hanya Fase 4 (gate manusia) dan Fase 5 (pencabutan mekanis C-05), dan Fase 5
kini terkunci **gate GO saja** — O47 sudah tidak ikut mengunci.

Sudah beres: MSL 32 layanan ber-versi di live · **69** karyawan riil (69/69/69/69 di
`employees`/`employee_credentials`/`auth.users`/`auth.identities`) · O42 dieksekusi,
`role_mappings` = 39 · UAT paritas C-03 dijalankan terhadap **deployment produksi** dengan
**PASS 69 · FAIL 0** · backup MySQL diambil & **diverifikasi 4 lapis** · OQ-2 membuktikan
**rantai FK jalur uang NOL** di MySQL lama.

Sisa yang menahan GO:

1. **Konfirmasi data Railway riil-atau-UAT** — belum dijawab.
2. **Angka N** hari Railway tetap hidup pasca-cutover, disepakati **Yohan + Nerissa**.
   Draf pertimbangan N = 14 hari ada di `RUNBOOK_BACKUP_MYSQL_RAILWAY.md` §7.
   Dokumen resminya: `docs/handoff/RENCANA_ROLLBACK_CUTOVER.md`.
3. **Backup MySQL keluar dari GitHub** — hari ini berkasnya masih hanya **artifact
   ber-retensi 30 hari**. Repo ini publik; artifact-nya bisa diunduh siapa saja, karena
   itu dump-nya **wajib terenkripsi**. Butir ini baru boleh dicentang sesudah tersimpan di
   luar GitHub dengan sha256 dicocokkan.
4. **O34 / O35** — roster diisi pemilik langsung ("abaikan, saya update di sistem"), tapi
   **model datanya tetap tidak ada**: mengisi roster tidak melahirkan dimensi **sub-tim**
   yang skema tidak punya. `role_mappings` tetap divisi×jabatan→(division, level).

---

## 5. ⚠️ Tiga berkas backlog BASI — jangan dibaca apa adanya

Ini temuan terpenting dokumen ini. Ketiganya **sudah dikoreksi** di commit yang sama dengan
handoff ini, tetapi dicatat di sini supaya alasannya tidak hilang.

| Berkas | Klaim yang basi | Kenyataan di `main` |
|---|---|---|
| `RISET_AWAL_BASELINE_BACKLOG.md` | *"Status: **nol kode**"* (2026-08-17) | **RAB-01…RAB-20 SELESAI.** `packages/core/src/baseline/` (16 berkas), `packages/domain/src/riset-awal.ts` + 3 berkas tes, migrasi `20260817000000_riset_awal_baseline_schema.sql`, rute `/interview/{id}/baseline[/confirm]`, `RisetAwalPanel.tsx`, dan **`docs/prd/CDPS_Module6_Interview.md` sudah dibuat** (RAB-18). Wave E ditutup commit `6cc26ca`. |
| `M6D_BACKLOG.md` | *"Status: **SPEC-ONLY. Belum ada migrasi/kode**"* (2026-08-12) | **Terbangun penuh.** 12 migrasi `*_m6d_wrr_*`, `packages/domain/src/recap.ts` + **8** berkas tes, rute `/api/v1/rekap/**` (6+), halaman `(shell)/account/rekap/[id]`. Bahkan sudah lewat gap-audit Wave 2 (temuan A1 `trg_wrr_reaggregate_on_close`). |
| `CUTOVER_BACKLOG.md` C-06 | *"Masih hanya `README.md` — belum ada kode/migrasi ditulis"* | `web-client-portal` punya **9 halaman** (login, lupa/reset password, beranda, laporan, laporan/[id], progres, komplain, akun/password), auth realm terpisah, CSP, 19 tes, `npm run build` sukses — mendarat lewat **CR-09** Gelombang 1. |

Pelajarannya sama seperti yang `PROMPT_PAKET_A_WIRE_PARITY.md` §0 no. 4 catat: **status di
berkas backlog bisa lebih tua dari kode.** Sebelum memulai tiket dari berkas backlog mana
pun, cek dulu apakah artefaknya sudah ada (`ls packages/domain/src/<modul>.ts`,
`ls supabase/migrations | grep <modul>`, `find apps/api/src/app/api -ipath '*<modul>*'`).

---

## 6. Yang SUDAH selesai (jangan dibangun ulang)

- **Sprint 0** · **Wave 1** (M0/M1/M4/M5) · **Wave 2** (M6A/B/C/D, M7–M10, M12) ·
  **Wave 3** non-portal (M2/M3/M11/M13/M14/M15 Team Portal) — gap-audit Wave 2 **dan** Wave 3
  ditutup, kelas A + B + C habis kecuali W2-C2/C3 dan M15-G3…G7 (§3).
- **M16 Lead Time + M17 AI Optimizer** — Fase 0–5 selesai, termasuk portal vendor Live.
- **Kinerja Sales** (S-01…S-05 + R-01…R-04) — sudah **di live** sejak 2026-08-30.
- **Riset Awal Baseline** (RAB-01…RAB-20) — lihat §5.
- **Gelombang 1–4 alat advertiser** — insight editable + Client Portal · Shopee Report
  Engine (paritas penuh, SHP-1/2/3) · SKU Screener (Modul A–D) · TikTok Ads Scanner
  (AS-01…AS-05). **Nol tiket kode tersisa**; sisanya operasional (§1).
- **Cutover Go → TS/Supabase**: port kode 100%, UAT paritas produksi PASS 69/FAIL 0.

---

## 7. Aturan rumah yang paling sering dilanggar (baca sebelum tiket pertama)

Semuanya ada di `CLAUDE.md`; ini yang benar-benar menggigit di sesi-sesi terakhir:

1. **⛔ Jangan bangun apa pun di `backend/`.** Go + MySQL pensiun. `backend/` hidup HANYA
   sebagai oracle paritas sampai C-05 mencabutnya.
2. **Migrasi hanya lewat `supabase/migrations/**`.** Ke live pakai `apply_migration`
   **per berkas** (O65), **bukan** `supabase db push`. Lokal dibangun ulang **hanya** lewat
   `scripts/db-rebuild.sh`. Jangan pernah `psql -f` (itu yang melahirkan drift O38).
3. **Gerbang hitungan ada di DUA tempat** — `.github/workflows/ci.yml` **dan**
   `scripts/db-rebuild.sh`. Menaikkan satu saja = CI merah.
4. **Prefix baru wajib masuk `packages/core/src/ident.ts` di commit yang SAMA** dengan
   migrasinya (near-miss PR #170).
5. **`KNOWN_GAPS` di `apps/api/src/lib/route-parity.test.ts` harus tetap KOSONG.** Menambah
   satu baris = mengakui satu halaman tidak berfungsi ⇒ butuh entri `DECISIONS.md`.
6. **Batas camelCase↔snake_case:** domain camelCase, wire snake_case, penerjemahnya **hanya**
   `apps/api/src/lib/wire.ts`. Route yang mengirim objek domain mentah = bug kelas O43 —
   halamannya blank walau route-nya 200. **Kunci yang HILANG lebih berbahaya daripada null**:
   kirim `null` eksplisit, jangan `omitempty`.
7. **`shape-parity` dan `route-parity` bisa hijau secara hampa.** Kalau menambah tipe wire
   baru, buktikan guard-nya menggigit: tambahkan field bogus, lihat merah, lalu kembalikan.

### Jebakan lingkungan yang akan Anda temui

- **Suite `@cdps/domain` hanya hijau di DB yang baru `db-rebuild.sh`, SEKALI.**
  `admin.test.ts` ("hari libur") dan `client.test.ts` ("Hold Service two-step") menghitung
  baris `audit_log`-nya sendiri dengan `toBe(1)`, sedangkan `audit_log` **immutable** ⇒
  cleanup-nya tidak bisa menghapus apa pun ⇒ run kedua gagal `expected 7 to be 1`.
  **Ini pre-existing, bukan diff Anda.** Rebuild dulu sebelum menuduh perubahan sendiri.
- **Jangan pernah menulis `delete from audit_log` di `afterEach`.** Tabelnya append-only;
  seluruh berkas tes akan gagal dengan pesan yang menyembunyikan kegagalan sebenarnya.
- **`normId` memotong ID ke 15 digit pertama.** Fixture yang hanya berbeda di digit ke-16
  akan **bertabrakan** di kunci JOIN dan satu baris menimpa yang lain.
- **OD/Director adalah FLAG, bukan `level`** — `permission.makeRole({ od: true })` /
  `{ director: true }`; `Actor` juga membawa `divisi`.
- **`web-internal` bukan Next.js yang Anda hafal** (`web-internal/AGENTS.md`) — baca panduan
  di `node_modules/next/dist/docs/` sebelum menulis kode.
- **`fmtPct` punya DUA arti** di dua berkas UI: `adsscanner-ui.ts` **mengalikan 100**
  (payload-nya fraksi), `skuscreener-ui.ts` **tidak** (payload-nya percent-number).
  Pemakuan dua arahnya ada di `adsscanner-ui.test.ts` — jangan "rapikan" jadi satu.

---

## 8. Peta dokumen

| Butuh tahu | Baca |
|---|---|
| Rantai alat advertiser (G1–G4) | `HANDOFF_ADVERTISER_TOOLS_SESI7_20260904.md` (terbaru), lalu SESI6/SESI5 |
| Status tiket Gelombang 1–4 | `docs/backlog/CLIENT_REPORT_PORTAL_BACKLOG.md` |
| Cutover & pensiun Go | `docs/backlog/CUTOVER_BACKLOG.md` + `PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md` |
| M16/M17 Lead Time | `docs/backlog/LEADTIME_BACKLOG.md` + `docs/handoff/RENCANA_INDUK_M16_M17.md` |
| Kinerja Sales | `docs/backlog/SALESPERF_BACKLOG.md` + `docs/handoff/RENCANA_KINERJA_SALES.md` |
| M6A/B/C | `docs/backlog/M6ABC_BACKLOG.md` + rantai `HANDOFF_M6ABC_SESI*.md` |
| Riset Awal | `docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md` + `docs/prd/CDPS_Module6_Interview.md` |
| Gap audit Wave 2/3 | `docs/backlog/WAVE2_GAP_AUDIT.md`, `WAVE3_GAP_AUDIT.md` |
| Keamanan Client Portal | `docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md` |
| Rollback | `docs/handoff/RENCANA_ROLLBACK_CUTOVER.md` + `RUNBOOK_BACKUP_MYSQL_RAILWAY.md` |
| Semua keputusan & pertanyaan terbuka | `docs/DECISIONS.md` (`Decided` lalu `Open`) |

---

## 9. Prompt siap tempel untuk chat berikutnya

> Baca `docs/handoff/HANDOFF_LANJUT_SEMUA_BUILD_20260904.md`. Kerjakan §0 nomor 1:
> terapkan migrasi `20260910010000_gelombang4_adsscanner.sql` ke live `CDPS SG` lewat
> `apply_migration` (bukan `db push`), lalu verifikasi gerbang 145/40/31/67 dan
> `get_advisors security`. Sesudah itu lanjut ke §1.3 (bug O67 `!/aktif/i.test`) dan §3
> tiket **B-03**. Jangan mulai tiket yang §2 tandai menunggu jawaban saya.
