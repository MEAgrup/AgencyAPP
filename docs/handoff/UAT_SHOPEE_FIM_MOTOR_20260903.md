# UAT SH-07 — laporan Shopee dari export ASLI (Fim Motor, Juli 2026)

**Tanggal:** 2026-09-03 · **Data:** diberikan Nerissa (COO), 15 berkas export
Shopee Seller Centre toko **Fim Motor** (`fim_motor`, ID Toko 938284780),
periode **01–31 Juli 2026**
**Kenapa ada:** sisa Gelombang 1 yang belum pernah ditutup — sampai sesi ini,
**setiap** verifikasi mesin laporan (TikTok maupun Shopee) memakai fixture.
Belum ada satu laporan pun dari export sungguhan.

**Cara diuji:** jalur produksi persis — langkah browser (`parseShopeeExportFile`:
semua worksheet + penanda `__SHEET__:`) direplikasi di node, lalu
`report.createReportShopee` di DB lokal hasil `db-rebuild.sh` (171 migrasi).
Bukan memanggil engine langsung: yang diuji adalah rantai
parse → deteksi → skor → simpan → atribusi, sama seperti yang dipanggil rute
`POST /clients/{id}/reports/shopee`.

---

## 1. Verdict

**Engine LOLOS.** Laporan terbentuk penuh dari 15 berkas asli, skor terhitung,
dan **setiap angka yang dicek ulang ke berkas mentah cocok persis**. Tidak ada
crash, tidak ada kolom yang gagal terbaca, tidak ada `NaN` yang lolos ke
payload.

**Tiga hal butuh keputusan pemilik** (§4) — bukan bug kode, tapi pilihan
bisnis yang saat ini diambil diam-diam oleh implementasi.

> **⚠️ §2–§4 memotret keadaan SEBELUM perbaikan.** Ketiga temuan sudah dijawab
> pemilik dan ditindaklanjuti pada hari yang sama — hasilnya, termasuk UAT yang
> dijalankan ULANG dengan kode baru, ada di **§7**. Baca §7 untuk keadaan
> sekarang; §2–§4 tetap ada sebagai dasar keputusannya.

---

## 2. Angka yang dihasilkan, dan cek-ulangnya ke berkas mentah

