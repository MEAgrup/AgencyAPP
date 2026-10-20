<!-- Section asal docs/DECISIONS.md: Wave 1 Integration (A↔B merge — 2026-07-11) -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-07-11 | **Prefix `NEG-` (negotiation proposal) & konfirmasi `SVC-`/`CLI-`/`TRX-`/`INST-` di closing.** Negotiation proposal id = `NEG-YYYYMM-NNNN` (tidak tercantum eksplisit di DATA_MODEL — dicatat di sini sesuai pola registry). Closing membangkitkan `CLI-`/`TRX-`/`SVC-`/`INST-` via `ident.Next` ke tabel 0002. | Konsistensi konvensi ID §1; `NEG-` mengikuti pola prefix. | Dev (integrator) |
