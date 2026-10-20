<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-09-08 | **🟢 JURNAL KOREKSI — wewenangnya SAMA dengan yang boleh menutup buku.** Kata pemilik: *"yang berwenang jurnal koreksi sesuai asumsi. itu benar"* — menutup asumsi yang sebelumnya ditandai terbuka di `HANDOFF_GELOMBANG_D_LIVE_20260908.md` §4.3. Jadi: `Finance` level lead **ATAU** `Director`. | Memperlebarnya berarti orang yang tidak boleh menutup buku tetap bisa mengubah angkanya lewat pintu samping, dan pintu samping yang sah tetap pintu samping. Disimpan di `audit_log` (`entity_type='jurnal_koreksi'`), **bukan tabel baru**: audit_log sudah menolak UPDATE/DELETE, sudah punya aktor+waktu+before/after, dan sudah jadi tempat orang mencari riwayat — tabel baru berarti menegakkan ulang keempatnya, dan menegakkan ulang berarti sebagian akan terlewat. | Pemilik (Yohan) |
