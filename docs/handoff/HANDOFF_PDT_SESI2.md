# HANDOFF — PDT (Pusat Data Toko) SESI 2 → SESI 3

> **Dibuat 2026-09-13.** Baca berkas ini **seluruhnya** sebelum menyentuh apa pun.
> Cabang kerja sesi 2 sudah **MERGE ke `main`** — mulai dari `main`, jangan dari cabang lama.
>
> **Status: §4 (5 tugas dokumen) selesai + G1-00 sebagian selesai.** Sesi 3 melanjutkan dari §2
> di bawah (G1-00 sisa) atau langsung ke G1-01 kalau prasyarat data diputuskan cukup nanti.

---

## 0. Ringkasan 60 detik

Sesi 1 memasukkan PRD PDT + backlog G1–G5 ke repo (nol kode). **Sesi 2** mengerjakan
`docs/handoff/HANDOFF_PDT_SESI1.md` §4 (5 tugas dokumen — PR #353, **merged**) lalu lanjut ke
G1-00 atas instruksi pemilik (PR #354, **merged**): `client_platforms.platform` sekarang punya
CHECK constraint di DB live, dipasang `NOT VALID` karena pembersihan klien testing **ditunda**.

**Satu hal paling penting:** 12 klien "testing" kandidat sudah teridentifikasi presisi (nama/toko/
`store_link` + 3 baris `client_platforms` bervokab gabungan) tapi **pemilik bilang jangan
disentuh dulu — masih dibutuhkan**. Jangan hapus/nonaktifkan klien mana pun dari daftar §2.1 di
bawah tanpa instruksi eksplisit baru dari pemilik/Nerissa/Anty.

---

## 1. Apa yang sudah SELESAI dan MERGE ke `main`

| PR | Isi | Commit merge |
|---|---|---|
| **#353** (merged) | PDT §4 — `DECISIONS.md` 2 baris baru, `PDT_KOLOM_DIPANEN.md` (baru), PRD → v1.2 (§7 +27 kolom + `shopee_kesehatan`, Rule 2/5/11 direvisi, `pdt_satuan_t`+`rasio`, §9 9/11 tertutup), `PDT_BACKLOG.md` (G1-00 baru, G1-02/06/07/10 diperbarui) | `e1423bf` |
| **#354** (merged) | Migrasi `20261010010000_g1_00_client_platforms_platform_check.sql` — CHECK `client_platforms.platform IN ('Shopee','TikTok Shop','Tokopedia','Lazada','Blibli')`, **`NOT VALID`**. Satu fixture test diperbaiki (`report.domain.test.ts`) | `cfc923d` |

Semua sudah di `main`. `docs/prd/CDPS_PDT_Pusat_Data_Toko.md`, `docs/backlog/PDT_BACKLOG.md`,
`docs/backlog/PDT_KOLOM_DIPANEN.md` sekarang ada di `main` (tidak lagi di cabang terpisah).

Gerbang CI **161/44/35/74 tidak bergerak** (diverifikasi `scripts/db-rebuild.sh --yes` sebelum
tiap push, dua kali).

---

## 2. G1-00 — status sebenarnya, per sub-tugas

### 2.1 Hapus/nonaktifkan klien testing — **DITUNDA, jangan eksekusi tanpa instruksi baru**

12 klien kandidat testing (query read-only ke live `egddxfcnrtecheiykhlf`, 2026-09-13):

| Client ID | nama_pic | toko | Sinyal |
|---|---|---|---|
| CLI-202608-0001 | tes21 | testw | gibberish + link generik |
| CLI-202608-0002 | mr 1 | toko ku | gibberish + link generik |
| CLI-202608-0003 | tedsa | toko kus | gibberish + link generik |
| CLI-202608-0004 | si niken | toko ku1 | `platform` gabungan "TikTok Shop, Shopee, Tokopedia" |
| CLI-202608-0005 | tedsadsa | testwf | `platform` gabungan "TikTok Shop, Shopee" |
| CLI-202608-0006 | Test Klien M6a 1 | test m6a 1 | eksplisit "Test" |
| CLI-202608-0007 | ilukman | tasdadf.ocm | domain gibberish |
| CLI-202609-0001 | wulan (testing) | abcd bakery | `store_link` testingfnb1.com |
| CLI-202609-0002 | arsye | efgh clothing | `store_link` testingcloth1.com (contoh dedup PX-M2a) |
| CLI-202609-0012 | bunga | testing1 | `store_link` testingfashion.com |
| CLI-202609-0015 | testing lanjutan | lanjutan id | eksplisit "testing" |
| CLI-202609-0017 | DFVBDFV | Salad Hut | nama gibberish, `kota="-"` |

**Kenapa belum dieksekusi:** setiap klien di atas sudah punya `audit_log`/`weekly_result_recap`
sungguhan (2–6 baris masing-masing), dan **CLI-202608-0006 sudah punya 1 `client_reports`**
(append-only/frozen). Rencana semula (nonaktifkan, bukan hard-delete, meniru pola PX-M2a) sudah
disepakati sebagai metode — **tapi eksekusinya sendiri ditunda pemilik**: *"Abaikan dulu klien
testing karena masih dibutuhkan."* Jangan jalankan langkah ini sampai ada instruksi baru yang
eksplisit menyebut daftar/klien mana yang boleh disentuh.

### 2.2 Assign AM ke klien real — **BELUM dikerjakan, butuh keputusan Nerissa/Anty**

12 klien REAL (bukan testing) tanpa AM, semuanya dibuat oleh tim **Sales** (bukan Account) —
konsisten dengan alur "sales closing → handoff ke Account":

`CLI-202608-0009`, `CLI-202609-0003`, `CLI-202609-0005`, `CLI-202609-0006`, `CLI-202609-0007`,
`CLI-202609-0008`, `CLI-202609-0009`, `CLI-202609-0010`, `CLI-202609-0011`, `CLI-202609-0013`,
`CLI-202609-0014`, `CLI-202609-0016`.

**Kenapa belum dikerjakan:** `created_by` klien-klien ini adalah SPV/staf Sales (MOHAMAD FAESAL
ABDULL AZIZ, CUCU NURHAYATI/Head of Sales Jasa, MAYA AMALIA, GEAN FAJAR, dll.) — **bukan** AM.
Assign AM = keputusan alokasi beban kerja tim Account yang sesi ini tidak punya dasar untuk
menebak. Query `select id, nama_pic, toko, kategori, kota from clients where id = ANY(...)` bisa
dipakai untuk menyusun daftar siap-putus untuk Nerissa/Anty.

### 2.3 `client_platforms.platform` CHECK — **SEBAGIAN selesai (PR #354, merged)**

- ✅ Constraint `ck_client_platforms_platform` sudah hidup di live `egddxfcnrtecheiykhlf`, `NOT
  VALID` — insert/update BARU dengan nilai kotor sekarang ditolak (`23514`), diverifikasi.
- ❌ **`VALIDATE CONSTRAINT ck_client_platforms_platform`** belum dijalankan — menunggu 3 baris
  lama (milik CLI-202608-0004/0005/0007, §2.1) dibersihkan/dinormalisasi. Migrasi validasi ini
  **satu baris SQL**, tinggal ditulis begitu §2.1 selesai:
  ```sql
  ALTER TABLE client_platforms VALIDATE CONSTRAINT ck_client_platforms_platform;
  ```

---

## 3. Yang belum disentuh sama sekali

- **G1-01 dst.** (`docs/backlog/PDT_BACKLOG.md` §1) — migrasi tabel `pdt_*`, seed
  `pdt_parser_modul`, parser, rekonsiliasi, dst. Nol kode, nol migrasi untuk ini.
- **Bucket 3 "human call"** di `PDT_KOLOM_DIPANEN.md` §7 — 11 nama kolom tanpa konsumen yang
  seharusnya dibuang (ketokan Q-6) **tidak tertulis di repo mana pun**. Jangan ditebak — tunggu
  Hans/Anty menempelkan rekomendasi aslinya.
- **§6.8 PRD** (anggaran storage) masih dihitung di atas asumsi 500 klien; P-10 sudah menutup
  angka ke 300 tapi tabelnya belum direvisi mengikuti itu.
- **P-04** (🟠 sebagian) dan **P-07** (🟡 terbuka, kapasitas partisi `pdt_fact_sku_period`) — dua
  dari sebelas Open Assumptions yang masih benar-benar terbuka.

---

## 4. Bug pra-ada yang TIDAK diperbaiki sesi ini (di luar cakupan PDT)

`apps/api/src/e2e/gelombang-c-showcase.e2e.test.ts` — fixture `seedLaporan()` insert
`client_platforms` baru per laporan untuk klien yang sama, tabrakan dengan
`uq_client_platforms_active_platform` (index dari PX-M2a, sudah ada sebelum sesi PDT mana pun).
Ini membuat gerbang `db-and-migrations` CI **selalu merah** di setiap PR yang menyentuh
`apps/api` — sudah dikonfirmasi bukan disebabkan PDT (reproduksi identik di `main` sebelum PR
#353/#354). Proposed patch (belum diterapkan): insert `client_platforms` **sekali per klien**
(bukan sekali per laporan), simpan `id`-nya, pakai ulang untuk laporan berikutnya. Lihat komentar
di PR #353/#354 untuk detail lengkap.

---

## 5. Rekomendasi urutan sesi 3

1. **Kalau pemilik/Nerissa sudah siap memutuskan** §2.1 (klien testing) dan §2.2 (assign AM):
   eksekusi keduanya (nonaktifkan bukan hard-delete, pola PX-M2a), lalu jalankan
   `VALIDATE CONSTRAINT` (§2.3) sebagai migrasi terpisah.
2. **Kalau belum**: G1-00 boleh dianggap "cukup untuk sekarang" dan sesi 3 bisa mulai G1-01
   (migrasi tabel `pdt_*`) — G1-00 tidak memblokir penulisan skema G1-01, hanya memblokir
   **gerbang keluar G1** (≥10 klien nyata `verified`), yang memang belum bisa dicapai sampai G0
   selesai.
3. Opsional, di luar PDT: perbaiki `gelombang-c-showcase.e2e.test.ts` (§4) untuk menghijaukan CI
   di semua PR mendatang — kecil, sudah ada proposed patch-nya.

---

## 6. Rujukan

- `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` (v1.2) — PRD, sekarang di `main`.
- `docs/backlog/PDT_BACKLOG.md` — tiket G1-00…G5.
- `docs/backlog/PDT_KOLOM_DIPANEN.md` — daftar `kolom_dipanen`.
- `docs/DECISIONS.md` — semua ketokan pemilik + deviasi aturan rumah tercatat di sana.
- PR #353, #354 (keduanya merged) — deskripsi PR + komentar CI berisi detail investigasi penuh.
