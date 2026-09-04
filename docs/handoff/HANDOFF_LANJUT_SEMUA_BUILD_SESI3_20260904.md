# HANDOFF — LANJUT SEMUA BUILD, SESI 3

> Melanjutkan `HANDOFF_LANJUT_SEMUA_BUILD_SESI2_20260904.md`. Dokumen itu (dan
> induknya, `HANDOFF_LANJUT_SEMUA_BUILD_20260904.md` di PR #281) **belum
> digantikan** — §2 (6 keputusan pemilik), §3 (tiket tersisa) dan §4 (gate
> cutover) **carry-over apa adanya** kecuali yang disebut berubah di sini.

## 0. TL;DR — apa yang berubah sesi ini

| # | Pekerjaan | Status |
|---|---|---|
| 1 | **UAT dua engine TikTok dengan export ASLI** (SESI2 §0 baris 2) | ✅ **SELESAI** — dan menemukan 1 bug berat, lihat §1.1 |
| 2 | **O70** — Ads Scanner baca kolom dari seksi yang salah (86% GMV hilang) | ✅ **DIPERBAIKI + dites** |
| 3 | Rename grup sidebar → **"MEA AI Tools"** + kunci visibilitas per divisi | ✅ **SELESAI** (§2) |
| 4 | Jawab 6 keputusan pemilik (SESI2 §2) | ⬜ belum — **+2 baru** (O71, O70-b, §3) |
| 5 | Tiket kode tersisa (SESI2 §3) | ⬜ belum tersentuh |
| 6 | Gate GO cutover → C-05 | ⬜ belum |
| — | PR #281 masih draft (SESI2 §5) | ⬜ masih perlu keputusan Nerissa/Yohan |

---

## 1. UAT TikTok dari export asli — laporan penuh di dokumen sendiri

**Baca `docs/handoff/UAT_TIKTOK_AVITASKIN_20260904.md`.** Ringkasnya:

### 1.1 🔴 O70 — bug berat di Ads Scanner, ditemukan & diperbaiki

Export **"Analitik Produk"** yang sebenarnya adalah tabel **176 kolom dalam 5
seksi** (`Semua`, `LIVE penjual`, `Video penjual`, `Afiliasi`, `Kartu produk
penjual`) dengan **30 nama kolom berulang**. `rowsToObjects` (port verbatim dari
tool pemilik) memakai aturan "yang terakhir menang", jadi **setiap metrik
headline SKU** dibaca dari seksi terakhir:

| | dibaca engine | sebenarnya |
|---|---|---|
| Σ GMV 24 SKU | Rp 3.743.633 | **Rp 26.560.049** |
| Σ Impresi | 55.345 | **832.842** |
| CTR SKU teratas | 2,36% | **3,51%** |
| CTOR SKU teratas | 3,39% | **0,40%** |

Oracle-nya silang-berkas: Σ kolom pertama = persis GMV export Analitik Toko
(`shop_tt`). Dampaknya bukan cuma angka — **nasihatnya berbalik arah**: SKU
teratas berubah dari *"kreatif/hook lemah, butuh angle baru"* jadi *"konversi
bocor — cek harga, review, foto & deskripsi halaman produk"*.

**Perbaikan:** `rowsToObjects` kini "kemunculan PERTAMA menang" + kunci bersuffix
`nama#<kolom>` untuk sisanya — **persis aturan `baseline/sheet.ts:readSheet`**
yang sudah dipakai mesin baseline/report, jadi repo ini berhenti punya dua aturan
untuk satu masalah. Ini satu-satunya penyimpangan dari tool pemilik di mesin ini,
dicatat di `DECISIONS.md` **O70** dan di komentar modulnya.

### 1.2 ✅ Report Engine: bersih

12 dari 12 berkas dikenali benar, semua KPI headline cocok **persis** ke berkas
mentah (GMV, pesanan, pembeli, pengunjung, CVR digit-demi-digit, impresi, klik),
periode terbaca dari berkas, `createReport` sukses (skor 4,5 KRITIS).

Satu konsekuensi operasional: 4 berkas video/LIVE ditandai **ambigu** (toko vs
afiliasi) dan `createReport` menolak 400 sampai klien punya akun tertaut →
**`client_platforms` klien TikTok harus terisi handle tokonya**.

### 1.3 ✅ O67 terverifikasi di data nyata

Kosakata status produk TikTok yang asli: **`Aktif` / `Nonaktif`**. Produk
`Nonaktif` masuk bucket **DIBLOKIR** dengan blocker yang benar — perbaikan
`\baktif\b` sesi lalu terbukti benar, keraguan "vocabulary belum diverifikasi"
di handoff SESI2 §1.2 tertutup.

### 1.4 Temuan kecil

- 🟡 **O71 (BARU, belum diperbaiki)** — Report Engine membuang video yang
  captionnya kosong (16 video, 15 di antaranya VV>0) dari penyebut. Butuh
  keputusan pemilik karena mengubahnya menggeser angka semua laporan lama.
- ✅ Pesan `[berkas ini ekspor "Ringkasan data"…]` kini **menyebut nama
  berkasnya** — sebelumnya satu folder 12 berkas ditolak tanpa petunjuk yang mana.

---

## 2. Navigasi — status sebenarnya

Pertanyaan pemilik sesi ini: *"plan perubahan navigasi sudah sampai mana?"*

- **Spek ADA, implementasi BELUM.** `docs/CDPS_Sidebar_IA_v3.md` +
  `docs/CDPS_Sidebar_IA_v3_mockup.html` (dikirim 2026-09-03) adalah reorganisasi
  penuh: 9 grup, 30-33 item, grup "Portal" dibubarkan, banyak rename.
  **Nol** dari reorganisasi itu ada di kode.
- **Yang sudah mendarat hanya label grup alat bantu**: `Alat` → `AI Tools MEA`
  (2026-09-03) → **`MEA AI Tools`** (sesi ini, permintaan pemilik).
- **Yang menahan sisanya:** §4 dokumen IA v3 — **3 pasang halaman yang mungkin
  duplikat** (Kinerja Saya vs Tugas Saya · Kinerja Divisi vs Team Performance ·
  Pantauan Risiko Klien vs Client Health). Itu keputusan PRODUK, bukan navigasi;
  jangan pilih sendiri mana yang di-drop.

Yang dikerjakan sesi ini di `web-internal/src/lib/nav.ts`:
label grup jadi **`MEA AI Tools`**; isinya tetap daftar alat bantu HTML dari
`embedded-tools.ts` (`AM - baseline riset`, `AM Co-Pilot`); **visibilitas
dikunci** oleh 6 tes baru — judul grup hilang sepenuhnya untuk 8 divisi tanpa
akses, dan setiap baris di grup ini WAJIB bergerbang dengan predikat dari
registry (satu baris tanpa gerbang akan membocorkan judul grup ke semua divisi,
karena `visibleNav` hanya membuang seksi yang KOSONG).

`/ads/screening` dan `/ads/scanner` **sengaja tetap di grup Delivery** — keduanya
sudah jadi halaman React ber-API/ber-RLS milik divisi Ads, bukan HTML yang
di-embed.

---

## 3. Keputusan pemilik yang menahan kode — 6 lama + 2 baru

Enam yang lama tidak berubah (SESI2 §2: SCR-UI-1, LT-2+LT-8, LT-1 sisa,
KS-4/KS-4b, X-12, O65). Dua tambahan sesi ini, keduanya di `DECISIONS.md` bagian
`Open`:

| # | Pertanyaan | Kalau tidak dijawab |
|---|---|---|
| **O71** 🟡 | Video tanpa caption: hitung sebagai video (kunci `ID Video`) atau tetap dibuang? | Penyebut "video ada penjualan" kurang ~2,4% di tiap laporan TikTok |
| **O70-b** 🟡 | Adakah scan Ads Scanner **produksi** sebelum 2026-09-04? Kalau ada, wajib scan ulang (`adsscanner_run` immutable) | Angka pra-O70 terbaca sebagai kebenaran di laporan klien |

Plus pertanyaan navigasi §2 (3 pasang halaman duplikat) yang menahan Sidebar IA v3.

---

## 4. Yang TIDAK dikerjakan sesi ini

Seluruh tabel tiket SESI2 §3 (X-08, CR-12, LT-12/LT-14, O60, O59-b, O48 sisa,
O47b sisa, W2-C2/C3, M15-G3…G7, O7, O8, C-05) **masih terbuka, nol tersentuh**.
Peringatan SESI2 tetap berlaku: **`ls` artefak kodenya dulu sebelum percaya
status "siap"/"belum"** di berkas backlog.

---

## 5. Catatan teknis untuk sesi berikutnya

1. **DB lokal wajib bersih sebelum `npm test`.** Baris UAT yang ditinggalkan di
   `clients` membuat 2 tes `portal.test.ts` (management dashboard, Rule 11)
   gagal — bukan regresi kode. `adsscanner_run` immutable jadi tak bisa
   di-`delete`; jalan keluarnya `scripts/db-rebuild.sh --yes`.
2. **Postgres di sandbox tidak jalan otomatis**: `pg_ctlcluster 16 main start`,
   lalu set password (`alter user postgres with password 'postgres'`) supaya
   `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/cdps` bisa dipakai.
3. **`npm install` di root DAN di `web-internal`** — dua lockfile terpisah.
4. Export asli klien **tidak** disimpan di repo. Cara mengulang UAT ada di §6
   dokumen UAT.

## 6. Prompt siap tempel untuk chat berikutnya

> Baca `docs/handoff/HANDOFF_LANJUT_SEMUA_BUILD_SESI3_20260904.md` lalu
> `UAT_TIKTOK_AVITASKIN_20260904.md`. Cek status PR #281 dan dua pertanyaan baru
> (O71, O70-b) — kalau belum dijawab, tanyakan ke Nerissa. Lalu pilih SATU tiket
> "nol — siap" dari SESI2 §3 (X-08, CR-12, O60, O59-b, O47b sisa),
> **verifikasi dulu ke kode** sebelum menulis apa pun, baca PRD terkait penuh,
> kerjakan dengan tes. Jangan mulai Sidebar IA v3 penuh sebelum 3 pertanyaan
> duplikat halaman (§2) dijawab.
