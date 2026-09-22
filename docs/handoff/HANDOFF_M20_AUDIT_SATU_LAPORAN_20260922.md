# AUDIT — M20 Laporan Klien PDT: "klien hanya melihat SATU laporan"

> **Dibuat 2026-09-22 (sore), branch `claude/audit-pdt-report-plan-df1xkt`.**
> Permintaan pemilik (Yohan Agustian): *"Audit repo, build plan dan fitur yg akan dibangun. Bagian
> report PDT di klien portal. Yg diinginkan klien hanya melihat 1 bagian report, jangan sampai ada
> 2 report yg bisa dilihat klien."*
>
> Sesi ini **audit + koreksi dokumen + satu tes penjaga**. Nol fitur dibangun, nol migrasi
> diterapkan. Angka live diambil lewat query read-only ke `CDPS SG`.

---

## 0. Kesimpulan dalam lima baris

1. **Hari ini klien memang hanya melihat satu laporan** — menu `Laporan` di portal membaca M14
   (`client_reports`), dan PDT belum punya satu pun rute/halaman di portal. Di live daftar itu
   **kosong** (`client_reports` 0 baris, `client_contacts` 0).
2. **Risikonya ada di rencana, bukan di kode**: Plan M20 Gelombang D versi pagi berbunyi "daftar +
   render laporan PDT" / "halaman `web-client-portal`: daftar laporan + detail". Dibaca literal itu
   melahirkan **permukaan kedua** yang hidup berdampingan dengan `/laporan` M14 sampai Gelombang G.
3. **Koreksi**: D diubah menjadi **ganti sumber** halaman dan rute yang sudah ada (bukan tambah
   halaman). PRD M20 mendapat **R11**; `DECISIONS.md` baris `M20-SATU-LAPORAN-PORTAL`.
4. **Requirement dikunci di CI**: dua tes baru di `apps/api/src/lib/route-parity.test.ts` memaksa rute
   portal ber-laporan **persis dua** dan halaman `(portal)` ber-laporan **persis dua**. Hijau (13/13).
5. **Temuan di luar pertanyaan, tapi memblokir D**: migrasi Gelombang C (`20261130010000`) sudah di
   `main` **dan kodenya sudah ter-deploy ke produksi** (`agency-app-api` READY di `6cc4ce4`), tapi
   tabelnya **belum di live** — live 184 tabel/35 mesin, repo 186/36. Rute HTML/insight/terbitkan/
   cabut PDT akan 500 pada kiriman pertama. Dicatat Open `M20-C01-LIVE`.

---

## 1. Yang diaudit dan hasilnya

### 1.1 Kode portal klien (`web-client-portal`, `apps/api`, `packages/domain`)

| Lapisan | Yang ditemukan | Bukti |
|---|---|---|
| Nav portal | **Empat** tautan: Ringkasan, Laporan, Progres Layanan, Ajukan Komplain. Satu menu laporan. | `web-client-portal/src/app/(portal)/layout.tsx` `NAV` |
| Halaman | `(portal)/laporan/page.tsx` (daftar) + `(portal)/laporan/[id]/page.tsx` (iframe same-origin). Dashboard `(portal)/page.tsx` menautkan ke keduanya. Nol halaman lain ber-laporan. | `find web-client-portal/src` |
| Rute API portal | `GET /client-portal/reports`, `GET /client-portal/reports/{id}/html`. Nol rute `client-portal/**` yang menyentuh PDT. | `apps/api/src/app/api/v1/client-portal/**` |
| Sumber data | `clientPortal.listReports` / `reportHtml` membaca **M14**: `client_reports` ⋈ `client_report_publikasi` (`[Terbit]`) ⋈ `client_report_insight` (revisi terpaku), render `report.renderReportHtml`/`reportShopee.renderReportHtml` mode `klien` hardcode. | `packages/domain/src/client-portal.ts:188-257` |
| Rujukan PDT di portal | **Nol** — `grep -ri pdt web-client-portal/src` kosong. | — |

**Verdict kode hari ini: satu permukaan, satu sumber (M14), kosong di live.** Tidak ada kebocoran
"dua laporan" yang sedang terjadi.

### 1.2 PDT sisi internal (yang sudah mendarat 2026-09-22)

| Gelombang | PR | Isi yang relevan ke portal |
|---|---|---|
| A | #494 | blok `kelengkapan` terstruktur; `insight.poin` bersih dari caveat (prasyarat R2) |
| B | #496 | `packages/core/src/pdt/render.ts` — `renderLaporanHtml(laporan, 'klien'\|'internal')`, blok internal **tidak dibangun** di `klien`; rute `GET /account/pdt/laporan/kiriman/{id}/html?mode=`; 4 tombol Lihat/Unduh Klien/Internal |
| C | #497 | `pdt_laporan_insight` (append-only), `pdt_laporan_publikasi` (`[Draf]→[Terbit]⇄[Dicabut]`, mesin `pdt_laporan`), verba `terbitkanKiriman`/`terbitkanUlangKiriman`/`cabutKiriman`, `insightUntukMode` (klien = revisi terpaku), editor FE `PdtInsightEditor` |

