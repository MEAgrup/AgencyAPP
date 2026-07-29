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
  // Lead yang dihapus lewat ACC Head (M1, keputusan pemilik 2026-07-29).
  // Perlu entri eksplisit: substring 'delete' tidak ada di heuristik bawah,
  // jadi tanpa baris ini `[Deleted]` jatuh ke 'gray' dan terlihat seperti
  // `[To Do]` — state terminal harus terbaca sebagai terminal.
  '[Deleted]': 'darkgray',
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
