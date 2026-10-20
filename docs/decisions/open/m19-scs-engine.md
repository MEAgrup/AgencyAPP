<!-- Section asal docs/DECISIONS.md: Open -->

| # | Item | Needed from | Blocking? |
|---|---|---|---|
| M19-SCS-ENGINE | ✅ **DIKETOK 2026-09-09 — opsi (b), mesin SENDIRI #34 `scs_task`, pola `internal_tasks`.** Pemilik memilih (b). Dibangun di migrasi `20260928010000_m19_scs_task_engine.sql` + `packages/domain/src/scs.ts`; rinciannya di baris `Decided` 2026-09-09 (`M19-SCS-ENGINE`). Yang membuat (b) benar dan bukan sekadar lebih murah: baris `all client: Brief` di sheet SMO **tidak punya klien**, sementara **M12 §2 Rule 1 MEMBEKUKAN** Task = Asset \| Creator Booking \| Brief-as-task sebagai turunan wajib Klien→Service→Brief — dan `PREFIXES.REQ` (`ident.ts`) sudah mencatat bahwa melonggarkan `client_id` *"akan membongkar gerbang pembayaran M4/M5"*. `task.ts` (M12) TIDAK disentuh sama sekali. | Yohan | **Tidak lagi memblokir apa pun** — Gap B/G/I dibangun. |
