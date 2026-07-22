/**
 * Bahasa Indonesia validation/block messages — house-wide core constants.
 *
 * SCOPE (important): CLAUDE.md #5 requires every validation message to be a
 * Bahasa Indonesia string in square brackets `[...]`, using the EXACT strings
 * from the PRDs. The Go backend keeps most of those strings **inline per
 * module** (≈285 distinct strings, no central catalog) — those belong to their
 * module ports (`module0_sales`, `module5_finance`, …), NOT here.
 *
 * This file holds ONLY the messages that are already named engine-level
 * constants in `backend/internal/core` (shared across every module) plus the
 * single global default from CLAUDE.md #5. Do NOT dump module-specific strings
 * here — port them alongside their module so the string stays next to the rule
 * that raises it (single source, no drift).
 */

/**
 * Global default when mandatory fields are missing (CLAUDE.md #5).
 * Ports the exact string from the house convention.
 */
export const INCOMPLETE_DATA = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';

/**
 * Fallback block message for an invalid/unlisted state transition.
 * Ports `statemachine.DefaultBlockMessage`. Mirrors the SQL side default
 * (`sm_machines.block_message` DEFAULT) — keep the two identical.
 */
export const TRANSITION_NOT_ALLOWED = '[transisi status tidak diizinkan]';

/**
 * Role-restricted transition denied (e.g. brief_task [Blocked] = SPV/Lead-only).
 * Ports `statemachine.RoleDeniedMessage`.
 */
export const TRANSITION_ROLE_DENIED = '[anda tidak memiliki akses untuk melakukan transisi ini]';

/**
 * isBracketed enforces the house-rule shape (CLAUDE.md #5): a BI message must be
 * wrapped in square brackets with non-empty content. Use in tests/assertions to
 * guard against a raw (un-bracketed) message leaking to a client.
 */
export function isBracketed(message: string): boolean {
  return /^\[.+\]$/.test(message);
}

/**
 * bracket wraps a bare message in the house `[...]` form if it is not already.
 * Convenience for assembling messages from a bare fragment; a message already
 * bracketed is returned unchanged (idempotent).
 */
export function bracket(message: string): string {
  return isBracketed(message) ? message : `[${message}]`;
}
