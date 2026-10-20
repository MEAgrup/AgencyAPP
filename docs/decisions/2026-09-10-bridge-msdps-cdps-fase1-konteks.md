<!-- Section asal docs/DECISIONS.md: Bridge MSDPS→CDPS Fase 1 (2026-09-10) — MENGGANTIKAN butir (7) entri 2026-07-12 -->

# Bridge MSDPS→CDPS Fase 1 (2026-09-10) — MENGGANTIKAN butir (7) entri 2026-07-12

Entri 2026-07-12 ("Role mapping HRIS→CDPS FINAL") butir **(7)** berbunyi *"TIKTOK GO = di luar
cakupan CDPS untuk saat ini, tanpa mapping (ditinjau ulang fase berikutnya)"*. Baris ini
**MENGGANTIKAN** butir itu: fase berikutnya sudah tiba. MEAGO! (MSDPS, `MEAgrup/MEAGO_MSDPS`,
proyek Supabase terpisah) tidak punya staff Account/Ads/Creative/Store Operation sendiri —
semuanya duduk di MEA Agency dan bekerja di CDPS — sehingga MSDPS M6–M10 (execution engine
kedua yang lengkap) berdiri tanpa penghuni sejak dibangun. Dokumen rencana lengkap:
`BRIDGING_MSDPS_CDPS_v1.0.md` (arsitektur, dibaca Claude atas dua repo penuh) dan
`RENCANA_BRIDGE_MSDPS_CDPS_FASE1.md` (verifikasi terhadap kode berjalan + 4 temuan yang
mengubah rencana, keduanya diunggah pemilik 2026-09-10/11).

**Prasyarat go-live yang BUKAN kode** (Bagian V rencana, tidak memblokir merge PR ini): (1) paket
MEAGO dibuat di Master Service List lewat layar MSL (Sales Head + Head Account) —
`external_service_map` LAHIR KOSONG dan TETAP kosong sampai ini selesai; (2) baris
`external_service_map` diisi sesudah paket ada; (3) SATU employee layanan "MEAGO Bridge"
dibuat (email nyata tim, bukan pribadi), TANPA baris `role_mappings`; (4) transaksi Finance
MSDPS untuk deal pilot dijalankan lewat B0, lalu diverifikasi, sebelum accept pertama dicoba.

**Stop conditions yang ditegakkan di kode ini** (bukan sekadar dicatat): `external_service_map`
TIDAK di-seed; `apply_ppn` cross-charge intra-grup adalah pertanyaan Finance, bukan
diputuskan di sini; tidak ada `TRX-` yang pernah dibuat untuk order MEAGO; M5 tidak pernah
membaca `client_external_billing`; gerbang accept tidak punya jalur pelonggaran untuk actor
mana pun termasuk Director.
