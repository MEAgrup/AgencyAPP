<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-09-08 | **🔴 TEMUAN KEAMANAN (milik perubahan ini, sudah ditutup) — `DROP FUNCTION` membuang ACL.** `sm_transition` yang baru sempat lahir dengan `EXECUTE` untuk `PUBLIC`, artinya `anon` dan `authenticated` bisa memanggil mesin transisi langsung. Dipulihkan di migrasi yang sama. | **`rls_checks` di `scripts/db-rebuild.sh` TIDAK menangkapnya** — ia memeriksa tabel, bukan ACL fungsi. Dua tes baru di `packages/domain/src/engine.test.ts` menutup celah itu (satu overload saja + `prosecdef`/ACL sejajar dua saudaranya), keduanya dibuktikan bisa merah lewat mutasi **terpisah**. | Claude |
