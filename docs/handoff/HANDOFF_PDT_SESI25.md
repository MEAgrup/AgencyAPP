# HANDOFF — PDT (Pusat Data Toko) SESI 24 → SESI 25

> **Dibuat 2026-09-15.** Berkas ini adalah handoff ADMINISTRATIF (merge PR #383)
> — rantai: … → `HANDOFF_PDT_SESI23.md` → `HANDOFF_PDT_SESI24.md` (detail teknis
> LENGKAP modul KESEMBILAN `shopee_live`, TIDAK diulang di sini) → berkas ini.
> Instruksi sesi ini (Yohan): **"Buat pr merge kemudian buat handoff untuk lanjut
> di chat baru."**

---

## 0. Status merge PR #383

- **PR #383** ("PDT G1-09 sesi 22-24 — modul KETUJUH `shopee_ads_search`,
  KEDELAPAN `shopee_ams_produk` + `platform_product_id`, diskon/flash_sale MVP,
  `shopee_video.wajib=false`, modul KESEMBILAN `shopee_live`") — **MERGED** ke
  `main`, commit merge `8701cef88397c4fdd57297210bdcc7e4fdc08088`.
- Tidak ada konflik dengan `main` — `mergeable_state` tetap `clean` sejak
  dibuka sampai merge.
- Semua job CI hijau pada head `e0add52` sebelum merge: `api`, `core-engines`,
  `db-and-migrations`, `web-client-portal`, `web-internal` (11 check run,
  semua `success`, dua workflow run terpicu keduanya lulus).
- Nol komentar review manusia yang butuh tindakan (hanya 1 komentar bot
  Vercel deployment-status).
- Branch sesi `claude/baca-handoff-pst-sesi-21-6go4i2` sudah **di-restart**
  dari `origin/main` pasca-merge (`git checkout -B ... origin/main`) — bersih,
  tidak ada history menggantung dari PR #383.
- Subscription PR activity untuk #383 sudah di-unsubscribe; trigger check-in
  terjadwal (`trig_01Vedh47XBU3atbsDvEB9d55`) sudah dihapus — keduanya moot
  pasca-merge.

Rincian teknis lengkap modul KESEMBILAN `shopee_live` (identitas sesi live
lewat digit mentah `Waktu Mulai`, bukan `Informasi Streaming`) + rekap
seluruh item A-E: baca `HANDOFF_PDT_SESI24.md` §0/§1 — TIDAK diulang di sini.

## 1. Yang perlu ditindaklanjuti sesi berikutnya

Sama seperti `HANDOFF_PDT_SESI24.md` §2 (belum ada yang berubah statusnya
sejak berkas itu ditulis — baca di sana untuk detail lengkap tiap butir,
termasuk rekomendasi & opsi untuk masing-masing):

1. **`G1-09-DETEKSI-PREAMBLE-AMBIGU`** — kandidat paling siap: verifikasi
   `detectPdtModule` terhadap seluruh sample Fim Motor sebagai regresi.
2. **`G1-09-2BII-SKU-STATUS-TRANSISI`** — kandidat paling siap: job cron
   periodik (pola sama G1-10) untuk transisi `status_listing` SKU.
3. Sisanya butuh sample data baru atau keputusan bisnis pemilik yang belum
   ada, tidak bisa dikerjakan tanpa itu: `G1-07-PERSKU-PESANAN`,
   `G1-07-PERSKU-DIBAYAR`, `G1-07-TIKTOK-REKONSILIASI`, `G1-08-SEBAGIAN`,
   `G1-06-PERIODE-TIKTOK`.
4. **Catatan penting untuk sesi berikutnya**: berkas ZIP contoh (Fim Motor,
   dll.) yang pernah diunggah pada sesi-sesi sebelumnya TIDAK otomatis
   tersedia di chat baru — hanya ada di scratchpad sesi lama. Jika sesi
   berikutnya butuh sample asli (mis. untuk butir 3 di atas), minta Yohan
   unggah ulang. Jangan menebak nama kolom dari nama berkas semata (Rule 6).

## 2. Setup teknis

Sama seperti `HANDOFF_PDT_SESI24.md` §3 — perintah start cluster Postgres,
rebuild DB, dan verifikasi suite tidak berubah. Baca di sana.

## 3. Rujukan

- `docs/handoff/HANDOFF_PDT_SESI24.md` — detail teknis LENGKAP modul
  KESEMBILAN `shopee_live` (§0), rekap item A-E (§1), sisa Open items dengan
  rekomendasi (§2), setup teknis (§3).
- `docs/handoff/HANDOFF_PDT_SESI21.md`/`SESI22.md`/`SESI23.md` — rantai
  keputusan A-E lengkap.
- `docs/DECISIONS.md` — baris Decided sesi 22/23/24 + sisa Open (lihat
  `HANDOFF_PDT_SESI24.md` §2 untuk daftar).
- `docs/backlog/PDT_BACKLOG.md` §G1-09 — status ringkas seluruh sub-langkah.
- PR #383 (merged, `8701cef`) — perubahan kode lengkap sesi 22-24.
