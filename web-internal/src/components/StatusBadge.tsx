import { badgeTone, type BadgeTone } from '@/lib/status';

// tone overrides the substring-matched badgeTone(status) for status vocabularies
// that badgeTone doesn't cover — e.g. the unbracketed Marketing campaign statuses
// (Draft/Active/Paused/Closed/Archived) whose tone map lives in lib/marketing.ts.
export default function StatusBadge({ status, tone }: { status: string; tone?: BadgeTone }) {
  return <span className={`badge badge-${tone ?? badgeTone(status)}`}>{status}</span>;
}
