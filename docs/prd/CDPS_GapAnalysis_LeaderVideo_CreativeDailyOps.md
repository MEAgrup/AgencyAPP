# CDPS — Gap Analysis: Leader Video Daily Ops vs. Current Coverage

**Status:** Gap analysis with decisions locked 2026-09-09 (§7) — **not yet a build-ready PRD.** Per house process (sequential module locking), this is the "compare reality to code" step; the interview round is done, so the next step is the field-level spec itself. Two items (D6, D9) carry recommendations awaiting Yohan's sign-off.

**Trigger:** Leader Video job description (24 Jun 2026) + two daily production schedule sheets ("jadwal lama": 1,442 rows, Jan–Mar 2026; "jadwal baru": 2,712 rows, Jan–Sep 2026) + three role-dedicated worksheets (Content Strategist, Content Creator, Social Media Officer — added in this revision, see §9) compared against current CDPS Module 7 (Creative), Module 12 (Task Execution), Module 14 (Team Performance), and the actually-shipped routes in `web-internal/src/app/(shell)/creative`.

**Revision note (this pass):** the three role sheets confirm Gaps B/C below and surface two more the schedule sheets alone didn't show — a role (Content Creator) that doesn't fit the "individual contributor with a taxonomy" pattern at all, and a recurring/standing-task pattern neither Module 7 nor the original gap map accounted for. Both are covered as Gaps H and I in §4.

**This confirms and gives concrete content for an already-flagged gap.** `docs/DECISIONS.md`, K-1 (owner Nerissa/COO, dated **2026-09-07** — one day before this analysis): *"Peran Strategist/Content Creator/SMO dan jadwal harian leader **TIDAK** dibangun sekarang... wave sendiri."* This document is the concrete scope for that deferred wave.

---

## 1. Method

Three sources were cross-referenced:

1. **Job description** — Leader Video's 6 Key Accountabilities (Production Planning & Task Distribution, Production Coordination, Timeline & Workload Management, Team Management, Production Administration, Operational Improvement).
2. **Daily reality** — what the sheet actually tracks, including the manual pivot-table dashboards Leader Video builds every month by hand: per-Client, per-Category, per-Task-Activity, per-PIC rollups, plus two entirely separate task logs for **Content Strategist** (Rani/Alis) and **Social Media Officer** (Nisa) that don't appear in the job description at all but clearly report to the same Leader.
3. **Code reality** — `docs/prd/CDPS_Module7_Creative.md` (Asset/Brief model), `Module12_Task_Execution.md` (Speed Score engine), `Module14_Team_Performance.md` (KPI Profiles), and the live routes: `creative/page.tsx`, `creative/briefs/[id]`, `creative/assets/[id]`, `creative/daily-output` — no calendar, booking, or leave-related route exists anywhere in the repo.

---

## 2. What Module 7 already covers well (don't rebuild)

- Brief → Asset breakdown, one row per individual deliverable unit.
- Per-Asset state machine, review/revision loop, mandatory output link.
- Turnaround Time / Speed Score / Revision Count (Module 12 engine).
- Daily Output auto-logged from status transitions (replaces 4 legacy per-role sheets).
- **Leader as internal QC gate before AM** — K-1 option B, shipped 2026-09-07 (`creative.canDriveReviewEdge`). This already matches Job Desc Activity #2 ("penghubung antara AM dan tim produksi") for the review-handoff part.
- GMV attribution feedback loop from Ads (Module 8).

---

## 3. Gap map — Job Description → Daily Sheet → CDPS Today

