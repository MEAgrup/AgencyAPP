# HANDOFF — PDT (Pusat Data Toko) SESI 31 → SESI 32

> **Dibuat 2026-09-15.** Segera sesudah PR #390 (`G1-09-SHOPEESHOPSTATS-BASIS-TOTAL`) merge,
> pemilik diminta memilih task berikutnya lewat `AskUserQuestion` (G1 sudah nol item teknis
> murni — sisanya semua butuh keputusan/data pemilik, `HANDOFF_PDT_SESI31.md` §1). Pemilik
> memilih menutup `G1-09-2BII-SKU-STATUS-TRANSISI` dulu. Rantai: `HANDOFF_PDT_SESI31.md` →
> berkas ini.

---

## 0. Apa yang terjadi sesi ini

**PR #390 di-merge** (squash `4cac73c`) atas instruksi eksplisit pemilik, sesudah dikonfirmasi
CI hijau (11/11 check) dan `mergeable_state: clean`.

**`G1-09-2BII-SKU-STATUS-TRANSISI` DITUTUP — keputusan murni, NOL kode berubah.** Ditawarkan
3 opsi lewat `AskUserQuestion` (persis rincian `docs/DECISIONS.md`/`HANDOFF_PDT_SESI26.md` §1a):
- **(a)** job periodik harian (pola `G1-10`) — bandingkan SKU per toko vs batch `verified`
  terbaru, tandai `nonaktif` yang absen.
- **(b)** ditandai saat `commitUploadBatch` — lebih sederhana, tapi tidak pernah terpicu untuk
  toko yang berhenti upload sama sekali.
- **(c)** ditinggalkan manual sampai ada konsumen hilir (G2/G4) yang butuh.

**Pemilik memilih (c)**, mengikuti rekomendasi eksplisit: G2 (laporan)/G4 (katalog usulan) —
satu-satunya konsumen kolom `status_listing` — belum dibangun sama sekali (0%), jadi membangun
mesin transisi sekarang berarti mengarang kriteria pemicu untuk kolom tanpa pemakai nyata.
`pdt_sku_master.status_listing` TETAP selalu `'aktif'` sekali SKU pernah terlihat — SKU yang
delisted/dihapus platform tidak akan pernah pindah status sampai keputusan ini dibuka kembali
(kemungkinan besar oleh sesi yang membangun G2/G4).

Dicatat sebagai Decided (bukan dibiarkan diam-diam): `docs/DECISIONS.md` baris Decided baru +
Open row `G1-09-2BII-SKU-STATUS-TRANSISI` dicoret `✅ DITUTUP`; `docs/backlog/PDT_BACKLOG.md`
§G1-09 status "sesi 32" baru.

**Tidak ada verifikasi test/typecheck/lint dijalankan sesi ini** — nol baris kode, nol baris
test berubah; hanya tiga file dokumentasi (`DECISIONS.md`, `PDT_BACKLOG.md`, handoff ini).

## 1. Posisi G1 sekarang — BENAR-BENAR nol item Open tersisa yang bisa dikerjakan tanpa data baru

Sisa item G1:

1. **TikTok Avitaskin** — butuh ZIP diunggah ulang. Membuka `G1-06-PERIODE-TIKTOK`,
   `G1-09-2BII-TTLIVE`, `G1-07-TIKTOK-REKONSILIASI`.
2. **`G1-10-RETENSI-RECOMPUTE`** — menunggu G2-01/G5 punya baris produksi pertama (struktural,
   bukan keputusan hari ini — build order CLAUDE.md menaruh G1 sebelum G2/G3).
3. **`G1-11-REPARSE-RECOMPUTE-STATUS`** — pertanyaan desain jarang-terjadi, tidak memblokir.

Ketiganya SUDAH didokumentasikan sebagai "tunggu", bukan "kerjakan sekarang" — G1 genuinely
tidak punya task lain yang bisa dimulai tanpa sample baru dari pemilik atau kemajuan G2/G5.
`docs/backlog/PDT_BACKLOG.md` §8 "Aturan strangler" tetap berlaku: G2 (Laporan sebagai view)
menunggu G1 exit criteria (≥10 klien nyata verified) — butuh KLIEN NYATA, bukan kode.

## 2. Rujukan

- `docs/DECISIONS.md` — cari `sesi 32` untuk baris Decided (`G1-09-2BII-SKU-STATUS-TRANSISI`
  ditutup, opsi (c)).
- `docs/backlog/PDT_BACKLOG.md` §G1-09 — status "sesi 32" baru di akhir blok.
