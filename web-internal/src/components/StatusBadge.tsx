import { badgeTone, type BadgeTone } from '@/lib/status';

export default function StatusBadge({ status, tone }: { status: string; tone?: BadgeTone }) {
  return <span className={`badge badge-${tone ?? badgeTone(status)}`}>{status}</span>;
}
