# HANDOFF — PDT (Pusat Data Toko) SESI 25 → SESI 26

> **Dibuat 2026-09-15.** Instruksi Yohan sesi ini: *"Baca handoff pdt sesi 25 kemudian lanjutkan
> build. Butuh keputusan? Jelaskan dengan contoh kasus dan rekomendasi. Update sisa berapa task
> lagi untuk penyelesaian pdt."* Rantai: `HANDOFF_PDT_SESI24.md` (detail teknis modul KESEMBILAN
> `shopee_live`) → `HANDOFF_PDT_SESI25.md` (administratif, merge PR #383) → berkas ini.

---

## 0. Apa yang terjadi sesi ini

**G1-10 (job purge harian) — pass PERTAMA Flow E dibangun.** Dari dua kandidat "paling siap"
`HANDOFF_PDT_SESI25.md` §1, `G1-09-DETEKSI-PREAMBLE-AMBIGU` butuh sample ZIP Fim Motor diunggah
ulang (tidak tersedia di chat baru ini — scratchpad sesi lama tidak ikut pindah) dan
`G1-09-2BII-SKU-STATUS-TRANSISI` butuh keputusan pemilik (3 opsi, lihat §1 di bawah). **G1-10
dipilih sebagai gantinya** — murni teknis, spec Flow E (`docs/prd/CDPS_PDT_Pusat_Data_Toko.md`
§3 Rule 45-50/§4) lengkap, nol sample/keputusan bisnis dibutuhkan.

Dibangun:
- `packages/domain/src/pdt.ts` — `planPdtPurgeTick` (Flow E langkah 1-3: pilih kandidat +
  pagar 5%/hari Rule 48) dan `finalizePdtPurgeTick` (langkah 4/6: isi `raw_dihapus_pada` +
  SATU `audit_log` rekap per tick, Rule 47). Dipecah dua fungsi mengikuti pola
  `commitUploadBatch`/`unggahPdtRawObjek`: domain memutuskan APA yang dihapus, route memanggil
  Storage sungguhan.
- `apps/api/src/lib/pdt-storage.ts` — `hapusPdtRawObjek` (DELETE bulk Storage REST, satu path
  per panggilan supaya Rule 46 error path — satu objek gagal tidak menggagalkan yang lain).
- `apps/api/src/app/api/v1/internal/pdt/purge/tick/route.ts` — endpoint tick baru (pola sama
  `plan`/`health`/`performance`/`penugasan`, `tickSecretOk` dibagi). Terdaftar
  `apps/api/vercel.json` (`45 17 * * *` = 00:45 WIB harian).
- Katalog notifikasi **v18 BARU**: `pdt.purge.guard_exceeded` → Directors (resolver `explicit`).
  Migrasi `20261026010000_g1_10_pdt_purge_notif.sql`. Gate `notif_events` 75→76 dinaikkan di
  `scripts/db-rebuild.sh` + `.github/workflows/ci.yml` + `packages/core/src/notification.test.ts`
  (v17→v18, literal versi yang SENGAJA hardcode — baca komentarnya sebelum menambah event lagi).

**Cakupan SENGAJA dipersempit** dari Rule 45/49 penuh (dua Open baru, `docs/DECISIONS.md`):
1. **`G1-10-RETENSI-RECOMPUTE`** — recompute perpanjangan retensi (Rule 45 langkah 2) hari ini
   HANYA membaca `retensi_sampai`/`legal_hold` yang sudah tersimpan sejak G1-01 (default 120
   hari verified/30 hari ditolak). DUA dari EMPAT pemicu perpanjangan ("laporan terkirim" →
   `pdt_laporan_kiriman`, "SKU di katalog PX" → `px_sku_volume`) menunjuk tabel yang **belum
   ada** (G2-01/G5 belum dibangun — build order CLAUDE.md memang menaruh G1 sebelum G2/G3, dan
   G5 ⛔ diblokir terpisah). Risiko nol SELAMA G2-01/G5 kosong (hari ini); jadi tanggung jawab
   sesi yang membangun G2-01/G5 untuk menyambungkan recompute-nya SEBELUM tabel itu punya baris
   produksi pertama.
2. **`G1-10-ORPHAN-PASS`** — pass kedua Flow E (Rule 49, objek yatim bucket >7 hari) belum
   dibangun. `pdt-storage.ts` baru punya get/put/delete PER-PATH yang sudah diketahui; Rule 49
   butuh LISTING rekursif bucket. Murni teknis, kandidat siap untuk sesi berikutnya.

Diverifikasi (DB lokal rebuild bersih, tiga kali — antara `@cdps/core`/`@cdps/domain`/`@cdps/api`
supaya tidak menabrak peringatan §2 di bawah): `@cdps/core` **1206/1206**, `@cdps/domain`
**2606/2606 (1 skip, tidak berubah)**, `@cdps/db` **107/107**, `@cdps/api` **586/586 (2 skip,
live-storage — butuh `SUPABASE_SERVICE_ROLE_KEY` sungguhan, tidak tersedia di sandbox)**;
typecheck 4 paket bersih + lint `@cdps/api --max-warnings 0` bersih.

## 1. Keputusan yang MASIH dibutuhkan pemilik (belum tersentuh sesi ini)

### 1a. `G1-09-2BII-SKU-STATUS-TRANSISI` — kapan SKU ditandai `nonaktif`?

**Kenapa ini keputusan bisnis, bukan teknis:** `pdt_sku_master.status_listing` hari ini SELALU
`'aktif'` sekali sebuah SKU pernah terlihat — tidak ada mesin yang menandainya `nonaktif` saat
SKU itu **berhenti muncul** di laporan bulan-bulan berikutnya (mis. penjual men-delisting
produk). PRD Rule 19 (§3.4) menyiratkan sisi sebaliknya harus ada ("memungkinkan pelacakan
perpindahan kuadran antar bulan") tapi **tidak merinci kriteria pemicunya** — berapa lama tidak
terlihat, dibandingkan terhadap apa. Menebak angka itu sendiri adalah kelas kesalahan yang
`G1-06-PERIODE-TIKTOK`/`G1-08-SEBAGIAN` sudah diperingatkan di `docs/DECISIONS.md`: jangan
mengarang gerbang yang PRD belum tentukan.

**Contoh kasus konkret:** Toko "Fim Motor" mengunggah `shopee_parent_sku` bulan Juli yang
memuat SKU `BAN-001` (masuk `pdt_sku_master`, `status_listing='aktif'`). Agustus, penjual
men-delisting `BAN-001` dari Shopee — laporan `shopee_parent_sku` Agustus **tidak lagi
menyebut** `BAN-001` sama sekali. Hari ini, `BAN-001` tetap `status_listing='aktif'`
**selamanya** karena tidak ada yang membandingkan "SKU lama vs batch baru". Begitu kuadran SKU
(G2/G4) dibangun, `BAN-001` akan terus dihitung sebagai SKU aktif toko itu padahal sudah lama
mati — mendistorsi skor/rekomendasi.

**Tiga opsi (rincian lengkap `docs/DECISIONS.md` baris `G1-09-2BII-SKU-STATUS-TRANSISI`):**
- **(a) Job periodik** (Vercel Cron, pola sama G1-10 yang baru dibangun): tiap hari bandingkan
  SKU per toko terhadap batch `verified` TERBARU yang membawa modul SKU-lengkap
  (`shopee_parent_sku`/`tt_orders`) — SKU yang absen ditandai `nonaktif`.
- **(b) Ditandai saat commit**: `commitUploadBatch` sendiri menandai `nonaktif` untuk SKU toko
  yang sama yang tidak muncul di batch SKU-lengkap yang baru saja `verified`.
- **(c) Ditinggalkan manual** sampai ada konsumen hilir (kuadran G2/G4) yang benar-benar
  membutuhkannya.

**Rekomendasi saya: (c) untuk saat ini.** G2 (laporan)/G4 (katalog usulan) — satu-satunya
konsumen kolom `status_listing` — **belum dibangun sama sekali** (0% menurut audit backlog
`docs/backlog/PDT_BACKLOG.md` §2/§4). Membangun mesin transisi sekarang berarti mengarang
kriteria pemicu yang PRD belum tentukan, untuk kolom yang belum ada satu pun pemakai nyata.
Kalau Yohan mau tetap jalan sekarang supaya tidak menumpuk utang teknis, opsi **(a)** adalah
runner-up saya — dengan kriteria konkret "absen dari batch `verified` TERBARU yang membawa
modul SKU-lengkap" (bukan "berapa lama tidak terlihat", supaya tidak mengarang ambang waktu).

### 1b. `G1-09-DETEKSI-PREAMBLE-AMBIGU` — butuh sample ZIP Fim Motor diunggah ulang

Bukan keputusan bisnis, tapi genuinely butuh input: berkas ZIP contoh (Fim Motor dkk.) dari
sesi-sesi lalu **tidak otomatis tersedia** di chat baru ini (hanya ada di scratchpad sesi lama).
Kalau sesi berikutnya mau menutup ini (verifikasi `detectPdtModule` terhadap seluruh sample
sebagai regresi ambiguitas CPC vs afiliasi), minta Yohan unggah ulang ZIP-nya dulu.

## 2. Update: sisa berapa task untuk penyelesaian PDT

PDT punya LIMA gelombang (`docs/backlog/PDT_BACKLOG.md` §0/§1-§5). Status ringkas per gelombang
(bukan hitungan tiket presisi — beberapa baris backlog adalah "1 modul = 1 baris status", jadi
angka pasti tergantung level granularitas yang dihitung):

| Gelombang | Isi | Status |
|---|---|---|
| **G1** (Fondasi: tabel, parser, upload, purge, reparse) | G1-00..G1-09 (upload+commit+rekonsiliasi Shopee) **SELESAI** untuk jalur yang sudah dibangun; **G1-10 pass pertama SELESAI sesi ini**, pass kedua (orphan) **belum**; **G1-11 (reparse Flow D) BELUM DISENTUH SAMA SEKALI** | ~85% |
| **G2** (Laporan sebagai view + benchmark admin) | G2-01 (membalik invarian `client_reports`)/G2-02 (benchmark UI) — **BELUM DIBANGUN**, meski `report.ts` sudah punya sebagian fungsi pendukung (`publishReport`/`revokeReport`/`recomputeTotalSales`) | ~10-15% |
| **G3** (Prefill Riset Awal, PDT-18) | **BELUM DIBANGUN.** Cakupan asli PRD jauh lebih sempit dari sangkaan (`DECISIONS.md` 2026-08-20): hanya B-0.6/B-0.7/B-1 yang punya sumber fakta; B-2..B-9 tetap manual | 0% |
| **G4** (Katalog usulan bersatuan) | G4-01 (katalog kode→DB)/G4-02 (satuan bertipe)/G4-03 (≥6 aksi Shopee) — **BELUM DIBANGUN**, meski mesin `copilot.ts` (4 pilar × 20 aksi) sudah ada di server sebagai fondasi | 0% |
| **G5** (Product Exchange) | ⛔ **DIBLOKIR** (bukan sekadar belum dikerjakan) — `level2_category`/`price_segment` tidak punya tipe di CDPS, `px_sku_volume`/`px_sku_eligibility` belum ada (PX-M2b, ditunda bersama M3) | Diblokir, bukan Open |

**Yang tersisa DI DALAM G1** (masih boleh dikerjakan sekarang, sisanya di G2-G5 menunggu
gelombang G1 exit + keputusan/urutan wave):
1. **`G1-10-ORPHAN-PASS`** — pass kedua purge (objek yatim >7 hari). Murni teknis, siap
   dikerjakan sesi berikutnya (§0 di atas).
2. **`G1-11` (reparse dari ZIP, Flow D)** — belum disentuh sama sekali. Spec lengkap ada
   (`docs/backlog/PDT_BACKLOG.md` §G1-11), DoD jelas, nol keputusan bisnis terlihat sejauh
   pembacaan sesi ini — kandidat kuat untuk sesi berikutnya.
3. **`G1-09-DETEKSI-PREAMBLE-AMBIGU`** — butuh ZIP diunggah ulang (§1b).
4. **`G1-09-2BII-SKU-STATUS-TRANSISI`** — butuh keputusan pemilik (§1a).
5. Sisa modul PDT yang belum dipetakan ke tabel fakta (dari 25 modul terdaftar di
   `pdt_parser_modul`, sekitar 10 sudah punya writer per `HANDOFF_PDT_SESI24.md` §0) — sebagian
   BLOCKED terverifikasi (`tt_live`/`G1-09-2BII-TTLIVE`, `shopee_video`/grain terbukti tidak
   punya baris per-video), sebagian menunggu sample baru: `G1-07-PERSKU-PESANAN`,
   `G1-07-PERSKU-DIBAYAR`, `G1-07-TIKTOK-REKONSILIASI`, `G1-08-SEBAGIAN`, `G1-06-PERIODE-TIKTOK`
   (rekap lengkap `HANDOFF_PDT_SESI24.md` §2, belum berubah).

**Kesimpulan jujur:** G1 (fondasi) sudah paling matang dari lima gelombang — realistis
**1-2 sesi lagi** untuk menutup sisa G1 murni-teknis (`G1-10-ORPHAN-PASS` + `G1-11`), TAPI G2,
G3, G4 masing-masing masih **titik nol** (belum ada satu baris kode produksi), dan urutan wave
(`docs/backlog/PDT_BACKLOG.md` §8 "Aturan strangler") mensyaratkan G1 exit criteria (≥10 klien
nyata verified, campuran TikTok & Shopee) SEBELUM G2 boleh mulai menggantikan Report Engine
lama. Estimasi PDT "selesai" (kelima gelombang, G5 tetap diblokir terpisah) ada di orde
**belasan sesi**, bukan satu-dua — G2/G3/G4 masing-masing kira-kira seukuran G1 dari sisi
cakupan PRD, dan G1 sendiri butuh puluhan sesi (SESI1→SESI26) untuk sampai ke titik ini.

## 3. Setup teknis untuk sesi berikutnya

Sama seperti `HANDOFF_PDT_SESI24.md` §3 (perintah start cluster Postgres, rebuild DB,
peringatan `fileParallelism`/`afterEach` per-file) — tidak berubah. Tambahan sesi ini: `npm
install` di root **dan** `apps/api` **dan** `web-internal` diperlukan terpisah (chat baru tidak
mewarisi `node_modules` sesi lama).

## 4. Rujukan

- `docs/DECISIONS.md` — cari `2026-09-15`/`sesi 26`/`G1-10` untuk baris Decided baru, dan
  `G1-10-RETENSI-RECOMPUTE`/`G1-10-ORPHAN-PASS` untuk dua Open baru.
- `docs/backlog/PDT_BACKLOG.md` §G1-10 — status "sesi 26" baru di akhir blok.
- `docs/handoff/HANDOFF_PDT_SESI24.md` §2 — rekap lengkap Open items lain (belum berubah).
- `packages/domain/src/pdt.ts` (`planPdtPurgeTick`/`finalizePdtPurgeTick`, docblock kepala
  bagian G1-10), `apps/api/src/lib/pdt-storage.ts` (`hapusPdtRawObjek`),
  `apps/api/src/app/api/v1/internal/pdt/purge/tick/route.ts`.
- `packages/core/src/notification.ts` (katalog v18, `PdtPurgeGuardExceeded`).
