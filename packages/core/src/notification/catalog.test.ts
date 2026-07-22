import { describe, it, expect } from "vitest";
import { EventType, CATALOG, events, isEvent, deepLinkFor, selectRecipients, type Emission } from "./catalog.js";

// Mirrors backend/internal/core/notification/notification_test.go — the catalog
// completeness and the pure recipient-selection semantics (the DB Emit/List/
// MarkRead behavior is covered by vitest-against-Postgres in Fase 1, §G).

describe("catalog", () => {
  it("registers exactly the 15 frozen events", () => {
    expect(events()).toHaveLength(15);
    expect(Object.keys(CATALOG)).toHaveLength(15);
  });

  it("isEvent guards against non-cataloged (wild) event strings", () => {
    expect(isEvent(EventType.BlockRequestSubmitted)).toBe(true);
    expect(isEvent("m99.made.up")).toBe(false);
  });
});

describe("deepLinkFor", () => {
  const base: Emission = { event: EventType.BlockRequestSubmitted, entityType: "demo_task", entityId: "DEMO-1", actor: "S1" };
  it("uses the explicit deep link when provided", () => {
    expect(deepLinkFor({ ...base, deepLink: "/demo-tasks/DEMO-1" })).toBe("/demo-tasks/DEMO-1");
  });
  it("defaults from entity type + id", () => {
    expect(deepLinkFor(base)).toBe("/demo_task/DEMO-1");
  });
});

describe("selectRecipients", () => {
  const em = (over: Partial<Emission> = {}): Emission => ({
    event: EventType.BlockRequestSubmitted,
    entityType: "demo_task",
    entityId: "DEMO-1",
    actor: "S1",
    ...over,
  });

  it("excludes the actor by default (block-request leads: S1 actor gets nothing)", () => {
    // Resolver returned the two division leads plus the acting staff member.
    expect(selectRecipients(["L1", "L2", "S1"], em())).toEqual(["L1", "L2"]);
  });

  it("includes the actor when notifyActor is set", () => {
    expect(selectRecipients(["L1", "S1"], em({ notifyActor: true }))).toEqual(["L1", "S1"]);
  });

  it("de-duplicates and drops empty ids, preserving first-seen order", () => {
    expect(selectRecipients(["R1", "", "R1", "R2", "R2"], em({ actor: "X" }))).toEqual(["R1", "R2"]);
  });
});
