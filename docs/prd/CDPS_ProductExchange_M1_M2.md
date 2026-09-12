# PRD — Product Exchange M1 & M2
**Versi 1.0 · 12 September 2026 · PT MEA Agensi Digital**

Modul M1 (Creator Capability Registry, `mcnapp`/MCN) dan M2 (Consent & Eligibility Policy, `agencyapp`/CDPS).
Kedua modul independen dan dapat dikerjakan paralel. Tidak ada ketergantungan di antara keduanya.

> **Catatan penerapan di CDPS (`agencyapp`) — dibaca sebelum §4.** M2 di sini disebut **PX-M2** di
> seluruh kode/commit/decision log CDPS (CDPS sudah punya modul bernama M2:
> `docs/prd/CDPS_Module2_Marketing.md`), dan dipecah jadi **PX-M2a** (dikerjakan lebih dulu — bagian
> ini) + **PX-M2b** (menyusul bersama M3, mengonsumsi `px_sku`). Modul **consent** yang PRD ini
> minta di §4 (`px_consents` + Rule 1–8 + Flow A/B) **DIHAPUS** oleh ketokan pemilik 2026-09-12,
> digantikan gerbang `client_platforms.shop_id` — lihat `docs/DECISIONS.md` 2026-09-12 untuk alasan
> lengkap dan konsekuensinya. `px_sku_volume`/`px_sku_eligibility` (Rule 9–16, Flow D) ditunda ke
> PX-M2b karena bergantung pada `px_sku` (M3) yang PRD-nya belum ditulis. Yang dieksekusi di PX-M2a:
> `client_platforms.shop_id` (D-04) + `px_eligibility_policy` (Rule 9–12, seed §4.5) saja. Deviasi
> lengkap: 5 entri `docs/DECISIONS.md` 2026-09-12.

