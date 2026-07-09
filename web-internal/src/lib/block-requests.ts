import type { AuditEntry } from '@/lib/types';

/**
 * CONTRACT ASSUMPTION: the fixed API contract does not expose a dedicated
 * "list pending block requests" field on GET /demo-tasks/{id} — only the
 * audit[] trail. Per house convention, notifications and derived state are
 * meant to come from the audit log, so we derive the current pending block
 * request (if any) by scanning audit entries for a "submitted" action not
 * yet followed by a matching "approve"/"reject" action, and read its id out
 * of a handful of plausible JSON keys. If the backend's real audit payloads
 * use a different key/action naming, this heuristic degrades gracefully:
 * the "Ajukan Block" flow still works, only the auto-detected approve
 * button would not appear.
 */

const ID_KEYS = ['request_id', 'block_request_id', 'req_id', 'id'];

function extractId(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  for (const key of ID_KEYS) {
    const value = obj[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return null;
}

function isSubmitAction(action: string) {
  const a = action.toLowerCase();
  return a.includes('block') && a.includes('request') && (a.includes('submit') || a.includes('ajukan'));
}

function isResolveAction(action: string) {
  const a = action.toLowerCase();
  return (
    a.includes('block') &&
    a.includes('request') &&
    (a.includes('approve') || a.includes('reject') || a.includes('setuju') || a.includes('tolak'))
  );
}

export interface PendingBlockRequest {
  id: string;
  submittedBy: string;
  submittedAt: string;
}

/** Returns the most recent unresolved block request found in the audit trail, if any. */
export function findPendingBlockRequest(audit: AuditEntry[]): PendingBlockRequest | null {
  const resolvedIds = new Set<string>();
  for (const entry of audit) {
    if (isResolveAction(entry.action)) {
      const id = extractId(entry.after_json) ?? extractId(entry.before_json);
      if (id) resolvedIds.add(id);
    }
  }

  let pending: PendingBlockRequest | null = null;
  for (const entry of audit) {
    if (!isSubmitAction(entry.action)) continue;
    const id = extractId(entry.after_json) ?? extractId(entry.before_json);
    if (!id || resolvedIds.has(id)) continue;
    pending = { id, submittedBy: entry.actor_employee_id, submittedAt: entry.created_at };
  }
  return pending;
}
