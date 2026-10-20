# CDPS — Decision Log (index)

> Every deviation from the PRD, every resolved ambiguity, every architecture choice gets a decision entry. Claude Code: if the PRD is ambiguous or two modules conflict, STOP and add an **Open** entry instead of picking silently.

## Rule (since 2026-10-20): one decision = one file

The log used to be one big table in this file. Every PR appended a row at the top, so every pair of open PRs conflicted on `docs/DECISIONS.md`. The table is now split into one file per entry, content verbatim.

- **Never append to a shared table. Never add rows to this file.** Add a NEW file instead.
- **Decided:** `docs/decisions/YYYY-MM-DD-<slug>.md`
  - `YYYY-MM-DD` = decision date (WIB).
  - `<slug>` = decision ID or short title, lowercase ASCII, words joined with `-`, max ~60 chars (e.g. `2026-10-19-pdt-ads-semua-klien.md`).
  - If the name exists already, add `-2`, `-3`, …
- **Open questions:** `docs/decisions/open/<id-slug>.md` (e.g. `open/jalur-plan-wajib-direct.md`). When resolved, update that file (mark ✅ RESOLVED + date) and, if a decision follows, add a dated file for it.
- **File content:** the same 4 columns as before (Date | Decision | Reason / trade-off | Approved by), as a one-row markdown table:

  ```markdown
  | Date | Decision | Reason / trade-off | Approved by |
  |---|---|---|---|
  | 2026-10-20 | **MY-ID — what was decided.** … | why / trade-off | Who, date |
  ```

- Superseding a decision: add a new file that names the old file; do not rewrite history.

## Finding an old entry

Older references in code and docs ("DECISIONS.md 2026-09-17", "DECISIONS O64", "DECISIONS.md G1-06-…") still hold. Look up the date or ID in `docs/decisions/`:

```sh
ls docs/decisions | grep 2026-09-17
rg -l 'O64' docs/decisions
```

Each migrated file starts with a comment naming its original section (`Decided`, `Wave 1 Integration`, `Wave 2 kickoff`, `Bridge MSDPS→CDPS Fase 1`, `Open`). The prose introduction of the Bridge section is in `docs/decisions/2026-09-10-bridge-msdps-cdps-fase1-konteks.md`.
