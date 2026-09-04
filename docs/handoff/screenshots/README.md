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
