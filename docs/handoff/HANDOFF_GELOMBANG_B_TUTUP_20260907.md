# Handoff — **Gelombang B TUTUP**: A · B1 · B2 · B3 · B4 · B5 semuanya di `main`

> **Baca ini dulu.** Enam gelombang dari empat sesi paralel sudah disatukan dan
> di-merge ke `main`. Sisa rencana empat-gelombang: **Gelombang C** (Showcase
> Klien Terbaik) dan **Gelombang D** (laporan keuangan accrual) — keduanya
> belum disentuh, dan pemilik memang memilih *"cukup B5 dulu"*.
>
> Handoff per gelombang masih berlaku sebagai rujukan rinci:
> `HANDOFF_GELOMBANG_B_20260906.md` (audit akar masalah §4 — **paling mahal
> untuk ditemukan ulang**), `HANDOFF_GELOMBANG_B_SESI2_20260906.md` (B1+B2),
> `HANDOFF_GELOMBANG_B3_B4_20260906.md`, `HANDOFF_GELOMBANG_B5_20260906.md`.

---

## 1. Posisi sebenarnya

| Gelombang | Isi | Status |
|---|---|---|
| **A** | PR kecil QA (2 alat Ads → MEA AI Tools, UX editor insight, dok Upcoming Milestone) | ✅ **di `main`** — PR #300 |
| **B1** | Perluas payload baseline TikTok (+4 turunan) | ✅ **di `main`** — PR #301 |
| **B2** | Engine baseline Shopee (`cdps.baseline.shopee.v1`) | ✅ **di `main`** — PR #301 |
| **B3** | Section B terisi dari satu upload | ✅ **di `main`** — PR #302 |
| **B4** | AM Co-Pilot mengisi Section E dari server | ✅ **di `main`** — PR #302 |
| **B5** | Baris Plan periode 1 tersemai dari Section E | ✅ **di `main`** — PR #303 |
| **C** | Showcase Klien Terbaik | ⏸️ **belum** |
| **D** | Laporan keuangan accrual | ⏸️ **belum** — satu-satunya yang menambah migrasi (183 → 184) |

**B6 tidak ada.** Nama branch `…b5-b6…` hanya slug; pemilik menghentikan di B5.

---

## 2. Cara enam gelombang disatukan tanpa drift — dan apa yang HAMPIR lolos

Empat sesi membangun dari titik `main` yang **sama**. Risiko sebenarnya bukan
konflik teks, melainkan **asumsi yang tidak pernah bertemu**.

### 2.1 Prosedur yang dipakai (ulangi ini kalau ada build paralel lagi)

1. **Dry-run lokal penuh lebih dulu**: satu branch buangan
   `main + A + B1/B2 + B3/B4 + B5`, seluruh konflik diselesaikan, `db-rebuild` +
   `npm test --workspaces` + typecheck + build dijalankan **sebelum satu pun PR
   di-merge**. Tujuannya: `main` tidak boleh pernah berada di keadaan setengah
   terintegrasi.
2. Merge berurutan dari yang paling kecil: A → B1/B2 → B3/B4 → B5, tiap langkah
   menunggu 5 job CI hijau.
3. Konflik teksnya semua **aditif**: dua baris `export` barrel
   (`packages/core/src/baseline/index.ts`, `packages/core/src/index.ts`) dan
   baris tabel `DECISIONS.md`. Semuanya diselesaikan dengan **menyimpan keduanya**.

### 2.2 ⚠️ Jahitan B2↔B3 BOCOR — sudah ditutup

Handoff B3 mengasumsikan payload Shopee sekongruen dengan TikTok. Setelah B2
mendarat dan pemetanya diuji terhadap keluaran **asli** `runShopeeBaseline`,
tiga kunci ternyata berbeda:

| Section B | TikTok | Shopee | Akibat kalau tidak ditutup |
|---|---|---|---|
| B-1.4 % batal | `toko.refund_rate` | `toko.batal_retur_rate` | kolom kosong, AM ketik ulang |
| B-7.1 video | `video.toko.*` + `video.afiliasi.*` | blok `video` **datar** | views + GMV video hilang |
| **B-4** | (tidak ada export) | `layanan.*` + `kesehatan_toko.poin_total` | **keputusan pemilik tidak berfungsi** |

