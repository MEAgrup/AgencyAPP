# HANDOFF — PDT (Pusat Data Toko) SESI 42 → SESI 43

> **Dibuat 2026-09-19.** Sesi ini **BUKAN** mode otonom: pemilik (Yohan Agustian/CEO) memberi
> empat tiket eksplisit dan mengunggah tiga ZIP sample ekspor platform NYATA, dengan instruksi
> *"Ini adalah satu-satunya data yang ada, petakan semua berdasarkan data ini saja. Selesaikan 4
> task ini, interview kalau dibutuhkan"*. Empat ketokan diambil lewat `AskUserQuestion`, dicatat
> `docs/DECISIONS.md` 2026-09-19.

---

## 0. Apa yang terjadi sesi ini (ringkasan padat)

1. **Temuan terbesar sesi ini bukan salah satu dari empat tiket itu.** Saat memetakan sample untuk
   G3-06, simulasi pipeline penuh (deteksi → `validasiKolomWajib` → ekstraksi → rekonsiliasi Rule
   13/14) atas **78 berkas nyata dari 12 klien** membuktikan: **0 dari 10 klien bisa mencapai
   `verified`, di KEDUA platform** — bukan karena angkanya meleset, tapi karena **lima ejaan
   `kolomDipanen` tidak pernah cocok dengan satu pun berkas nyata**. Karena `kolomDipanen` = kolom
   WAJIB, setiap berkas yang terkena jatuh ke `parse_status='gagal'` lalu dibuang dari `terparse`
   seluruhnya. Sesudah koreksi: **10 dari 10 klien `verified`, ΔGMV 0,0000%** (TikTok juga
   ΔPesanan 0,0000%) — nol persis, bukan sekadar di bawah ambang 0,5%.
2. **G3-06 `tipeKampanye` — DITUTUP PENUH.** Bersumber fakta berkas (kolom konfigurasi kampanye
   yang memang ada, namanya berbeda per modul), bukan dari `pdt_fact_ads.sumber` yang sesi 40
   tolak — dan `sumber` memang tetap ditolak.
3. **G4-03 aksi 4 — lapisan FAKTA dibangun (`pdt_fact_promo`), NOL aksi katalog.** Ketokan
   pemilik: "Tulis fakta dulu, aksi menyusul". Rule 30 tetap **3 dari ≥6**.
4. **G3-10 — TETAP diblokir**, tapi premis blokirnya berubah (lihat §3).
5. **G-TTAFF-BARIS-GANDA — TETAP TERBUKA.** Ketiga ZIP dipindai seluruhnya: **nol berkas cocok
   modul `tt_affiliate_video`**. Ketokan pemilik: "Tetap terbuka + saya tulis panduan berkasnya" —
   spesifikasi ekspor yang dibutuhkan kini tertulis eksplisit (§4).

**Migrasi sesi ini: 3** (`20261120010000` G3-06, `20261121010000` G4-03 aksi 4, `20261122010000`
koreksi registry DB). Gate tabel **183 → 184**. `db-rebuild.sh --yes`: **273 migrasi**, semua gate
+ 4 invariant lolos.

> ⚠️ **Ketiga ZIP sample berisi DATA KLIEN NYATA dan TIDAK di-commit.** Yang masuk repo hanya
> **nama kolomnya** (`header-nyata.fixture.ts`) — nol baris data.

---

## 1. Lima ejaan whitelist yang memblokir SELURUH jalur `verified`

| Modul | Tertulis (salah) | Berkas nyata |
|---|---|---|
| `shopee_ads_live` | `Omzet` | `Omzet Penjualan` |
| `shopee_ads_live` | `Efektivitas Iklan` | `Efektifitas Iklan` (ejaan Shopee, dengan **f**) |
| `tt_product_analytics` | `AOV` | `AOV (pesanan SKU)` |
| `tt_product_analytics` | `CTOR` | `CTOR (pesanan SKU)` |
| `shopee_parent_sku` | `Tingkat Pesanan Berulang` | `Tingkat Pesanan Berulang (Pesanan Dibuat)` |

