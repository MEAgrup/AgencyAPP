// Badge color mapping for lifecycle-entity statuses (CLAUDE.md / task spec).
// Keys are matched by substring so machine-specific variants (e.g. the M9
// QC labels) still fall into the right bucket without inventing new labels.

export type BadgeTone = 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'purple' | 'darkgray';

const EXACT_MAP: Record<string, BadgeTone> = {
  '[To Do]': 'gray',
  '[In Progress]': 'blue',
  '[Submitted]': 'amber',
  '[In Review]': 'amber',
  '[Approved]': 'green',
  '[Blocked]': 'red',
  '[Revision Requested]': 'purple',
  '[Cancelled — Service Voided]': 'darkgray',
  // M0 prospect attempt / M1 lead record statuses (docs/STATE_MACHINES.md §1-2).
  '[Pool]': 'blue',
  'active': 'green',
  'New Lead': 'gray',
  'Contacted': 'blue',
  'Qualified': 'green',
  'Not Qualified': 'red',
  '[Not Qualified]': 'red',
  '[Rejected]': 'red',
  '[Blocked - Duplikat]': 'red',
  'Closed-Success': 'green',
  'Closed-Lost': 'darkgray',
  '[Closed - Kalah Kompetisi]': 'darkgray',
};

export function badgeTone(status: string): BadgeTone {
  if (EXACT_MAP[status]) return EXACT_MAP[status];
  const lower = status.toLowerCase();
  if (lower.includes('progress')) return 'blue';
  if (lower.includes('review') || lower.includes('submit')) return 'amber';
  if (lower.includes('approve') || lower.includes('pass')) return 'green';
  if (lower.includes('block') || lower.includes('fail') || lower.includes('escalat')) return 'red';
  if (lower.includes('revision')) return 'purple';
  if (lower.includes('cancel') || lower.includes('void') || lower.includes('drop')) return 'darkgray';
  return 'gray';
}
