# CDPS — W1-19: Pemetaan Sumber Riil → Kontrak Import (hasil pembacaan spreadsheet, 2026-07-10)

> Lanjutan `WAVE1_EXTERNAL_REQUESTS.md` §"Jawaban diterima (2026-07-10)". Konektor Google Drive
> sudah aktif; 5 dari 6 spreadsheet berhasil dibaca langsung. Dokumen ini memetakan **isi riil**
> tiap sumber terhadap kontrak import W1-19 (Permintaan #3) dan mencatat gap yang butuh keputusan
> (O22, O23) — sesuai disiplin O6: parser dibangun mengikuti bentuk kolom riil, bukan tebakan.

## 1. Inventaris sumber (apa yang sebenarnya ada di tiap sheet)

| Sheet (link di WAVE1_EXTERNAL_REQUESTS) | Isi riil | Peran untuk W1-19 |
|---|---|---|
| **Data karyawan HRIS** (`1rLCb…`) | 186 baris karyawan: `No, NIK, JOIN DATE, NAMA LENGKAP, DEPARTMENT, JABATAN`. Tanpa email/status. | ✅ Selesai dialiri: `cmd/hrisconvert` + `HRIS_ROLE_MAPPING_DRAFT.md`. Email = O21. |
| **"Dashboard team account"** (`1aLNK…`, judul asli *Database Clients .v2*) | Dashboard KPI CRO: retention/cross-sell/end-of-service + workload per CRO. Pivot agregat. | ❌ Bukan sumber import & bukan sumber MSL. (Tab lain di file ini tak terjangkau tool konektor — hanya tab pertama.) |
| **"Database client"** (`1uAUws…`, judul asli *db_anthy*, tab `db_jasa`) | **Ledger deal/layanan 1.517 baris, LENGKAP**: `Tanggal Closing, Status(Ya/Tidak), ID_TRX, ID(IdNew-JSxx), Status Pembayaran, Tgl mulai, Remark, Tag, Nama Sales, Nama Client, Jenis Client(Baru/Perpanjangan/Cross Sell), Nama Toko, Link Toko, Jasa(platform), Detail Jasa(nama layanan), Durasi Jasa (bulan), Nominal Jasa, Jasa Ke-`. | ✅ **Sumber utama KLIEN AKTIF** (jalur 2 W1-19) + bahan mentah MSL (lihat `MSL_DRAFT_KOMPILASI.md`). Gap kolom: §3 / O23. |
| **"Dashboard sales"** (`1ZeRv…`, judul asli *2026-Dashboard SPV Sales Jasa*) | Dashboard kinerja SPV: activity/closing per sales, source closing (Database/Iklan/Event/…), produk jasa/non-jasa. Pivot ber-filter. | ❌ Bukan sumber import (agregat kinerja). Berguna sebagai data rekonsiliasi silang (jumlah closing per sales/bulan). |
| **Rekapan harian sales** (`1KtN…`, judul asli *New Daily INPUT IKLAN Tim SALES Jasa 2026*, 43 tab, LENGKAP) | Tab inti `Input_Lead_Iklan[_2026]` & `Input_Lead_Organik[_2026]` ("dashboard iklan/organik" yang dimaksud): **AGREGAT harian** per `Tanggal × Nama Staff × Platform × Campaign` dengan kolom hitungan `Jumlah, Lead Qualify, Lead Seller, Lead Affiliator, Lead No Respon, Lead Bad Respon` (+ closing qty/nominal/komisi). Iklan: 2024-03→2026-07; Organik: 2025-02→2026-07. Plus 11 tab Daily Output per staff, komplain, perpanjangan (dengan alasan churn), target. | ⚠ **Bukan satu-baris-per-lead** — lihat §2 / O22. Klasifikasi riil terkonfirmasi: **Qualify / Seller / Affiliator / No Respon / Bad Respon**. |
| **Daily lead + prospek & closing** (`19pfVwm…`) | **BELUM BISA DIBACA** — file milik `yohanagustian@meagency.co.id`, belum di-share ke akun Google konektor sesi (`nerissa.arv@meagency.co.id`). | ❓ Kandidat satu-satunya sumber **per-lead** (tab "daily lead" = quality lead; "prospek dan closing" = closingan). **Aksi: share file ini ke akun konektor, lalu sesi lanjutan membaca ulang.** |

Ekstrak CSV mentah semua tab yang terbaca tersimpan di scratchpad sesi build (tidak di-commit —
berisi PII nama/klien). Yang di-commit hanya hasil olahan tanpa-PII (draft MSL) dan dokumen ini.

## 2. Gap kontrak — LEADS (jalur 1 W1-19)

Kontrak import lead (Permintaan #3) & engine dedup M1 mensyaratkan **satu baris = satu lead**
dengan minimal `nama_lead, no_telepon` (dedup by phone, keputusan via `module1_leads.Decide`).
**Tidak ada sumber per-lead di sheet yang terbaca** — rekapan iklan/organik adalah hitungan
agregat harian (tanpa nama, tanpa telepon). Agregat **tidak mungkin** dialirkan lewat engine
dedup, dan mengarang baris lead dari hitungan = fabrikasi data (dilarang konvensi).

→ **O22 (Open, DECISIONS.md):** impor lead historis menunggu (a) akses sheet `19pfVwm…` untuk
melihat apakah tab "daily lead"/"prospek dan closing" berisi baris per-lead ber-telepon, dan
(b) keputusan produk: apakah lead historis pra-CDPS memang perlu diimpor per-lead, atau cukup
**prospek yang masih berjalan** saja yang dibawa (lead lama non-aktif dibiarkan di arsip
spreadsheet)? Angka agregat historis (tren lead per kanal) adalah kebutuhan **reporting**, bukan
kebutuhan operasional M1 — CDPS menghitung metrik dari baris lead sejak go-live.

## 3. Gap kontrak — KLIEN AKTIF (jalur 2 W1-19), sumber `db_jasa`

Pemetaan kolom `db_jasa` → `ClientRow` importer:

| Kontrak (`ClientRow`) | `db_jasa` | Catatan |
|---|---|---|
| toko | `Nama Toko` | ✓ (trim spasi) |
| nama_pic | `Nama Client` | ✓ (nama orang, trim) |
| kota | — | **TIDAK ADA** |
| link_toko | `Link Toko` | Sering kosong |
| kategori | — | **TIDAK ADA** (kategori bisnis klien) |
| platform_list | `Jasa` per baris | Per-layanan, bukan list per-klien; perlu agregasi per `ID` + normalisasi ejaan (TikTok/Tiktok/Shopee␠) |
| gmv_baseline / target_gmv / marketing_budget | — | **TIDAK ADA** |
| sales_pic | `Nama Sales` | Nama, bukan NIK — perlu resolusi ke `employees` (via hasil sync HRIS) |
| alokasi_sales (Σ100%) | — | **TIDAK ADA** (single sales per baris; alokasi multi-sales tak terekam) |
| commission_payment_pic | — | **TIDAK ADA** |
| tanggal_closing | `Tanggal Closing` | ✓ (format `6-Mei-2025`, bulan Indonesia) |
| layanan_dibeli (nama + harga deal) | `Detail Jasa` + `Nominal Jasa` | ✓ per baris; **satu klien = beberapa baris** (kunci gabung: `ID` = `IdNew-JSxx`) |
| nilai_transaksi_total | — | Harus diagregasi Σ`Nominal Jasa` per klien? Atau per deal? **Basis TRX tidak eksplisit** di ledger (`ID_TRX` = string per-layanan) |
| skema_pembayaran | `Status Pembayaran` | Nilai riil: `Lunas` (1388), `Termin` (113, kadang ber-spasi ekor), **`DP` (9), `Monthly` (3), `Deposit` (1), kosong (3)** — 3 nilai terakhir **di luar 4 skema CDPS** |
| jadwal_termin (amount + due date, Σ=total) | — | **TIDAK ADA** (hanya label "Termin" + `Durasi Jasa (bulan)`) |
| pembayaran_terverifikasi (amount + tanggal) | — | **TIDAK ADA** |
| link_kontrak | — | **TIDAK ADA** |

Tambahan: `Status` = `Ya`(1149)/`Tidak`(368) — makna pasti (closing valid? aktif?) perlu
konfirmasi; `Jenis Client` (Baru/Perpanjangan/Cross Sell) tak punya padanan langsung di kontrak;
`Remark` kadang berisi serial date Excel bocor (mis. `46139`).

→ **O23 (Open, DECISIONS.md):** sebelum parser klien ditulis, butuh keputusan: (1) **definisi
"klien aktif"** yang dibawa ke CDPS (mis. `Tgl mulai + Durasi` masih berjalan pada tanggal
go-live? `Status=Ya` saja?) — 1.517 baris historis jelas bukan semuanya klien aktif; (2)
**mapping skema** `DP`/`Monthly`/`Deposit`/kosong → 4 skema CDPS (DP≈Bayar Sebagian? Monthly≈
Termin bulanan? Deposit≈?) atau baris tsb dikeluarkan dari import; (3) **pengisian field wajib
yang tidak ada di ledger** (kota, GMV baseline, target, alokasi, commission PIC, jadwal termin,
pembayaran terverifikasi, link kontrak) — usul: **form pelengkap per-klien-aktif** diisi
CRO/Account & Finance hanya untuk klien yang lolos definisi (1); (4) **basis transaksi**: satu
TRX per klien-aktif (Σ layanan berjalan) atau per deal closing. Perlu juga daftar `Nama Sales`
riil → NIK (banyak nama panggilan: Cena, Esal, Waba-JKT, Cekat AI = bot?).

## 4. MSL (Permintaan #2) — status

Sumber riil = `db_jasa` juga. Harga di ledger adalah **harga deal aktual** (nego/tier/durasi
membuat satu nama layanan berrentang harga sangat lebar), **bukan rate card** — sesuai konvensi,
`standard_price`/`commission_rule` **ditetapkan Sales Head**, bukan disalin dari ledger.
Deliverable: `docs/handoff/MSL_DRAFT_KOMPILASI.{csv,md}` — worksheet kanonikalisasi nama layanan
(varian ejaan digabung konservatif) + statistik harga per layanan, kolom `usulan_standard_price`
dan `usulan_commission_rule` sengaja kosong untuk diisi Sales Head (grammar O14), lalu di-input
via admin MSL / seed CSV.

## 5. Ringkasan aksi terbuka

> **UPDATE 2026-07-10 (sore):** data per-lead & per-deal DITERIMA via upload workbook
> "Data Cena Sales Performance" (tab `Daily Leads` 1.769 lead ber-telepon, `PROSPECT&CLOSING`/
> `Sheet72` per-deal + kontak). O22 & O23 diputus Nerissa (lihat DECISIONS 2026-07-10) dan
> **parser + tooling W1-19 sudah dibangun**: `backend/cmd/import` (leads-dryrun/apply, gen-form,
> clients-dryrun/apply, dormant-dryrun/apply — Director-only) + migrasi 0013 (`clients.dormant_at`).
> Angka smoke riil (run-date 2026-07-10): ledger 1.517 baris → **1.336 klien unik = 239 kandidat
> aktif (form pelengkap) + 1.097 dormant** (1.096 valid; 1 baris error data riil: `link_toko`
> terlalu panjang — koreksi di sumber); Daily Leads → **18 lead lolos filter B** (Qualify/Hot/Warm,
> sejak 2026-01-10), semua valid, 0 duplikat.

| # | Aksi | Siapa | Status |
|---|---|---|---|
| 1 | ~~Share sheet `19pfVwm…`~~ → terpenuhi via upload workbook Cena (bentuk kolom sama; kalau ada file per-sales lain, parser yang sama jalan) | Yohan | ✅ |
| 2 | ~~Putuskan O22~~ → Pilihan B (Qualify + Hot/Warm, 6 bulan) | Nerissa | ✅ |
| 3 | ~~Putuskan O23~~ → semua klien diimpor (non-aktif dormant), DP→Sebagian, Monthly→Termin, kosong→form, 1 klien = 1 TRX | Nerissa | ✅ |
| 4 | Validasi `MSL_DRAFT_KOMPILASI.csv` → isi standard_price + commission_rule | Sales Head | ⏳ |
| 5 | Serahkan daftar NIK→email karyawan (O21) + validasi `HRIS_ROLE_MAPPING_DRAFT.md` | HR + OD/Nerissa | ⏳ |
| 6 | ~~Tulis parser W1-19~~ → selesai (`internal/importer/parse_*.go`, `cmd/import`) | Sesi build | ✅ |
| 7 | **Isi form pelengkap 239 klien aktif** (hasil `gen-form`; kolom kota/kategori/GMV/alokasi NIK/jadwal termin/pembayaran masuk/kontrak; konfirmasi_aktif Y/N) lalu `clients-dryrun` → `clients-apply` | CRO + Finance | ⏳ |
| 8 | Susun `--sales-map` (nama panggilan sheet → NIK; 18 lead & 239 klien memakai nickname: Cena, Esal, dst.) | Sales Head + HR | ⏳ |