| Key Accountability (job desc) | What the sheet actually tracks for this | CDPS coverage today | Verdict |
|---|---|---|---|
| 1. Production Planning & Task Distribution | Daily rows: Tanggal, Client, Jenis Paket, Jumlah (target qty), Task, PIC VG, Time slot | Module 7 §3: Leader distributes Assets to PIC — but per-Asset, no day/time-slot concept | **Partial** |
| 2. Production Coordination | "Support Videographer" cross-link on Strategist log; MEETING rows in both logs | Not modeled — no cross-link field, no meeting/coordination-activity type | **Gap** |
| 3. Timeline & Workload Management | Actual Number / Sisa Task per row; "Task Tidak Selesai di Hari yang Sama" per PIC per month | Module 12 Speed Score (multi-day SLA ratio) — different granularity, see Gap F | **Gap** |
| 4. Team Management | PIC totals dashboard; CUTI/SAKIT rows that block a PIC's day | No leave/capacity concept anywhere in repo | **Gap** |
| 5. Production Administration | Client×Month, Category, Task-Activity, PIC dashboards (all manual pivot tables) | Module 7 Daily Output feeds Module 14, but not these specific breakdowns; `SMO & Content Strategist` logs entirely unfed | **Gap** |
| 6. Operational Improvement | Not directly a sheet artifact — inferred from Leader's role | N/A (process, not data) | — |

---

## 4. The concrete gaps

### Gap A — No daily production calendar / studio-slot view
The sheet's core unit is a **day × studio × PIC × time-slot** row (Tempat: Kasuari, Rajawali, Cempaka, Luar Kantor). This is the artifact Leader Video rebuilds by hand every single day. Module 7's queue is per-PIC, per-status — there is no day-grouped or studio-grouped view anywhere in `creative/`.
**Missing:** daily/weekly calendar grouped by studio + PIC, with target qty vs. actual vs. remainder visible per slot.

### Gap B — Role "SMO & Content Strategist" (merged; decisions locked 2026-09-09)

Rani/Alis (Strategist) and Nisa (SMO) each ran a separate task log — confirmed by their own dedicated worksheets, dropdown-validated Kategori lists included. **Yohan has locked the merge: one role, named `SMO & Content Strategist`**, and — to keep CDPS simple — **the overlapping tasks are merged rather than kept as parallel entries.**

**Locked Kategori list for the merged role:**

| Kategori | Origin | Notes |
|---|---|---|
| Content Idea | SMO | |
| Content Plan | both | |
| Brief | **merged** | Strategist's creative brief + SMO's daily brief collapsed into one Kategori. Sub Type carries the distinction where it matters (Brief Feed / Brief Story). |
| Script | **merged** | SMO's standalone "Script" + Strategist's "Script Video" Sub-Type collapsed into one Kategori. |
| QC | **merged** | Strategist's "QC Sript" (pre-shoot, on the script) + SMO's "QC" (pre-posting, on finished content) collapsed into one Kategori. |
| Brief/Guideline VG | Strategist | Support VideoGrapher field applies here. |
| DOP Video | Strategist | |
| DOP Foto | Strategist | |
| Prepare product | Strategist | |
| Prepare talent | Strategist | |
| Prepare lokasi shooting | Strategist | |
| Copy - Marketplace | Strategist | |
| Copy - Socmed | Strategist | |
| Copy - Publikasi | Strategist | |
| Upload & Checklist | SMO | standing/daily — see Gap I |
| Weekly Report | SMO | |
| Monthly Report | SMO | |
| Req Tambahan - Client | both (identical) | |
| Req Tambahan - Internal | both (identical) | |
| Rework - Client | both (identical) | |
| Rework - Internal | both (identical) | |
| Others - Shooting/Talent | Strategist | |
| Others - Voice Over | Strategist | |
| Others | SMO | generic fallback |

**Sub Type (8, carried over from Strategist, optional):** Brief Feed, Brief Story, Script Video, Content Plan, Caption, Angle Content, Copy SKU, Copy Banner

**One consequence worth recording now, so it isn't a surprise later:** merging QC means a QC row no longer says on its own which pipeline stage it belongs to (script-before-shoot vs. content-before-posting). Same for Brief. If Leader later wants to report those separately, the distinction has to be recovered from Sub Type or from free-text Descriptions — it's no longer a first-class field. That's an accepted trade for a simpler system, not an oversight.