`tt_product_analytics.CTR` **sengaja tetap polos** — kolom itu memang benar bernama `CTR`; hanya
AOV/CTOR yang bersufiks. Ejaan lama jadi alias (Rule 9, append-only).

### 1.1 Bug tingkat dua yang ikut ketahuan

**Alias selama ini HANYA dibaca `validasiKolomWajib`, tidak pernah oleh satu pun `ekstrakBaris*`.**
Jadi sebuah alias membuat `parse_status` hijau sementara kolomnya **diam-diam terbaca `null`** —
kegagalan senyap yang lebih buruk daripada gagal terang-terangan. Ini sudah aktif menelan
`tt_live` `Kreator`→`Nama panggilan` sejak alias pertama diseed.

Perbaikannya `pencariKolom(header, modulKode)` (`packages/core/src/pdt/fakta.ts`) — satu pencari
sadar-alias, dipasang ke empat ekstraktor yang memang punya alias (`shopee_ads_live`, `tt_live`,
`tt_product_analytics`, `shopee_kesehatan`).

### 1.2 Kenapa tes lama tidak bisa menangkapnya, dan apa penggantinya

Tes lama **menulis fixture-nya sendiri DARI `kolomDipanen`**. Ia membuktikan registry konsisten
dengan dirinya sendiri; secara struktural ia tidak akan pernah bisa menangkap kelas kegagalan ini.

Penggantinya **membalik arah pengujian**: header datang dari berkas, registry yang wajib
menyesuaikan.
- `packages/core/src/pdt/header-nyata.fixture.ts` — korpus header NYATA: **24 modul, 28 varian,
  12 klien**, nama kolom saja.
- `packages/core/src/pdt/header-nyata.test.ts` — **31 tes**: kolom wajib ada untuk setiap varian
  (dengan alias), deteksi tidak ambigu, dan satu-satunya penurunan ke kolom-opsional
  didokumentasikan eksplisit (`tt_shop_analytics: Pengembalian dana` — ekspor TikTok yang lebih
  baru menghapus kolom itu, sample Avitaskin yang lebih lama masih punya).

> **`meta_ads` SENGAJA tidak dikoreksi kanoniknya.** Kedua ejaan (`CTR Unik (rasio klik tayang
> tautan)` dan `CTR (rasio klik tayang tautan)`) sama-sama NYATA di periode yang SAMA, 3 klien
> masing-masing. Itu bukan salah eja — itu dua varian ekspor Meta yang hidup berdampingan.

### 1.3 Registry DB ikut dikoreksi (jangan lupakan ini)

`pdt_parser_modul`/`pdt_kolom_alias` adalah registry kedua yang "hidup di DB, bukan di kode", dan
`packages/db/src/pdt.registry.test.ts` menegakkan keduanya set-equal dengan TS. Koreksi TS saja
**memecahkan dua tes itu** — migrasi `20261122010000` yang membawa sisi DB ikut. Pola sama
`20261019010000`/`20261107010000`. `versi` sengaja TIDAK dinaikkan (tes menegakkan `versi === 1`
untuk seluruh modul).

---

## 2. G3-06 `tipeKampanye` — DITUTUP PENUH

Sesi 40 menolak `pdt_fact_ads.sumber` sebagai sumber taksonomi karena ia nama MODUL PARSER, bukan
konfigurasi kampanye. **Penolakan itu masih berlaku.** Yang berubah: sample nyata membuktikan
berkas iklan memang MEMUAT kolom konfigurasi kampanye, hanya namanya berbeda per modul.

