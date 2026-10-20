<!-- Section asal docs/DECISIONS.md: Open -->

| # | Item | Needed from | Blocking? |
|---|---|---|---|
| REV-1 | 🟡 **BARU 2026-09-04 (Revisi Sales/Creative/Performa) — `[Unrespon]` membalik prinsip M1-OA-7 untuk jam yang berbeda.** M1-OA-7 sudah memutuskan bahwa penuaan lead menghasilkan **flag**, bukan perubahan status (`[Pool]` >24 jam ditandai *stale* tapi "not removed or auto-recycled"). `[Unrespon]` (`docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md` L1) membuat penuaan yang menggerakkan STATUS `prospect_attempts` — untuk jam yang berbeda (attempt yang sudah diklaim sales, bukan record `[Pool]` yang belum diklaim siapa pun). Bukan kontradiksi harfiah (dua mesin berbeda: `leads.record_status` vs `prospect_attempts.status`), tapi wajib ditandatangani sebelum L1 dikerjakan. | Yohan/Nerissa | Tidak — dua mesin status berbeda secara desain; ini konfirmasi, bukan koreksi arsitektur |