**Merged team:** Rani, Alis, Nisa.
**Fields:** Support VideoGrapher (which VG's shoot this supports) and Sub Type both become **optional** on the merged entity — populated for script/guide work, left blank for posting-ops work (Upload & Checklist, Weekly/Monthly Report) where there's no single VG to link to. Plus the fields both sheets already share: Kategori, Descriptions, Qty, Link Output, Notes, PIC, Client, Tanggal.

Module 7 §3 Rule 1 lists roles as "Videographer, Editor, Graphic Designer, Copywriter, Social Media Officer" — the merged shape doesn't exist there, and Copywriter's generic "copies written" unit doesn't match this taxonomy.
**Missing:** the merged role as a distinct entity with the locked taxonomy above as first-class fields, plus the Support-Videographer cross-link.

### Gap C — merged into Gap B
Previously tracked separately as "Social Media Officer role not modeled" — folded into Gap B above per the 2026-09-08/09 decision to merge Strategist and SMO into one role.

### Gap C — merged into Gap B
Previously tracked separately as "Social Media Officer role not modeled" — folded into Gap B above per the 2026-09-08 decision to merge Strategist and SMO into one role.

### Gap D — PIC availability / leave not tracked
Whole rows in the sheet read "RAMDANI CUTI," "ABAY SAKIT," "TARUNA CUTI" — Leader manually remembers not to assign that person that day. Repo-wide search found `'cuti'` only as a free-text reason string on an unrelated reassignment action (`kol.test.ts`, `account.test.ts`) — never a structured entity.
**Missing:** a PIC leave/sick calendar that Leader can see when planning, tied to Job Desc §4's "kapasitas serta workload masing-masing anggota tim."

### Gap E — Studio/resource booking not tracked
Kasuari, Rajawali, Cempaka appear as a free-text location column with zero conflict logic — nothing stops two clients being booked into the same studio at the same time. No resource entity exists in CDPS at all.
**Missing:** simple resource-booking check for the studio list.

### Gap F — Same-day completion signal missing (distinct from Module 12's Speed Score)
The monthly PIC dashboard's **"Task Tidak Selesai di Hari yang Sama"** column is literally `Total Task − Actual Number` (verified: Abay 185−110=75 in the Sep recap). This measures whether a PIC finished what was scheduled **today** — meaningful for short shoot/edit slots. Module 12's Speed Score measures multi-day SLA turnaround per Asset, which is the wrong grain for a same-day shoot-then-edit task.
**Missing:** a same-day completion rate as its own PIC-level signal, kept separate from Speed Score (same principle Module 12 already uses to keep Revision Count separate from Speed — don't blend signals that answer different questions).

### Gap G — Batch/quantity progress doesn't fully match Module 7's Asset model
Real workflow assigns e.g. "25 videos" as **one row** to one PIC for a session, tracks partial completion same-day (Jumlah/Actual/Sisa), and rolls the remainder into a **new row** the next day — without ever pre-declaring 25 individual Asset rows. Module 7 §4 Rule 1 does track "Assets Created vs. Brief's Quantity/Target" (e.g., "5 of 12"), but that's a count of *rows created*, not *units physically finished in today's session*. These may turn out to be reconcilable, or may need a lighter batch-progress field at the Task level — worth deciding rather than assuming either way.

A related sub-pattern, confirmed by the Content Creator sheet's separate **"Task Additional"** table (Tanggal, Nama Client/Project, Task Additional, PIC VG/Editor, Jumlah Assigne, Actual Number, Notes): unplanned extra work — **Edit Revisi, Voice Over, Edit Tambahan, ad-hoc Shoot/Script** — gets logged in a table separate from the day's originally planned rows. Edit Revisi partially maps to Module 7's revision loop (§6), but Voice Over and Edit Tambahan are *new* units of work added mid-stream, not a rejection-and-rework of an existing one — the Asset model has no "add an extra unappealed unit to an already-submitted batch" flow.

### Gap H — "Content Creator" isn't a fourth taxonomy-only role; it's a hybrid coordinator role
Where Strategist and SMO each turned out to be "one taxonomy, one worksheet," the **Content Creator** worksheet (belonging to Boy Ginting) is a different shape entirely, mixing three things that don't obviously belong in one entity:

1. **An unstructured daily coordination journal** — "Report WFH [name], [day], [date]" followed by free-text checklist lines: share the day's VG schedule, coordinate with Rani (Strategist) on shoot props, coordinate with Nisa (SMO) on posting, coordinate with Project Leads and named AMs per client, submit scripts/content ideas, QC a numbered list of client content, submit content via **WhatsApp and Trello** (external tools CDPS has no link to), report to a cross-functional "Creative x Sales x CRO" group — **and, notably, "Bikin Jadwal VG buat Hari [besok]"**: this role is who actually *builds* the next day's Videographer schedule, which is a big reason Gap A (no daily calendar in CDPS) hurts in practice.
2. **A personal output log for MEA's own internal-brand content** — DEVTALK, Skilskul, Sebari, MEA Digi (columns: Tanggal, Account, Activity, Quantity, Notes, Link GDrive) — this is content for MEA's *own* marketing channels, not a paying Client. **Attribution and recency:** the table itself carries no PIC column, but it sits inside the worksheet titled "Report WFH Boy Ginting," so it reads as his personal log rather than a team log. **It is not current** — every dated row falls between **2–30 Juni 2025** (one month) and nothing in the rest of the worksheet picks it back up at any later date, including anywhere in 2026. That's over a year of apparent inactivity as of this analysis (Sep 2026), against a worksheet that is otherwise actively maintained through Sep 2026 elsewhere (the "Task Additional" table, Gap G, has rows dated as recently as 4 Sep 2026). **Resolved by D8 (§7): CDPS does not track or count this stream at all** — so whether it was deliberately discontinued or merely unlogged no longer affects the build. Module 6's Brief model is scoped to Client contracts; there's no CDPS concept for internal/house content production at all, so this entire stream is invisible to the system by design, not by oversight.
3. **A half-year trend dashboard** — Jan–Mar vs. Apr–Jun quantity + % Uplift per PIC (Ramdani, Killa, Taruna, Uci, Alvi, Abay — the same VG roster) across Edit / Shoot / Script / Edit Tambahan / Edit Revisi / Voice Over-Talent. This is a period-over-period comparison, a different cadence and shape from Module 12's per-Asset Speed Score or Module 14's monthly rollup — closer to a trend line than a KPI score.

**Missing:** whatever CDPS builds for this role needs to be scoped as three separate things (coordination log, internal-content tracking, trend reporting), not one taxonomy extension like the merged `SMO & Content Strategist` role — folding it into the same pattern would misrepresent what the role actually does.

### Gap I — Recurring/standing daily tasks aren't a Module 7 concept
Both the Strategist and SMO sheets show the same Kategori logged for the same client **every single day** without fail — e.g. SMO's "sagata: Upload & Checklist = 1" and "all client: Brief" appear on nearly every date across the full Aug–Sep range. This reads as a standing responsibility ("check this every day"), not a one-off deliverable spawned from a Brief. Module 7's Asset is inherently a child of a specific Brief with a specific Quantity/Target — there's no template for "this Kategori recurs daily until told otherwise."
**Missing:** either a lightweight recurring-task concept, or a deliberate decision that these stay outside the Asset model as a simple daily checklist (which may be the cheaper, more honest fit — worth deciding rather than defaulting).

---

## 5. Building blocks to reuse, not reinvent

- **Task Execution Engine (Module 12)** — if the merged Strategist+SMO role's items become canonical Tasks, they should plug into the same Turnaround/Speed Score/Revision Count engine, exactly like Ads' Brief-as-task already does (Module 12 §5.3b). Whether they *should* become full Tasks (with SLA) is an open question below — the sheets today track them without any SLA concept.
- **Role Matrix (Phase 0)** — extending `role_mappings` beyond `staff`|`lead` to add the merged role is exactly what K-1's note flagged as touching "HRIS mapping + Team Performance + PRD M7 sekaligus" — i.e. this is the trigger for that cross-cutting change, not a side effect of it. The merge decision simplifies this to **one** new role, not two.
- **Team Performance (Module 14)** — the "Creative" KPI Profile today only weights Editor/Designer/Copywriter (§2 table). Once the merged role's output is tracked, it needs its own weighted row — same pattern as the four existing profiles, not a new mechanism.

---

## 6. Proposed scope for the next module (working name: Module 19 — Creative Daily Ops)

Reflects the §7 decisions locked 2026-09-09.

1. Leader's Daily Schedule / Studio Calendar as a `PROD-SLOT` entity (Gap A, D1) — and per Gap H, likely the same screen Content Creator uses to actually build it, not a Leader-only view
2. **`SMO & Content Strategist`** queue + locked merged taxonomy + optional Support-Videographer and Sub Type fields (Gap B, D2) — wired into the Task Execution Engine, with standing Kategori excluded from Speed Score (D9)
3. PIC Leave/Attendance, Leader-input (Gap D, D4)
4. Studio booking with warn-only conflict check (Gap E, D3)
5. Same-day completion signal on a Leader-only dashboard, not in Module 14 (Gap F, D5)
6. Reconcile batch/quantity partial-completion with Module 7's Asset-creation model, including the ad-hoc "Task Additional" overflow pattern (Gap G)
7. Content Creator as one role — coordination journal likely a simple checklist, not a Task-Execution-Engine entity (Gap H-1, D7)
8. `is_standing` flag on the taxonomy so standing ops volume reports separately from project deliverables (Gap I, D9)

**Removed from scope:** internal/house content tracking (Gap H-2) — per D8, CDPS does not track or count it.

**Deferred to a later phase:** the merged role's Module 14 KPI Profile (§7.2 Phase 2) — Phase 1 adds the role for permissions only.

---

## 7. Decisions — locked 2026-09-09

Answers confirmed by Yohan. Two items (D6, D9) were answered with "give me an example and a recommendation" — those are resolved in §7.2 and §7.3 and remain **open pending Yohan's sign-off**; everything else is locked.

| # | Question | Decision |
|---|---|---|
| D1 | Entity shape | ✅ **Lightweight `PROD-SLOT-…` entity**, not a pure calendar view — reasoning in §7.1 |
| D2 | SLA weight | ✅ Merged SMO & Content Strategist work **goes through the full Task Execution Engine** (SLA, Speed Score, Revision Count) |
| D3 | Booking strictness | ✅ **Warn only** — studio double-booking shows a warning, never blocks |
| D4 | Leave ownership | ✅ **Leader inputs** CUTI/SAKIT (not PIC self-service) |
| D5 | Same-day metric destination | ✅ **Leader-only operational dashboard** — does *not* feed Module 14 Team Performance |
| D6 | Role model cost | ⏳ Recommendation in §7.2 — not blocking, staged plan proposed |
| D7 | Content Creator's scope | ✅ **One role** (not split into coordinator + editor) |
| D8 | Internal/house content boundary | ✅ **Out of scope** — CDPS does not track or count DEVTALK/Skilskul/Sebari/MEA Digi content |
| D9 | Recurring tasks | ⏳ Recommendation in §7.3 |

**Note on D2 + D5 together:** these two decisions point in slightly different directions and it's worth being explicit about it. D2 puts the merged role's work fully inside the Task Execution Engine, which *does* feed Module 14. D5 keeps the same-day completion metric out of Module 14. Both can hold at once — Speed Score (multi-day SLA, from D2) becomes a scored KPI, while same-day completion (from D5) stays a Leader dashboard number only. Just don't let them get conflated during the build: they measure different things and land in different places.

**Note on D8:** this closes Gap H-2 entirely — no build, no field, no "internal client" record. It also means the Jun-2025 internal-brand log stays where it is (or gets dropped); CDPS simply has no opinion on it. Scope item 8 in §6 is removed.

### 7.1 Rationale for D1 (Entity shape)

**A lightweight `PROD-SLOT-…` entity — not a pure calendar view over Asset.** A pure view looks cheaper at first glance, but doesn't hold up once the real requirements are checked against it:

- **Timing conflict with an already-locked decision.** Real workflow plans tomorrow's schedule *today* (Content Creator's "Bikin Jadwal VG buat Hari Selasa," Gap H). A calendar view can only show rows that already exist — so a view-only approach would force Assets to be pre-created a day ahead just to populate the calendar. That directly contradicts **M7-OA-6** (already confirmed by Yohan: "PIC creates Assets incrementally as work starts, not all pre-created upfront"). A separate planning entity avoids relitigating a decision that's already locked.
- **Fields the view doesn't have anywhere to attach to.** Studio/location (Gap E), time slot, and batch-level Jumlah/Actual/Sisa (Gap G — a day's "25 videos" target isn't the same number as "Assets created") aren't Asset fields today. Adding them to Asset just to support a "view" means Asset absorbs concepts — physical scheduling, batch progress — that belong to planning, not to execution/review. At that point it's not "just a view" anymore; it's a disguised entity with extra baggage on the wrong table.
- **Studio and leave need their own tables regardless.** Gaps D and E require new entities no matter which way D1 went — a `PROD-SLOT` is where those two naturally attach (a slot has a day + studio + PIC), so building it isn't really "extra" cost, it's where that cost was landing anyway.

**What keeps this cheap:** `PROD-SLOT` is a **planning/logistics record, not a second parallel state machine.** No SLA, no Speed Score of its own — that machinery stays owned by Asset/Task. A slot's job is just: day + studio + PIC + client + package + target qty + time, with an *optional* link to the Asset(s) it produces once work actually starts. The calendar screen becomes "show me `PROD-SLOT` rows for this day/studio."

### 7.2 D6 — Role model cost: example case + recommendation

**The question restated:** does `SMO & Content Strategist` become a real role in `role_mappings`, or piggyback on `staff` with the Kategori field carrying the distinction?

**Worked example of what goes wrong if it piggybacks.** Module 14 Rule 2 selects a KPI Profile by Role Type. If the merged role lands under the existing **Creative** profile (built for Editor/Designer/Copywriter), Rani's September score would be computed as:

| Component | Weight | What Rani actually has |
|---|---|---|
| Speed Score (M12) | 28.5% | ✅ available once D2 is implemented |
| Output Quantity — *Approved Assets*, M7 | 23.75% | ❌ **none** — her output is briefs, scripts, copy. These are never Assets. |
| GMV Impact (M7§7/M8§7) | 23.75% | ❌ **none** — GMV attributes to the Asset that drove sales; a script's author owns no Asset |
| Revision Count (M12, inverse) | 19% | ✅ available |
| Weekly-Note Compliance | 5% | ✅ available |

Module 14 Rule 6 then redistributes the 47.5% of missing weight across the surviving components — which means **Speed Score alone becomes ~54% of her entire performance score.** Her whole evaluation collapses onto "how fast did you turn things around," with no measure of how much she produced. Worse for Nisa's side of the merged role: Upload & Checklist is a standing daily task with no SLA (see §7.3), so even Speed Score gets thin, and the redistribution math starts amplifying whatever fragment remains. This isn't a rounding error — it's a score that would actively mislead.

**Recommendation — staged, and D6 is correctly non-blocking:**

- **Phase 1 (build now, with the module):** create the merged role's queue and taxonomy, and add `smo_content_strategist` to `role_mappings` for **permissions and visibility only** (who sees what, per Role Matrix Phase 0). This is the cheap half and it's genuinely needed on day one — Leader has to be able to assign to them.
- **Phase 1 explicitly does NOT wire the role into Module 14.** Leave it out of the KPI Profile table rather than letting it inherit Creative's. An absent score is honest; a wrong score gets used in reviews. Module 14 Rule 2's table simply won't have a row for this role yet.
- **Phase 2 (after 2–3 months of real data):** define the role's own KPI Profile with components that actually exist for it — likely Output Quantity measured in *Kategori rows completed vs. period target* rather than Approved Assets, plus Speed Score and Revision Count. This mirrors what Module 14 already admits about itself: GMV Impact and Optimization Activity use "illustrative period-target figures (real targets pending once actual monthly targets are set per Advertiser)." Same situation, same fix — set targets from observed reality, not guesses.

**Why this is safe to defer:** nothing in Gaps A–I depends on the KPI Profile existing. The queue, the calendar, leave, booking, and the same-day dashboard all work without it. The only thing Phase 2 unlocks is a monthly performance number — and per D5 the Leader's operational visibility doesn't route through Module 14 anyway.

### 7.3 D9 — Recurring tasks: examples + recommendation

**What's actually in the sheets.** Two clear cases, both from the SMO side of the merged role:

- **`sagata: Upload & Checklist, qty 1`** — appears on essentially every working date across the full Aug–Sep range. It's not a deliverable someone requested; it's "check the posting went out today."
- **`all client: Brief`** — logged near-daily against a generic "all client" rather than one named Client. Reads as a standing coordination touchpoint.

Contrast with a genuine deliverable from the same sheet: `mamimegol: Script, qty 7` — a specific client, a specific quantity, done when it's done. That one belongs in the Task/Asset world. The two above don't.

**Recommendation: do not build a recurring-task engine. Add one flag instead.**

Mark the standing Kategori entries in the taxonomy with `is_standing: true` (initially: Upload & Checklist, and Brief when logged against "all client"). Behaviour:
- Standing rows are logged the same way everything else is — no scheduler, no nightly generation job, no template config, no holiday/skip/backfill handling. All of that is real engineering cost for a row whose answer is "yes, done" 95% of the time.
- **The flag's actual job is to keep reporting honest.** Without it, 22 working days of "Upload & Checklist" inflate the month's task count by 22 and make the merged role's output look like it out-produced everyone — while the Strategist side's 7-script week looks small next to it. Leader's dashboard and (later, per §7.2 Phase 2) the KPI Profile should count standing ops volume **separately** from project deliverables, never summed into one "total tasks" number.
- **Interaction with D2:** standing rows should be **excluded from Speed Score**. A daily checklist has no meaningful SLA — including it would either always score 100 (padding the number) or need an artificial deadline invented for it. D2 puts the role's work in the Task Execution Engine; this is the one carve-out inside that decision.

**Why not a template mechanism:** the cost is in the edge cases, not the happy path — what happens on a holiday, when a client pauses, when someone's on leave (D4), when a day gets skipped and needs backfilling. Every one of those needs a rule and a UI. A flag needs neither, and the team is already successfully logging these rows by hand today.



---

## 9. Sources

- Google Sheets: "jadwal baru" (2,712 data rows, Jan–Sep 2026) and "jadwal lama" (1,442 data rows, Jan–Mar 2026), incl. their embedded monthly recap dashboards (Dashboard Content Strategist, Dashboard Social Media Officer, Total Task Berdasarkan PIC, etc.)
- Content Strategist dedicated worksheet (Rani/Alis task log + Kategori/Sub Type/PIC dropdown validation lists)
- Content Creator dedicated worksheet (Boy Ginting — WFH coordination journal, half-year PIC trend dashboard, internal-brand output log, client Activity/Category log back to Oct 2025, "Task Additional" overflow tracker)
- Social Media Officer dedicated worksheet (Nisa task log + full 13-value Kategori dropdown list)
- Leader Video job description document (Bandung, 24 Jun 2026)
- `github.com/MEAgrup/AgencyAPP`: `docs/prd/CDPS_Module7_Creative.md`, `CDPS_Module12_Task_Execution.md`, `CDPS_Module14_Team_Performance.md`, `docs/DECISIONS.md` (K-1, 2026-09-07), `docs/handoff/HANDOFF_PENUTUP_REVISI_OD_20260908.md`, live routes under `web-internal/src/app/(shell)/creative`
