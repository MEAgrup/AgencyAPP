// Declarative transition engine — pure decision layer (S0-05).
//
// Ported from backend/internal/core/statemachine/statemachine.go, split into the
// PURE parts that belong in TypeScript (machine config lookup + the allow/block/
// role decision) and the DB parts that become the Postgres function `sm_transition`
// (SELECT ... FOR UPDATE, UPDATE status, INSERT audit_log, emit notifications — all
// atomic, §B.2). This module answers "is this transition allowed for this actor?";
// the SQL function is what actually and authoritatively performs it. Both derive
// from the SAME config so they cannot diverge (the config seeds sm_edges).
//
// House rules reflected here:
//   - A status is ONLY ever set through the transition path (this decision + the
//     SQL function) — never a raw UPDATE.
//   - Invalid transitions are blocked with the machine's Bahasa Indonesia message
//     (default "[transisi status tidak diizinkan]") and change nothing.
//   - Role-restricted transitions (e.g. brief_task [Blocked] = SPV/Lead-only) are
//     enforced; OD (read-only) can never drive a transition.
//   - The decision is returned as a structured value (not thrown), so the route
//     handler maps it to HTTP 409/403 with the exact message and pgTAP/vitest can
//     assert it without brittle error-string matching (§B.2 recommendation).

import { RoleDeniedMessage } from "../bi-messages.js";
import { LevelLead, type Actor } from "../permission.js";

/** EdgeDef is one configured transition in a machine's config. */
export interface EdgeDef {
  from: string;
  to: string;
  requireLead?: boolean;
}

/** Edge is one configured transition (introspection/testing). */
export interface Edge {
  from: string;
  to: string;
  requireLead: boolean;
}

interface Rule {
  requireLead: boolean;
}

export interface MachineConfig {
  name: string;
  initial: string;
  flags: string[];
  autoComputed: boolean;
  blockMessage: string;
  terminal: string[];
  edges: EdgeDef[];
}

/** Machine is one entity's declarative lifecycle. */
export class Machine {
  readonly name: string;
  readonly initial: string;
  readonly flags: string[];
  readonly autoComputed: boolean;
  readonly blockMessage: string;
  private readonly terminalSet: Set<string>;
  private readonly transitions: Map<string, Map<string, Rule>>;

  constructor(cfg: MachineConfig) {
    this.name = cfg.name;
    this.initial = cfg.initial;
    this.flags = [...cfg.flags];
    this.autoComputed = cfg.autoComputed;
    this.blockMessage = cfg.blockMessage;
    this.terminalSet = new Set(cfg.terminal);
    this.transitions = new Map();
    for (const e of cfg.edges) {
      let tos = this.transitions.get(e.from);
      if (!tos) {
        tos = new Map();
        this.transitions.set(e.from, tos);
      }
      tos.set(e.to, { requireLead: e.requireLead ?? false });
    }
  }

  /** isTerminal reports whether s is a terminal state of the machine. */
  isTerminal(s: string): boolean {
    return this.terminalSet.has(s);
  }

  /** allowedFrom returns the sorted list of target states reachable from `from`. */
  allowedFrom(from: string): string[] {
    const tos = this.transitions.get(from);
    if (!tos) {
      return [];
    }
    return [...tos.keys()].sort();
  }

  /** hasEdge reports whether `from`->`to` is a configured edge. */
  hasEdge(from: string, to: string): boolean {
    return this.transitions.get(from)?.has(to) ?? false;
  }

  /** edges returns all configured edges (sorted for determinism). */
  edges(): Edge[] {
    const out: Edge[] = [];
    for (const [from, tos] of this.transitions) {
      for (const [to, r] of tos) {
        out.push({ from, to, requireLead: r.requireLead });
      }
    }
    out.sort((a, b) => (a.from !== b.from ? (a.from < b.from ? -1 : 1) : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
    return out;
  }

  ruleFor(from: string, to: string): Rule | undefined {
    return this.transitions.get(from)?.get(to);
  }
}

/**
 * TransitionDecision is the structured result of evaluating a requested
 * transition, mirroring the Go engine's BlockedError / RoleError / success paths
 * without touching the DB.
 */
export type TransitionDecision =
  | { ok: true; from: string; to: string; requireLead: boolean }
  | { ok: false; kind: "unknown_machine"; machine: string }
  | { ok: false; kind: "auto_computed"; machine: string }
  | { ok: false; kind: "blocked"; message: string }
  | { ok: false; kind: "role_denied"; message: string };

/** hasLeadAuthority mirrors the Go check: Director OR lead level. OD never writes. */
function hasLeadAuthority(actor: Actor): boolean {
  return actor.role.director || actor.role.level === LevelLead;
}

/** Engine holds the machine configs and evaluates transition requests. */
export class Engine {
  private readonly machinesByName: Map<string, Machine>;

  constructor(machines: Map<string, Machine>) {
    this.machinesByName = machines;
  }

  /** machine returns a registered machine by name. */
  machine(name: string): Machine | undefined {
    return this.machinesByName.get(name);
  }

  /** machines returns all registered machines (sorted by name). */
  machines(): Machine[] {
    return [...this.machinesByName.values()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  }

  /**
   * evaluate decides whether `from`->`to` is permitted for `actor` on the named
   * machine. It is the pure decision the SQL `sm_transition` re-checks under a row
   * lock before writing; the route handler passes the authoritative current status
   * as `from` (from the locked row) when applying.
   */
  evaluate(machineName: string, from: string, to: string, actor: Actor): TransitionDecision {
    const m = this.machinesByName.get(machineName);
    if (!m) {
      return { ok: false, kind: "unknown_machine", machine: machineName };
    }
    if (m.autoComputed) {
      // Dependency-style machines have no manual transitions (Go returns a config
      // error, NOT a BlockedError, so callers don't surface a BI block message).
      return { ok: false, kind: "auto_computed", machine: machineName };
    }
    const rule = m.ruleFor(from, to);
    if (!rule) {
      return { ok: false, kind: "blocked", message: m.blockMessage };
    }
    if (rule.requireLead && !hasLeadAuthority(actor)) {
      return { ok: false, kind: "role_denied", message: RoleDeniedMessage };
    }
    return { ok: true, from, to, requireLead: rule.requireLead };
  }
}
