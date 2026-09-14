# Backlog — PDT (Pusat Data Toko)

> Disusun 2026-09-12 dari `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` (PRD v1.1) + 10 keputusan terkunci
> `PDT-15`…`PDT-27` (`docs/DECISIONS.md`, tiga baris 2026-09-12).
>
> ### Status hari ini: **NOL KODE, NOL MIGRASI.** Yang sudah ada hanya dokumen.
> Ini disengaja, bukan tertinggal. PRD sendiri (§Langkah konkret #1/#2/#2b) menaruh **tiga** hal
> sebagai prasyarat *sebelum migrasi pertama di-merge*: entri `DECISIONS.md` (✅ selesai),
> jawaban P-01…P-11 (⚠️ 6 dari 11 masih menunggu manusia), dan daftar `kolom_dipanen` per modul
> (❌ belum — pekerjaan Hans + Anty).
>
> **Jangan mulai G1 sebelum §5 dan §6 di bawah tertutup.** Verifikasi ke kode menemukan **tiga dari
> sebelas asumsi premisnya keliru**; dua di antaranya menyebut tipe kolom yang tidak ada di CDPS.
>
> ### Update sesi 2 (2026-09-13, ketokan Nerissa — masih **NOL KODE, NOL MIGRASI**)
> Sembilan dari sebelas Open Assumptions sekarang tertutup (§6 di bawah) — P-01/P-06/P-08/P-10/P-11
> ditutup sesi ini, di atas empat yang sesi 1 sudah jawab. **Daftar `kolom_dipanen`
> (`docs/backlog/PDT_KOLOM_DIPANEN.md`) sudah ada**, tapi **belum lengkap secara sengaja**: bucket
> "human call" (11 kolom tanpa konsumen ⇒ buang, ketokan Q-6) tidak ditulis karena rekomendasi
> aslinya tidak ditemukan di repo mana pun — lihat berkas itu §7. Ini **tidak** memblokir G1 (G1-02
> sudah punya bucket 1 + bucket 2 lengkap, yang memang whitelist-nya); ia memblokir kelengkapan
> penuh `pdt_parser_modul.kolom_dipanen` sebelum daftar itu jadi kanonik selamanya.
>
> ### Ringkasan jumlah tiket per gelombang (2026-09-14 — jauh sesudah "NOL KODE" di atas)
> **17 tiket bernomor** di seluruh §1-§5 (`### G<gelombang>-<nomor>`): **G1** 12 (`G1-00`…`G1-11`),
> **G2** 2 (`G2-01`/`G2-02`), **G3** 0 (§3 masih prosa, belum dipecah jadi tiket bernomor), **G4** 3
> (`G4-01`…`G4-03`), **G5** 0 (⛔ diblokir, sengaja belum dijadwalkan — §5). Status ringkas: **G1-00
> s.d. G1-08 SELESAI** (migrasi+engine+tes, lihat commit/`docs/DECISIONS.md` per tiket); **G1-09
> SEDANG BERJALAN** — bukan satu langkah, sudah 5 dari ~6 sub-langkah (pratinjau, G1-09-BODY-BESAR,
> commit 2a, rekonsiliasi 2b-i, baris fakta 2b-ii DIMULAI SATU modul dari 25 — halaman UI
> sub-langkah 3 masih menyusul, lihat catatan status di bawah DoD G1-09 §1); **G1-10**/**G1-11**
> belum dimulai; **G2**/**G4**
> belum dimulai (nol seed/nol UI di luar struktur tabel G1-01). Angka ini TIDAK termasuk tiket
> non-coding §7 atau Open Assumptions §6 (bukan "tiket G", pertanyaan/keputusan pemilik).

---

## 0. Prasyarat & gerbang

Semua tiket di berkas ini tunduk pada delapan pagar berikut. Melanggar salah satunya =
CI merah, bukan diskusi gaya.

1. **Migrasi HANYA** lewat `supabase/migrations/**` + `apply_migration` **per berkas**.
   Jangan `psql -f` (O38), jangan `supabase db push` (O65), jangan hand-edit schema.
2. **Empat gerbang hitung CI**, dan keduanya naik dalam **SATU commit** —
   `.github/workflows/ci.yml` **dan** `scripts/db-rebuild.sh`. Menaikkan salah satu saja
   menghasilkan suite hijau palsu (pelajaran PR #170 / #335).

   | Gerbang | Nilai hari ini | Bergerak untuk PDT? |
   |---|---|---|
   | `public` base tables | **161** | ✅ ya — naik sebanyak tabel `pdt_*` yang lahir |
   | `entity_prefix` | **44** | ❌ **tidak** — semua tabel PDT `bigint identity`, nol prefix baru (koreksi K-2) |
   | `sm_machines` | **35** | ❌ tidak, kecuali sebuah entitas PDT diberi lifecycle (lihat G1-03) |
   | `notif_events` | **74** | ⚠️ naik **hanya** bila katalog versi baru didaftarkan (O55) |

3. **`route-parity.test.ts` `KNOWN_GAPS` tetap KOSONG.** Setiap path yang dipanggil
   `web-internal` wajib dilayani `apps/api`. Menambah satu baris = mengakui satu halaman
   tidak berfungsi, dan itu butuh entri `DECISIONS.md` tersendiri.
4. **`shape-parity.test.ts`** — tiap objek domain yang keluar lewat `apps/api` melewati
   `*ToWire` di `apps/api/src/lib/wire.ts`, dengan `null` eksplisit. **Kunci yang HILANG lebih
   berbahaya daripada `null`** (kelas bug O43: halaman blank walau route menjawab 200).
5. **Status ditulis eksklusif oleh `sm_transition`.** Tidak ada kolom status yang diset
   `UPDATE` mentah. Alternatif sah: **nol** state machine, secara sengaja (preseden M19 `dailyops`).
6. **Pesan validasi Bahasa Indonesia dalam `[...]`**, string persis dari PRD.
7. **Izin = predikat bernama** di `packages/domain/src/pdt.ts`, bukan permission-key
   (koreksi K-3; ketokan PX-M2a 2026-09-12). RLS memikul row-scope.
8. **`archive/backend-go/**` tidak disentuh.** Arsip read-only (C-05).

---

## 1. G1 — Fondasi: tabel, parser, rekonsiliasi, upload

> **Gerbang keluar G1:** ≥ **10 klien nyata** berstatus `verified` (campuran TikTok & Shopee),
> rekonsiliasi ≤ 0,5% — **bukan** data seed. Dan sejak G1 merge: **nol batch baru** lewat tool lama.

### G1-00 · Prasyarat data ("G0") — **sebelum G1 bisa lulus UAT**
Ditambahkan sesi 2 (`docs/handoff/HANDOFF_PDT_SESI1.md` §5 menyebutnya "G0"; nomor tiketnya
`G1-00` supaya tetap satu urutan dengan G1-01…G1-11 di backlog ini). ⚠️ **G1 tidak bisa lulus UAT
sebelum tiket ini selesai** — gerbang keluar G1 (≥10 klien nyata `verified`) tidak tercapai kalau
data klien di bawahnya masih kotor.

Fakta hari ini (§7.1 handoff, query read-only 2026-09-12): **16 dari 27** klien tanpa AM
(mayoritas testing, ketokan F-8); kosakata `client_platforms.platform` = `Shopee | TikTok Shop |
TikTok Shop, Shopee | TikTok Shop, Shopee, Tokopedia | Tokopedia` dengan **nol CHECK**.

- **Hapus klien testing** (ketokan F-8: *"Klien tanpa AM mayoritas testing. Yang testing dihapus,
  yang belum di-assign."*). Ini keputusan **manusia per baris** (Nerissa/Anty menentukan mana
  testing, mana belum sempat di-assign) — dieksekusi sebagai transaksi SQL langsung + baris
  `audit_log` per penghapusan/nonaktivasi, pola yang sama dengan pembersihan baris kembar
  `client_platforms` di PX-M2a §4b (`DECISIONS.md` 2026-09-12). **Bukan** DELETE mentah tanpa jejak.
- **Assign AM ke klien real** yang tersisa tanpa AM — prasyarat `canUploadBatch(actor, ownerAm)`
  (K-3) punya `ownerAm` untuk digigit; klien tanpa AM tidak bisa punya batch PDT yang sah.
- **`client_platforms.platform` jadi pilihan** — migrasi kecil: enum/CHECK ke
  (`tiktok`/`shopee`/`meta`/`tokopedia`), plus normalisasi baris live yang hari ini menyimpan
  gabungan teks bebas (`"TikTok Shop, Shopee"` dll., ketokan F-5: *"toko yang melanggar itu toko
  testing"* — dua baris gabungan diperkirakan terhapus bersama data testing di atas, bukan
  dinormalisasi terpisah). ⚠️ Ini **satu-satunya** bagian tiket ini yang benar-benar migrasi;
  pembersihan datanya sendiri manual/SOP, bukan kode aplikasi.

**DoD:** nol klien testing tersisa · nol klien real tanpa AM · `client_platforms.platform` ber-CHECK
· nol baris `platform` bergabung tersisa · baseline "10 klien nyata `verified`" (gerbang G1) diukur
dari data yang sudah bersih ini, bukan dari 27 klien hari ini yang 16-nya testing.

### G1-01 · Migrasi tabel `pdt_*` + RLS + gerbang CI
Tabel dari PRD §6.1–§6.4. Semua `bigint GENERATED ALWAYS AS IDENTITY` (koreksi K-2).

- **Batch & berkas:** `pdt_upload_batch` (termasuk kolom paket raw PDT-25/PDT-26:
  `raw_path`, `raw_sha256`, `raw_bytes`, `raw_entri`, `raw_entri_dilewati`,
  `retensi_sampai date NOT NULL`, `retensi_alasan`, `raw_dihapus_pada`, `legal_hold`),
  `pdt_file` (satu baris per **entri di dalam ZIP**).
- **Fakta:** `pdt_fact_shop_daily`, `pdt_sku_master`, `pdt_fact_sku_period`,
  `pdt_fact_content`, `pdt_fact_creator_period`, `pdt_fact_ads`.
- **Konfigurasi:** `pdt_parser_modul`, `pdt_kolom_alias`, `pdt_benchmark`, `pdt_usulan_katalog`,
  ENUM `pdt_satuan_t`.
- **Usulan & laporan:** `pdt_usulan`, `pdt_laporan_kiriman`.

⛔ **JANGAN lahirkan `level2_category` dan `price_segment` di `pdt_sku_master`** (koreksi K-4) —
tipenya tidak ada di CDPS. Keduanya milik G5, yang diblokir. Menambahkan kolom `text` "sementara"
adalah persis cara taksonomi bercabang dua.

**Pola yang disalin, bukan dikarang:**
- `pdt_benchmark` → **huruf per huruf `adsscanner_benchmark`**
  (`20260910010000_gelombang4_adsscanner.sql:81-148`): `versi integer PK`, `nilai jsonb`,
  `aktif boolean default true`, trigger `_frozen()` yang menolak **semua** UPDATE dan DELETE,
  `REVOKE` + `ENABLE RLS` + **nol policy**. Versi aktif dibaca
  `where aktif = true order by versi desc limit 1`. **`aktif` tidak pernah dibalik** — sebuah versi
  boleh **lahir** non-aktif (draft/rollback). Nol partial unique. Preseden kedua yang sudah
  mengikuti pola ini: `px_eligibility_policy`.
- `pdt_laporan_kiriman` append-only → trigger `_frozen()`, pola `client_reports_frozen()`.
- RLS varian B (GRANT SELECT + satu policy ber-scope Account) untuk tabel yang dibaca AM;
  varian A (nol policy, default-deny) untuk `pdt_benchmark` dan `pdt_usulan_katalog`.

**Constraint yang PRD sebut eksplisit dan mudah terlewat:**
- Unique partial `(client_platform_id, periode_mulai, periode_selesai)` **WHERE `status='verified'`**
  — batch `ditolak`/`digantikan` **tidak** boleh memblokir penggantinya (Rule 36).
- CHECK `raw_dihapus_pada IS NULL OR raw_path IS NOT NULL`.
- Index `(retensi_sampai)` **WHERE** `raw_dihapus_pada IS NULL AND legal_hold = false` — indeks
  kerja job purge.
- **Tiap kolom fakta wajib menyebut konsumennya di komentar migrasi**
  (`-- konsumen: report.dimensi_roas, px.L2`). Kolom tanpa konsumen tidak boleh lahir (PDT-27).

**DoD:** `scripts/db-rebuild.sh` hijau di angka tabel yang baru · gerbang CI + `db-rebuild.sh`
naik dalam satu commit · tes RLS per peran · tes immutability (`pdt_benchmark`,
`pdt_laporan_kiriman` tanpa jalur UPDATE/DELETE) · tes unique-partial menggigit di DB
(batch `ditolak` boleh diganti, batch `verified` tidak).

### G1-02 · Seed `pdt_parser_modul` — **menyatukan EMPAT registry, bukan satu**
> **`kolom_dipanen` per modul sudah disusun** di `docs/backlog/PDT_KOLOM_DIPANEN.md` (sesi 2,
> Task §4 Tugas 2) — pakai berkas itu, jangan menyusun ulang whitelist dari §7 PRD secara harfiah
> (§7 PRD sendiri sekarang menunjuk balik ke `PDT_KOLOM_DIPANEN.md` sebagai daftar yang mengikat).
> Satu bucket di berkas itu **belum lengkap secara sengaja** — bucket 3 "human call" (11 kolom
> tanpa konsumen ⇒ buang) menunggu rekomendasi asli Hans/Anty; itu tidak menghalangi seed modul,
> karena bucket 1 + bucket 2 (yang justru harus **masuk** whitelist) sudah lengkap.

Konsekuensi P-04 (🟠 sebagian, §5). Yang harus disatukan ke `tanda_tangan_kolom jsonb`:

| Registry hari ini | Isi |
|---|---|
| `packages/core/src/baseline/detect.ts` | 12 tipe Seller Center (`shop_tt`, `prod_tt`, `vid_toko`, `ads_prod`, …) |
| `packages/core/src/report/detect.ts` | 4 tipe TikTok Ads Manager (`ttam_*`) |
| `packages/core/src/report/shopee/detect.ts` | 17 tanda tangan Shopee |
| `packages/core/src/adsscanner/tiktok/detect.ts` | tanda tangan Ads Scanner |

Plus modul baru dari PRD §7 yang belum punya registry sama sekali (`shopee_video` header 2 lapis,
`shopee_chat_broadcast`, `meta_ads`).

- **Deteksi modul TIDAK BOLEH bergantung nama berkas** (Rule 6). UAT Fim Motor membuktikan
  kenapa: `parseFilename` mengembalikan `null` untuk **15 dari 15** berkas nyata, dan fallback
  tanda tangan memberi 8 benar · **3 SALAH SLOT** · 4 tak terdeteksi. Salah-slot adalah kasus
  berbahayanya (bagian Affiliate diam-diam terisi angka search-ads).
- **Baris header dicari, tidak diasumsikan** (Rule 7): CSV iklan Shopee baris **8**,
  `Data-Semua-Iklan-Live` baris **7**, TikTok `Live Analysis`/`Video Performance List` baris **3**,
  `product_list` baris **4**, `video-overview` **dua lapis**.
- Pakai ulang `readSheet` (`packages/core/src/baseline/sheet.ts`) — ia **sudah** menangani
  header dua lapis dan kolom duplikat lewat sufiks `nama#j` (perbaikan O70). ⛔ Jangan ubah
  heuristik hitungan LABEL UNIK-nya.

**DoD:** setiap modul di PRD §7 punya baris seed · deteksi diuji terhadap **28 berkas sample**
(Fim Motor/Shopee, Avitaskin/TikTok) dengan target **nol salah-slot** · `pdt_kolom_alias`
append-only terisi untuk alias yang sudah diketahui.

### G1-03 · Normalisasi angka terpusat — **pilih NaN, bukan 0**
PRD §6.7 minta "normalisasi angka lokal terpusat, bukan per modul". Hari ini ada **dua** semantik
yang berbeda dan keduanya dipakai:

| Fungsi | Gagal parse ⇒ | Dipakai di |
|---|---|---|
| `n()` — `packages/core/src/baseline/angka.ts` | **`0`** | baseline, report |
| `parseIndonesianNumber()` — `packages/core/src/skuscreener/parse.ts` | **`NaN`** | SKU screener |

**Keputusan: NaN** untuk jalur PDT. PRD Product Exchange Rule 14 sudah memutuskan hal yang sama
untuk alasan yang sama, dan `0`-diam-diam adalah persis kelas bug yang PDT Rule 12 hapus.

⚠️ **Tapi `n()` BUKAN bug — jangan "perbaiki" ia.** Docblock-nya menyatakan maksudnya:
*"a present-but-empty cell is 0. Absence of the whole COLUMN is a different thing — see
metrik.ts."* Jadi ia membedakan **sel kosong** (sah bernilai 0) dari **kolom yang tidak ada**
(ditangani di tempat lain). Mengubah `n()` akan menggeser skor seluruh laporan & baseline yang
sudah berjalan. Yang benar: fungsi PDT **membedakan tiga keadaan** — sel kosong ⇒ `0`,
nilai tak terbaca ⇒ `NaN`, kolom tak ada ⇒ kegagalan parse bernama (Rule 9). Dua parser lama
tetap di tempatnya sampai pemakainya ikut pindah. Encoding: CSV Shopee `utf-8-sig`, pemisah koma, angka format
Indonesia (`1.234,56`); Ads Manager memakai `.` sebagai desimal sedangkan Seller Center sebagai
ribuan — keduanya wajib ditangani satu fungsi.

**DoD:** satu fungsi, diuji terhadap kedua konvensi · nol pemanggil baru `n()` di jalur PDT.

### G1-04 · Bucket `pdt-raw` + pagar paket ZIP — **infrastruktur pertama di repo ini**
P-09 ✅ terkonfirmasi: **nol preseden**. Tidak ada bucket, `supabase/functions/`, atau
`createSignedUrl` di mana pun.

- Bucket **privat**, path `{client_id}/{client_platform_id}/{periode_selesai}/{batch_id}.zip`.
  **Tidak pernah** publik; akses hanya lewat signed URL **≤ 15 menit**, hanya untuk peran yang
  boleh membaca batch itu.
- **Pagar sebelum satu entri pun dibaca** (Rule 42): ≤ **50 MB** · ≤ **40 entri** ·
  rasio dekompresi ≤ **100:1**.
- **Entri ditolak** (Rule 41): ZIP bersarang · entri terenkripsi/berkata sandi · ekstensi di luar
  `.xlsx`/`.xls`/`.csv` · **zip-slip** (path keluar dari akar arsip).
- **Entri dilewati tanpa peringatan:** `__MACOSX/`, `.DS_Store`, berkas berawalan `._` —
  sample nyata membawanya dan itu normal untuk zip dari macOS.
- Ekstraksi **streaming ke disk sementara**, tidak seluruhnya ke memori.
- `sha256` dihitung untuk **paket** dan **tiap entri**. Sidik jari entri sama pada
  `client_platform_id` berbeda ⇒ **peringatan keras**. (Hari ini indeksnya ada di
  `riset_awal_sumber_berkas`/`client_report_berkas` tapi **nol query** pernah memakainya.)

**DoD:** bucket ada di staging · pagar diuji dengan zip bomb sintetis + zip-slip + ZIP bersarang ·
signed URL kedaluwarsa benar-benar menolak.

### G1-05 · Parse **di server** — pemindahan arsitektur yang sesungguhnya
Hari ini `XLSX.read` jalan **di browser** (`web-internal/src/lib/{riset-awal,report,skuscreener,adsscanner}.ts`);
server hanya menerima array-of-arrays. PRD §6.7 minta parse **di server**.

Yang **tidak** perlu ditulis ulang: seluruh engine di `packages/core` sudah murni, DOM-free, dan
menerima AoA. Yang pindah hanyalah **dekode berkasnya**.

- `xlsx@0.18.5` hari ini dependensi **`web-internal` saja** — perlu masuk sisi server.
  ⚠️ **Lisensi SheetJS pernah jadi ketidakpastian terbuka** (`RISET_AWAL_BASELINE_BACKLOG.md` §0);
  pastikan terjawab sebelum menambah dependensi di `apps/api`.
- Target < **45 detik** untuk batch 13 berkas (~1.500 baris SKU + ~2.000 baris konten). Bila lebih:
  pindah ke **job asinkron dengan status polling** — **bukan** dengan mengurangi kedalaman parse.
- **Nol perhitungan di berkas HTML mandiri; nol `localStorage` sebagai tempat bergantung.**

**DoD:** parse jalan tanpa browser (tes integrasi memanggil domain langsung) · 28 berkas sample
lewat · waktu diukur dan dicatat.

### G1-06 · Identitas toko & periode dari BERKAS, bukan dari input AM
- **Shopee** (Rule 2): preamble tiga CSV iklan membawa `Username`, `Nama Toko`, `ID Toko`,
  `Periode` (baris 1–6). `ID Toko` ≠ `client_platforms.shop_id` ⇒ batch **ditolak** dengan pesan
  yang **menyebut kedua nilai**.
  - **Pengikatan `shop_id` (Q-1 opsi A, sesi 2 — simetris Rule 4 TikTok).** Bila `shop_id` toko itu
    **masih kosong** (F-4: Product Exchange belum dimulai untuk toko ini), batch Shopee pertama
    masuk berstatus `identitas_belum_terikat` → sistem mengusulkan `ID Toko` dari preamble → AM
    mengonfirmasi **sekali** → nilai terikat permanen ke `client_platforms.shop_id`. `shop_id`
    terisi sebagai **efek samping** validasi PDT, bukan field AM ketik terpisah — dan Product
    Exchange (konsumen lain kolom yang sama) ikut siap begitu batch pertama `verified`.
- **TikTok** (Rule 3–4): export TikTok **tidak membawa shop_id sama sekali** (fakta terverifikasi).
  Identitas divalidasi dari `ID Kreator` akun toko terhadap `client_platforms.akun_konten_toko`.
  Bila masih kosong: batch pertama boleh masuk berstatus `identitas_belum_terikat`, sistem
  mengusulkan `ID Kreator` yang paling sering muncul, AM mengonfirmasi **sekali**, nilainya
  terikat permanen.
- **Periode** (Rule 5) dari berkas, bukan input AM. Dua berkas beda periode dalam satu batch ⇒
  ditolak. Modul yang tidak membawa tanggal **mewarisi** dari berkas lain di batch yang sama.
- `tanggal_tarik_data` **selalu jam server** (Rule 37), tidak pernah jam browser.

**Perubahan pada tabel yang sudah ada (PRD §6.5):** `client_platforms + akun_konten_toko jsonb`,
`client_platforms + shop_username text`. `client_platforms.shop_id` **sudah ada** (PX-M2a,
`20261008010000`). `clients.target_gmv` tinggal dibaca.

> **Sebagian sudah ada:** `createReport` hari ini **sudah** menolak 400 bila `client_platforms`
> tidak membawa handle toko (UAT Avitaskin). Yang baru adalah menjadikannya kolom terikat
> alih-alih `linked_accounts` yang **diketik ulang di setiap request** laporan dan baseline.

**DoD:** batch export Agustus yang dimasukkan ke batch Juli **ditolak** · pesan tolak menyebut
kedua nilai · `linked_accounts` tidak lagi diketik di jalur PDT.

### G1-07 · Rekonsiliasi (PDT-16) — dan larangan mencampur basis
- **Toleransi Rule 5 bulan-sama (sesi 2, §2.4 handoff).** Batch ditolak **hanya** bila
  berkas-berkasnya berasal dari BULAN kalender berbeda, bukan lagi setiap kali rentang tanggalnya
  sedikit berbeda (1–31 vs 1–28 Juli **diterima**, keduanya sama-sama Juli). `periode_mulai`/
  `periode_selesai` batch = rentang **terluas** di antara berkas dalam batch itu. ⛔ Jangan
  hardcode ambang 28 hari — rentang per modul dicatat di `pdt_parser_modul`, ditinjau setelah A-3.
- Σ GMV per-SKU vs GMV shop-level **pada basis yang sama**; Σ pesanan per-SKU vs shop-level.
- ≤ 0,5% ⇒ `verified`. > 0,5% ⇒ `ditolak` + `reconcile_delta_pct` tersimpan + UI menunjuk modul
  penyebab (modul ber-`parse_status != 'ok'` disebut lebih dulu).
- **Basis tidak boleh dicampur** (Rule 15): TikTok = GMV − refund; Shopee punya **tiga** basis
  terpisah (`Pesanan Dibuat`, `Pesanan Siap Dikirim`, `Pesanan Dibayar`), disimpan sebagai
  **baris berbeda** di `pdt_fact_shop_daily`, bukan dijumlah. Kasus Fim Motor
  (Rp 295.710.122 = **18,2%**) adalah akibat pencampuran ini.
- Basis default laporan klien Shopee = **Pesanan Siap Dikirim**; basis gerbang PX =
  **Pesanan Dibayar** (PDT-19). Keduanya hidup berdampingan karena keduanya tersimpan.
- ⚠️ **`tt_shop_analytics` tidak boleh jadi satu-satunya sisi rekonsiliasi TikTok** sampai P-01
  terjawab (dua sample punya 11 vs 14 kolom dan angka jauh berbeda). Pakai `tt_orders` sebagai
  sisi kanonik.

**DoD:** kasus Fim Motor direproduksi sebagai fixture dan **ditolak** oleh gerbang 0,5% ketika
basisnya dicampur, lolos ketika tidak.

### G1-08 · Kegagalan parse tidak boleh ditelan (Rule 10) + skor netral dihapus (Rule 12)
- Tiap berkas punya `parse_status` (`ok`/`sebagian`/`gagal`) + `parse_error` **tersimpan**.
  Pesan **"berkas tidak diunggah" DILARANG** dipakai untuk berkas yang diunggah tapi gagal parse —
  keduanya wajib bisa dibedakan di UI **dan** di DB.
- Kolom wajib yang tidak ditemukan **dan** tidak punya alias ⇒ `parse_status='gagal'` dengan pesan
  yang **menyebut nama kolom yang dicari**.
- **Skor netral 5/10 DIHAPUS.** Dimensi tanpa berkas ⇒ `null` + label `data tidak tersedia`, dan
  dimensi itu **dikeluarkan dari pembobotan** (bobot dinormalisasi ulang). Kelengkapan berkas
  tidak boleh lagi menurunkan skor performa klien.

> Ini menutup kegagalan yang **sudah terkirim ke klien**: laporan Shopee dengan error 16 dari 17
> modul dibuang diam-diam, dan dimensi ROAS berbobot 22% diberi 5/10 dengan alasan salah.
> Preseden normalisasi-ulang bobot sudah ada di `performance.ts` (Rule 6 M14).

**DoD:** tes yang membuktikan dimensi `null` **tidak** menurunkan skor total · tes yang
membedakan "tidak diunggah" dari "gagal parse".

### G1-09 · Halaman upload + tabel hasil deteksi
- Satu ZIP, bukan 13 berkas longgar (PDT-25). Nama berkas **di dalam** ZIP tidak diatur dan tidak
  divalidasi; struktur folder diabaikan (sistem membaca seluruh entri secara rata).
- Tabel hasil deteksi ditampilkan **SEBELUM disimpan**: modul terdeteksi, baris header,
  kolom dipanen, kolom baru (**nama saja**), status.
- AM dapat menimpa deteksi per berkas dari dropdown **SELURUH** modul — bukan 4 dari 16
  seperti sekarang.
- UI batch wajib menampilkan status paket: **tersedia** (+ tanggal kedaluwarsa),
  **kedaluwarsa** (+ tanggal purge), atau **legal hold** (Rule 50).
- *Error path:* kegagalan di langkah parse/rekonsiliasi menyisakan batch `ditolak` yang **tetap
  tersimpan** beserta `parse_error` per berkas, agar bisa didiagnosis **tanpa upload ulang**.

**DoD:** `route-parity` hijau (`KNOWN_GAPS` kosong) · `shape-parity` hijau · tiap field wire
punya `null` eksplisit.

> **Status 2026-09-13 (sub-langkah 1/3 SELESAI, lihat `docs/DECISIONS.md` baris teratas)** —
> `POST /account/pdt/batches/preview` (`packages/domain/src/pdt.ts` `previewUploadBatch` +
> `apps/api/.../pdt/batches/preview/route.ts`) menutup bullet 1-2 (satu ZIP, tabel deteksi
> SEBELUM disimpan) dan separuh bullet 4 dari sisi identitas/periode (Rule 2-5 DIPANGGIL
> untuk pertama kalinya dari alur nyata) — **nol tulis DB, nol upload storage**. Kontrak wire
> (`PdtPreviewBatchWire` + FE mirror `web-internal/src/lib/pdt.ts`) sudah ada; **halaman UI-nya
> BELUM** (tidak ada tombol/form yang memanggil route ini hari ini). **Belum dibangun:** dropdown
> override AM per berkas (bullet 3 — moduleOptions sudah dikirim, penegakan overridenya
> butuh commit endpoint), UI status paket (bullet 4, batch belum ada untuk dibaca statusnya),
> commit sungguhan (menulis `pdt_upload_batch`/`pdt_file`, upload ke `pdt-raw`, rekonsiliasi
> Rule 13-16), dan error path bullet 5 (butuh baris batch untuk ditandai `ditolak`).
>
> **Status 2026-09-13 (G1-09-BODY-BESAR DITUTUP, sesi sama — lihat `docs/DECISIONS.md` baris
> teratas)** — dikonfirmasi (riset dokumentasi Vercel): platform deploy membatasi badan
> request/respons ke **4,5 MB keras**, jauh di bawah Rule 42 (≤50 MB). Route `preview` di atas
> **DIRETROFIT**: body sekarang JSON `{client_platform_id, storage_path}`, bukan bytes ZIP
> mentah. Endpoint BARU `POST /account/pdt/batches/upload-url` (gerbang izin
> `pdt.siapkanUploadBatch` + signed upload URL Storage `buatPdtRawSignedUploadUrl`) mendahului
> Flow A langkah 2: AM/browser meng-PUT ZIP LANGSUNG ke bucket `pdt-raw` (path staging, BUKAN
> path final Rule 44), lalu memanggil `preview` dengan `storage_path` yang sama — route itu
> mengunduhnya balik server-ke-server (`unduhPdtRawObjek`) sebelum pipeline G1-04/05/09 yang
> sudah ada berjalan TIDAK BERUBAH. Ini menutup risiko 413 produksi untuk pratinjau, BUKAN cuma
> untuk commit seperti dugaan Open row semula. Sub-langkah 2 (commit) sekarang tinggal
> memindahkan objek staging ke path final Rule 44 (bukan mengunggah ulang dari nol).
>
> **Status 2026-09-14 (sub-langkah 2a SELESAI, lihat `docs/DECISIONS.md` baris teratas)** —
> `POST /account/pdt/batches` (`pdt.commitUploadBatch` + `pdt.markRawStored` +
> `apps/api/.../pdt/batches/route.ts`) menutup bullet 1 (satu ZIP → batch sungguhan) dan
> separuh bullet 3-5: dropdown override AM DITEGAKKAN (`overrides`, `deteksi_oleh` DB
> mencatat `tanda_tangan` vs `override_am`), status batch ditulis dari identitas (Rule 2-4:
> `tolak`→`ditolak`, `usulkan_ikat`→`identitas_belum_terikat`, `cocok`/`tidak_dapat_divalidasi`→
> `parsing`), error path bullet 5 (gagal identitas/periode TETAP tersimpan sebagai batch
> `ditolak`, kecuali periode sendiri yang gagal — lihat catatan skema di `docs/DECISIONS.md`).
> **Bukan** "pindah objek staging" seperti dugaan status sebelumnya — byte yang sudah di
> tangan (dari unduh ulang untuk parse) diunggah LANGSUNG ke path final via
> `unggahPdtRawObjek` (POST + upsert), objek staging lama dibiarkan jadi yatim (Rule 49).
> **Belum dibangun (sengaja, sub-langkah 2b):** rekonsiliasi (Rule 13-16, PDT-16 — `status`
> tidak pernah `verified` hari ini), penulisan baris fakta tertipe (`pdt_fact_*`, peta
> kolomDipanen→tabel BELUM ada), UI status paket bullet 4 (batch sudah ada untuk dibaca
> statusnya, tapi halaman `web-internal` masih sub-langkah 3), dan endpoint konfirmasi AM
> untuk `usulkan_ikat` (menulis `client_platforms.shop_id`/`akun_konten_toko` — Rule 2/4
> eksplisit minta AM "mengonfirmasi sekali", BUKAN otomatis saat commit).
>
> **Status 2026-09-14 (sub-langkah 2b-i SELESAI, lihat `docs/DECISIONS.md` baris teratas)** —
> `commitUploadBatch` sekarang menjalankan rekonsiliasi Shopee (Rule 13-16,
> `pdt.rekonsiliasiGmvPesanan` G1-07, AKHIRNYA dipanggil dari alur nyata) begitu identitas
> `cocok`/`tidak_dapat_divalidasi` DAN batch membawa `shopee_shop_stats` + `shopee_parent_sku`
> ber-status `ok` berdua — basis **Siap Dikirim** (Rule 16, default laporan klien). `status`
> **BISA `'verified'` sekarang** (bukan lagi selalu berhenti di `'parsing'`), atau `'ditolak'`
> dengan `reconcile_delta_pct` + alasan menyebut modul penyebab. **Perbandingan pesanan (separuh
> Rule 13) DILEWATI** — nol kolom jumlah-pesanan per-SKU terverifikasi di `shopee_parent_sku`
> (`G1-07-PERSKU-PESANAN`, Open BARU) — verdict murni dari GMV sampai kolomnya ditemukan.
> **TikTok TIDAK direkonsiliasi** (`G1-07-TIKTOK-REKONSILIASI`, Open BARU) — G1-07 belum punya
> mesin shop-level-vs-per-SKU setara Shopee untuk TikTok; batch TikTok tetap berhenti di
> `'parsing'`. `uq_pdt_upload_batch_verified` (Rule 36, batch verified kedua untuk toko+periode
> yang sama) diterjemahkan jadi `ValidationError` BI, bukan 500 mentah. **Masih belum dibangun:**
> baris fakta tertipe (sub-langkah 2b-ii), UI (sub-langkah 3), endpoint konfirmasi identitas AM.
>
> **Status 2026-09-14 (sub-langkah 2b-ii DIMULAI — SATU modul, `docs/DECISIONS.md` baris
> teratas)** — baris fakta tertipe PERTAMA ditulis sungguhan: `shopee_ads_live` →
> `pdt_fact_ads` (`packages/core/src/pdt/fakta.ts` `ekstrakBarisShopeeAdsLive`, dipanggil
> `commitUploadBatch`). Dipilih dari ketiga modul iklan Shopee karena satu-satunya yang kunci
> uniknya (`ID Iklan`) tidak butuh `pdt_sku_master` (belum ada) — `shopee_ads_cpc`/
> `shopee_ads_search` **BELUM dipetakan**, masing-masing punya blocker BERBEDA yang ditemukan
> saat membangun (bukan sekadar "belum sempat"): lihat Open baru `G1-09-2BII-ADS-CPC` (butuh
> `pdt_sku_master`) dan `G1-09-2BII-ADS-SEARCH` (kolomDipanen tidak cukup — nol biaya/identitas).
> Commit-ulang periode yang sama = replace (DELETE+INSERT dalam transaksi yang sama), bukan
> `ON CONFLICT` (`sku_id`/`content_id` NULL membuat unique index tidak bisa jadi target
> conflict). **Sisa peta kolomDipanen→tabel fakta untuk 24 modul/5 tabel lain BELUM disentuh**
> — pekerjaan besar tersendiri, lihat `docs/handoff/HANDOFF_PDT_SESI14.md` §1 untuk kandidat
> modul berikutnya (`tt_video`→`pdt_fact_content` direkomendasikan, kolomnya paling verified).
>
> **Status 2026-09-14 (sub-langkah 2b-ii — MODUL KEDUA, `docs/DECISIONS.md` baris teratas)** —
> `tt_video` → `pdt_fact_content` (`ekstrakBarisTtVideo`) ditulis sungguhan, dua tabel fakta
> sekarang punya penulis (`pdt_fact_ads`, `pdt_fact_content`). Investigasi ulang (bukan percaya
> framing "kolomnya paling verified" apa adanya) menemukan `Likes`/`Dibagikan`/`Klik Produk`
> AMAN dipanen (verified di `baseline/metrik.ts`/`report/metrik.ts`, dua modul yang sebelumnya
> tidak dicek) — `waktu_posting`/`sku_id` TETAP NULL (nol parser `Waktu` terverifikasi; SKU
> master belum ada). `is_akun_toko` — fungsi PERTAMA turunan boolean per-baris `ID Kreator` vs
> `akun_konten_toko`, baru ditulis sesi ini. Modul ini pakai `ON CONFLICT DO UPDATE` SUNGGUHAN
> (kunci uniknya, beda dari `pdt_fact_ads`, tidak punya komponen NULL). **Efek samping**: bug
> test-fixture double-encoding jsonb ditemukan+diperbaiki (`pdt.test.ts` `insertClientPlatform`)
> — seluruh tes identitas TikTok lama diam-diam menguji perilaku yang salah (substring-match
> kebetulan cocok, bukan keanggotaan array sungguhan), sekarang diperbaiki. **Sisa 23 modul/3
> tabel fakta lain BELUM disentuh** — lihat `docs/handoff/HANDOFF_PDT_SESI15.md` untuk kandidat
> berikutnya.
>
> **Status 2026-09-14 (PR #368 DI-MERGE ke `main`, `docs/handoff/HANDOFF_PDT_SESI16.md`)** —
> seluruh isi sub-langkah 2a+2b-i+2b-ii (dua modul di atas) sekarang di `main`, bukan lagi di
> branch PR terpisah. Sesi berikutnya mulai dari `main` langsung.
>
> **Status 2026-09-14 (sub-langkah 2b-ii — MODUL KETIGA, `docs/DECISIONS.md` baris teratas)** —
> rekomendasi sesi lalu (`shopee_live`/`shopee_video`) diinvestigasi dulu, KEDUANYA ternyata
> BLOCKED (`shopee_live`: kelas blocker sama `tt_live`, nol kolom identitas sesi live stabil —
> `G1-09-2BII-SHOPEELIVE`, Open baru; `shopee_video`: masih `UNVERIFIED_SIGNATURE`, tidak
> berubah). **`pdt_sku_master` dibangun sebagai gantinya** — `shopee_parent_sku` (Shopee,
> sendirian, Rule 18) + `tt_orders` (TikTok, sendirian — DEVIASI SADAR dari Rule 18 harfiah yang
> minta digabung `tt_transaction_product`, karena nol kunci gabung terverifikasi antara dua grain
> berbeda, lihat `docs/DECISIONS.md`) → `pdt_sku_master`. **UPSERT sungguhan** (bukan
> delete-then-insert/`ON CONFLICT DO UPDATE` polos seperti dua tabel fakta sebelumnya) — Rule 19
> (SKU tidak pernah dihapus) ditegakkan lewat `COALESCE` field opsional + `status_listing`
> selalu `'aktif'` saat terlihat + `first_seen_at` hanya diisi sekali. **Belum dibangun (sengaja):**
> transisi `status_listing` ke `nonaktif`/`dihapus_platform` untuk SKU yang berhenti muncul
> (`G1-09-2BII-SKU-STATUS-TRANSISI`, Open baru — PRD tidak merinci kriteria pemicu); `sku_id` di
> `pdt_fact_content`/`pdt_fact_ads` TETAP NULL (resolusi FK adalah pekerjaan lanjutan terpisah,
> lihat `docs/handoff/HANDOFF_PDT_SESI17.md` untuk kandidat modul berikutnya). Tiga
> modul/tiga tabel fakta (dari enam) kini punya penulis: `pdt_fact_ads`, `pdt_fact_content`,
> `pdt_sku_master`. Sisa 21 modul/3 tabel fakta lain (`pdt_fact_sku_period`,
> `pdt_fact_creator_period`, sisa `pdt_fact_ads`/`pdt_fact_content`) belum disentuh.
>
> **Status 2026-09-14 (sub-langkah 2b-ii — MODUL KEEMPAT, `docs/DECISIONS.md` baris teratas)** —
> `tt_transaction_creator` → `pdt_fact_creator_period` (`ekstrakBarisKreatorTtTransactionCreator`).
> Dipilih SETELAH mengevaluasi `shopee_ads_cpc` lebih dulu (blocker lamanya — SKU master belum
> ada — sudah tertutup) dan menemukan blocker BARU yang lebih dalam: legacy parser
> (`report/shopee/metrik.ts` `parseAdsCsv`) mengunci baris lewat `nama iklan`, bukan `Kode Produk`
> — menyiratkan grain SEBENARNYA modul itu mungkin satu baris PER IKLAN (bukan per produk), dan
> salah tebak `kampanye_id` berisiko unique-violation di runtime, bukan cuma salah data. `G1-09-
> 2BII-ADS-CPC` diperbarui (bukan ditutup) mencatat temuan ini — TETAP terbuka, butuh sample asli.
> `tt_transaction_creator` dipilih sebagai gantinya: grain barisnya SUDAH per-kreator, cocok
> persis kunci `pdt_fact_creator_period`, nol ambiguitas serupa. `ON CONFLICT DO UPDATE` (bukan
> delete-then-insert) — kunci unik tabel ini tidak pernah punya komponen NULL. `Tayangan video`/
> `Perkiraan komisi` (whitelist modul ini) SENGAJA tidak ditulis ke tabel ini (konsumen Co-Pilot/PX,
> belum dibangun). **Empat modul/empat tabel fakta (dari enam) kini punya penulis**: `pdt_fact_ads`,
> `pdt_fact_content`, `pdt_sku_master`, `pdt_fact_creator_period`. Sisa: `pdt_fact_sku_period`
> (nol penulis) + 20 modul lain yang belum dipetakan ke tabel yang SUDAH punya penulis.
>
> **Status 2026-09-14 (sub-langkah 2b-ii — MODUL KELIMA, `docs/DECISIONS.md` baris teratas)** —
> `shopee_ams_afiliasi` → `pdt_fact_creator_period` (`ekstrakBarisKreatorShopeeAmsAfiliasi`),
> sisi Shopee untuk tabel yang modul keempat baru mengisi sisi TikTok-nya. `shopee_ams_produk`
> (dikelompokkan bersama di `PDT_KOLOM_DIPANEN.md` §2.10) SENGAJA TIDAK ikut dipetakan — grainnya
> PER PRODUK, bukan per-kreator, tidak cocok kunci tabel ini. `Username`→`creator_handle` (bukan
> `ID Affiliates` — cermin legacy `parseAffCsv`), `Omzet`→`gmv`, `Pesanan`→`pesanan_teratribusi`.
> `Komisi`/`ROI` SENGAJA tidak ditulis (konsumen PX Flow D `commission_pct`, domain lain, tabel
> ini tidak punya kolom untuk keduanya). `pdt_fact_creator_period` sekarang punya penulis di
> KEDUA platform (TikTok + Shopee) — lima modul/empat tabel fakta (dari enam) kini punya penulis.
> Sisa: `pdt_fact_sku_period` (nol penulis) + 19 modul lain belum dipetakan.
>
> **Status 2026-09-14 (sesi 19, sub-langkah 2b-ii — MODUL KEENAM, `docs/DECISIONS.md` baris
> teratas)** — `shopee_ads_cpc` → `pdt_fact_ads` (`ekstrakBarisShopeeAdsCpc`), blocker grain
> `G1-09-2BII-ADS-CPC` TERTUTUP: pemilik mengunggah sample EKSPOR ASLI (Fim Motor), grain TERBUKTI
> per IKLAN (`nama iklan` sebagai `kampanye_id`, BUKAN `Kode Produk` — baris "Shop GMV Max" di
> sample asli tidak punya `Kode Produk` sama sekali tapi tetap baris sah). `Dilihat`→`tayangan`,
> `Jumlah Klik`→`klik` (beda dari `shopee_ads_live` yang tidak punya kolom klik), `Konversi`→
> `pesanan_sku`, `omzet penjualan`→`gmv`, `Biaya`→`biaya`, `Efektifitas Iklan`→`roas`. `sku_id`
> SENGAJA tetap `null` — `Kode Produk` level produk induk, `pdt_sku_master` berkunci per varian,
> lookup langsung akan mengarang varian (Open baru `G1-09-2BII-ADS-CPC-SKU`, kelas ambiguitas sama
> dengan modul KEENAM/KETUJUH `pdt_fact_sku_period` di bawah, belum punya preseden). **Bug LATEN
> ditemukan & diperbaiki**: `kolomDipanen` modul ini (`modules.ts`/`pdt_parser_modul`) salah sejak
> G1-02 — `ID Toko`/`Periode` (preamble) salah dimasukkan sebagai kolom header (`validasiKolomWajib`
> akan SELALU gagal untuk berkas asli), dan ejaan kolom ACOS adalah tebakan yang tidak pernah cocok
> sample nyata; keduanya dikoreksi (`modules.ts` + migrasi `UPDATE pdt_parser_modul`), plus migrasi
> melebarkan `pdt_fact_ads.kampanye_id` ke `varchar(255)` (nama iklan bisa sepanjang judul produk).
> **Enam modul/lima tabel fakta (dari enam) kini punya penulis.** Sisa: `pdt_fact_sku_period` (nol
> penulis, tabel fakta TERAKHIR tanpa penulis) + 19 modul lain belum dipetakan.
>
> **Status 2026-09-14 (sesi 20) — dua bug LATEN dikoreksi (bukan modul baru), ditemukan saat
> menginvestigasi kandidat modul KETUJUH.** `shopee_ams_produk` (`ProductPerformance_*.csv`)
> TIDAK PERNAH terdeteksi sejak G1-02 — `tandaTanganKolom` lama mensyaratkan substring `'nama
> produk'`, header asli ber-`'Nama Item'`; dikoreksi ke `must: ['Kode Item', 'Omzet'], mustNot:
> ['ID Affiliates']`. `shopee_ams_afiliasi` (modul KELIMA, sesi 17, SUDAH menulis
> `pdt_fact_creator_period`) terdeteksi BENAR tapi `kolomDipanen`-nya (`'Username'`/`'Omzet'`/
> `'Komisi'` polos) tidak pernah cocok header asli (`'Username Affiliate'`/`'Omzet
> Penjualan(Rp)'`/`'Estimasi Komisi(Rp)'`) — modul ini SELALU `parse_status='gagal'` di produksi
> sejak lahir. Keduanya dikoreksi (`modules.ts`, `fakta.ts` `ekstrakBarisKreatorShopeeAmsAfiliasi`,
> migrasi `UPDATE pdt_parser_modul`). **Modul KETUJUH (`shopee_ams_produk` → `pdt_fact_sku_period`)
> BELUM dibangun** — `sku_id` NOT NULL DAN bagian kunci unik tabel itu, jadi TIDAK ADA baris yang
> bisa ditulis sampai lookup `Kode Item` (produk induk) → `pdt_sku_master.id` (per varian)
> diputuskan (Open `G1-09-2BII-ADS-CPC-SKU`, sekarang menunggu DUA modul nyata).
>
> **Status 2026-09-14 (sesi lanjutan pasca-sesi 20) — EMPAT bug `kolomDipanen` lagi dikoreksi**
> (`shopee_ads_search`, `shopee_live`, `shopee_chat`, `shopee_chat_broadcast`), ZIP Fim Motor
> LENGKAP (15 berkas) diekstrak ulang untuk memeriksa berkas yang belum pernah dibaca sesi
> mana pun. Pola sama seluruhnya: ejaan `kolomDipanen` tidak pernah diverifikasi, tidak pernah
> cocok berkas nyata. `shopee_ads_search`: sample JUGA membuktikan `Nama Iklan`/`Biaya` ada
> (premis `G1-09-2BII-ADS-SEARCH` usang) — writer BELUM dibangun (keputusan whitelist baru,
> lihat Open diperbarui). `shopee_live`: ejaan diperbaiki, blocker identitas
> `G1-09-2BII-SHOPEELIVE` TETAP terbuka. `shopee_chat`/`shopee_chat_broadcast`: keduanya belum
> punya writer, jadi koreksi ini murni mencegah `parse_status='gagal'` sejak modul ini kelak
> dibangun. **Investigasi TANPA kode** untuk `shopee_diskon`/`shopee_flash_sale`
> (`UNVERIFIED_SIGNATURE` sejak G1-02): header asli dibaca pertama kali, deskripsi lama
> "sama struktur `shopee_voucher`" TERBUKTI SALAH — dicatat Open baru
> `G1-09-2BII-DISKON-FLASHSALE-STRUKTUR`, menunggu keputusan kolom mana yang dipanen.
>
> **Status 2026-09-14 (sesi lanjutan, PR #378 sudah merge) — bug `kolomDipanen` KELIMA: `meta_ads`.**
> Berkas TERAKHIR yang tersisa di ZIP Fim Motor (`Laporan-tanpa-judul-*.xlsx`) diperiksa — pola
> sama: 6 dari 11 kolom lama hilang sufiks Meta Ads Manager (`'(IDR)'`, `'Khusus untuk Item
> Bersama'`, dsb.). Dikoreksi (modul opsional PDT-22, belum ada writer — koreksi ini tidak
> membuka konsumen baru).
>
> **Status 2026-09-14 (sesi lanjutan, PR #379 sudah merge) — `shopee_video` TEMUAN DEFINITIF, nol
> perubahan kode.** Satu-satunya berkas ZIP Fim Motor yang belum dibaca ISINYA secara penuh
> (`video-overview-v3*.csv`, 32 baris) akhirnya dibaca lengkap — bukan "kolom belum
> diverifikasi" seperti dicatat sejak G1-02, tapi berkas ini TIDAK PUNYA BARIS PER VIDEO SAMA
> SEKALI (satu baris agregat per akun per periode + blok ringkasan per sumber kunjungan, nol
> identitas video di 54 kolom). Modul ini secara STRUKTURAL tidak bisa menulis
> `pdt_fact_content` dari sumber laporan "Video Overview" — dicatat Open baru
> `G1-09-2BII-SHOPEEVIDEO-GRAIN`, menunggu konfirmasi apakah ada laporan Shopee per-video lain
> yang belum diunggah. `shopee_video` TETAP `UNVERIFIED_SIGNATURE`. **Ini menutup investigasi ZIP
> Fim Motor — seluruh 15 berkas sudah diperiksa minimal sekali.**
>
> **Status 2026-09-14 (sesi 22) — MODUL KETUJUH: `shopee_ads_search` → `pdt_fact_ads`,
> `G1-09-2BII-ADS-SEARCH` DITUTUP.** `HANDOFF_PDT_SESI21.md` §3.B menandai ini murni
> implementasi (pola sudah ada) — dikerjakan tanpa menunggu pemilik. `kolomDipanen` dilebarkan
> `'Nama Iklan'`/`'Biaya'`; `ekstrakBarisShopeeAdsSearch` + writer `pdt_fact_ads` dibangun.
> `kampanye_id` **KOMPOSIT** (`nama iklan :: kata pencarian`, BUKAN `nama iklan` polos seperti
> `shopee_ads_cpc`) — aman kalau satu iklan search ternyata punya banyak baris per keyword
> (belum terbukti dari sample 1 baris, tapi mahal untuk salah tebak). `Kata Pencarian` dibaca
> untuk identitas baris TAPI TIDAK ditambahkan ke `kolomDipanen` — Q-6 (isinya sebagai dimensi
> laporan) TETAP terbuka menunggu Anty. **Tiga tabel fakta sekarang punya total TUJUH modul
> penulis** (`pdt_fact_ads`: `shopee_ads_live`/`shopee_ads_cpc`/`shopee_ads_search`;
> `pdt_fact_content`: `tt_video`; `pdt_sku_master`: `shopee_parent_sku`/`tt_orders`;
> `pdt_fact_creator_period`: `tt_transaction_creator`/`shopee_ams_afiliasi`). Migrasi baru:
> `20261023010000_..._pdt_parser_modul_ads_search_kolom.sql`. Diverifikasi (DB lokal rebuild
> bersih): `@cdps/core` 1191/1191, `@cdps/domain` 2590/2590 (1 skip), `@cdps/db` 107/107,
> `@cdps/api` 576/576 (2 skip); typecheck + lint bersih.
>
> **Status 2026-09-14 (sesi 23) — pemilik menjawab TIGA keputusan `HANDOFF_PDT_SESI22.md` §2
> sekaligus (A/C/D); MODUL KEDELAPAN: `shopee_ams_produk` → `pdt_fact_sku_period`.**
> **A** ("kebutuhan hanya GMV per produk bukan sampai varian", `G1-09-2BII-ADS-CPC-SKU` DITUTUP):
> `platform_product_id varchar(128) NULL` (salinan identitas, bukan lookup) ditambah ke
> `pdt_fact_ads`/`pdt_fact_sku_period`; `pdt_fact_sku_period.sku_id` DILONGGARKAN nullable + CHECK
> identitas + dua unique index PARSIAL + RLS pindah ke `jwt_owns_client_platform_am` langsung
> (migrasi `20261025010000`) — membuka blocker `sku_id NOT NULL` yang menahan `shopee_ams_produk`
> sejak lahir ("BLOCKED TOTAL", SESI21 §1). `shopee_ads_cpc` sekarang mengisi `platform_product_id`
> dari `Kode Produk`. `shopee_ams_produk` (modul KEDELAPAN) akhirnya dibangun: `Kode Item`→
> `platform_product_id`, `Omzet Penjualan(Rp)`→`gmv`, `Produk Terjual`/`Pesanan` terisi,
> `Estimasi Komisi(Rp)`/`ROI` TETAP tidak ditulis (sumber PX Flow D, domain lain). `basis =
> 'dibayar'` — ditanyakan lewat `AskUserQuestion` (AMS tidak menyebut basisnya), pemilik memilih
> "Pesanan Dibayar/Selesai". **B (C di §2)** ("Jalan rekomendasi", `G1-09-2BII-DISKON-FLASHSALE-
> STRUKTUR` DITUTUP): `shopee_diskon`/`shopee_flash_sale` dinyalakan dari `UNVERIFIED_SIGNATURE`
> ke whitelist MVP (agregat harian sheet "Kriteria Utama" saja) — nol writer fact-table, sama
> pola `shopee_voucher`/`shopee_chat`. **C (D di §2)** ("Tidak ada" laporan per-video lain di
> Shopee Seller Center, `G1-09-2BII-SHOPEEVIDEO-GRAIN` DITUTUP): `shopee_video.wajib` diturunkan
> `true`→`false` (deviasi PRD §7.2, disetujui pemilik langsung) — dimensi Video PDT sekarang
> hanya dari TikTok. **Empat tabel fakta sekarang punya total DELAPAN modul penulis** (`pdt_fact_
> ads`: `shopee_ads_live`/`shopee_ads_cpc`/`shopee_ads_search`; `pdt_fact_content`: `tt_video`;
> `pdt_sku_master`: `shopee_parent_sku`/`tt_orders`; `pdt_fact_creator_period`:
> `tt_transaction_creator`/`shopee_ams_afiliasi`; `pdt_fact_sku_period`: `shopee_ams_produk`
> — PENULIS PERTAMA tabel ini). Migrasi baru: `20261024010000_..._diskon_flashsale_video.sql`,
> `20261025010000_..._ads_cpc_sku_platform_product_id.sql`. Diverifikasi (DB lokal rebuild bersih,
> `rls_checks` invariant lolos): `@cdps/core` 1199/1199, `@cdps/domain` 2594/2594 (1 skip),
> `@cdps/db` 107/107, `@cdps/api` 576/576 (2 skip); typecheck + lint bersih.

### G1-10 · Job purge harian — **Vercel Cron, BUKAN pg_cron**
Konsekuensi P-09: pola `pg_cron`-di-balik-guard yang ada (`20260811040000_interview_cron.sql`)
hanya bisa menyentuh baris DB. Menghapus **objek storage** butuh panggilan API.

⇒ Inangnya **`/api/v1/internal/pdt/purge/tick`** dengan `tickSecretOk`
(`apps/api/src/lib/tick-auth.ts` — menerima `x-plan-tick-secret` **atau** `Authorization: Bearer`,
constant-time, **fail-closed bila secret tidak dikonfigurasi**), didaftarkan di
`apps/api/vercel.json` seperti tiga tick yang sudah jalan.

Urutan kerja (Flow E):
1. Pilih batch `retensi_sampai < current_date`, `legal_hold = false`, `raw_dihapus_pada IS NULL`.
2. **Hitung ulang perpanjangan retensi lebih dulu** — laporan terkirim dan keanggotaan katalog PX
   bisa berubah sejak batch dibuat. `retensi_sampai` **tidak pernah diperpendek**.
3. **Pagar 5%/hari** (Rule 48): terlampaui ⇒ **berhenti**, notifikasi Director, **nol objek dihapus**.
4. Hapus objek → isi `raw_dihapus_pada` → tulis `audit_logs` (`type='auto'`,
   `action='pdt_raw_purged'`, jumlah objek + total byte).
5. Pass kedua: objek **yatim** (ada di bucket, nol baris `pdt_upload_batch`) > **7 hari**.
6. *Error path:* gagal hapus satu objek **tidak** menghentikan sisanya; dicoba lagi besok.
   `raw_dihapus_pada` **hanya** diisi setelah penghapusan benar-benar berhasil.

⛔ **Purge menghapus OBJEK STORAGE saja.** Baris fakta, laporan, verdict, dan `pdt_file`
**tidak pernah** ikut terhapus — purge storage bukan penghapusan data. Aturan rumah #3 utuh:
`audit_log` tidak pernah disentuh.

**Retensi TETAP 120 hari (P-08 tertutup, §2.4 sesi 2) — saran PRD "turunkan ke jendela platform"
SENGAJA tidak dijalankan.** TikTok mundur 180 hari (> 120, aman); Shopee mundur 90 hari
(**< 120** — 30 hari di mana paket ZIP kita satu-satunya salinan). Menurunkan retensi akan
menghapus salinan itu tepat saat ia mulai jadi satu-satunya. Yang **ditambahkan** sebagai
gantinya: status batch **`tidak_dapat_dipulihkan`**, ambang **per platform** (TikTok umur batch
> 180 hari, Shopee > 90 hari, dihitung dari `periode_selesai`) — dipasangkan dengan
`perlu_upload_ulang` (Rule 11 PRD, direvisi sesi 2). Batch di luar ambang platformnya ditandai
`tidak_dapat_dipulihkan`, bukan `perlu_upload_ulang`: menyuruh AM "upload ulang" di luar jendela
mundur platform adalah instruksi yang mustahil dijalankan.

**DoD:** purge jalan di staging, `audit_logs` terisi · pagar 5% diuji dengan sengaja
melampauinya (harus berhenti di nol objek) · selesai < 2 menit pada 500 klien × 12 bulan riwayat.

### G1-11 · Reparse dari paket ZIP (Flow D)
- `parser_versi` dicatat **per batch dan per baris fakta**.
- Job reparse mengunduh paket batch lama yang **masih dalam masa retensi**, memparse ulang,
  menaikkan `parser_versi`, mencatat `audit_logs` (`action='pdt_reparse'`).
- Batch yang paketnya sudah dipurge **dilewati dan dilaporkan sebagai daftar** — bukan digagalkan
  diam-diam — lalu ditandai `perlu_upload_ulang` **secara eksplisit, dan hanya batch itu**.
  UI wajib menyebut **tanggal purge**-nya, bukan hanya "tidak tersedia".

> Inilah yang O70/O71 tidak punya: saat kedua bug itu diperbaiki, batch lama tidak bisa
> direparse sama sekali karena berkasnya sudah dibuang.

**DoD:** reparse mengubah angka pada fixture yang sengaja diparse dengan parser lama · batch
ber-paket-terpurge muncul di daftar laporan, bukan hilang.

---

## 2. G2 — Laporan sebagai view + benchmark UI admin

> Mematikan: **Report Engine TikTok & Shopee**.

### G2-01 · ⚠️ Membalik invarian `client_reports` yang sedang berjalan (PDT-21)
Hari ini `client_reports` **adalah** snapshot beku saat **dibuat** (`trg_client_reports_frozen`),
dan ia **penulis tunggal `clients.total_sales`** (gap C1). UAT Fim Motor §7.4 mencatat akibatnya:
laporan lama **tidak pernah** dihitung ulang saat parser diperbaiki.

PDT-21 membaliknya: laporan = **view atas fakta**; snapshot beku **hanya saat dikirim ke klien**.

**Yang meringankan — sebagian sudah terbangun.** `packages/domain/src/report.ts` sudah punya
`publishReport`, `republishReport`, `revokeReport`, dan `recomputeTotalSales`. Rule 24
(pencabutan memicu hitung ulang agregat klien) sebagian tinggal disambungkan.

- Tidak ada baris laporan yang menyimpan angka yang bisa dihitung dari fakta (Rule 21).
- `pdt_laporan_kiriman` menyimpan payload final + `parser_versi` + `benchmark_versi` +
  `dikirim_pada`; append-only, trigger `_frozen()`.
- Laporan revisi = snapshot baru menunjuk `menggantikan_kiriman_id`. **Tidak meminta berkas ulang.**
- Pencabutan **wajib** memicu hitung ulang `total_sales`, Health Score, baseline Ads.
  **Nol jalan keluar lewat SQL manual** (Rule 24).

### G2-02 · Benchmark UI admin (Director)
- Ganti versi ⇒ seluruh laporan **yang belum dikirim** otomatis ikut versi baru; yang **sudah
  dikirim** tetap memakai versi saat pengiriman (Rule 23). **Nol permintaan upload ulang ke AM.**
- Mengubah ambang **tidak boleh lagi** butuh migrasi SQL + deploy (Rule 25).
- Gate: `canKelolaBenchmark(actor)` = **Director saja** (preseden `productexchange.canKelolaPolicy`).

**DoD:** mengubah ambang lewat UI menggeser skor laporan belum-terkirim dan **tidak** menggeser
yang sudah terkirim, dibuktikan satu tes.

---

## 3. G3 — Prefill (PDT-18)

> Mematikan: **AM Baseline (Riset Awal + Video Factory)** — termasuk iframe
> `web-internal/public/tools/video-factory.html`.

**Permukaan sebenarnya hari ini jauh lebih sempit dari yang PRD sangka.** Menurut
`DECISIONS.md` 2026-08-20, yang terwarisi dari Riset Awal ke Section B **hanya**: B-0.6
(provenance), B-0.7 (periode), dan B-1 (GMV + jumlah pesanan per bulan). Selebihnya —
% batal, belanja iklan, ROAS, ACOS per bulan, dan **seluruh B-2…B-9** — masih manual.
Itulah ruang ekspansi terbesar PDT.

- Field yang punya sumber di fakta **wajib** terisi otomatis dan **read-only**, dengan tautan ke
  batch sumbernya (Rule 33). AM tidak boleh diminta "memeriksa satu per satu" field yang sistem
  sudah tahu.
- Field tanpa sumber tetap manual, **ditandai jelas sebagai input manusia** (Rule 34).
- **Riwayat GMV 6 bulan tidak pernah diketik** (hari ini sampai **24 sel** manual) — dihitung dari
  `pdt_fact_shop_daily` batch-batch sebelumnya (Rule 35).
- **Jalur koreksi Riset Awal** (Rule 36): submit kedua membuat batch baru dengan
  `menggantikan_batch_id`; batch lama ditandai `digantikan`, **bukan dihapus**. Salah upload
  sekali tidak boleh mengunci skor klien selamanya.

⚠️ **Dua pagar yang sudah ada dan wajib dihormati:**
1. **CHECK Rule 5 `strategi_channel`** (`20260806064000_m6a_strategi.sql:282-296`): bila ada angka
   baseline terisi, maka `periode_baseline_bulan` (1–6) **DAN** `sumber_data` **DAN**
   `tanggal_ambil_data` **DAN** `lampiran` wajib non-kosong; `periode_baseline_bulan < 3`
   menuntut `alasan_periode_pendek`. Prefill wajib memenuhi ini, bukan menabraknya.
2. `mergeBaselinePrefill` (`web-internal/src/lib/strategi-baseline-inherit.ts`) **hanya mengisi
   yang kosong, tidak pernah menimpa**. Pertahankan.

⛔ **`strategi.ts` (7.763 baris) tidak disentuh** (PDT-18).

---

## 4. G4 — Katalog usulan bersatuan

> Mematikan: **AM Co-Pilot**, termasuk iframe `web-internal/public/tools/am-copilot.html`.

**Ini bukan port.** `packages/core/src/copilot.ts` (1.002 baris, 4 pilar × 20 aksi, `verdict()`,
`skor()`, `saranD5()`) **sudah** di server, dengan rute `GET /api/v1/strategi/{id}/copilot`.
Yang G4 kerjakan adalah tiga hal yang belum ada:

### G4-01 · Katalog pindah **kode → DB**
`pdt_usulan_katalog` (`kode` PK, `platform_berlaku text[]`, `kondisi jsonb`, `metrik_kunci`,
`satuan pdt_satuan_t`, `target_formula jsonb`, `divisi_tujuan`, `aktif`). Nol logika perhitungan
di berkas HTML mandiri. Nol komponen LLM — seluruh usulan **deterministik**.

### G4-02 · Satuan bertipe — **tidak ada enum untuk dipakai ulang**
Diverifikasi: `plan_row.satuan` (`varchar(32)`) dan `strategi_resource.satuan` (`varchar(24)`)
adalah **teks bebas tanpa CHECK**; `master_service.unit` bahkan pernah harus dibersihkan migrasi
(`20260920010000_d0_bersihkan_unit_sisa_angka.sql`, 16 baris masih berisi hitungan bulan).
Jadi `pdt_satuan_t` (`rupiah`, `persen`, `hitungan`, `jam`, `hari`, `views`) **benar-benar baru**.

- Target disimpan sebagai **`(nilai numeric, satuan enum)`** (Rule 27). Ini yang menutup bug
  "20 sesi live dicetak Rp 20,00" dan "CTOR 1,5% dicetak sebagai Rupiah".
- Rendering ke brief divisi **wajib** lewat **satu** formatter yang membaca `satuan`.
  **Formatter bebas-satuan dilarang** (Rule 28).
- ⚠️ **Sebutkan formatter mana.** Repo punya **tiga** gaya IDR yang hidup berdampingan:
  `formatIDR` (`web-internal/src/lib/money.ts` + `packages/core/src/money.ts`) untuk konvensi
  rumah `Rp. X.XXX.XXX,00`; bentuk ringkas yang **sengaja menyimpang** di
  `packages/core/src/report/render.ts` dan `adsscanner/tiktok/render.ts`; dan
  `toLocaleString('id-ID')` mentah di `brief-inherit.ts:182` + `ads.ts:1766`.

### G4-03 · Minimal **6 aksi khusus Shopee** + loop verdict
- Tiap aksi menyatakan `platform_berlaku` **eksplisit**. Aksi yang hanya berlaku TikTok
  **tidak boleh** membuat klien Shopee menerima nol usulan **tanpa pesan**; bila nol aksi memenuhi
  syarat, UI wajib menampilkan alasannya per aksi terdekat (Rule 29).
- ≥ 6 aksi Shopee **sebelum tool lama dimatikan** — populasi klien miring ke Shopee, dan Co-Pilot
  lama menghasilkan **nol** usulan untuk seluruh populasi itu (Rule 30).
- **Loop evaluasi wajib hidup** (Rule 31): `pdt_usulan` menyimpan `nilai_sekarang`,
  `target_nilai`, `realisasi_nilai`, `verdict` (`tidak_dikerjakan` / `gagal` / `tercapai`).
  Pemisahan **"tidak dikerjakan" (masalah tim)** vs **"gagal" (masalah taktik)** adalah
  satu-satunya sinyal yang membedakan keduanya — dan hari ini ia **tidak pernah jalan**.

⚠️ **Jangan tulis `wrr_metrik` langsung.** Baris ber-`otomatis` di sana UPDATE-blocked untuk AM;
jalur yang benar dari hasil parse adalah membuat **Metric Entry (`MTR-`, `entry_method='File Export'`)**.
GMV bulanan otoritatif tetap entri manual AM (M6B P-E / M6D §3 Rule 11).

---

## 5. G5 — Product Exchange — ⛔ **DIBLOKIR, jangan dijadwalkan**

**Blokirnya:** `pdt_sku_master.level2_category` dan `price_segment` **tidak punya tipe di CDPS**.
Grep seluruh `supabase/migrations/**`: nol hasil untuk keduanya dan untuk enum `price_segment_t`.
Keduanya hidup di sisi **MCN/MSDPS** (`bridge.px_creator_capability`,
`creator_subcat_segment_gmv`). Pertanyaan asli P-02 ("apakah granularitasnya cocok") belum bisa
**diajukan** sebelum diputuskan bagaimana taksonomi lintas-sistem itu masuk CDPS.

**Blokir kedua:** `px_sku_volume` dan `px_sku_eligibility` **belum ada** — keduanya milik
**PX-M2b**, ditunda bersama M3 (`20261008010000:33-34`). Yang ada hari ini hanya
`px_eligibility_policy`.

**Yang PDT akan suplai bila kedua blokir terbuka** (dan ini memang jawaban atas A-08 PRD PX,
*"per-SKU rows exist in the platform pull but are not persisted"*):
- baris per-SKU persisten (`platform_product_id`, `Seller SKU`, kategori, harga satuan),
- `px_sku_volume` basis **pesanan dibayar**, jendela **30 hari** (PDT-19),
- `sumber_report` menunjuk balik ke sumbernya.

**Yang tidak berubah:** Rule 13 PX — tiga keluaran **layak / tidak layak / `data_kurang`**;
"tidak tahu" tidak boleh dilipat jadi "tidak layak". Rule 16 — `px_sku_volume` default-deny,
**angka volume berhenti di CDPS, hanya verdict yang menyeberang ke MCN**.

**P-05 sudah terjawab dan jawabannya TIDAK** — lihat §6.

---

## 6. Open Assumptions — status verifikasi

Empat dari sebelas sudah terjawab dari kode (sesi 1). **Tiga di antaranya premisnya keliru.**
**Update sesi 2 (ketokan Nerissa 2026-09-13):** lima lagi tertutup — P-01 (verifikasi kode),
P-06/P-08/P-10/P-11 (ketokan pemilik, `HANDOFF_PDT_SESI1.md` §2–§2.4). **Sembilan dari sebelas**
sekarang tertutup. Sisa dua: **P-04** (🟠 sebagian) dan **P-07** (🟡 terbuka, kapasitas partisi) —
**tidak satu pun dari sebelas memblokir G1.**

| # | Status | Temuan | Penjawab | Memblokir |
|---|---|---|---|---|
| **P-01** | ✅ **tertutup (sesi 2)** | Dua sample adalah **TikTok vs Tokopedia** (`shop_tt`/`shop_tp`, 35 baris sama, periode sama), bukan filter produk — `baseline/detect.ts:26-27`. `tt_orders` tetap kanonik | Claude (verifikasi kode) | selesai — G1-07 memakai `tt_orders`, bukan `tt_shop_analytics`, sebagai sisi rekonsiliasi TikTok |
| **P-02** | 🔴 **premis salah** | `level2_category` **nol hasil** di `supabase/migrations/**`; ia hidup di MCN | Hans | **G5** |
| **P-03** | 🔴 **premis salah** | enum `price_segment_t` **tidak ada di CDPS sama sekali** | Hans | **G5** |
| **P-04** | 🟠 **sebagian** | `readSheet` memang dipakai bersama — tapi ada **4 registry tanda tangan terpisah** + **2 parser angka beda perilaku** (`n()`→0 vs `parseIndonesianNumber()`→NaN) | — | melebarkan **G1-02/G1-03** |
| **P-05** | ✅ **tertutup (premis salah)** | `optimization_tracker` = tracker A/B before-after, **mutable**, `product_code` jatuh balik ke **nama produk** ⇒ melanggar Rule 20. **Bukan** master SKU, **tidak dimigrasi**; riwayat kuadran yang dikhawatirkan hilang **tidak pernah ada** di sana | Claude (verifikasi kode) | tidak memblokir |
| **P-06** | ✅ **tertutup (F-9, sesi 2)** | Ketokan F-9 ("SKU tanpa Kode Produk tidak dimasukkan ke Product Exchange") membuat stabilitas `Kode Produk` **tidak lagi jadi prasyarat**: Rule 20 menang apa pun jawabannya — SKU dengan kunci tak stabil/hilang jadi baris yatim yang di-*resolve*, bukan alasan menunda `pdt_sku_master` | Nerissa (ketokan 2026-09-13) | tidak memblokir — stabilitas empirisnya tetap layak dipantau AM/Hans, di luar jalur kritis |
| **P-07** | 🟡 terbuka | ≈9 juta baris/tahun di `pdt_fact_sku_period` | Hans | butuh partisi per tahun **sejak awal** |
| **P-08** | ✅ **tertutup (§2.4, sesi 2)** | TikTok 180 hari mundur > retensi 120 hari (aman); **Shopee 90 hari < 120 hari** — 30 hari paket ZIP jadi satu-satunya salinan. Saran PRD ("turunkan retensi") **sengaja tidak dijalankan** — itu menghapus salinan tepat saat ia mulai jadi satu-satunya | Nerissa (ketokan 2026-09-13) | **retensi TETAP 120 hari**; G1-10 menambah status `tidak_dapat_dipulihkan` per platform (TikTok >180h, Shopee >90h) sebagai gantinya |
| **P-09** | ✅ **terkonfirmasi** | nol bucket, nol `supabase/functions/`, `storage.objects` kosong ⇒ **purge tidak bisa pure SQL** | — | memindahkan **G1-10** ke Vercel Cron |
| **P-10** | ✅ **tertutup (150–300, sesi 2)** | Desain dikunci ke **batas atas 300 klien**: ≈5,4 jt baris/tahun `pdt_fact_sku_period`, ≈0,72 GB ZIP pasca-purge, ≈5,3 GB fakta | Anty (ketokan 2026-09-13) | §6.8 PRD masih terhitung di atas asumsi 500 klien — revisi angka itu dicatat sebagai gap terbuka, di luar cakupan sesi 2 |
| **P-11** | ✅ **tertutup (SOP, sesi 2) — bersyarat** | Jawabannya bukan "AM pasti bisa tanpa bantuan": F-3/F-10 — adopsi rendah tool lama adalah **gejala** tool HTML lama yang tidak membantu, bukan bukti AM menolak berubah. Syarat: SOP tertulis **dan** tombol "cek paket" (sudah di desain G1-09) | Nerissa + Anty (ketokan F-3/F-10) | tiket SOP non-coding tetap di §7 butir 5 — **wajib selesai sebelum G1 merge** |

---

## 7. Yang belum dikerjakan dan BUKAN tiket coding

| # | Pekerjaan | Owner | Kenapa bukan Claude |
|---|---|---|---|
| 1 | **Daftar `kolom_dipanen` per modul (PDT-27) — bucket 1+2 SELESAI sesi 2** (`docs/backlog/PDT_KOLOM_DIPANEN.md`), **bucket 3 belum** | Hans + Anty | Bucket 3 ("human call", 11 kolom tanpa konsumen ⇒ buang, ketokan Q-6) butuh rekomendasi asli — tidak tertulis di repo mana pun yang sesi 2 temukan. Menebaknya = whitelist salah yang memegang data. Field Product Exchange (`SKU ID`/`Product ID`, `Seller SKU`, harga satuan, `Product category`, `gmv_dari_kreator`, `Sampel terkirim`, `ID Video`, `ID Kreator`, GMV basis **pesanan dibayar**) sudah masuk bucket 1, ditandai `[PX]` |
| 2 | Jawab P-07 | Hans | butuh fakta kapasitas operasional; **P-01/P-06/P-08/P-10 sudah tertutup sesi 2** (§6) |
| ~~3~~ | ~~Jawab P-11~~ | — | **tertutup sesi 2** (§6) — bersyarat SOP + tombol "cek paket", lihat butir 5 di bawah |
| 4 | Kumpulkan sample ≥ 2 klien lain per platform | Anty | ≥ 4 set sample supaya tanda tangan kolom tidak overfit ke 2 klien; juga menjawab A-3 (rentang per modul, §2.4 handoff) |
| 5 | **SOP AM**: satu batch per toko per periode + arti mengisi Shop ID | **Nerissa** + Anty | 100% AM tersosialisasi **sebelum** G1 merge — prasyarat P-11 (§6) |
| 6 | Matikan tulis di tool lama saat G1 merge | Hans | aturan strangler §8 |
| 7 | Cek tarif per GB Supabase | Hans | §6.8 mengikat pada **ukuran**, bukan tarif — jangan kutip rupiah sebelum dicek; §6.8 juga masih terhitung di atas asumsi 500 klien, bukan 300 (P-10, §6) |

---

## 8. Aturan strangler yang tidak boleh dilanggar (PDT-17)

> **Dibiarkan apa adanya (ketokan F-3/F-10, sesi 2).** Nerissa: *"Kita sedang mulai pakai CDPS,
> bertahap; 12 bulan adaptasi 100%. Adopsi rendah justru KARENA tool HTML lama tidak membantu — AM
> berulang kali mengisi kolom yang sama."* Adopsi rendah tool lama dengan demikian dibaca sebagai
> **gejala yang PDT obati**, bukan bukti bahwa strangler-nya harus dilonggarkan atau jadwalnya
> dipercepat/ditunda. Aturan di bawah **tidak direvisi** oleh ketokan ini — dicatat di sini supaya
> jelas bahwa itu keputusan sadar, bukan terlewat dipertimbangkan.

Sejak **G1 merge**: **nol batch baru** boleh masuk lewat tool lama. Tool lama hanya boleh
**dibaca** (data historis), tidak ditulis.

Tanpa aturan ini, strangler berubah menjadi *"dua sistem paralel selamanya"* — dan duplikasi
kerja AM justru **naik**, yang persis kebalikan dari alasan PDT dibangun.

**Gerbang antar gelombang:** sebuah gelombang hanya boleh merge bila gelombang sebelumnya sudah
`verified` pada **minimal 10 klien nyata** (campuran TikTok & Shopee), **bukan pada data seed**.

| Gelombang | Tool lama yang mati | Permukaan yang ikut mati |
|---|---|---|
| G1 | — (PDT jalan berdampingan, **wajib** untuk semua batch baru) | — |
| G2 | Report Engine TikTok & Shopee | — |
| G3 | AM Baseline (Riset Awal + Video Factory) | iframe `public/tools/video-factory.html` |
| G4 | AM Co-Pilot | iframe `public/tools/am-copilot.html` + jalur paste "MEA AM Cockpit" |
| G5 | — | — |

Setelah G4, `web-internal/public/tools/` seharusnya **kosong dari tool yang mengeksekusi logika**
(tersisa `xlsx.full.min.js` yang ikut terhapus bersama pemakainya), dan
`web-internal/src/lib/embedded-tools.ts` beserta dua baris nav-nya ikut dicabut.