Yang ketiga paling mahal: keputusan pemilik *"B-4 Shopee diisi otomatis"*
(2026-09-06, menutup pertanyaan terbuka §8 #1) **sudah mendarat di payload B2**
lalu **berhenti di situ** karena B3 tidak membacanya. Fitur yang terlihat
selesai di dua PR sekaligus dan tetap tidak muncul di layar.

### 2.3 Jahitan B4↔B5 diperiksa — TIDAK bocor, tapi hanya setelah dibaca

`parseTargetKuota` (B5) menuntut teks `target` **diawali angka** — bentuk yang
tool HTML hasilkan (`"30 video, jembatan …"`). Co-Pilot server-side (B4) menulis
bentuk lain: `"jembatan Median VV video toko: 10,0 VV → 12,5 VV dalam 3 minggu"`.

Jadi pilar B4 **tidak** disemai otomatis; ia jatuh ke panel *"Pilar Strategi
belum jadi baris kerja"* dengan alasan **"isi kuota + satuan"**.

**Itu benar, bukan bug.** `kuota` PC-6 adalah *berapa deliverable akan dibuat*
(40 video, 7 listing, 36 jam live) — keputusan perencanaan yang server tidak
punya sumbernya. Target jembatan (median VV 12.500) adalah angka yang **berbeda**;
menyemainya sebagai kuota melahirkan baris kerja yang menuntut 12.500 unit
pekerjaan. Divisi dan channel tetap terisi otomatis, jadi yang tersisa untuk AM
benar-benar **satu angka**.

### 2.4 Aturan yang diambil — ini bagian yang wajib dibawa ke Gelombang C/D

> **Setiap jahitan antar-gelombang wajib punya satu tes yang memanggil KEDUA
> sisi sungguhan. Fixture sintetis di masing-masing sisi tidak cukup.**

Alasannya terbukti di sini: B2 menguji payload-nya benar, B3 menguji pemetanya
benar, dan **nol tes** menguji bahwa payload B2 yang sungguhan masuk ke pemeta
B3 yang sungguhan — padahal itulah satu-satunya tempat bug-nya bisa hidup. Dua
tes lintas-mesin sekarang menjaganya:

- `packages/core/src/baseline/section-b.test.ts` → menjalankan
  `runShopeeBaseline` lalu menyuapkan payload-nya ke `mapPayloadToSectionB`.
- `packages/core/src/planpillar.test.ts` → menjalankan `copilot.susunUsulan`
  lalu menyuapkan `target`-nya ke `seedRowFromPillar`.

Keduanya memerah kalau salah satu sisi mengganti nama kunci atau bentuk teks —
bukan seorang AM yang menemukan Section B kosong atau Plan tanpa baris.

---

## 3. Verifikasi — angka acuan BARU

Semua angka di handoff gelombang sebelumnya sudah **usang**.

| Suite | Sekarang | Akhir Gelombang A |
|---|---|---|
| core | **900** | 667 |
| db | **53** | 53 |
| apps/api | **454** | 447 |
| domain | **1930** (+1 skip) | 1903 (+1 skip) |
| web-internal | **621** | 565 |
| web-client-portal | **19** | 19 |
| migrasi db-rebuild | **183** | 182 |
| gate db-rebuild | **145 / 40 / 31 / 69** | sama |

```
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""   # sekali per container
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes
npm install && npm test --workspaces && npm run typecheck --workspaces --if-present
cd web-internal && npm install && npx vitest run && npx tsc --noEmit && npm run build
cd ../web-client-portal && npx vitest run
```

### Jebakan yang menggigit LAGI di sesi ini

- **Suite dijalankan dua kali di DB yang sama tanpa rebuild ⇒ 2 kegagalan PALSU**
  (`admin.test.ts` hari libur `expected 7 to be 1`, `client.test.ts` Hold Service
  `expected 3 to be 1` — keduanya menghitung baris `audit_log`). **Rebuild dulu
  sebelum mencari bug.**
- **Postgres bisa mati sendiri di container ini.** Gejalanya puluhan FAIL yang
  terlihat seperti regresi nyata; sebabnya `Connection refused`. Cek
  `pg_isready` sebelum menyimpulkan apa pun.
- **Suite penuh bisa flaky di bawah beban paralel** — satu kali run menunjukkan
  `strategi.test.ts` + `client.test.ts` merah sebagian; dijalankan sendiri
  248/248 hijau, dan run berikutnya bersih. Jangan langsung percaya satu run.
- `riset_awal_analisa` **immutable by trigger**: fixture varian payload harus
  di-`INSERT` dengan bentuknya, tidak bisa di-`UPDATE` sesudahnya.
- 1 error lint `react-hooks/static-components` di `admin/employees/page.tsx`
  **PRE-EXISTING**, di luar cakupan.

### Live DB

Migrasi **183** (`20260915010000_b2_baseline_shopee_provenance.sql`) **sudah
di-apply ke live** `egddxfcnrtecheiykhlf` oleh sesi B2 sendiri. Diverifikasi
ulang lewat kueri katalog: **145 tabel**, kolom `benchmark_versi_shopee` ✓,
`ck_analisa_benchmark_xor` ✓. **Nol migrasi baru** dari B3/B4/B5 ⇒ repo dan live
tidak drift.

⛔ Tetap **JANGAN `supabase db push`** — ledger versi live berbeda *wholesale*
dari nama berkas repo (O65). Pakai `mcp__Supabase__apply_migration` per berkas.

---

## 4. Yang BELUM bisa diklaim

1. **Uji terima §10 butir 1–7 belum dijalankan end-to-end di aplikasi nyata.**
   Yang terbukti adalah tesnya, bukan layarnya. Butir 2 (upload Shopee) kini
   bisa diuji karena B2 sudah mendarat. Ini pekerjaan pertama yang layak
   dilakukan sebelum Gelombang C.
2. **Pertanyaan terbuka yang masih menggantung** (`DECISIONS.md` §Open):
   - **B23-SHP** *(baru)* — kanal `gmv_mix` Shopee mana yang mengisi kolom
     B-2.3 mana. Taksonominya berbeda dan saling tumpang tindih (`shopee_ads` ·
     `affiliate` · `voucher` · `chat` · `meta_cpas` · `shopee_video`), dan
     `voucher`/`chat` tidak punya kolom tujuan sama sekali. Sampai diketok,
     **B-2.3 Shopee tetap manual** — itu keadaan yang jujur, bukan bug.
   - **Pemilik pilar `retensi`** (E-9) — belum diketok sama sekali; menebaknya
     melanggar keputusan yang sama yang menetapkan `sku`/`harga`.
   - Lima pertanyaan Gelombang C/D (akses Sales ke Showcase, layanan di-void di
     tengah periode, `[On Hold]` vs pengakuan pendapatan, kunci tutup buku,
     bruto vs PPN, izin kontrak untuk materi pitch).
3. **Utang teknis yang sengaja dibiarkan** (dari B2): `flashsale_aktif` tidak
   diemit — slot `promo_flashsale` terdeteksi dan terparse, tapi
   `ZERO_ACTIVITY_MODULES` mesin laporan tidak memantaunya, jadi membacanya akan
   **selalu** berbunyi "ada aktivitas". B-8 tetap manual untuk baris itu.

---

## 5. Kalau lanjut ke Gelombang C atau D

Rancangan keduanya ada di `HANDOFF_GELOMBANG_B_20260906.md` §7. **Baca peringatan
di muka**: hari ini halaman Showcase akan **KOSONG** (satu-satunya laporan live
pra-R3, `payload` beku permanen, tak bisa di-backfill), dan skedul pendapatan
hanya mencakup **3 dari 14 layanan** (11 tanpa periode; `durasi_jasa` MSL terisi
**0 dari 14**). Keduanya bukan cacat — itu laporan yang jujur menunjukkan data
yang belum diisi. Gelombang **D** menambah **satu** migrasi ⇒ 184.
