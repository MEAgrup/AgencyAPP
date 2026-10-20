<!-- Section asal docs/DECISIONS.md: Bridge MSDPS→CDPS Fase 1 (2026-09-10) — MENGGANTIKAN butir (7) entri 2026-07-12 -->

| Tanggal | Keputusan | Alasan | Approved by |
|---|---|---|---|
| 2026-09-10 | **Bagian A (CDPS) dan Bagian B (MSDPS) dieksekusi BERURUTAN, CDPS lebih dulu.** MSDPS tidak bisa mengirim apa pun sebelum `POST /api/v1/internal/bridge/orders` ada dan `docs/BRIDGE_MSDPS_CONTRACT.md` di-commit — dokumen itu yang membangun sisi MSDPS (payload builder + fixture bersama, D12). B0 (menyambungkan `create_poi_finance()` yang sudah ada di MSDPS ke UI, migrasi SQL: NOL baris baru) dieksekusi paling awal di sisi MSDPS karena gerbang D13 hari ini menolak 100% deal produksi (nol `transaction_id` terisi — ditemukan lewat pengukuran langsung production MSDPS, bukan asumsi). | Urutan yang salah (MSDPS lebih dulu) akan mengirim ke endpoint yang belum ada; B0 adalah prasyarat teknis nyata yang ditemukan lewat pengukuran, bukan pilihan gaya. | Yohan Agustian |
