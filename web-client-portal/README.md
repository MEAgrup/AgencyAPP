# web-client-portal (empty shell — Wave 3)

External-facing Client Portal for MEA Agency clients. **Not built in Sprint 0.**

## Status
Empty shell placeholder per Sprint 0 ticket **S0-01**. Wave 3 (Module 15) —
prerequisites **O4** (embeddability) and **O5** (security spec) are now
**RESOLVED** (`docs/DECISIONS.md`, 2026-08-31; final spec
`docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md`). Implementation has not started
yet — this remains a shell until the first M15-C2 cluster PR lands.

## Separate auth realm (non-negotiable)
This app is a **separate authentication realm** from the internal system:

- Client contacts authenticate through their **own** realm — they are **never**
  part of the HRIS employee sync used by `web-internal` / the CDPS backend
  (`docs/HRIS_API_CONTRACT.md`, Phase 0 v2 §8).
- Data access is a **strict per-Client allow-list** enforced at the query layer
  (Module 15 §6.1) — **never** a permission-trimmed view of internal data.
- Additional minimums before build: per-Client data isolation, rate limiting on
  login + complaint form, session expiry, per-contact action audit
  (Phase 0 v2 §11).

Do not wire this app to the internal auth/session tables.
