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
| 3b | **Sidebar IA v3 diimplementasi** — 9 grup, accordion, kotak cari, Papan Divisi | ✅ **SELESAI** (§2) — badge §5.4 ditunda |
| 4 | Jawab 6 keputusan pemilik (SESI2 §2) | ⬜ belum — 2 pertanyaan BARU sesi ini (O71, O70-b) **sudah dijawab & ditindaklanjuti**, §3 |
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

- ✅ **O71 (dijawab pemilik, diperbaiki)** — Report Engine membuang video yang
  captionnya kosong (16 video, 15 di antaranya VV>0) dari penyebut. Pemilik:
  **tetap dihitung, diberi nama `(tanpa caption)`**. Baris kini dibuang hanya
  bila caption DAN `ID Video` sama-sama kosong. Terverifikasi ke export asli:
  34 dari **664** (dari 648).
- ✅ **O70-b (dijawab pemilik)** — Ads Scanner **belum dipakai di aplikasi**,
  jadi tak ada scan produksi yang perlu dijalankan ulang setelah O70.
- ✅ Pesan `[berkas ini ekspor "Ringkasan data"…]` kini **menyebut nama
  berkasnya** — sebelumnya satu folder 12 berkas ditolak tanpa petunjuk yang mana.

---

## 2. Navigasi — Sidebar IA v3 SUDAH mendarat

Saat sesi ini dimulai, jawaban atas *"plan navigasi sudah sampai mana?"* adalah:
**spek ada, implementasi nol** — kecuali satu label grup. Sekarang tidak lagi.

**Yang terpasang** (`web-internal/src/lib/nav.ts` + `Sidebar.tsx`):

- **9 grup** sesuai IA v3 §2: Beranda · Akuisisi · Katalog & Penawaran · Klien ·
  Delivery · MEA AI Tools · Keuangan · Tim · Admin.
- **Grup "Portal" dibubarkan**: `Portal Saya`→Beranda `Kinerja Saya`,
  `Portal Tim`→Tim `Kinerja Divisi`, `Manajemen`→Klien `Pantauan Risiko Klien`,
  `Kontak Klien (Portal)`→Admin `Akses Portal Klien`. Plus `Klien`→`Direktori
  Klien`, `Perlu Persetujuan Saya`→`Persetujuan`.
- **`Notifikasi` + `Ganti Password` pindah ke header** (v3 §2 "Avatar menu") —
  bel & Keluar sudah ada di sana, `Ganti Password` ditambahkan. Tetap tanpa
  gerbang, alasan O44(c) yang sama.
- **Accordion** (satu grup terbuka; grup rute aktif terbuka saat muat),
  **kotak cari ⌘K/Ctrl+K**, **sub-grup `Papan Divisi`** kedalaman-2 yang
  mengingat lipatannya di localStorage, rail 270px sticky, a11y penuh.
- **Auto-scope Papan Divisi** ternyata bukan aturan baru: ia jatuh dari
  `divisionQueue` yang sudah ada. Creative staff melihat satu papan; Direktur/OD
  tujuh.

**Empat penyimpangan dari dokumen, semuanya disengaja & tercatat:**

1. **Badge angka (§5.4) DITUNDA** — pilihan pemilik. Tiap badge butuh endpoint
   hitungan sendiri di `apps/api` (Persetujuan, Leads, Task Execution, Reminder)
   berikut tes izin per peran. **Itu tiket berikutnya kalau badge dimau.**
2. **§4 dijawab pemilik: ketiga pasang halaman DIPERTAHANKAN** → 33 item, bukan
   30. Ketiganya beda kemampuan, bukan cuma scope (lihat DECISIONS 2026-09-04).
3. **Label dua alat di MEA AI Tools tidak diubah** — pemilik hanya minta nama
   grupnya.
4. **`Screening SKU` + `Ads Scanner` ditambahkan ke Delivery** — mendarat sesudah
   v3 ditulis; keduanya halaman React ber-API/ber-RLS milik divisi Ads, bukan
   HTML embed, jadi bukan anggota grup MEA AI Tools.

**Yang menjaga supaya tidak ada halaman kehilangan pintu:** satu tes menyebutkan
37 href satu per satu dan gagal kalau salah satunya hilang dari model, plus tes
"tidak ada href ganda". Logika accordion & pencarian dipindah ke `nav.ts` sebagai
fungsi murni (`isActiveHref`/`sectionOfRoute`/`filterNav`) supaya bisa dites tanpa
DOM; `Sidebar.tsx` tinggal renderer.

⚠️ **Belum diuji di browser sungguhan** — build, lint, typecheck dan 534 tes
hijau, tapi rail-nya belum pernah dibuka mata manusia. Kalau ada sesi dengan
`apps/api` + DB hidup, buka `/` dan periksa accordion, ⌘K, dan lipatan Papan
Divisi.

---

## 3. Keputusan pemilik yang menahan kode — 6 lama + 2 baru

Enam yang lama tidak berubah (SESI2 §2: SCR-UI-1, LT-2+LT-8, LT-1 sisa,
KS-4/KS-4b, X-12, O65). Dua tambahan sesi ini, keduanya di `DECISIONS.md` bagian
`Open`:

Dua pertanyaan yang lahir dari UAT sesi ini **sudah dijawab pemilik pada hari
yang sama** dan sudah ditindaklanjuti — nol yang menggantung:

| # | Pertanyaan | Jawaban | Tindak lanjut |
|---|---|---|---|
| **O71** | Video tanpa caption: hitung atau buang? | **Hitung**, beri nama `(tanpa caption)` | ✅ dibangun + 3 tes |
| **O70-b** | Ada scan Ads Scanner produksi sebelum 2026-09-04? | **Belum dipakai di aplikasi** | ✅ nol pekerjaan retroaktif |

Yang masih menahan: 6 keputusan lama SESI2 §2, plus pertanyaan navigasi §2
(3 pasang halaman duplikat) yang menahan Sidebar IA v3.

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