| Modul | Kolom sumber | Contoh isi |
|---|---|---|
| `shopee_ads_live` | `Tujuan` | (apa pun) → selalu `live_ads` |
| `shopee_ads_cpc` | `Mode Bidding` | 'GMV Max' → `gmv_max` |
| `shopee_ads_search` | `Mode Bidding` | 'Manual' → `manual_keyword`; 'Otomatis' → `auto` |
| `tt_ads_product` | `Jenis materi iklan` | 'Video' → `video_ads`; 'Kartu produk' → `lainnya` |
| `tt_ads_live` | — (nol kolom konfigurasi) | menulis `null`; tipenya sudah tertentu dari modulnya |

- **Kolom `pdt_fact_ads.tipe_kampanye_sumber` menyimpan teks MENTAH**, bukan hasil pemetaan —
  supaya pemetaannya bisa dikoreksi kapan saja tanpa re-upload (house convention #4).
- **Pemetaan hidup di SATU tempat**, `strategi.ts` `petakanTipeKampanye` — `CAMPAIGN_TYPES` tidak
  boleh punya dua rumah. `shopee_ads_live` diperiksa **SEBELUM** cabang `gmv_max`, karena berkas
  live Shopee juga bisa menulis "GMV Max" di `Tujuan`.
- **`affiliate_ads` TIDAK dipetakan dari modul iklan mana pun** — nol berkas menyatakannya.
- **Teks tak dikenal → `null`, BUKAN `lainnya`.** "Tidak tahu" tidak dilipat jadi "kategori lain".
- `ringkasIklanDariFakta` mengembalikan `CampaignType[] | null` terurut mengikuti `CAMPAIGN_TYPES`;
  `null` ⇒ Section B jatuh ke payload AM — **strangler coexistence**, sama seperti G3-07.

---

## 3. G3-10 — masih diblokir, tapi premisnya berubah

Sebelum sesi ini backlog membaca seolah G3-10 hanya menunggu gerbang **bisnis** "≥10 klien
verified", seakan jalur teknisnya sudah siap. §1 membuktikan sebaliknya: **jalur teknisnya sendiri
tidak pernah bisa lulus**. Kini ia terbuka untuk pertama kalinya.

**Yang tersisa memang tinggal gerbang bisnisnya** — 10 klien nyata di-upload ke sistem PRODUKSI,
bukan disimulasikan dari ZIP. Dan **jangan membaca "0/10" historis sebagai bukti PDT tidak akurat**:
akurasinya nol persen selisih begitu whitelist-nya benar.

### 3.1 🔒 Ketokan pemilik: AM Baseline TETAP HIDUP, permanen

Pemilik memutuskan **AM Baseline tidak dimatikan** — juga tidak otomatis mati begitu gerbang ≥10
klien tercapai. Tiket G3-10 berubah bentuk: dari "matikan AM Baseline" jadi **"PDT jadi sumber
utama, AM Baseline jadi jaring pengaman permanen"**.

Konsekuensi teknis yang langsung berlaku: pola **strangler coexistence** yang sudah dipakai G3-07
(nol batch verified ⇒ jatuh ke `riwayat` payload) dan G3-06 (`tipeKampanye === null` ⇒ jatuh ke
payload AM) adalah **bentuk akhir yang disengaja**, bukan tahap transisi. **Jangan buat tiket
lanjutan yang "membereskan" fallback itu.** Iframe `video-factory.html` tetap.

Alasannya nyata dan baru saja terbukti: §1 adalah kegagalan SENYAP yang membuat 0/10 klien tidak
bisa `verified` tanpa satu pun error. Kalau AM Baseline sudah mati saat itu terjadi, Riset Awal
akan kosong total tanpa jalan mundur. Mematikannya nanti butuh ketokan pemilik BARU + entri
`DECISIONS.md` tersendiri.

---

## 4. G-TTAFF-BARIS-GANDA — tetap terbuka; INI berkas yang dibutuhkan

Ketiga ZIP dipindai seluruhnya: **nol berkas cocok modul `tt_affiliate_video`**. Yang ada hanya
ekspor sisi **SELLER** (Seller Center); M9-OA-4 butuh ekspor sisi **PARTNER/MCN**. Tiket ini tidak
bisa ditutup dengan data yang ada.

**Spesifikasi berkas yang dibutuhkan** (ditulis supaya ekspor berikutnya tidak meleset lagi):

| Hal | Nilai |
|---|---|
| Sumber | TikTok Shop **Affiliate** (bukan Seller Center) |
| Menu | **Custom report** |
| Bahasa header | **Inggris** |
| Kolom wajib | `Affiliate video-attributed GMV`, `Video ID` |
| Periode | **yang GMV-nya TIDAK nol** ← ini yang paling sering meleset |

Sample Anjalie Factory yang sudah ada **seluruh kolom uangnya `Rp0`**, itulah sebabnya pemisah
ribuan/desimal sisi partner belum terverifikasi. Satu berkas yang benar memverifikasi DUA hal
sekaligus: (i) apakah aturan pilih-satu-baris (GMV terbesar → views terbesar → follower terbesar →
kemunculan pertama, **tidak pernah menjumlah**) benar untuk baris ganda per `Video ID`, dan
(ii) format angka uang sisi partner.

**Nol perubahan kode** untuk tiket ini sesi ini — parser tetap konservatif. Menjumlah baris ganda
terbukti melampaui total platform **59%**.

---

## 5. G4-03 aksi 4 — lapisan fakta, bukan aksi

**Premis "modul ini sengaja UNVERIFIED" GUGUR.** Catatan G1-02 ("hanya terselesaikan lewat NAMA
BERKAS MENTAH, yang Rule 6 larang") benar pada sample TUNGGAL Fim Motor; pada 6 klien nyata
`shopee_diskon` menang tunggal lewat (`Tanggal`+`Tipe Promosi`) dan `shopee_flash_sale` lewat
(`Periode Waktu`+`Jumlah Produk Dilihat`) — **nol ambiguitas di 6 dari 6 berkas**.

**Dibangun:** `pdt_fact_promo` (satu tabel, kolom `jenis` `diskon`/`flash_sale`,
replace-on-recommit per (toko, jenis, periode)); dua ekstraktor baru; routing di `commitUploadBatch`
DAN `reparsePdtBatch`.

### ⚠️ Baris `Tipe Promosi='Semua'` MEN-DEDUP, bukan menjumlah

Ini hanya ketahuan **karena ada klien kelima**. Pada 5 dari 6 klien, Σ(Diskon + Paket Diskon +
Kombo Hemat) KEBETULAN sama persis dengan baris 'Semua', yang membuat "jumlahkan saja komponennya"
tampak benar. Pada Nubutik tidak:

| Baris | Penjualan | Pesanan |
|---|---|---|
| `Semua` | Rp354.987.431 | 2.019 |
| `Diskon` | Rp318.741.842 | 1.926 |
| `Paket Diskon` | Rp125.702.470 | 412 |
| `Kombo Hemat` | Rp0 | 0 |
| **Σ komponen** | **Rp444.444.312** | **2.338** ← **25% DI ATAS total sebenarnya** |

Sebabnya nyata, bukan kesalahan ekspor: **satu pesanan bisa membawa lebih dari satu tipe promosi
sekaligus**, jadi ia tercatat di kedua baris komponen dan dihitung SEKALI di 'Semua'. Itulah
gunanya baris 'Semua' ada. **Menjumlahkan baris `pdt_fact_promo` adalah bug** kelas
`G1-07-SHOPEE-DOBEL-HITUNG` — diperingatkan di `COMMENT ON COLUMN`, docblock ekstraktor, dan
docblock writer.

### ⚠️ Ejaan kolom uang BERBEDA antar kedua modul

Diskon memakai `' (IDR)'` (**dengan** spasi), flash sale memakai `'(Rp)'` (**tanpa** spasi).
Menyalin ejaan yang satu ke yang lain menghasilkan seluruh kolom `null` **tanpa satu pun error** —
kelas kegagalan senyap yang sama dengan §1.

Bentuknya ditegakkan **di DB** (`CHECK`: flash sale tidak pernah punya `tipe_promosi`, diskon tidak
pernah punya funnel `produk_dilihat`/`produk_diklik`), bukan hanya di TS.

### Kenapa aksi katalognya TIDAK dikodekan

Riset kode memastikan **NOL** angka ambang diskon/flash-sale di `pdt_benchmark` MAUPUN
`report_benchmark_shopee` untuk platform mana pun — situasi yang sama persis dengan aksi 5 (GMV
live) yang pemilik tunda sesi 42. Mengarang ambang `good`/`warn` melanggar house convention #4.
**Rule 30 tetap 3 dari ≥6.**

---

## 6. Temuan yang dicatat tapi TIDAK dikerjakan (kandidat tiket berikutnya)

1. **`[aff]-Product` Pawlovin ber-header BAHASA INGGRIS** — deteksi `shopee_ams_produk` gagal untuk
   berkas itu. Satu klien dari enam; belum jelas apakah ini varian ekspor Shopee yang sah atau
   pilihan bahasa akun. Butuh satu sample lagi sebelum dialiaskan.
2. **`[promo]-Voucher` Pawlovin mis-ekspor** — isinya bukan voucher.
3. **Sajira: 146 baris `ID Video` byte-identical duplikat** — diverifikasi **aman**, writer
   `pdt_fact_content` memakai `ON CONFLICT DO UPDATE`. Dicatat supaya tidak dikira korupsi data.

---

## 7. Verifikasi sesi ini

- `scripts/db-rebuild.sh --yes` — **273 migrasi**, gate (tabel **184**/prefix 45/mesin 35/notif 79)
  + 4 invariant SQL lolos.
- `scripts/check-migration-versions.sh` — nol tabrakan baru.
- `npm test --workspaces` — core **1547**, domain **2889** (+7 baru, 1 skip pra-ada), db **110**,
  api hijau.
- `npm run typecheck --workspaces` — bersih di keempat paket.

### 7.1 ⚠️ Live `CDPS SG` BELUM di-apply — sengaja, butuh ketokan pemilik

Sesi ini **TIDAK** berjalan di mode otonom, jadi tiga migrasi sesi ini **tidak** didorong ke live.
Diperiksa lewat `list_migrations` pada `egddxfcnrtecheiykhlf`: migrasi terakhir di live adalah
`20261118010000_o75_service_closure_twostep`. Yang belum mendarat:

| Migrasi | Asal |
|---|---|
| `20261119010000_g1_08_sebagian_kolom_opsional` | **sesi SEBELUMNYA** — sudah tertinggal sebelum sesi ini |
| `20261120010000_g3_06_tipe_kampanye_sumber` | sesi ini |
| `20261121010000_g4_03_aksi4_fakta_promo` | sesi ini |
| `20261122010000_g1_02_koreksi_kolom_dipanen_dan_alias` | sesi ini |

Ketiganya aman-maju (satu kolom nullable, satu tabel baru, satu UPDATE/INSERT registry) dan tidak
menyentuh data yang ada. **Terapkan lewat `apply_migration`, jangan `psql -f`, dan jangan
`supabase db push`** (mati di pasangan prefix pertama, SQLSTATE 23505 — `CLAUDE.md`).

> ⚠️ **Sampai `20261122010000` mendarat di live, registry DB live masih memuat lima ejaan yang
> salah** — artinya jalur `verified` di PRODUKSI masih tertutup persis seperti §1, walau kode
> TS-nya sudah benar. Ini yang paling mendesak dari keempatnya.

> 🧯 **Pelajaran operasional:** menjalankan dua suite vitest SEKALIGUS terhadap satu Postgres lokal
> mencemari DB (deadlock + baris `ZZ-%` yatim) dan menghasilkan ratusan kegagalan palsu yang
> **terlihat seperti regresi**. Kalau muncul badai kegagalan FK/duplicate-key: `db-rebuild.sh --yes`
> dulu, jalankan suite **satu per satu**, baru percaya hasilnya.
