<!-- Section asal docs/DECISIONS.md: Wave 2 kickoff — interview keputusan manusia (2026-07-12) -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-07-12 | **R5 DI-WAIVE SEMENTARA — Wave 2 dimulai sekarang (Opsi A).** Build Plan R5 ("no Wave-2 tickets before Wave-1 exit criteria pass UAT") di-waive khusus situasi ini: seluruh gate TEKNIS Wave 1 hijau (17 paket test, migrasi up→down→up, seed idempoten), UAT W1-20 macet hanya di item MANUSIA (O21 email, O18/O6 bahan import, endpoint HRIS). M6 mulai dikerjakan paralel; skema `0002` beku & stabil, M6 hanya konsumsi klien `released_to_account_at`. UAT W1-20 TETAP wajib lulus sebelum go-live — waiver ini tidak menghapus gate, hanya melepas serialisasi. | Menunggu item manusia memblokir engineering tanpa mengurangi risiko; pekerjaan M6 tidak menyentuh kontrak Wave 1. | Nerissa (interview 2026-07-12) |
