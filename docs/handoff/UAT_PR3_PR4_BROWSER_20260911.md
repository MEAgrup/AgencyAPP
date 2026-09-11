# UAT peramban — PR-3 (Laporan Penjualan) & PR-4 (Adopsi Sistem), 2026-09-11

Menjalankan `HANDOFF_PR3_PR4_20260911.md` §6a/§6b, ditambah cakupan divisi
Adopsi dari ketokan pemilik hari ini (`PR4-SIAPA-BOLEH-LIHAT`).

| | |
|---|---|
| Commit | `e787450` (branch `claude/pr5-handoff-tasks-dt71hy`, PR #344) |
| DB | lokal, `db-rebuild.sh --yes` — 224 migrasi, gate 156 · 43 · 34 · 73 |
| Aktor | EMP-0001 Sales staff · EMP-0006 **Head Sales** · EMP-0007 Finance staff · EMP-0014 **Finance lead** · EMP-0011 **HR lead** · EMP-0012 **OD murni** · EMP-0008 Director |
| Server | `apps/api` :3001 + `web-internal` :3000 |
| Tangkapan layar | `screenshots/uat2-*.png` |

## 1 · Hasil

**43 butir · 43 PASS · 0 FAIL.** (PR-3: 21 · PR-4: 22)

Tidak ada FAIL, dan itu **bukan** karena assertion-nya longgar — dua kali
assertion saya sendiri yang salah lebih dulu dan memerah (cookie salah nama,
lalu locator seksi nav yang mengandung karakter panah). Keduanya diperbaiki
pada harness-nya, bukan dengan melonggarkan uji.

### 1a · Gerbang, diuji lewat API per aktor

| Rute | Sales staff | Head Sales | Finance staff | Finance lead | HR lead | OD | Director |
|---|---|---|---|---|---|---|---|
| `GET /sales/report` | 200 | 200 | **200** | **200** | **403** | 200 | 200 |
| `GET /sales/performance` | 200 | 200 | **403** | **403** | 403 | 200 | 200 |
| `GET /sales/report/export` | — | — | 200 | — | **403** | — | — |
| `GET /adopsi` | **403** | **200** | **403** | **200** | **200** | 200 | 200 |

Dua baris pertama adalah inti PR-3 dan **tidak boleh disatukan**: Finance
membaca LAPORAN tapi tetap 403 di Kinerja Sales, karena Finance sengaja tidak
punya lengan RLS ke `leads`/`prospect_attempts`. Kalau gerbangnya disatukan,
`/sales/performance` akan menjawab 200 dengan setiap kolom corong berisi 0 —
nol yang terlihat sah.

Baris `/adopsi` adalah ketokan hari ini: lead divisi (Sales, Finance, HR)
sekarang 200, staff tetap 403.

### 1b · PR-3 di layar (21 butir)

| Butir | Aktor | Hasil |
|---|---|---|
| Hanya tab *Laporan Penjualan* | Finance staff & lead | ✅ `[Laporan Penjualan]` — satu tab |
| Kelima tab muncul | Head Sales, Sales staff | ✅ `[Laporan Penjualan, Per Sales, Per Bulan, Sumber Lead, Target]` |
| **Rekap Layanan terisi** | Head Sales | ✅ 4 baris (`SVC-B2TOUR-1..3`, `-SEKALI`) — inilah yang migrasi `20261002010000` tutup |
| Rekap Layanan terisi | Finance staff & lead | ✅ 4 baris, angka IDENTIK dengan Head Sales |
| Baris `TOTAL` di kaki tabel | keempat aktor | ✅ |
| Kolom **Total Sales (Deal)** | kedua tab | ✅ `total_deal` ada di tab Laporan DAN Per Sales |
| Sales staff hanya barisnya sendiri | Sales staff | ✅ hanya `EMP-0001`, `EMP-0006` tidak muncul |
| Ekspor CSV = isi layar + `TOTAL` DI DALAM berkas | Finance staff | ✅ lihat §2 |
| Ekspor tetap bergerbang | HR lead | ✅ 403 |

### 🔴 1c · Bukti PR3-RNW-TRX di layar, bukan di tes

Fixture `seed-browser-tour.ts` punya `CLI-202609-0002` — **klien tanpa satu pun
baris Kontrak**, Rp 4.000.000. Itu persis bentuk yang selama ini hilang.

```
MODEL LAMA (pagar `exists (contracts)`)  : Rp 20.000.000
LAYAR SEKARANG                           : Rp 24.000.000
```

Rp 4.000.000 itu kembali, dan ia terlihat di keempat aktor pada tab Laporan
maupun tab Per Sales — dua layar yang menyebut angka yang sama untuk periode
yang sama, seperti yang dijaga tesnya.

### 1d · PR-4 di layar (22 butir) — cakupan divisi terbukti MENGGIGIT

| Aktor | Menu *Adopsi Sistem* | Halaman | Divisi yang terlihat |
|---|---|---|---|
| Director | ✅ muncul | ✅ terbuka | `Sales, Finance, HR` |
| OD murni | ✅ muncul | ✅ terbuka | `Sales, Finance, HR` |
| **Head Sales** | ✅ muncul | ✅ terbuka | **`Sales` saja** (2 baris) |
| **HR lead** | ✅ muncul | ✅ terbuka | **`HR` saja** (1 baris) |
| **Finance lead** | ✅ muncul | ✅ terbuka | **`Finance` saja** (2 baris) |
| Sales staff | ✅ TIDAK muncul | ✅ URL langsung → pesan tanpa akses | — |

Ini uji yang benar-benar bisa gagal: baris Finance dan HR **ada** di DB saat
Head Sales membukanya (ketiga aktor itu memakai sistem lebih dulu di sesi UAT
yang sama), dan Head Sales tetap hanya melihat dua baris Sales-nya.

Kalimat **"Pencatatan dimulai 2026-09-11"** muncul untuk kelima aktor yang
berhak — itu bagian fiturnya, bukan hiasan.

## 2 · Isi berkas CSV (verbatim)

```
Laporan Penjualan — per Sales
salesperson_id;nama;level_sales;total_deal;klien_baru;klien_perpanjangan;klien_cross_sell;klien_count;omzet;komisi_kontrak;komisi_diakui
EMP-0001;Budi Santoso;—;2;2.00;0.00;0.00;2.00;24000000.00;2400000.00;2000000.00
EMP-0006;Dewi Anggraini;—;0;0.00;0.00;0.00;0.00;0.00;0.00;0.00
TOTAL;2 sales;;2;;;;2;24000000.00;2400000.00;2000000.00

Rekap Layanan Terjual
master_service_id;nama_layanan;jumlah;nilai
SVC-B2TOUR-1;Svc SVC-B2TOUR-1;1;9000000.00
...
```

`content-disposition: attachment; filename="laporan-penjualan-2026-09-11.csv"`.

## 3 · Observasi (bukan FAIL, dan bukan milik PR ini)

**`level_sales` merender `—` untuk kedua sales.** `SALES_LEVEL_LABELS` memetakan
jabatan HRIS asli (`SALES JASA`, `HEAD OF SALES JASA`, …); seed Sprint-0 memakai
`Sales Executive`/`Sales Head` yang memang tidak ada di daftar itu. Jadi ini
artefak **data seed lokal**, bukan cacat kode — di live, jabatan yang tersinkron
dari HRIS memang yang ada di registry. Diperiksa: live punya 13 karyawan SALES
aktif dan **ke-13-nya ter-map**.

## 4 · 🔴 Dua butir konfigurasi — statusnya BERUBAH sesudah diperiksa ke live

Handoff sebelumnya menuliskan keduanya sebagai "Director tinggal membuat
pemetaan". Diperiksa ke `CDPS SG`, hanya satu yang begitu.

1. **`role_mappings` → `Finance`: SUDAH ADA, butir ini TUTUP.** Tiga pemetaan
   nyata (`FINANCE AND ACCOUNTING` → 1 `lead` + 2 `staff`), ketiganya menunjuk
   karyawan aktif. Laporan Penjualan sudah bisa dibuka Finance di produksi
   begitu kode ini rilis — tidak ada yang perlu dikerjakan.

2. **`role_mappings` → `HR`: TIDAK BISA diselesaikan dengan pemetaan.**
   Sebabnya bukan pemetaan yang lupa dibuat: **tidak ada divisi HR sama sekali
   di roster HRIS.** Divisi yang ada: `ACCOUNT` (19), `ADVERTISER` (8),
   `BUSINESS DEVELOPMENT` (1), `CREATIVE` (10), `FINANCE AND ACCOUNTING` (3),
   `MARKETING` (1), `SALES` (13), plus `Director` (3) dan `OD` (3) yang memang
   datang dari `employee_layered_roles`, bukan `role_mappings`. Nol karyawan
   ber-divisi atau ber-jabatan HR.

   Jadi mutasi & resign permanen (PR-1) **tetap Director-only**, dan itu bukan
   konfigurasi yang tertinggal melainkan **ketokan yang belum ada**: siapa yang
   memegang fungsi HR di CDPS? Tiga jalan yang mungkin — (a) HRIS menambah
   divisi HR lalu sync, (b) pemilik menunjuk satu jabatan yang sudah ada untuk
   dipetakan ke `HR`, (c) biarkan Director-only karena memang begitu praktiknya.
   **Ini pertanyaan untuk pemilik, bukan pekerjaan teknis.**

## 5 · Cara mengulang

```bash
pg_ctlcluster 16 main start
su postgres -c "psql -c \"alter user postgres with password 'postgres';\""
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
scripts/db-rebuild.sh --yes
npx tsx scripts/seed-browser-tour.ts > /tmp/tour-ids.json
# + EMP-0014 (Finance lead) dan EMP-0012 (OD murni) — lihat TUTORIAL §0.5
export SUPABASE_JWT_SECRET='local-dev-harness-secret-do-not-use-in-prod'
for e in EMP-0001 EMP-0006 EMP-0007 EMP-0014 EMP-0011 EMP-0012 EMP-0008; do
  node scripts/dev-jwt.mjs --employee "$e" > "/tmp/uat/$e.jwt"; done
(cd apps/api && npx next dev -p 3001) &      # WAJIB dari dalam apps/api — `next dev --dir` tidak ada
(cd web-internal && npx next dev -p 3000) &
```

⚠️ Nama cookie-nya **`cdps_access_token`**, bukan `cdps_session`. Menebaknya
salah membuat SETIAP butir memerah dengan gejala yang menyesatkan: halaman tetap
menjawab 200, hanya isinya kosong — persis seperti bug perizinan sungguhan.
