<!-- Section asal docs/DECISIONS.md: Wave 1 Integration (A↔B merge — 2026-07-11) -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-07-11 | **A#O18 accept-counter RESOLVED — edge `Negotiation - Revision Required → Negotiation - Approved` adalah aksi SALESPERSON (owner), bukan superior.** PRD M0 §5 baris 122 eksplisit: counter-offer → Revision Required → *salesperson* accepts (system syncs values) → Approved. Edge di `config.go` diubah dari `requireLead:true` menjadi tanpa `requireLead` (1 baris). Selaras dengan STATE_MACHINES.md §1 yang menyebut "(accept ⇒ Approved)" tanpa batasan role. | Menutup open question A#O18 sesuai teks PRD; approval Pending→Approved/Revise/Reject tetap superior-only. | Nerissa |
