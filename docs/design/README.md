# `docs/design/` — artefak desain, rujukan **satu arah**

Berkas di sini adalah **prototipe/desain yang sudah disetujui pemilik dan dipakai sebagai
spesifikasi porting**. Aturannya satu, dan penting:

> **Rujukan satu arah.** Begitu logikanya diport ke `packages/**`, berkas di sini **tidak
> dipelihara lagi**. Jangan memperbaiki bug di sini, jangan menyinkronkan dua arah.

Alasannya bukan kerapian: memelihara dua salinan aturan bisnis yang sama akan membuat keduanya
menyimpang, dan itu kegagalan yang `CLAUDE.md` peringatkan eksplisit (*"menciptakan versi kedua
dari aturan bisnis yang sama"*). Sesudah port, satu-satunya sumber kebenaran adalah kode di
`packages/**` beserta tesnya.

## Isi

| Berkas | Asal | Diport ke | Status |
|---|---|---|---|
| `BASELINE_TOOL_TIKTOK_v1.html` | Pemilik, 2026-08-17 (revisi ke-2) | `packages/core/src/baseline/` (tiket **RAB-02**) | **belum diport** |

### `BASELINE_TOOL_TIKTOK_v1.html`

Tool baseline riset toko: membaca export **TikTok Shop Seller Center + Ads Manager** (dan Analitik
Toko Tokopedia secara tipis), menghitung 5 pilar Skor Kondisi Toko, menghasilkan payload
`cdps.baseline.tiktok.v1`.

**Nilainya bagi porting** ada di hal-hal yang mudah salah dan sudah benar di sini — jangan
ditulis ulang, pindahkan apa adanya:

- `n(v,raw)` — Seller Center mengirim string `"Rp10.945.407"` (titik = **ribuan**), Ads Manager
  mengirim float `335164.77` (titik = **desimal**). Flag `raw` yang membedakannya.
- Heuristik deteksi baris header — memakai hitungan **label unik** supaya header kedua
  ("Data harian") dan baris filter `"Semua","Semua",…` tidak salah dibaca sebagai header.
- Ambang tayangan **adaptif** (median VV video yang terbukti jual), membuang baris sisa histori.
- **Median, bukan rata-rata**, sebagai jangkar baseline + penanda bulan campaign 1,8×.
- Guardrail *"pendapatan iklan tumpang tindih dengan GMV, jangan dijumlah"* — sejajar dengan
  guardrail single-source GMV M6D (RM-3).
- Bobot 5 pilar **sadar-cakupan**: pilar tanpa data → `null`, bobot dinormalisasi ulang.
- 12 tanda-tangan tipe file + **seluruh string nama kolom** (inilah peta yang tak boleh ditebak).

**Yang HARUS diperbaiki saat porting** (jangan diport apa adanya) —
lihat `docs/handoff/HANDOFF_M6ABC_SESI31.md` §2.2 untuk daftar lengkap dengan alasannya:

1. `null * 100` jadi `0`, membatalkan penjagaan null di setiap situs panggil `meter()`.
2. `n()` mengembalikan `0` untuk kolom kosong/hilang — kolom yang berganti nama terbaca sebagai nol.
3. `detect()` memisah toko-vs-afiliasi dari ambang `u.size<=2`.
4. Benchmark (`BENCH`, 16 angka) bisa diedit AM di browser ⇒ skor tak bisa dihitung ulang.
5. `new Date()` klien, bukan WIB server. 6. SheetJS/font dari CDN. 7. Identitas & riwayat GMV
   diketik ulang padahal sudah ada di `clients`/`qualified_forms`. 8. Output berhenti di clipboard.
   9. Nol baris audit.

> ⚠️ **Berkas ini adalah salinan yang dituliskan ulang dari pesan pemilik, bukan unggahan biner.**
> Kalau saat porting ada keraguan tentang satu baris — terutama string nama kolom atau angka
> benchmark — **minta pemilik menempelkan ulang versi aslinya** dan perlakukan itu sebagai yang
> benar, jangan menebak.
