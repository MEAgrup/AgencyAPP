# CDPS ⇄ HRIS — API Contract (draft v1, for HRIS maintainer sign-off)

> Implements Phase 0 v2 §8. Two endpoints on the HRIS side, consumed only by CDPS (server-to-server). HRIS maintainer: review field names against the actual HRIS schema and confirm — placeholders marked ⚠.

## Security
- Server-to-server: static service token or mTLS (HRIS maintainer's choice) via `Authorization: Bearer <service-token>` — never end-user credentials on the sync endpoint.
- CDPS never writes to HRIS in v1. Read-only.

## 1. `GET /api/v1/employees`
Query params: `updated_since` (ISO 8601, optional — incremental sync), `page`, `page_size`.

Response `200`:
```json
{
  "data": [
    {
      "employee_id": "EMP-0231",        
      "nama": "Sinta Rahma",
      "email": "sinta@mea.co.id",
      "divisi": "Account",               
      "jabatan": "Account Manager",      
      "status_aktif": true,
      "updated_at": "2026-07-01T08:00:00+07:00"
    }
  ],
  "page": 1,
  "page_size": 100,
  "total": 132
}
```
⚠ Confirm: exact field names, `divisi`/`jabatan` value list (needed to seed the CDPS role-mapping table), and whether `employee_id` is stable/immutable (it must be — CDPS uses it as the foreign key).

**CDPS behavior:** scheduled sync (proposal: every 15 min incremental via `updated_since` + full sync nightly) + manual refresh button. `status_aktif=false` ⇒ revoke CDPS sessions & access on next sync. Employees present in CDPS but absent from a full sync ⇒ flagged for admin review, not auto-deleted (audit trail preserved).

## 2. `POST /api/v1/auth/verify`
CDPS login form collects email+password, forwards for verification; CDPS then issues its **own** session bound to the synced employee record. HRIS never issues the CDPS session.

Request:
```json
{ "email": "sinta@mea.co.id", "password": "<plaintext-over-TLS>" }
```
Response `200`:
```json
{ "valid": true, "employee_id": "EMP-0231" }
```
Response `401`: `{ "valid": false, "reason": "invalid_credentials" }`
⚠ Alternative if the HRIS already issues JWTs: expose `POST /auth/token` + JWKS/validation endpoint instead, and CDPS validates HRIS-issued tokens. Either pattern is fine — maintainer picks; the CDPS side is abstracted behind an `Authenticator` interface (Sprint 0 ticket S0-07).

## 3. Failure modes
- HRIS unreachable at login ⇒ CDPS login fails closed (no cached-password fallback), with BI message `[sistem HRIS tidak dapat dihubungi, coba beberapa saat lagi]`.
- HRIS unreachable at sync ⇒ CDPS keeps last-known employee set, raises an admin notification after 2 consecutive failures.
- Contingency before endpoints exist (Build Plan R1): CSV import behind the same `EmployeeSource` interface — dev/staging only.

## 4. Future (not v1)
- `POST /api/v1/performance-scores` (CDPS → HRIS): monthly Module 14 `PERF-…` export for HR review workflows. Design when Wave 3 lands.
