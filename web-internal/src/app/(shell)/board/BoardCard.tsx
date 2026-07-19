import Link from 'next/link';
import { cardHref, divisionBadgeClass, dependencyBadgeClass, type Card } from '@/lib/board';

/**
 * Shared card tile for both Client Board and My Tasks (same `Card` shape,
 * brief §1). `showClientId` is for My Tasks, which spans Clients so the
 * Client needs to be visible on the card; Client Board already scopes to one
 * Client so it's redundant there. `dependency_badge` never exists on My Tasks
 * cards (brief §1/§4) — this renders it only when the field is present,
 * which naturally excludes My Tasks without a separate flag.
 */
export default function BoardCard({ card, showClientId = false }: { card: Card; showClientId?: boolean }) {
  return (
    <Link href={cardHref(card)} className="card" style={{ padding: 10, display: 'block' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <span className={`badge ${divisionBadgeClass(card.division)}`}>{card.division}</span>
        {card.overdue && <span className="badge badge-red">Overdue</span>}
      </div>
      <div style={{ fontWeight: 600, fontSize: 13, marginTop: 6 }}>{card.id}</div>
      <div className="muted" style={{ fontSize: 12 }}>{card.native_status}</div>
      <div className="muted" style={{ fontSize: 12 }}>PIC: {card.pic || '—'}</div>
      <div className="muted" style={{ fontSize: 12 }}>Due: {card.due_date || '—'}</div>
      {showClientId && (
        <div className="muted" style={{ fontSize: 12 }}>Klien: {card.client_id}</div>
      )}
      {card.type !== 'brief' && (
        <div className="muted" style={{ fontSize: 12 }}>Brief: {card.brief_id}</div>
      )}
      {card.dependency_badge && (
        <span
          className={`badge ${dependencyBadgeClass(card.dependency_badge)}`}
          style={{ marginTop: 6, display: 'inline-flex' }}
        >
          {card.dependency_badge}
        </span>
      )}
    </Link>
  );
}
