import { badgeTone } from '@/lib/status';

export default function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${badgeTone(status)}`}>{status}</span>;
}