| Yang dilaporkan engine | Nilai | Cek ulang ke berkas mentah | Cocok? |
|---|---|---|---|
| GMV | Rp 1.624.937.476 | sheet `Pesanan Dibuat` kolom *Total Penjualan (IDR)* = `1.624.937.476` | ✅ persis |
| Pesanan | 13.568 | sheet yang sama, *Total Pesanan* | ✅ persis |
| CR toko | 2,46% | sheet yang sama, *Tingkat Konversi Pesanan* = `2,46%` | ✅ persis |
| AOV | Rp 119.762 | *Penjualan per Pesanan* = `119.762,49` | ✅ (dibulatkan) |
| Pembeli / repeat | 11.452 / 12,97% | *Pembeli* `11.452`, *Tingkat Pembelian Berulang* | ✅ |
| Batal | 2.785 pesanan / Rp 359.295.534 | *Pesanan Dibatalkan* `2785` | ✅ |
| Retur | 140 pesanan / Rp 24.586.464 | *Pesanan Dikembalikan* `140` | ✅ |
| Ads spend | Rp 133.342.120 | Σ Biaya seluruh berkas iklan | ✅ |
| Ads omzet | Rp 1.284.165.288 | Σ Omzet seluruh berkas iklan | ✅ |
| ROAS | 9,63× | 1.284.165.288 ÷ 133.342.120 = 9,631 | ✅ dihitung ulang |
| ACOS | 10,38% | 133.342.120 ÷ 1.284.165.288 = 10,38% | ✅ dihitung ulang |
| CTR ads | 4,43% | — (agregat lintas berkas) | — |
| Skor | 5,7 → **KRITIS** | ambang `skor.ts`: ≥8 SEHAT, ≥6 PERLU PERHATIAN, <6 KRITIS | ✅ konsisten dengan ambangnya |
| Benchmark | `report_benchmark_shopee` versi 1 | terisi, jadi skor recomputable (aturan rumah #4) | ✅ |

**Rincian skor** (bobot × nilai): ROAS & Channel 10 (.22) · Traffic Quality 5,6
(.22) · Conversion & Retention **0,9** (.18) · Product Performance 6,2 (.14) ·
Live Streaming 5 (.12) · Kesehatan Toko (.12) → total **5,7**.

Catatan kecil, bukan temuan: `Penjualan dari Iklan Shopee` di shop-stats
(Rp 1.284.330.288) berbeda **Rp 165.000** dari Σ berkas iklan yang dipakai
engine (Rp 1.284.165.288). Dua sumber berbeda — shop-stats mengatribusi per
pesanan, berkas iklan melaporkan per kampanye — jadi selisih 0,013% wajar.
Kalau pemilik mau keduanya identik, itu keputusan sumber angka, bukan bug.

---

## 3. Temuan operasional: deteksi otomatis TIDAK bisa diandalkan pada nama berkas MENTAH

Nama berkas asli Seller Centre **bukan** konvensi tim
(`[bisnis]-Home && Juli 2026 && Fim Motor && 2026-08-01.xlsx`), jadi
`parseFilename` mengembalikan `null` untuk **seluruh 15 berkas** dan deteksi
jatuh ke tanda-tangan ISI berkas. Hasilnya:

| Berkas asli | Deteksi otomatis | Pemetaan manual (perlu konfirmasi advertiser) | |
|---|---|---|---|
| `fim_motor.shopee-shop-stats.…xlsx` | `bisnis_home` | `bisnis_home` | ✅ |
| `parentskudetail.…xlsx` | `bisnis_produk` | `bisnis_produk` | ✅ |
| `chat_….xlsx` | `layanan_chat` | `layanan_chat` | ✅ |
| `voucher_….xlsx` | `promo_voucher` | `promo_voucher` | ✅ |
| `Data-Semua-Iklan-Live-….csv` | `ads_live` | `ads_live` | ✅ |
| `AMSAffiliatePerformance_….csv` | `aff_creator` | `aff_creator` | ✅ |
| `video-overview-v3_….csv` | `bisnis_video` | `bisnis_video` | ✅ |
| `Laporan-tanpa-judul-….xlsx` | `meta` | `meta` | ✅ |
| `Chat_Broadcast_overview_….xlsx` | **`bisnis_video`** | `layanan_broadcast` | ❌ SALAH SLOT |
| `Data+Keseluruhan+Iklan+Shopee-….csv` | **`aff_creator`** | `ads_toko` | ❌ SALAH SLOT |
| `Search-Ads-Overall-Data-….csv` | **`aff_creator`** | `ads_produk` | ❌ SALAH SLOT |
| `In_Shop_Flash_Sale_Metrics_….xlsx` | — | `promo_flashsale` | ⚠️ tak terdeteksi |
| `ProductPerformance_….csv` | — | `aff_product` | ⚠️ tak terdeteksi |
| `discount_….xlsx` | — | `promo_diskon` | ⚠️ tak terdeteksi |
| `live_streaming_….xlsx` | — | `bisnis_live` | ⚠️ tak terdeteksi |

**8 benar · 3 SALAH SLOT · 4 tak terdeteksi.** Berkas wajib (`bisnis_home`)
terdeteksi benar, jadi laporan tetap terbentuk — dengan 8/17 slot terisi, dan
tiga di antaranya berisi berkas yang salah.

**Kenapa ini lebih berbahaya daripada "tak terdeteksi":** berkas yang tak
terdeteksi hilang dari laporan dan seksinya kosong — kelihatan. Berkas yang
masuk **slot yang salah** membuat seksi Affiliate diisi angka iklan pencarian,
dan tidak ada tanda apa pun di laporan bahwa itu terjadi. Ditambah: dua berkas
bertabrakan di slot `bisnis_video`, jadi salah satunya pasti hilang tergantung
urutan unggah.

**Ini bukan regresi dan bukan cacat implementasi UI.** Engine memang dirancang
mengandalkan konvensi nama berkas tim lebih dulu (`docs/design/README.md`:
"berkas dengan nama rusak memang tidak bisa dikenali, sama seperti di alat
aslinya"), dan form SH-07 sudah punya dropdown modul per berkas justru untuk
kasus ini. Yang temuan ini buktikan: **default "Otomatis (deteksi server)"
tidak cukup untuk export mentah** — AM harus melakukan salah satu dari dua hal,
dan itu perlu jadi instruksi kerja, bukan harapan.

---

## 4. BUTUH KEPUTUSAN PEMILIK

### 4.1 GMV mana yang dilaporkan ke klien: "Pesanan Dibuat" atau "Pesanan Dibayar"?

Berkas shop-stats punya **tiga** bagian; engine memakai yang **pertama**:

| Bagian di berkas | GMV | Pesanan | Dipakai engine? |
|---|---|---|---|
| Pesanan Dibuat | **Rp 1.624.937.476** | 13.568 | ✅ ini yang jadi `gmv_net` |
| Pesanan Siap Dikirim | Rp 1.515.002.476 | 12.801 | diparse, disimpan di payload, tidak dipakai sebagai GMV |
| Pesanan Dibayar | Rp 1.329.227.354 | 11.071 | ❌ **tidak diparse sama sekali** |

Angka yang dipakai memasukkan **Rp 359.295.534 pesanan dibatalkan** dan
**Rp 24.586.464 retur** — Rp 383,9 juta, **23,6%** dari GMV yang dilaporkan,
uang yang tidak pernah masuk. Selisih Dibuat vs Dibayar = **Rp 295.710.122
(18,2%)**.

Ini bukan angka kosmetik: `gmv_net` adalah satu-satunya penulis
`clients.total_sales`, yang dibaca **Health Score M13**. Jadi pilihan ini
menggerakkan skor kesehatan klien, bukan cuma tampilan laporan. Untuk TikTok,
standar MEA eksplisit "GMV Bersih (net)"; untuk Shopee saat ini yang tersimpan
justru angka bruto-nya.

**Opsi:**

| | Untung | Rugi |
|---|---|---|
| **A. Tetap "Pesanan Dibuat"** (sekarang) | sama dengan yang tampil di dashboard Seller Centre, jadi klien tidak bingung; nol perubahan kode | melaporkan Rp 383,9 juta yang tidak jadi duit sebagai penjualan; Health Score M13 ikut kelebihan; kalau klien membandingkan dengan settlement-nya, angka kita yang salah |
| **B. Pindah ke "Pesanan Dibayar"** | angka = uang yang benar-benar masuk; Health Score jujur; konsisten dengan "GMV Bersih" TikTok | butuh parser bagian ke-3 (belum ada), jadi ada kerjaan kode; laporan bulan-bulan lama tidak bisa dihitung ulang otomatis (tabel `client_reports` beku — laporan baru saja yang ikut aturan baru); angka turun 18% dan itu harus dijelaskan ke klien |
| **C. Tampilkan KEDUANYA** — Dibuat sebagai "GMV kotor", Dibayar sebagai "GMV bersih" | paling jujur; `gmv_kotor`/`gmv_net` yang sudah ada di skema akhirnya dipakai sebagaimana namanya (sekarang keduanya diisi angka yang SAMA); klien lihat gap-nya sendiri | kerjaan kode paling banyak (parser + renderer + keputusan mana yang masuk `total_sales`) |

**Rekomendasi gw: C**, dengan `total_sales` mengambil yang **Dibayar**.
Alasannya: kolom `gmv_kotor` dan `gmv_net` sudah ada dan saat ini diisi angka
identik — komentar di `report.ts` sendiri berbunyi *"gmv_kotor == gmv_net here.
Not a bug: there is no second number to store"*, dan UAT ini membuktikan **ada**
angka kedua, bahkan dua. Gap batal 20,5% terlalu besar untuk disembunyikan dari
klien maupun dari Health Score kita sendiri.

### 4.2 Toko dengan ROAS 9,63× dilabeli "KRITIS" ke klien — mau begitu?

Skor 5,7 dengan ambang `<6 = KRITIS`. Penariknya: Conversion & Retention
**0,9/10** (CR 2,46%, repeat 13,0%, **batal 20,5%**) dan Live Streaming 5/10.
Padahal ROAS & Channel dapat **10/10** dan ketiga flag iklan (ROAS/ACOS/CTR)
hijau semua.

Secara isi, skornya jujur — batal 20,5% memang parah. Yang perlu lo putuskan:
**apakah kata "KRITIS" itu yang mau dibaca klien** di laporan bulanan, saat
iklannya justru performa terbaiknya. Opsinya: (a) biarkan (label = apa adanya),
(b) geser ambang, (c) pisahkan label internal dan label klien. Gw **tidak**
mengubah apa pun di sini — ambang itu port dari alat pemilik, mengubahnya butuh
entri `DECISIONS.md` atas namanya.

### 4.3 Instruksi kerja AM untuk unggah berkas Shopee

Dari §3, AM harus pilih satu:

| | Untung | Rugi |
|---|---|---|
| **A. Rename berkas ke konvensi tim** sebelum unggah (`[bisnis]-Home && Juli 2026 && Fim Motor && 2026-08-01.xlsx`) | deteksi jadi 100% akurat, nol perubahan kode | 15 rename manual per klien per bulan — kerjaan berulang yang gampang salah |
| **B. Pakai dropdown modul per berkas** di form (sudah ada) | tanpa rename, tanpa kode baru; AM lihat langsung apa yang ia tetapkan | 15 kali pilih dropdown per laporan; tetap manual |
| **C. Tambah pengenalan nama berkas MENTAH Shopee ke engine** (`shopee-shop-stats`, `parentskudetail`, `live_streaming`, `discount_`, `voucher_`, `In_Shop_Flash_Sale_Metrics`, `chat_`, `Chat_Broadcast_overview`, `ProductPerformance`, `AMSAffiliatePerformance`, `Data+Keseluruhan+Iklan`, `Data-Semua-Iklan-Live`, `Search-Ads-Overall-Data`, `video-overview`) | AM cukup drag-and-drop apa adanya; nama export Seller Centre stabil, jadi pengenalan berbasis nama itu andal | perubahan kode di engine (aditif: lapisan nama kedua, dijalankan sebelum fallback isi) + butuh entri `DECISIONS.md`; pola nama bisa berubah kalau Shopee ganti format export |

**Rekomendasi gw: C**, dengan B sebagai jaring pengaman yang sudah terpasang.
Alasannya: A dan B sama-sama memindahkan beban ke AM setiap bulan untuk masalah
yang sifatnya sekali-selesai, dan keduanya bisa salah tanpa terdeteksi —
sedangkan C menghilangkan sumber kesalahannya. Sampai C dikerjakan, **instruksi
ke AM harus B, bukan mengandalkan Otomatis.**

---

## 5. Yang BELUM diuji (jujur, bukan terlupa)

- **Laporan belum diterbitkan dan belum dibaca kontak klien sungguhan.** UAT ini
  berhenti di "laporan terbentuk & angkanya benar". Menerbitkan ke Fim Motor
  butuh baris klien + kontak portal di live, dan itu keputusan/aksi pemilik.
- **Atribusi Metric Entry (`MTR-`) tidak terpicu** di uji ini: klien uji tidak
  punya kampanye `Shopee Ads` aktif, jadi jalur "tidak upload manual" ke M6D
  RM-C belum diuji dengan data asli. Mekanismenya sendiri sudah punya 9 test
  domain (`report.shopee.domain.test.ts`), tapi belum pernah kena data nyata.
- **Render HTML laporan** belum dibuka di browser untuk data ini (payload sudah
  terisi lengkap; yang belum dilihat mata adalah hasil render-nya).
- Uji ini di DB **lokal**, bukan live. Live sudah punya skemanya (§migrasi
  diterapkan 2026-09-03) tapi belum ada laporan Shopee di sana.

---

## 6. Cara mengulang uji ini

Berkas mentah **tidak** disimpan di repo (data klien). Yang perlu diulang:

1. Taruh 15 berkas export di satu folder.
2. Replikasi langkah browser: baca SEMUA sheet tiap berkas, sisipkan baris
   `__SHEET__:<nama sheet>` sebelum tiap sheet, sha256 atas byte mentah.
3. Panggil `report.createReportShopee` dengan `tipeOverride` per berkas sesuai
   tabel §3 kolom "pemetaan manual", `periode='Juli 2026'`,
   `periodeMulai='2026-07-01'`, `periodeAkhir='2026-07-31'`.
4. Bandingkan keluarannya dengan tabel §2.

Atau lewat UI: `/clients/{id}` → panel Laporan Performa → mesin **Shopee** →
unggah 15 berkas → set dropdown modul per berkas → isi periode → Buat Laporan.

---

## 7. SESUDAH PERBAIKAN — SHP-1 & SHP-3 dibangun, UAT dijalankan ULANG

Pemilik menjawab ketiga temuan pada hari yang sama (SHP-1 opsi C dengan
`total_sales` ikut **Dibayar**, SHP-2 **biarkan**, SHP-3 **jalankan
rekomendasi**). Kode dibangun, lalu 15 berkas yang SAMA dijalankan ulang —
kali ini dengan **NOL override manual**, semua diserahkan ke deteksi server.

### 7.1 Deteksi: 8 benar → **15/15 benar**

| | Sebelum | Sesudah |
|---|---|---|
| Benar | 8 | **15** |
| **Salah slot** | **3** | **0** |
| Tak terdeteksi | 4 | **0** |
| Slot terisi | 8/17 | **15/17** (2 sisa memang tak ada berkasnya) |

Tiga yang tadinya salah slot sekarang benar: `Chat_Broadcast_overview` →
`layanan_broadcast` (dulu `bisnis_video`), `Data+Keseluruhan+Iklan` →
`ads_toko` (dulu `aff_creator`), `Search-Ads-Overall-Data` → `ads_produk`
(dulu `aff_creator`). Tabrakan dua berkas di slot `bisnis_video` juga hilang.

### 7.2 GMV kotor vs bersih: dua angka berbeda, sumbernya dinyatakan

| | Nilai | Asal |
|---|---|---|
| `gmv_kotor` | **Rp 1.624.937.476** | bagian *Pesanan Dibuat* |
| `gmv_net` | **Rp 1.329.227.354** | bagian *Pesanan Dibayar* (baru diparse) |
| `clients.total_sales` | **Rp 1.329.227.354** | ikut `gmv_net` → **Health Score M13 kini berbasis uang yang masuk** |
| `payload.periode.gmv_bersih_sumber` | `pesanan_dibayar` | bukan fallback |
| Skor | **5,7 KRITIS** (tak berubah) | SHP-2: ambang dibiarkan |

Selisih kotor−bersih Rp 295.710.122 sekarang **tampil di laporan** sebagai dua
kartu berdampingan plus keterangan selisihnya, bukan disembunyikan di satu
angka.

### 7.3 Yang TETAP belum diuji

Sama seperti §5 dan tidak berubah: laporan belum diterbitkan ke kontak klien
sungguhan, atribusi `MTR-` belum kena data nyata (klien uji tak punya kampanye
`Shopee Ads` aktif), dan render HTML-nya belum dibuka di browser untuk data
ini. Ketiganya milik pemilik/AM, bukan sesi Claude.

### 7.4 Catatan untuk laporan yang SUDAH ada

`client_reports` beku untuk UPDATE (aturan rumah #3), jadi **laporan yang sudah
dibuat tidak dihitung ulang** — `gmv_net` mereka tetap berisi angka gross.
Hanya laporan yang dibuat SETELAH perubahan ini yang memakai basis Dibayar. Di
live belum ada satu laporan Shopee pun, jadi praktisnya tidak ada baris lama
yang terpengaruh; untuk TikTok aturan ini tidak berubah sama sekali.
