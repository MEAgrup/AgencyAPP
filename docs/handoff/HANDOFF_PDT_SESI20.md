# HANDOFF — PDT (Pusat Data Toko) SESI 19/20 → SESI 21

> **Dibuat 2026-09-14.** Berkas ini adalah handoff ADMINISTRATIF (merge PR
> #376) — rantai: … → `HANDOFF_PDT_SESI18.md` → `HANDOFF_PDT_SESI19.md`
> (detail teknis LENGKAP modul KEENAM `shopee_ads_cpc` + bug laten
> `shopee_ams_produk`/`shopee_ams_afiliasi`, TIDAK diulang di sini) → berkas
> ini. Instruksi sesi ini (Yohan): **"buat pr merge kemudian buat handoff
> untuk lanjut task berikutnya di chat baru."**

---

## 0. Status merge PR #376

- **PR #376** ("PDT G1-09 sub-langkah 2b-ii — modul KEENAM `shopee_ads_cpc`
  + koreksi bug ejaan kolom AMS") — **MERGED** ke `main`, commit merge
  `101082cf6faf5bc140483a7c55a2f400cac71926`.
- Sebelum merge, terjadi **konflik nyata** dengan `main` (PR #375 — fix
  refresh-token auth, tidak terkait PDT — sempat merge duluan). Konflik
  HANYA di `docs/DECISIONS.md` (kedua sisi menambah baris "Decided" baru di
  puncak tabel yang sama) — diselesaikan dengan mempertahankan kedua baris,
  commit merge lokal `574a6f7`, semua suite diverifikasi ULANG penuh pasca-
  merge (bersih, nol regresi — `@cdps/api` naik ke 576 tes karena tes baru
  PR #375), push, lalu merge lewat GitHub.
- Semua job CI hijau pada commit `574a6f7` sebelum merge: `api`,
  `core-engines`, `db-and-migrations`, `web-client-portal`, `web-internal`
  (dua kali jalan karena re-trigger duplikat, keduanya hijau).
- Branch sesi `claude/charming-lovelace-x0bszv` sudah **di-restart** dari
  `origin/main` pasca-merge (`git reset --hard origin/main` + push) —
  bersih, tidak ada history menggantung dari PR #376.

Rincian teknis lengkap perubahan modul KEENAM + dua bug laten AMS: baca
`HANDOFF_PDT_SESI19.md` §0/§0b — TIDAK diulang di sini.

## 1. Yang perlu ditindaklanjuti sesi berikutnya

Sama seperti `HANDOFF_PDT_SESI19.md` §1 (belum ada yang berubah statusnya
sejak berkas itu ditulis — baca di sana untuk detail lengkap tiap butir):

1. **Kandidat modul KETUJUH — `shopee_ams_produk` → `pdt_fact_sku_period`,
   header sudah dikonfirmasi, TAPI BLOCKED** sampai lookup `Kode Item`
   (produk induk) → `pdt_sku_master.id` (per varian) diputuskan — Open
   `G1-09-2BII-ADS-CPC-SKU` (kelas ambiguitas sama `shopee_ads_cpc.sku_id`,
   sebaiknya dirancang BERSAMA, bukan ditebak terpisah).
2. **Berkas ZIP `Shopee - Fim Motor.zip` yang belum diperiksa headernya
   sama sekali** (daftar lengkap + dugaan modul per berkas: lihat
   `HANDOFF_PDT_SESI19.md` §1 butir 1). **Catatan penting untuk sesi
   berikutnya: ZIP ini TIDAK otomatis tersedia** — ia hanya ada di
   scratchpad sesi SAAT INI (`/tmp/claude-0/.../scratchpad/shopee_fim_motor/`)
   dan di upload asal (`/root/.claude/uploads/...`), keduanya TIDAK
   terbawa ke sesi/chat baru. **Minta Yohan unggah ulang
   `Shopee - Fim Motor.zip`** sebelum memverifikasi header berkas-berkas
   itu. JANGAN menebak nama kolom dari nama berkas semata (Rule 6).
3. Item lama dari sesi 17/18/19 TETAP terbuka, tidak tersentuh sesi ini:
   `G1-07-PERSKU-PESANAN`, `G1-07-TIKTOK-REKONSILIASI`,
   `G1-09-DETEKSI-PREAMBLE-AMBIGU`, `G1-08-SEBAGIAN`, `G1-06-PERIODE-TIKTOK`,
   `G1-07-PERSKU-DIBAYAR`, `G1-09-2BII-SHOPEELIVE`,
   `G1-09-2BII-SKU-STATUS-TRANSISI`, `G1-09-2BII-ADS-SEARCH`.
4. G1-09 sub-langkah 3 (halaman upload `web-internal`) dan endpoint
   konfirmasi identitas AM (`usulkan_ikat` → `client_platforms.shop_id`/
   `akun_konten_toko`) — masih belum ada.
5. Resolusi `sku_id` untuk `tt_video`/`shopee_ads_live`/`shopee_ads_cpc`
   yang SUDAH ditulis (semuanya `sku_id=NULL` selamanya) — belum tersentuh.

## 2. Ritual administratif — apa yang masih harus terjadi sesi ini

Mengikuti pola SESI17→18 (PR #374 handoff-only): berkas ini sendiri akan
di-commit + push sebagai PR dokumentasi-saja terpisah, menunggu CI hijau,
di-merge, lalu branch di-restart SEKALI LAGI. Baca commit log
`claude/charming-lovelace-x0bszv` / PR list repo untuk memastikan status
PR itu sebelum melanjutkan pekerjaan teknis baru.

## 3. Rujukan

- `docs/handoff/HANDOFF_PDT_SESI19.md` — detail teknis LENGKAP modul KEENAM
  `shopee_ads_cpc` + bug laten `shopee_ams_produk`/`shopee_ams_afiliasi`
  (§0/§0b), daftar lengkap berkas ZIP belum diperiksa (§1 butir 1).
- `docs/handoff/HANDOFF_PDT_SESI17.md`/`SESI18.md` — detail modul 3/4/5.
- `docs/DECISIONS.md` — baris Decided sesi 19/20 + Open
  `G1-09-2BII-ADS-CPC-SKU`.
- `docs/backlog/PDT_BACKLOG.md` §G1-09 — status ringkas seluruh sub-langkah.
- PR #376 (merged, `101082c`) — perubahan kode lengkap sesi 19/20.
