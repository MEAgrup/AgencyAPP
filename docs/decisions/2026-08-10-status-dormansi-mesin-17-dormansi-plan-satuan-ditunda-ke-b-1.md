<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-08-10 | **`status_dormansi` + mesin #17 (dormansi Plan Satuan) DITUNDA ke B-10, bukan dibuat di B-01** meski backlog B-01 menyebutnya. `lingkup` & `strategi_id` nullable tetap dibuat di B-01 supaya B-10 tak perlu migrasi kolom. | `status_dormansi` sebuah STATUS, dan aturan rumah #2 melarang kolom status tanpa mesin di STATE_MACHINES.md. Mesin #17 (`Aktif ⇄ Dorman`) adalah rancangan B-10 — dorman itu properti RANTAI periode Plan Satuan, bukan satu periode, dan Plan Satuan sendiri belum dibangun. Preseden: `contracts` (O57) menolak mendaftar mesin kosong dengan alasan yang sama. Bukan deviasi PRD — penajaman urutan kolom antar-tiket. | Claude Code (mengikuti aturan rumah #2) |
