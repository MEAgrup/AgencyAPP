<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-08-10 | **Empat tabel anak Plan (`plan_target`/`plan_actual`/`plan_review`/`plan_flag`) masuk ledger O48** di `supabase/tests/rls_checks.sql`. | Sama kelas dengan sebelas `strategi_*`: policy-nya `private.jwt_can_read_plan()`, cermin persis `plan_select` termasuk arm `jwt_is_lead() AND jwt_division() = 'Account'` — jadi arm-nya ADA, hanya satu tingkat di balik SECURITY DEFINER yang detektor sintaktik O48 tak bisa lihat (false-negative, bukan gap). `plan_row` TIDAK di ledger: policy-nya membawa arm divisi PIC-nya sendiri, dan `plan_row_week` mewarisinya lewat EXISTS. O60 (jika dikerjakan) menghapus keempatnya bersama sebelas `strategi_*` sekaligus. | Claude Code (mengikuti keputusan pemilik O48 (b)) |
