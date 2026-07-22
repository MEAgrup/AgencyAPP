// @cdps/core statemachine — declarative transition engine (pure decision layer).
export { Machine, Engine, type Edge, type EdgeDef, type MachineConfig, type TransitionDecision } from "./machine.js";
export { defaultMachines } from "./config.js";
export * from "./config.js";

import { Engine } from "./machine.js";
import { defaultMachines } from "./config.js";

/** newEngine returns an Engine loaded with the canonical machine configuration
 * transcribed from docs/STATE_MACHINES.md (mirrors Go statemachine.New). */
export function newEngine(): Engine {
  return new Engine(defaultMachines());
}
