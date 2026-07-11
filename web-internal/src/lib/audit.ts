/** Best-effort extraction of a human-readable status label from an audit before/after JSON blob. */
export function extractStatusLabel(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  const value = obj.status ?? obj.to ?? obj.state;
  return typeof value === 'string' ? value : null;
}

/** Renders a before/after JSON blob compactly for the audit table when it isn't a plain status transition. */
export function summarizeJson(json: unknown): string {
  if (json === null || json === undefined) return '—';
  if (typeof json === 'string') return json;
  try {
    return JSON.stringify(json);
  } catch {
    return '—';
  }
}