## Daftar Isi
1. [Background](#1-background)
2. [Keputusan Terkunci](#2-keputusan-terkunci)
3. [M1 — Creator Capability Registry](#3-m1--creator-capability-registry)
4. [M2 — Consent & Eligibility Policy](#4-m2--consent--eligibility-policy)
5. [Open Assumptions](#5-open-assumptions)
6. [Success Metrics](#6-success-metrics)

---

## 1. Background

**Masalah.** MEA Agency memegang klien seller; MCN MEA memegang kreator. Hari ini tidak ada cara
sistematis mempertemukan keduanya: AM tidak tahu kategori produk apa yang benar-benar bisa dijual
kreator MEA, dan CPM tidak tahu produk apa yang tersedia dari basis klien agency. Pencocokan
terjadi lewat percakapan ad-hoc, tidak terukur, tidak ber-SLA.

**Kenapa sekarang.** Ini satu-satunya inisiatif yang berdiri di atas aset milik MEA sendiri
(supply seller + demand kreator), bukan di atas subsidi platform. Tidak ada kompetitor yang
memegang dua sisi. Nilainya bukan pada ukuran katalog, melainkan pada **activation rate** —
berapa persen pencocokan berakhir sebagai kampanye afiliasi yang menghasilkan GMV.

**Kenapa M1 dan M2 lebih dulu.** Prinsip demand-first: hanya produk yang MEA punya kreatornya yang
boleh masuk katalog. Artinya registry kapabilitas kreator (M1) harus ada sebelum ada apa pun yang
bisa disaring, dan consent klien (M2) harus ada sebelum satu baris data klien diproses. Modul
ingestion SKU (M3) mengonsumsi keduanya, bukan sebaliknya.

**Hasil yang diharapkan.** Setelah M1 dan M2 selesai: (a) tersedia peta terukur "sub-kategori mana
MEA kuat, mana kosong, dan berapa kapasitas tersisa", dan (b) tersedia daftar klien-toko yang sah
untuk diproses beserta aturan kelayakan SKU yang dapat dikalibrasi tanpa mengubah skema.

---

## 2. Keputusan Terkunci

Ketiga belas keputusan berikut sudah diketok CEO. Developer **tidak boleh** mendesain ulang.
Yang relevan untuk M1/M2 ditandai.

| Kode | Keputusan | Relevan |
|---|---|---|
| D-01 | Gate kelayakan **per SKU**, ambang Rp 200.000.000/bulan | **M2** |
| D-02 | **Tanpa commission floor** di Phase 1; dikalibrasi sebelum Phase 2 | **M2** |
| D-03 | Dua proyek Supabase terpisah; schema `bridge` di sisi MCN | M1 |
| D-04 | `shop_id` ditambahkan ke `client_platforms`, diisi AM saat opt-in | **M2** |
| D-05 | Komponen `gmv_impact` ditambahkan ke role AM, disuapi **total** GMV klien (bukan GMV Product Exchange saja). Rekonsiliasi bobot OKR = workstream terpisah | — |
| D-06 | Angka volume penjualan **berhenti di CDPS**; hanya verdict yang menyeberang | **M2** |
| D-07 | Satu slot = **jumlah match aktif bersamaan** per (kreator, level2, price_segment) | **M1** |
| D-08 | Consent **per toko per platform** (`client_platform`), bukan per klien atau per SKU | **M2** |
| D-09 | Permukaan kreator = halaman baru, bukan perluasan `/portal/agency-plan` | — |
| D-10 | Kreator swalayan di portal | — |
| D-11 | SLA memakai **hari kerja**; kalender CDPS di-port ke MCN | — |
| D-12 | Region MCN = `ap-southeast-1` (Singapore), sama dengan CDPS | M1 |
| D-14 | ID memakai **`bigint` biasa**, tanpa prefix baru | **M1, M2** |

---

## 3. M1 — Creator Capability Registry

**Repo:** `mcnapp` (MCN) · **Schema:** `bridge` · **Estimasi:** 5–8 dev-day

### 3.1 Background

MCN sudah punya bahan bakunya: `creator_subcat_segment_gmv` menyimpan GMV historis per
`(creator_id, level2_category, price_segment, upload_batch, window_end)`. Itu menjawab "kategori dan
segmen harga apa yang **pernah** dijual kreator ini". Yang tidak ada: **kapasitas** — berapa banyak
produk yang sanggup dikerjakan kreator itu sekarang.

Tanpa kapasitas, kuota admisi (keputusan 9) tidak punya basis, dan janji AM ke klien akan patah
ketika kreator kehabisan bandwidth. M1 menambahkan lapisan kapasitas di atas data kapabilitas yang
sudah ada.

### 3.2 Rules

1. Satu baris registry = satu kombinasi unik `(creator_id, level2_category, price_segment)`.
2. Kolom `proven_gmv` dan `proven_orders` **selalu dihitung ulang** dari
   `creator_subcat_segment_gmv`. Nilai tersebut **tidak boleh** diedit manual — tidak boleh ada
   sumber kebenaran kedua.
3. Jendela perhitungan `proven_*` = nilai `projection.window_days` di `app_config`. Tidak
   di-hardcode.
4. `slots_total` adalah **satu-satunya input manusia** di seluruh modul ini. Diisi oleh CM Lead
   atau Senior SPV MCN. Default `0`.
5. `slots_total = 0` berarti kreator tersebut **tidak tersedia** untuk kombinasi itu. Baris tetap
   ada (kapabilitasnya tercatat), tetapi tidak dapat dipakai untuk admisi SKU.
6. `slots_committed` **tidak pernah** ditulis manual. Ia dipelihara trigger dari tabel `px_match`
   (M5): naik saat match masuk status non-terminal, turun saat match mencapai status terminal
   (`[Aktif]`, `[Ditolak]`, `[Kedaluwarsa]`).
7. Definisi slot (D-07): **jumlah match aktif bersamaan**. Bukan SKU per bulan, bukan jam konten.
8. `slots_available` adalah generated column: `greatest(slots_total - slots_committed, 0)`.
   Tidak pernah disimpan sebagai nilai independen.
9. Over-commit **harus gagal di level database**, bukan diperingatkan di UI. CHECK constraint
   `slots_committed <= slots_total`.
10. Sebuah kombinasi `(level2_category, price_segment)` dinyatakan **covered** jika
    `sum(slots_available) > 0` pada kombinasi tersebut. Tidak ada ambang jumlah kreator minimum di
    Phase 1 — ambang tersebut baru relevan saat volume naik dan dikalibrasi di Phase 2.
11. Hanya kreator dengan `creators.status = 'aktif'` masuk perhitungan coverage. Kreator
    `prospek`/`binding`/`nonaktif` boleh punya baris registry tapi `slots_available`-nya
    diperlakukan `0` oleh fungsi coverage.
12. Recompute `proven_*` dijalankan setelah setiap ingest mingguan selesai. Kegagalan recompute
    **tidak boleh** mengosongkan nilai lama — nilai terakhir bertahan, dan `last_computed_at`
    menunjukkan keterlambatannya.

### 3.3 Flow

**Flow A — Inisialisasi registry (sekali, lalu berkala)**
1. Job membaca `creator_subcat_segment_gmv` untuk jendela `projection.window_days`.
2. Agregasi per `(creator_id, level2_category, price_segment)` → `proven_gmv`, `proven_orders`.
3. UPSERT ke `bridge.px_creator_capability`. Kombinasi baru dibuat dengan `slots_total = 0`.
   Kombinasi yang sudah ada: hanya `proven_*` dan `last_computed_at` yang diperbarui —
   `slots_total` **tidak disentuh**.
4. Kombinasi yang tidak lagi muncul di jendela: `proven_*` di-set `0`, baris **tidak dihapus**
   (agar `slots_total` yang sudah diisi manusia tidak hilang).
5. *Error path:* kegagalan di langkah 1–3 → transaksi rollback, tulis `audit_logs`
   (`type = 'auto'`, `action = 'px_capability_recompute_failed'`), nilai lama bertahan.

**Flow B — CM Lead mengisi kapasitas**
1. CM Lead membuka halaman Capability Registry, memfilter per kreator atau per kategori.
2. Sistem menampilkan baris dengan `proven_gmv`, `proven_orders`, `slots_total`,
   `slots_committed`, `slots_available`.
3. CM Lead mengubah `slots_total` pada satu atau beberapa baris.
4. Sistem memvalidasi `slots_total >= slots_committed`. Gagal → tolak dengan pesan Bahasa
   Indonesia yang menyebut nilai `slots_committed` saat ini.
5. Simpan, tulis `audit_logs` (`action = 'px_slots_updated'`, `before`/`after` berisi nilai lama
   dan baru).

**Flow C — Coverage map untuk AM**
1. Fungsi `bridge.px_coverage_map()` mengagregasi per `(level2_category, price_segment)`:
   jumlah kreator dengan `slots_available > 0`, total `slots_available`, total `proven_gmv`.
2. Hasil ditampilkan sebagai tabel di halaman Coverage.
3. Kombinasi dengan `sum(slots_available) = 0` ditandai **kosong** — inilah sinyal bagi AM untuk
   tidak menawarkan agency plan pada kategori tersebut.

### 3.4 Example

**Input.** Kreator `CRT-000412` (Dita), status `aktif`. Data `creator_subcat_segment_gmv` pada
jendela 90 hari:

| level2_category | price_segment | gmv | orders |
|---|---|---|---|
| Sepatu Wanita | mid | 184.000.000 | 1.240 |
| Sepatu Wanita | low | 31.000.000 | 410 |
| Tas Wanita | mid | 12.000.000 | 88 |

**Proses.** Flow A membuat tiga baris registry dengan `slots_total = 0`. CM Lead menilai Dita
sanggup memegang 3 produk bersamaan di Sepatu Wanita mid, 1 di low, dan belum siap di Tas Wanita.

**Output registry.**

| creator_id | level2_category | price_segment | proven_gmv | slots_total | slots_committed | slots_available |
|---|---|---|---|---|---|---|
| CRT-000412 | Sepatu Wanita | mid | 184.000.000 | 3 | 0 | 3 |
| CRT-000412 | Sepatu Wanita | low | 31.000.000 | 1 | 0 | 1 |
| CRT-000412 | Tas Wanita | mid | 12.000.000 | 0 | 0 | 0 |

**Output coverage map** (digabung dengan kreator lain):

| level2_category | price_segment | kreator tersedia | total slot | status |
|---|---|---|---|---|
| Sepatu Wanita | mid | 7 | 19 | covered |
| Sepatu Wanita | low | 3 | 4 | covered |
| Tas Wanita | mid | 0 | 0 | **kosong** |

Baris terakhir adalah sinyal operasional: AM **tidak** menawarkan agency plan untuk SKU tas wanita
segmen mid, karena tidak ada kreator yang siap mengerjakannya. Ini mencegah janji yang tidak dapat
dipenuhi.

**Skenario over-commit.** Dita sudah punya 3 match aktif di Sepatu Wanita mid
(`slots_committed = 3`). CM Lead mencoba menurunkan `slots_total` ke 2 → transaksi ditolak dengan
pesan: *"Tidak bisa set slot ke 2. Kreator ini sedang punya 3 match aktif di kategori tersebut.
Turunkan setelah match selesai."*

### 3.5 System Requirements

**Tabel `bridge.px_creator_capability`**

| Field | Tipe | Wajib | Validasi / catatan |
|---|---|---|---|
| `creator_id` | `text` | ya | FK `public.creators(id)` |
| `level2_category` | `text` | ya | Taksonomi kanonik MCN, sama dengan `creator_subcat_segment_gmv` |
| `price_segment` | `price_segment_t` | ya | Enum yang sudah ada di MCN |
| `proven_gmv` | `numeric(15,2)` | ya | Default `0`. Turunan, tidak editable |
| `proven_orders` | `integer` | ya | Default `0`. Turunan, tidak editable |
| `last_computed_at` | `timestamptz` | ya | Diisi setiap recompute |
| `slots_total` | `smallint` | ya | Default `0`. CHECK `>= 0`. **Satu-satunya input manusia** |
| `slots_committed` | `smallint` | ya | Default `0`. CHECK `>= 0`. Hanya trigger yang menulis |
| `slots_available` | `smallint` | — | `GENERATED ALWAYS AS (greatest(slots_total - slots_committed, 0)) STORED` |
| `updated_by` | `uuid` | tidak | FK `team_members(id)`; diisi saat `slots_total` diubah |
| `updated_at` | `timestamptz` | ya | Default `now()` |

- PK: `(creator_id, level2_category, price_segment)`
- CHECK: `slots_committed <= slots_total`
- Index: `(level2_category, price_segment)` untuk query coverage

**Fungsi `bridge.px_coverage_map(p_level2 text DEFAULT NULL)`**
Mengembalikan `(level2_category, price_segment, creator_count, total_slots_available, total_proven_gmv, status)`.
`status` = `'covered'` bila `total_slots_available > 0`, `'kosong'` bila `0`.
Hanya menghitung baris yang `creator_id`-nya berstatus `aktif` (Rule 11).

**Keamanan & akses**
- `REVOKE ALL ON bridge.px_creator_capability FROM anon, authenticated;`
- Restrictive policy: `using (not is_creator_user())` — pola `pt_creator_deny` yang sudah ada.
  Kreator **tidak boleh** melihat kapasitas kreator lain.
- Tulis hanya lewat server action yang digerbangi `requirePermission`. Kunci izin baru:
  `px.capability.read`, `px.capability.write`.

**Integrasi**
- Sumber data: `public.creator_subcat_segment_gmv` (read-only dari sisi M1).
- Config: `app_config` key `projection.window_days` (sudah ada). `getConfig()` throw bila hilang —
  perilaku ini dipertahankan, jangan diberi default diam-diam.
- Recompute dipicu setelah ingest mingguan. **Tidak ada scheduler di MCN** — dipicu dari akhir
  pipeline ingest yang sudah ada, bukan dari cron baru.

**Non-functional**
- Recompute untuk ~5.000 kreator harus selesai < 60 detik. Kalau lebih, agregasi dipindah ke
  materialized view.
- Halaman Capability Registry: bulk edit minimal 50 baris dalam satu simpan.

**UI**
- Halaman baru di navigasi MCN, di bawah kelompok yang memuat halaman kreator.
- Dua tab: **Registry** (per kreator, editable) dan **Coverage** (per kategori, read-only).
- Tab Coverage harus dapat di-export CSV — ini artefak kerja AM.

---

## 4. M2 — Consent & Eligibility Policy

**Repo:** `agencyapp` (CDPS) · **Schema:** `public` · **Estimasi:** 7–10 dev-day

### 4.1 Background

Data penjualan klien bukan milik MEA. SKU klien hanya boleh diproses jika klien tersebut telah
menyetujui pembuatan agency plan (kampanye TAP/SAP) di mana MEA memperoleh komisi penjualan.
Klien yang tidak setuju **tidak masuk sistem sama sekali**.

Selain consent, dibutuhkan aturan kelayakan SKU yang dapat dikalibrasi tanpa migrasi: ambang
penjualan, basis pengukuran, dan (nanti) commission floor. Kalibrasi akan berubah — skemanya
tidak boleh.

### 4.2 Rules

1. Consent dicatat pada level **`client_platform`** (satu toko pada satu platform), bukan per
   klien dan bukan per SKU. Klien dengan dua toko = dua baris consent terpisah.
2. `px_consents` adalah **ledger append-only**. Trigger melarang UPDATE dan DELETE. Perubahan
   apa pun = baris baru.
3. Hanya dua nilai `aksi`: `'beri'` dan `'cabut'`. Tidak ada `pending`, tidak ada `draft`.
   **Klien yang belum setuju tidak punya baris apa pun.**
4. Status consent hari ini **selalu turunan**, tidak pernah disimpan sebagai kolom:
   baris terakhir per `client_platform_id` dengan `aksi = 'beri'` dan
   (`berlaku_sampai IS NULL` atau `berlaku_sampai >= current_date`).
5. `berlaku_sampai IS NULL` berarti tanpa batas waktu. `berlaku_sampai` terisi berarti consent
   **berhenti berlaku sendiri** setelah tanggal itu, tanpa perlu pencabutan manual.
6. Baris `aksi = 'cabut'` **wajib** punya `alasan` dan **wajib** `berlaku_sampai IS NULL` dan
   `dokumen_catatan IS NULL`. Baris `aksi = 'beri'` **wajib** `alasan IS NULL`.
7. `agency_plan_ref` mencatat kampanye TAP/SAP yang menjadi dasar consent. Wajib untuk
   `aksi = 'beri'` — inilah bukti bahwa consent melekat pada pembuatan agency plan (keputusan 4).
8. `shop_id` pada `client_platforms` **wajib terisi** sebelum baris consent `'beri'` dapat dibuat.
   Tanpa `shop_id`, atribusi GMV tidak mungkin dan SKU toko itu tidak boleh diproses.
9. `px_eligibility_policy` adalah tabel **berversi dan append-only**. Kalibrasi baru = INSERT
   versi baru, bukan UPDATE versi lama. Trigger melarang UPDATE dan DELETE.
10. Hanya satu versi policy boleh `aktif = true` pada satu waktu. Ditegakkan partial unique index.
11. Ambang kelayakan diukur **per SKU** (D-01): nilai default
    `sales_threshold_idr = 200000000`, `threshold_basis = 'per_sku'`, `threshold_window_days = 30`.
12. `commission_floor_pct` di Phase 1 bernilai `null` (D-02). Fungsi evaluasi **harus** menangani
    `null` sebagai "tidak ada floor", bukan sebagai `0`.
13. Evaluasi kelayakan menghasilkan tiga kemungkinan, bukan dua: **layak**, **tidak layak**, dan
    **data kurang**. SKU tanpa data volume mendapat `alasan_kode = 'data_kurang'`, **bukan**
    `'volume_di_bawah_ambang'`. Perbedaan antara "belum tahu" dan "tidak layak" tidak boleh
    dikaburkan.
14. Nilai volume yang tidak dapat di-parse harus diperlakukan sebagai **NaN, bukan 0**. Gunakan
    kontrak `parseIndonesianNumber()` dari `packages/core/src/skuscreener/parse.ts`, **bukan**
    `n()` dari `packages/core/src/baseline/angka.ts` yang mengembalikan `0`.
15. Verdict kelayakan disimpan immutable per `(sku_id, policy_versi, dinilai_pada)`. Verdict
    **tidak boleh** memuat angka volume — hanya boolean dan kode alasan (D-06).
16. Angka volume penjualan disimpan di tabel terpisah `px_sku_volume` dengan akses default-deny.
    Tabel ini **tidak pernah** direplikasi ke proyek MCN.

### 4.3 Flow

**Flow A — AM mencatat consent**
1. AM membuka halaman klien, tab Product Exchange.
2. Jika `client_platforms.shop_id` kosong → sistem meminta AM mengisinya terlebih dahulu.
   Tombol catat consent **disabled** sampai terisi (Rule 8).
3. AM memilih toko, mengisi `agency_plan_ref` (ID kampanye TAP/SAP), opsional `berlaku_sampai`
   dan `dokumen_catatan`.
4. Sistem INSERT baris `aksi = 'beri'`, tulis `audit_logs`.
5. *Error path:* validasi bentuk gagal → tolak dengan pesan yang menyebut field mana.

**Flow B — Pencabutan consent**
1. AM membuka toko yang consent-nya aktif, pilih Cabut.
2. `alasan` wajib diisi.
3. Sistem INSERT baris `aksi = 'cabut'`. Baris `'beri'` sebelumnya **tidak diubah**.
4. Efeknya langsung pada pembacaan berikutnya: status turunan berubah, toko keluar dari
   `px_publishable_v` (M3).

**Flow C — Kalibrasi policy**
1. Director membuka halaman Eligibility Policy, melihat versi aktif dan riwayatnya.
2. Director membuat versi baru dengan nilai `jsonb` yang diubah + `catatan` alasan kalibrasi.
3. Sistem INSERT versi baru dengan `aktif = true`, set versi sebelumnya `aktif = false`
   dalam satu transaksi.
4. *Catatan:* versi lama **tidak dihapus**. Verdict lama tetap merujuk versi yang dipakai saat
   dinilai — audit trail utuh.

**Flow D — Evaluasi kelayakan SKU**
1. Fungsi evaluasi menerima `sku_id` dan versi policy aktif.
2. Baca `px_sku_volume` untuk jendela `threshold_window_days`.
3. Tidak ada baris volume, atau nilainya NaN → verdict `eligible = false`,
   `alasan_kode = 'data_kurang'`. **Berhenti.**
4. Volume < `sales_threshold_idr` → `eligible = false`,
   `alasan_kode = 'volume_di_bawah_ambang'`.
5. `commission_floor_pct` tidak `null` dan `commission_pct < floor` → `eligible = false`,
   `alasan_kode = 'komisi_di_bawah_floor'`.
6. `require_stock_in = true` dan `stock_status = 'out'` → `eligible = false`,
   `alasan_kode = 'stok_habis'`.
7. Lolos semua → `eligible = true`, `alasan_kode = 'lolos'`.
8. INSERT ke `px_sku_eligibility`. Jika baris untuk `(sku_id, policy_versi, dinilai_pada)` sudah
   ada, evaluasi **tidak ditulis ulang** (tabel immutable) — kembalikan verdict yang ada.

### 4.4 Example

**Setup.** Klien `CLI-202605-0031` (Toko Bunda Aisyah) punya dua toko:

| client_platform_id | platform | shop_id | store_link |
|---|---|---|---|
| 4821 | tiktok | 7495283910 | (URL) |
| 4822 | shopee | *(kosong)* | (URL) |

Klien setuju agency plan **hanya untuk toko TikTok**.

**Flow A.** AM mencatat consent untuk `client_platform_id = 4821`, `agency_plan_ref = 'TAP-99812'`,
`berlaku_sampai = NULL`.

Ledger `px_consents`:

| id | client_platform_id | aksi | berlaku_sampai | agency_plan_ref | alasan |
|---|---|---|---|---|---|
| 1 | 4821 | beri | NULL | TAP-99812 | NULL |

Toko Shopee (4822) **tidak punya baris apa pun**. SKU-nya tidak akan pernah diproses. Ini yang
dijaga D-08 — consent per klien akan salah menarik toko Shopee ikut masuk.

**Flow D — evaluasi tiga SKU dari toko 4821** (policy versi 1: ambang Rp 200jt, per SKU, 30 hari,
tanpa floor):

| SKU | volume 30 hari | commission_pct | stock | verdict | alasan_kode |
|---|---|---|---|---|---|
| Sepatu Lari X | Rp 380.000.000 | 8,5 | in | **layak** | lolos |
| Sandal Y | Rp 74.000.000 | 12,0 | in | tidak layak | volume_di_bawah_ambang |
| Sepatu Anak Z | *(tidak ada data)* | 9,0 | in | tidak layak | **data_kurang** |

Perhatikan baris ketiga. Tanpa Rule 13 dan 14, SKU ini akan dinilai "volume nol ⇒ di bawah ambang"
dan tertutup permanen — padahal yang sebenarnya terjadi adalah laporannya belum masuk. Kode alasan
`data_kurang` membuatnya masuk antrean tindak lanjut AM, bukan antrean penolakan.

**Skenario kalibrasi.** Tiga bulan kemudian ternyata hanya 12 SKU yang lolos di seluruh basis klien
— terlalu sedikit. Director membuat policy versi 2 dengan `sales_threshold_idr = 150000000`.
Verdict lama tetap merujuk versi 1; evaluasi berikutnya memakai versi 2. Nol migrasi, nol perubahan
skema, riwayat keputusan utuh.

### 4.5 System Requirements

**Konvensi rumah CDPS yang wajib diikuti**
- `varchar` + `CHECK (… IN (…))`, **bukan** `CREATE TYPE`. CDPS punya nol enum Postgres.
- ID memakai `bigint identity` (D-14), **bukan** prefix `PXS-`. Preseden: `client_reports`.
- **Tidak** menambah baris ke `entity_prefix` maupun `PREFIXES` di `packages/core/src/ident.ts`.
- Angka gerbang rilis di `scripts/db-rebuild.sh` dan `.github/workflows/ci.yml` **wajib dinaikkan
  di commit yang sama** dengan migrasi yang menambah tabel. M2 menambah 4 tabel → hitungan tabel
  dasar naik dari 146 ke 150. Lupa menaikkan = CI merah.
- Helper SECURITY DEFINER ditempatkan di schema `private`.
- RLS untuk tabel config = **nol policy** (default-deny), dibaca hanya service role.
- Parsing dilakukan di browser; server menerima array-of-arrays, **bukan** berkas. `packages/core`
  tetap bebas DOM dan bebas dependency.

**Tabel `px_consents`**

| Field | Tipe | Wajib | Validasi |
|---|---|---|---|
| `id` | `bigint identity` | ya | PK |
| `client_id` | `varchar(32)` | ya | FK `clients(id)` |
| `client_platform_id` | `bigint` | ya | FK `client_platforms(id)` |
| `aksi` | `varchar(8)` | ya | CHECK `IN ('beri','cabut')` |
| `berlaku_sampai` | `date` | tidak | NULL = tanpa batas |
| `agency_plan_ref` | `text` | kondisional | Wajib bila `aksi='beri'` |
| `dokumen_catatan` | `text` | tidak | |
| `alasan` | `text` | kondisional | Wajib bila `aksi='cabut'` |
| `created_at` | `timestamptz` | ya | Default `now()` |
| `created_by` | `varchar(64)` | ya | FK `employees(employee_id)` |

- CHECK bentuk:
  `(aksi='beri' AND alasan IS NULL AND agency_plan_ref IS NOT NULL) OR (aksi='cabut' AND berlaku_sampai IS NULL AND dokumen_catatan IS NULL AND alasan IS NOT NULL)`
- Trigger `forbid_mutation()` pada UPDATE **dan** DELETE
- Index: `(client_platform_id, id DESC)` untuk query status turunan

**View `px_consent_status_v`**
```
distinct on (client_platform_id) client_platform_id, client_id, aksi, berlaku_sampai, agency_plan_ref, created_at
from px_consents order by client_platform_id, id desc
```
Konsumen menyaring `aksi='beri' AND (berlaku_sampai IS NULL OR berlaku_sampai >= current_date)`.

**Tabel `px_eligibility_policy`**

| Field | Tipe | Wajib | Validasi |
|---|---|---|---|
| `versi` | `integer` | ya | PK, CHECK `>= 1` |
| `nilai` | `jsonb` | ya | Skema di bawah |
| `aktif` | `boolean` | ya | Default `true` |
| `catatan` | `text` | tidak | Alasan kalibrasi |
| `dibuat_pada` | `timestamptz` | ya | Default `now()` |
| `dibuat_oleh` | `varchar(64)` | ya | FK `employees(employee_id)` |

- Partial unique index: `UNIQUE (aktif) WHERE aktif = true`
- Trigger `forbid_mutation()` pada UPDATE dan DELETE
- RLS: nol policy (default-deny)

Bentuk `nilai` versi 1 (seed):
```json
{
  "sales_threshold_idr": 200000000,
  "threshold_basis": "per_sku",
  "threshold_window_days": 30,
  "commission_floor_pct": null,
  "require_stock_in": true,
  "platforms": ["tiktok"]
}
```

**Tabel `px_sku_volume`** — isolasi D-06

| Field | Tipe | Wajib | Validasi |
|---|---|---|---|
| `id` | `bigint identity` | ya | PK |
| `sku_id` | `bigint` | ya | FK `px_sku(id)` (M3) `ON DELETE CASCADE` |
| `periode_mulai` | `date` | ya | |
| `periode_akhir` | `date` | ya | CHECK `>= periode_mulai` |
| `units_sold` | `integer` | tidak | NULL = tidak diketahui, **bukan nol** |
| `gmv` | `numeric(15,2)` | tidak | NULL = tidak diketahui, **bukan nol** |
| `sumber_report` | `bigint` | tidak | FK `client_reports(id)` |
| `created_at` / `created_by` | | ya | |

- `REVOKE ALL … FROM anon, authenticated;` + RLS nol policy
- UNIQUE `(sku_id, periode_mulai, periode_akhir)`
- **Tabel ini tidak pernah menyeberang ke proyek MCN**

> Catatan urutan kerja: `px_sku` milik M3. Untuk M2, buat `px_sku_volume` dan
> `px_sku_eligibility` dengan FK ke `px_sku` yang didefinisikan di migrasi M3, atau kerjakan
> migrasi M2 setelah tabel `px_sku` ada. Keputusan urutan migrasi diserahkan CTO; yang tidak boleh
> adalah membuat `px_sku` versi sementara yang nanti diganti.

**Tabel `px_sku_eligibility`**

| Field | Tipe | Wajib | Validasi |
|---|---|---|---|
| `sku_id` | `bigint` | ya | FK `px_sku(id)` |
| `policy_versi` | `integer` | ya | FK `px_eligibility_policy(versi)` |
| `dinilai_pada` | `date` | ya | |
| `eligible` | `boolean` | ya | |
| `alasan_kode` | `varchar(32)` | ya | CHECK `IN ('lolos','volume_di_bawah_ambang','komisi_di_bawah_floor','stok_habis','data_kurang')` |

- PK: `(sku_id, policy_versi, dinilai_pada)`
- Trigger `forbid_mutation()` pada UPDATE dan DELETE
- **Nol kolom volume.** Verdict recomputable dari `(px_sku_volume, policy_versi)`

**Perubahan pada tabel yang sudah ada**
- `client_platforms`: tambah `shop_id text NULL` + index. **Nullable**, karena toko lama belum
  punya dan tidak boleh memblokir operasi berjalan. Diisi AM saat mencatat consent (D-04, Rule 8).

**Izin baru**
`px.consent.read`, `px.consent.write`, `px.policy.read`, `px.policy.write` (director saja).

**Non-functional**
- Evaluasi kelayakan untuk 500 SKU < 5 detik.
- Semua pesan validasi dalam Bahasa Indonesia, mengikuti pola `sm_machines.block_message`.

---

## 5. Open Assumptions

Wajib dijawab sebelum coding modul terkait.

| # | Asumsi | Modul | Penjawab |
|---|---|---|---|
| A-01 | `price_segment_t` di MCN memuat nilai yang cukup untuk seluruh rentang harga SKU agency. Belum diverifikasi terhadap sebaran harga produk klien | M1 | Hans |
| A-02 | `creator_subcat_segment_gmv.level2_category` konsisten tanpa varian ejaan/kapitalisasi. Kalau tidak, registry akan punya baris duplikat semu | M1 | Hans |
| A-03 | Ingest mingguan MCN punya titik akhir yang jelas untuk memicu recompute. Kalau pipeline-nya bercabang, titik pemicunya perlu ditentukan | M1 | Hans |
| A-04 | CM Lead adalah role yang tepat untuk mengisi `slots_total`, dan mereka punya dasar menilainya. Kalau tidak, angka awal akan sembarang | M1 | Lukman (Sr SPV MCN) |
| A-05 | `agency_plan_ref` adalah ID kampanye TAP/SAP yang dapat dicatat AM saat itu juga. Kalau ID baru terbit belakangan, Flow A butuh status sementara — dan itu bertentangan dengan Rule 3 | M2 | Anty (Head of Account) |
| A-06 | AM dapat memperoleh `shop_id` platform untuk toko klien tanpa akses khusus. Kalau butuh akses seller center, Flow A langkah 2 jadi hambatan nyata | M2 | Anty |
| A-07 | Tidak ada klien yang saat ini punya lebih dari satu `client_platform` aktif pada platform yang sama. Kalau ada, definisi "satu toko satu platform" perlu diperjelas | M2 | Hans |
| A-08 | `client_reports.payload` memuat baris per-SKU **[STATUS: terjawab sebagian]** — datanya ada di tarikan platform tapi belum dipersist. M3 perlu menambah titik tulis di jalur parse | M3 | Hans — **lihat catatan di bawah** |
| A-09 | Ketiga tools (AM Baseline, AM Co-pilot, report engine) melewati jalur parse yang sama di `packages/core` **[dinyatakan Yohan: ya]**. Perlu konfirmasi di kode sebelum M3 | M3 | Hans |
| A-10 | `optimization_tracker` (PK `screening_id, product_code`) mungkin dapat dipakai ulang sebagai basis master SKU, memotong sebagian M3 | M3 | Hans |

**Catatan A-08/A-09/A-10.** Perkiraan Yohan: 20–40 SKU di seluruh basis klien yang tembus
Rp 200jt/bulan. Cukup untuk pilot 10 SKU, jadi ambang Rp 200jt terkonfirmasi tidak perlu
diturunkan. Sebelum PRD M3 ditulis, dibutuhkan **daftar field yang dikonsumsi dan dihasilkan
masing-masing dari tiga tools** — ini yang menentukan bentuk tabel lapisan data bersama, dan
tabel yang salah bentuk akan mahal diubah setelah berisi data.

---

## 6. Success Metrics

**M1 — Creator Capability Registry**

| Metrik | Target | Kenapa metrik ini |
|---|---|---|
| Activation event | ≥ 25 kreator punya `slots_total > 0` pada ≥ 1 kombinasi, dalam 7 hari kerja setelah rilis | Registry tanpa kapasitas terisi = tabel kosong yang tidak menyaring apa pun |
| Coverage terdefinisi | ≥ 1 kombinasi `(level2, segment)` berstatus `covered` dengan `total_slots_available ≥ 10` | Ini kategori yang dipakai Phase 1. Tanpanya pilot tidak punya lahan |
| Akurasi recompute | `last_computed_at` ≤ 8 hari untuk 100% baris | Data kapabilitas basi akan menyaring dengan kriteria yang salah |
| Leading indicator | Coverage map diekspor/dibuka AM ≥ 1× per minggu | Registry yang tidak dibaca AM tidak mengubah perilaku penawaran |

**M2 — Consent & Eligibility Policy**

| Metrik | Target | Kenapa metrik ini |
|---|---|---|
| Activation event | ≥ 3 klien-toko punya consent aktif dengan `shop_id` terisi, dalam 14 hari kerja | Tanpa consent, M3 tidak punya data yang sah untuk diproses |
| Kelengkapan `shop_id` | 100% toko yang punya consent aktif juga punya `shop_id` | Ditegakkan Rule 8; kalau ada yang lolos, ada bug di gate |
| Kualitas verdict | Proporsi `alasan_kode = 'data_kurang'` ≤ 30% dari SKU yang dievaluasi | Di atas itu berarti masalahnya bukan kelayakan SKU tapi pipeline data — dan menambah SKU tidak akan menolong |
| Integritas ledger | Nol percobaan UPDATE/DELETE berhasil pada `px_consents` dan `px_eligibility_policy` | Dibuktikan tes otomatis, bukan pemeriksaan manual |

**North-star kedua modul.** Bukan jumlah baris registry maupun jumlah consent. North-star-nya
adalah gerbang Phase 1: **≥ 8 dari 10 SKU mencapai status `[Aktif]` dalam 21 hari** sejak
ditawarkan, di mana `[Aktif]` berarti ada GMV afiliasi > 0 yang teratribusi. M1 dan M2 adalah
prasyarat, bukan pencapaian.

---

## Lampiran — Definition of Done

**M1**
- [ ] Tabel `bridge.px_creator_capability` + CHECK + generated column + index
- [ ] Fungsi `bridge.px_coverage_map()`
- [ ] Job recompute `proven_*`, dipicu dari akhir pipeline ingest
- [ ] Halaman Registry (editable, bulk ≥ 50 baris) + tab Coverage (read-only, export CSV)
- [ ] Restrictive policy `not is_creator_user()` + REVOKE dari `anon`/`authenticated`
- [ ] Izin `px.capability.read` / `px.capability.write`
- [ ] Tes: over-commit ditolak DB · recompute gagal tidak mengosongkan nilai lama · kreator tidak bisa membaca tabel

**M2**
- [ ] Tabel `px_consents`, `px_eligibility_policy`, `px_sku_volume`, `px_sku_eligibility` + trigger beku
- [ ] View `px_consent_status_v`
- [ ] Kolom `client_platforms.shop_id` + index
- [ ] Fungsi evaluasi kelayakan dengan tiga hasil (layak / tidak layak / data kurang)
- [ ] Halaman consent per klien + halaman policy (director)
- [ ] Seed policy versi 1
- [ ] Angka gerbang `db-rebuild.sh` + `ci.yml` dinaikkan **di commit yang sama** (146 → 150)
- [ ] Izin `px.consent.*` / `px.policy.*`
- [ ] Tes: UPDATE/DELETE ditolak · `data_kurang` vs `volume_di_bawah_ambang` terpisah benar · kontrak NaN dipakai (bukan 0) · consent `'beri'` ditolak tanpa `shop_id` · `px_sku_eligibility` nol kolom volume
