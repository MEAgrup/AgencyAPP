# Screenshot Sidebar IA v3 — bukti verifikasi browser 2026-09-04

Diambil dari `web-internal` yang benar-benar jalan (Chromium via Playwright,
`apps/api` :3001 + `web-internal` :3000 di atas DB lokal hasil
`scripts/db-rebuild.sh`, sesi JWT di-mint lokal — GoTrue live tidak dipakai).
Cara mengulangnya ada di `HANDOFF_LANJUT_SEMUA_BUILD_SESI3_20260904.md` §6.2.

| Berkas | Yang dibuktikan |
|---|---|
| `sidebar-v3-01-direktur-tertutup.png` | Direktur di `/` — 9 judul grup, hanya **Beranda** terbuka. Inilah keadaan yang tidak bekerja sebelum perbaikan `[hidden]`: seluruh 37 tautan terlihat sekaligus. |
| `sidebar-v3-02-papan-divisi-terbuka.png` | Direktur di `/creative` — **Delivery** + sub-grup **Papan Divisi** terbuka sendiri (kedalaman 2), `Creative` bertanda aktif. |
| `sidebar-v3-03-cari-papan.png` | Kotak cari berisi `"papan"` — hanya Delivery › Papan Divisi tersisa, 7 papan. |
| `sidebar-v3-04-creative-autoscope.png` | Staff Creative — auto-scope §5.6: **satu** papan divisi, dan 5 grup saja (nol Akuisisi/Klien/Keuangan/Admin). |

Kalau rail-nya diubah lagi, ganti screenshot ini pada PR yang sama — dokumen
lain merujuknya sebagai bukti keadaan yang lolos.


---

# Screenshot UAT M19 — bukti verifikasi browser 2026-09-09

Diambil dengan cara yang sama (Chromium via Playwright, `apps/api` :3001 +
`web-internal` :3000 di atas DB `db-rebuild.sh`, JWT di-mint lokal). Langkah
lengkapnya `TUTORIAL_UAT_M19_SALES_DRIFT_20260909.md` §0–§1; hasilnya
`UAT_M19_BROWSER_20260909.md`.

| Berkas | Yang dibuktikan |
|---|---|
| `uat-m19-01-bentrok-warn-not-block.png` | Dua slot bertumpang di studio Kasuari: **keduanya tersimpan dan keduanya tampil**, bergaris kuning, dengan pita **"Tersimpan, dengan catatan"** — bukan pita galat. Inilah *warn-not-block* (D3/D4) sebagai PERILAKU, bukan sekadar teks. |
| `uat-m19-02-pic-tidak-tersedia.png` | Menjadwalkan PIC yang tercatat tidak tersedia: peringatan `[PIC tidak tersedia pada tanggal ini]` **dan slotnya tetap tersimpan**. Terlihat juga cacat `M19-NAMA-RLS`: blok "Tidak tersedia hari ini" berbunyi `EMP-0003 (Cuti)`, bukan nama orang. |
| `uat-m19-03-semua-klien.png` | Baris SCS tanpa klien merender **"Semua klien"**, bukan sel kosong. |
| `uat-m19-04-kategori-sla-standing.png` | Layar Kategori: SLA dua Kategori standing kosong, dan memilih standing = ya mengosongkan + mematikan input SLA. |

| `uat-sales-01-owner-nama.png` | `/sales` sebagai **Head Sales**: kolom Owner berisi **"Budi Santoso"**, bukan `EMP-0001` (feedback Sales `#2`). Peran ini yang membuktikan — OD/Director lolos `jwt_can_read_all()` dan tidak pernah melihat bug-nya. |
| `uat-sales-02-kalkulator-tenor.png` | `/sales/kalkulator` (FS-6b): memilih tenor **6 bulan** mengubah kolom Harga Rp 3.000.000 → **Rp 15.000.000** dan ikut mengubah Ringkasan — harga PAKET UTUH tenor terpilih, bukan `standard_price` versi. |
| `uat-sales-03-client-record-pita-galat.png` | `OBS-1-PITA-GALAT`: Client Record sebagai Sales staff **pemilik klien** — tiga pita galat merah pada halaman yang boleh dibuka, sementara panel Kontrak & Perpanjangan berfungsi penuh. Director/OD melihat nol pita. |
| `uat-m19-05-nama-sesudah-perbaikan.png` | `M19-NAMA-RLS` **sesudah** diperbaiki: kartu slot sebagai lead Creative kini menampilkan nama toko & nama PIC, bukan `CLI-…`/`EMP-…`. Bandingkan dengan `uat-m19-02` yang merekam keadaan cacatnya. |
| `uat-sales-04-client-record-sesudah-perbaikan.png` | `OBS-1-PITA-GALAT` **sesudah** diperbaiki: Client Record sebagai Sales staff pemilik — nol pita merah, panel Kontrak & Perpanjangan tetap utuh. Bandingkan dengan `uat-sales-03`. |

## UAT resign permanen (PR #340, 2026-09-10)

Harness `scripts/dev-jwt.mjs` + `scripts/browser-tour.mjs` terhadap DB lokal
hasil `db-rebuild`; hasil lengkapnya `UAT_RESIGN_PERMANEN_20260910.md`.

| Berkas | Yang dibuktikan |
|---|---|
| `uat-resign-01-lead-hr.png` | Halaman Karyawan sebagai **Lead HR** — inilah perbaikan jebakan #3 sebagai PERILAKU: menu ADMIN tampil, dan tabelnya berisi **11 dari 11** karyawan LINTAS DIVISI (Account/Ads/Creative/Finance/HR/KOL/Management/Sales), bukan hanya divisi HR. Tombol **Mutasi + Resign** per baris; baris EMP-0003 yang sudah resign berbadge `Resign` dan kolom Aksi-nya `—` (tidak bisa di-resign dua kali). Kolom "Punya Password" berbunyi `Belum` HANYA pada barisnya sendiri dan `—` untuk semua orang di luar divisinya — batas password yang sengaja tidak dilebarkan, terlihat di layar. |
| `uat-resign-02-od-tanpa-tombol.png` | Aktor **OD** (badge `OD`, `od:true director:false`): halaman terbuka penuh, 11 baris terbaca, **nol tombol Resign, nol tombol Mutasi, nol kolom Aksi**. Invarian "OD tidak pernah menulis" sebagai perilaku, bukan sekadar 403 di jaringan. Terlihat juga temuan pre-existing `OBS-OD-PANEL-TULIS`: panel "Impor karyawan" dan "Reset password" TETAP disodorkan kepadanya. |
| `uat-resign-03-lead-divisi-lain.png` | **Lead divisi lain** (Head Sales): **menu ADMIN sama sekali tidak ada** di sidebar, dan saat URL-nya diketik langsung direktori menolak dengan `[anda tidak memiliki akses ke data ini]` di panel merah — bukan halaman kosong, bukan galat mentah. Dua panel tulis yang sama juga masih tampil di sini (`OBS-OD-PANEL-TULIS`). |
