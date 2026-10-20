<!-- Section asal docs/DECISIONS.md: Wave 1 Integration (A↔B merge — 2026-07-11) -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-07-11 | **A#O21 resubmit-after-reject RESOLVED — konvergen dengan B#O16.** PRD M0 §5 baris 123: setelah Reject, salesperson boleh submit fresh proposal atau Closed-Lost. Edge `Negotiation - Rejected → Negotiation - Pending Approval` sudah ada di config.go fondasi B (via B#O16). Integrasi mengadopsinya sebagai resolusi A#O21 (tanpa `requireLead` = aksi salesperson). Catatan penomoran: A#O18/O21 ≠ B#O18/O21 (stream berbeda). | Kedua stream tiba di edge yang sama; tidak ada duplikasi. | Nerissa |
