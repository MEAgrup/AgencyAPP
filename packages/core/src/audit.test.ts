import { describe, it, expect } from "vitest";
import { buildEntry, NoActorError, SecretInAuditError, type AuditRecord } from "./audit.js";

// Mirrors the pure/validation parts of backend/internal/core/audit/audit.go — the
// mandatory-actor rule and the no-secret-in-payload house rule (§B.3). The
// storage-layer immutability (UPDATE/DELETE forbidden by trigger + REVOKE) is
// covered by pgTAP against audit_log (§G).

const rec = (over: Partial<AuditRecord> = {}): AuditRecord => ({
  entityType: "sm_probe",
  entityId: "X-1",
  actor: "EMP-1",
  action: "transition:A->B",
  ...over,
});

describe("buildEntry", () => {
  it("requires an actor", () => {
    expect(() => buildEntry(rec({ actor: "" }))).toThrow(NoActorError);
  });

  it("serializes before/after as jsonb strings and sets created_by to the actor", () => {
    const p = buildEntry(rec({ before: { status: "A" }, after: { status: "B" } }));
    expect(p).toEqual({
      entity_type: "sm_probe",
      entity_id: "X-1",
      actor_employee_id: "EMP-1",
      action: "transition:A->B",
      before_json: '{"status":"A"}',
      after_json: '{"status":"B"}',
      created_by: "EMP-1",
    });
  });

  it("writes null (not 'null') for absent before/after", () => {
    const p = buildEntry(rec());
    expect(p.before_json).toBeNull();
    expect(p.after_json).toBeNull();
  });

  it("refuses to serialize secret fields (password_hash never enters the log)", () => {
    expect(() => buildEntry(rec({ after: { email: "a@b.co", password_hash: "$2b$..." } }))).toThrow(
      SecretInAuditError,
    );
    // nested too
    expect(() => buildEntry(rec({ before: { cred: { token: "abc" } } }))).toThrow(SecretInAuditError);
  });
});
