'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  BRIEF_IN_REVIEW,
  BRIEF_SUBMITTED,
  approveBrief,
  getBrief,
  isAccountLead,
  isAccountStaff,
  isReadOnlyOD,
  requestBriefRevision,
  reviewBrief,
  type Brief,
} from '@/lib/account';
import StatusBadge from '@/components/StatusBadge';
import StageTimelinePanel from '@/components/StageTimelinePanel';
import { transitionTo } from '@/lib/transition';

export default function BriefDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();
  const readOnly = isReadOnlyOD(role);

  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getBrief(id);
      setBrief(res);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleReview() {
    setActionError(null);
    setActionMessage(null);
    setActionSubmitting(true);
    try {
      const res = await reviewBrief(id);
      setActionMessage(`Status berpindah ke ${transitionTo(res)}.`);
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActionSubmitting(false);
    }
  }

  async function handleApprove() {
    if (!window.confirm('Setujui Brief ini?')) return;
    setActionError(null);
    setActionMessage(null);
    setActionSubmitting(true);
    try {
      const res = await approveBrief(id);
      setActionMessage(`Status berpindah ke ${transitionTo(res)}.`);
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActionSubmitting(false);
    }
  }

  async function handleRequestRevision() {
    const feedback = window.prompt('Catatan revisi untuk divisi eksekusi:');
    if (!feedback) return;
    setActionError(null);
    setActionMessage(null);
    setActionSubmitting(true);
    try {
      const res = await requestBriefRevision(id, feedback);
      setActionMessage(`Status berpindah ke ${transitionTo(res)}.`);
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActionSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !brief) {
    return (
      <div className="stack">
        <Link href="/account/briefs" className="muted">&larr; Kembali ke Papan Brief</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Brief tidak ditemukan.'}</div>
      </div>
    );
  }

  const canReview = brief.status === BRIEF_SUBMITTED;
  const canDecide = brief.status === BRIEF_IN_REVIEW;
  // AM-review actions belong to the owner AM/Director (brief.go review guard,
  // ErrBriefReviewForbidden). Execution-division staff/leads (Creative/Ads/KOL)
  // legitimately read this page via canSeeBrief but must see it read-only —
  // hide the action section outside the Account division. Server stays final.
  const isAMReviewer =
    !readOnly && (isAccountStaff(role) || isAccountLead(role) || !!role?.director);

  return (
    <div className="stack">
      <div>
        <Link href="/account/briefs" className="muted">&larr; Kembali ke Papan Brief</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{brief.title}</h1>
          <p className="muted">{brief.id}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {brief.revision_flagged && <span className="badge badge-red">Revisi Berulang</span>}
          <StatusBadge status={brief.status} />
        </div>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Detail Brief</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Layanan</div>
            <div>
              <Link href={`/account/services/${encodeURIComponent(brief.service_id)}`}>{brief.service_id}</Link>
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Strategy</div>
            <div>
              {brief.strategy_id ? (
                <Link href={`/account/strategies/${brief.strategy_id}`}>{brief.strategy_id}</Link>
              ) : (
                'Direct (tanpa Strategy)'
              )}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Divisi Tujuan</div>
            <div>{brief.assigned_division}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>PIC</div>
            <div>{brief.assigned_pic || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Deliverable Type</div>
            <div>{brief.deliverable_type}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Quantity / Target</div>
            <div>{brief.quantity_target}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Due Date</div>
            <div>{brief.due_date || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Prioritas</div>
            <div>{brief.priority}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Recurring</div>
            <div>
              {brief.recurring
                ? `Ya (${brief.recurring_frequency || '—'}, ${brief.recurring_count ?? '—'}x s/d ${brief.recurring_end_date || '—'})`
                : 'Tidak'}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Jumlah Revisi &middot; <span title="Auto-calculated dari audit log">🔒 read-only</span>
            </div>
            <div>{brief.revision_count}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Instruksi</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{brief.instructions || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Referensi / Lampiran</div>
            <div>
              {brief.reference_attachments ? (
                <a href={brief.reference_attachments} target="_blank" rel="noreferrer">Lihat</a>
              ) : (
                '—'
              )}
            </div>
          </div>
        </div>
      </section>

      <StageTimelinePanel
        briefId={brief.id}
        assignedDivision={brief.assigned_division}
        canReview={!readOnly && (role?.division === brief.assigned_division || !!role?.director)}
      />

      {isAMReviewer && (canReview || canDecide) && (
        <section className="card">
          <div className="cardHeader">
            <h2>Review Brief (AM)</h2>
          </div>
          {actionError && <div className="alert alertError" role="alert">{actionError}</div>}
          {actionMessage && <div className="alert alertSuccess" role="status">{actionMessage}</div>}
          <div className="row" style={{ gap: 10 }}>
            {canReview && (
              <button type="button" className="btn btnPrimary" disabled={actionSubmitting} onClick={handleReview}>
                {actionSubmitting ? 'Memproses...' : 'Mulai Review'}
              </button>
            )}
            {canDecide && (
              <>
                <button type="button" className="btn btnPrimary" disabled={actionSubmitting} onClick={handleApprove}>
                  {actionSubmitting ? 'Memproses...' : 'Setujui'}
                </button>
                <button type="button" className="btn btnSecondary" disabled={actionSubmitting} onClick={handleRequestRevision}>
                  {actionSubmitting ? 'Memproses...' : 'Minta Revisi'}
                </button>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
