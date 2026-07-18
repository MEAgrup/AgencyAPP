'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  COMPLAINT_IN_PROGRESS,
  COMPLAINT_OPEN,
  COMPLAINT_RESOLVED,
  closeComplaint,
  getComplaint,
  isReadOnlyOD,
  resolveComplaint,
  startComplaint,
  type Complaint,
} from '@/lib/account';
import StatusBadge from '@/components/StatusBadge';

function relatedRefHref(ref: string): string {
  if (ref.startsWith('BRF-')) return `/account/briefs/${ref}`;
  if (ref.startsWith('SVC-')) return `/account/services/${encodeURIComponent(ref)}`;
  return '/account';
}

export default function ComplaintDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();
  const readOnly = isReadOnlyOD(role);

  const [complaint, setComplaint] = useState<Complaint | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [resolutionNotes, setResolutionNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getComplaint(id);
      setComplaint(res);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleStart() {
    setActionError(null);
    setActionMessage(null);
    setActionSubmitting(true);
    try {
      const res = await startComplaint(id);
      setActionMessage(`Status berpindah ke ${res.To}.`);
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActionSubmitting(false);
    }
  }

  async function handleResolve(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    setActionMessage(null);
    setActionSubmitting(true);
    try {
      const res = await resolveComplaint(id, resolutionNotes);
      setActionMessage(`Status berpindah ke ${res.To}.`);
      setResolutionNotes('');
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActionSubmitting(false);
    }
  }

  async function handleClose() {
    if (!window.confirm('Tutup komplain ini?')) return;
    setActionError(null);
    setActionMessage(null);
    setActionSubmitting(true);
    try {
      const res = await closeComplaint(id);
      setActionMessage(`Status berpindah ke ${res.To}.`);
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActionSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !complaint) {
    return (
      <div className="stack">
        <Link href="/account/complaints" className="muted">&larr; Kembali ke Pintu Komplain</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Komplain tidak ditemukan.'}</div>
      </div>
    );
  }

  const isOpen = complaint.status === COMPLAINT_OPEN;
  const isInProgress = complaint.status === COMPLAINT_IN_PROGRESS;
  const isResolved = complaint.status === COMPLAINT_RESOLVED;

  return (
    <div className="stack">
      <div>
        <Link href="/account/complaints" className="muted">&larr; Kembali ke Pintu Komplain</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{complaint.id}</h1>
          <p className="muted">Klien: {complaint.client_id}</p>
        </div>
        <StatusBadge status={complaint.status} />
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Detail Komplain</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Severity</div>
            <div>{complaint.severity}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Sumber</div>
            <div>{complaint.source}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Ditugaskan Ke</div>
            <div>{complaint.assigned_to || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Referensi</div>
            <div>
              {complaint.related_ref ? (
                <Link href={relatedRefHref(complaint.related_ref)}>{complaint.related_ref}</Link>
              ) : (
                '—'
              )}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Deskripsi</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{complaint.description}</div>
          </div>
          {complaint.resolution_notes && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Catatan Penyelesaian</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{complaint.resolution_notes}</div>
            </div>
          )}
        </div>
      </section>

      {!readOnly && (isOpen || isInProgress || isResolved) && (
        <section className="card">
          <div className="cardHeader">
            <h2>Aksi</h2>
          </div>
          {actionError && <div className="alert alertError" role="alert">{actionError}</div>}
          {actionMessage && <div className="alert alertSuccess" role="status">{actionMessage}</div>}

          {isOpen && (
            <button type="button" className="btn btnPrimary" disabled={actionSubmitting} onClick={handleStart}>
              {actionSubmitting ? 'Memproses...' : 'Mulai Tangani'}
            </button>
          )}

          {isInProgress && (
            <form className="form" onSubmit={handleResolve}>
              <div className="field">
                <label htmlFor="resolution-notes">Catatan Penyelesaian</label>
                <textarea
                  id="resolution-notes"
                  required
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                />
              </div>
              <div>
                <button type="submit" className="btn btnPrimary" disabled={actionSubmitting}>
                  {actionSubmitting ? 'Memproses...' : 'Selesaikan'}
                </button>
              </div>
            </form>
          )}

          {isResolved && (
            <button type="button" className="btn btnPrimary" disabled={actionSubmitting} onClick={handleClose}>
              {actionSubmitting ? 'Memproses...' : 'Tutup Komplain'}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
