<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-07-09 | CDPS dibangun **standalone** (Golang modular monolith + React/Next + MySQL), terintegrasi tipis ke HRIS existing (employee sync + auth), bukan di dalam codebase HRIS. | Decoupling dari sistem HR kritis; satu sumber data karyawan; satu login; tim internal pegang stack yang sama. | Nerissa |
