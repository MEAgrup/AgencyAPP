import { describe, it, expect } from "vitest";
import { newEngine, MBriefTask, MDependency } from "./index.js";
import { DefaultBlockMessage } from "../bi-messages.js";
import { newRole, type Actor } from "../permission.js";

// Mirrors the PURE decision assertions of
// backend/internal/core/statemachine/statemachine_test.go. The DB-backed parts
// (row lock, status UPDATE, audit_log write, "blocked transition changed nothing")
// are covered by pgTAP against the SQL `sm_transition` function (§G) — here we
// assert the same allow/block/role decisions the engine makes before the write.

const leadActor: Actor = { employeeId: "LEAD-1", role: newRole({ level: "lead", division: "X" }) };
const staffActor: Actor = { employeeId: "STAFF-1", role: newRole({ level: "staff", division: "X" }) };

describe("all machines: every configured edge is allowed, unlisted is blocked", () => {
  const engine = newEngine();

  it("every allowed edge evaluates ok (lead-only edges need lead)", () => {
    let n = 0;
    for (const m of engine.machines()) {
      if (m.autoComputed) continue;
      for (const edge of m.edges()) {
        const actor = edge.requireLead ? leadActor : staffActor;
        const d = engine.evaluate(m.name, edge.from, edge.to, actor);
        expect(d.ok, `[${m.name}] ${edge.from}->${edge.to}`).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it("an unlisted target from every from-state is blocked with the BI message", () => {
    for (const m of engine.machines()) {
      if (m.autoComputed) continue;
      const froms = new Set(m.edges().map((e) => e.from));
      for (const from of froms) {
        const d = engine.evaluate(m.name, from, "[__unlisted__]", leadActor);
        expect(d.ok, `[${m.name}] ${from}->[__unlisted__]`).toBe(false);
        if (!d.ok) {
          expect(d.kind).toBe("blocked");
          if (d.kind === "blocked") expect(d.message).toBe(m.blockMessage);
        }
      }
    }
  });
});

describe("brief_task [Blocked] is lead-only", () => {
  const engine = newEngine();

  it("staff cannot set [Blocked]", () => {
    const d = engine.evaluate(MBriefTask, "[In Progress]", "[Blocked]", staffActor);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.kind).toBe("role_denied");
  });

  it("lead can set [Blocked]", () => {
    const d = engine.evaluate(MBriefTask, "[In Progress]", "[Blocked]", leadActor);
    expect(d.ok).toBe(true);
  });
});

describe("illegal jump is blocked with the default BI message", () => {
  it("[To Do] -> [Approved] is not a configured edge", () => {
    const d = newEngine().evaluate(MBriefTask, "[To Do]", "[Approved]", leadActor);
    expect(d.ok).toBe(false);
    if (!d.ok && d.kind === "blocked") {
      expect(d.message).toBe(DefaultBlockMessage);
    } else {
      expect.fail(`expected blocked, got ${JSON.stringify(d)}`);
    }
  });
});

describe("dependency has no manual transition", () => {
  it("returns auto_computed, NOT a block message", () => {
    const d = newEngine().evaluate(MDependency, "Pending", "Satisfied", leadActor);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.kind).toBe("auto_computed");
  });
});