Artinya **semua bahan untuk sisi klien sudah ada**: dokumen klien sudah bisa dirender (B), sudah ada
status terbit + paku revisi (C). Yang belum ada hanya *pembaca* di portal — itulah Gelombang D.

### 1.3 Build plan & dokumen — yang usang dan sudah dikoreksi

| Dokumen | Sebelum | Sesudah |
|---|---|---|
| `docs/prd/CDPS_Build_Plan.md` baris M20 | "Status: dokumen saja, nol tiket mendarat" | posisi A/B/C merge, C-01 belum live, D direvisi |
| `docs/prd/CDPS_Module20_PDT_Laporan_Klien.md` | "DRAF — belum ada tiket yang mendarat"; §10 empat pertanyaan masih terbuka padahal sudah diketok pagi harinya | status aktif; **R11 baru**; §10 diperbarui (+`M20-C01-LIVE`); §9 dan §11 menyebut R11 |
| `docs/plan/PLAN_PORT_M14_KE_PDT.md` | nol tanda status per gelombang; D berbentuk "tambah halaman"; §4 blocker semua masih "butuh Yohan" | tabel posisi; prinsip #6; **Gelombang D ditulis ulang** (D-00..D-05); §4 dan §5 diperbarui |
| `docs/backlog/PDT_BACKLOG.md` §2 | catatan pagi saja | + catatan sore (posisi + koreksi bentuk D) |
| `docs/DECISIONS.md` | — | Decided `M20-SATU-LAPORAN-PORTAL`; Open `M20-C01-LIVE` |

### 1.4 Angka live `CDPS SG` (read-only, 2026-09-22)

| Objek | Live |
|---|---|
| `client_reports` | 0 |
| `client_report_publikasi` status `[Terbit]` | 0 |
| `client_contacts` | 0 |
| `pdt_laporan_kiriman` | 0 |
| `pdt_upload_batch` | 14 |
| `clients` dengan `total_sales ≠ 0` | 0 |
| tabel publik / `sm_machines` | **184 / 35** (repo & CI: 186 / 36) |
| `pdt_laporan_insight`, `pdt_laporan_publikasi`, `jwt_owns_pdt_kiriman_am`, mesin `pdt_laporan` | **tidak ada** |

Konsekuensi: mengganti sumber portal dari M14 ke PDT **tidak menghilangkan satu pun data klien**,
dan tidak ada kontak klien yang sedang memakai portal.

---

## 2. Gelombang D — bentuk yang benar (ringkas; rincian di Plan §3)

- **D-00** apply migrasi C-01 ke live (prasyarat merge, bukan kode).
- **D-01** `client-portal.ts`: `listReports`/`reportHtml` berganti sumber ke `pdt_laporan_kiriman` ⋈
  `pdt_laporan_publikasi` (`[Terbit]`) ⋈ `pdt_laporan_insight` (revisi = `insight_revisi`), predikat
  `client_platforms.client_id = scope.clientId` **di SQL**, render `pdtCore.renderLaporanHtml(…, 'klien')`
  dengan `insight` di-overlay revisi terpaku. Hapus import `report`/`reportShopee` dari modul ini.
  Per toko+periode tampilkan hanya kiriman terbit terbaru (R11.3).
- **D-02** DTO/wire/path/FE **tidak berubah bentuk**. Nol halaman, nol menu, nol rute baru.
- **D-03** komplain M15 apa adanya (sudah diketok) — nol kode.
- **D-04** tes isolasi antar-klien, paku revisi, nol string internal, nol argumen mode; fixture
  `client-portal.test.ts` pindah dari `createReport`/`publishReport` ke `kirimLaporanPdt`/`terbitkanKiriman`.
- **D-05** tes R11 tetap hijau + tes sumber: `client-portal.ts` nol string `client_reports`.

Kriteria keluar: kontak klien membuka menu **Laporan** yang sama dan membaca dokumen **byte-identik**
dengan "Unduh Klien" milik AM untuk kiriman yang sama.

---

## 3. Yang TIDAK dilakukan sesi ini, dan kenapa

| Tidak dilakukan | Alasan |
|---|---|
| Menerapkan migrasi C-01 ke live | perubahan produksi, di luar cakupan permintaan "audit"; dicatat sebagai Open `M20-C01-LIVE` dengan langkah persisnya |
| Membangun Gelombang D | permintaan ini audit + plan; D punya tiket sendiri dan menunggu D-00 |
| Menghapus kode M14 | prinsip plan #4 — dicabut sekali di G, sesudah §9 PRD terpenuhi |

---

## 4. Yang perlu ketokan pemilik pada PR Gelombang D

1. **R11.3** — untuk satu toko+periode dengan kiriman revisi (`menggantikan_kiriman_id`) yang
   keduanya `[Terbit]`, klien melihat **hanya yang terbaru**. Ini tafsir sesi audit atas "1 report";
   alternatifnya AM wajib **Cabut** yang lama secara manual sebelum menerbitkan revisi. Default
   yang dipakai plan: otomatis tampil satu (yang terbaru).
2. `periode_tipe` di DTO portal dikunci `'bulanan'` (kiriman PDT selalu bulanan) — teks kosong-state
   portal "Laporan mingguan dan bulanan …" ikut disesuaikan.
