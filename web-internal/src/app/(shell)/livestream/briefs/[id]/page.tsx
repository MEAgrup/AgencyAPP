'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import StatusBadge from '@/components/StatusBadge';
import {
  BRIEF_APPROVED_STATUS,
  BRIEF_DISPATCHED_STATUS,
  BRIEF_VOIDED_STATUS,
  PLATFORM_OPTIONS,
  canManageLiveStream,
  confidenceBadgeTone,
  createSession,
  getBrief,
  listBriefSessions,
  reopenBrief,
  sessionBadgeTone,
  type LiveStreamBrief,
  type Session,
} from '@/lib/livestream';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

export default function LiveStreamBriefDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();

  // canManageSession (m10 brief §1.1/gotcha #8): owning AM OR Director — see
  // canManageLiveStream in lib/livestream.ts. UX-only; backend re-checks the
  // exact clients.assigned_am_id match on every write.
  const canManage = canManageLiveStream(role);

  const [brief, setBrief] = useState<LiveStreamBrief | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Buat Session
  const [platform, setPlatform] = useState<string>(PLATFORM_OPTIONS[0]);
  const [requestedDatetime, setRequestedDatetime] = useState('');
  const [targetDurationHours, setTargetDurationHours] = useState('');
  const [productsTalent, setProductsTalent] = useState('');
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Buka Kembali (reopen)
  const [reopenSubmitting, setReopenSubmitting] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [reopenMessage, setReopenMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [briefRes, sessionsRes] = await Promise.all([getBrief(id), listBriefSessions(id)]);
      setBrief(briefRes);
      setSessions(sessionsRes.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateSubmitting(true);
    try {
      await createSession(id, {
        platform,
        requested_datetime: requestedDatetime,
        target_duration_hours: targetDurationHours,
        products_talent: productsTalent || undefined,
        special_instructions: specialInstructions || undefined,
      });
      setRequestedDatetime('');
      setTargetDurationHours('');
      setProductsTalent('');
      setSpecialInstructions('');
      await load();
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function handleReopen() {
    if (!window.confirm('Yakin ingin membuka kembali Brief ini ke [Dispatched to Vendor]?')) return;
    setReopenError(null);
    setReopenMessage(null);
    setReopenSubmitting(true);
    try {
      await reopenBrief(id);
      setReopenMessage('Brief berhasil dibuka kembali.');
      await load();
    } catch (err) {
      setReopenError(errorMessage(err));
    } finally {
      setReopenSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !brief) {
    return (
      <div className="stack">
        <Link href="/livestream" className="muted">&larr; Kembali ke Live Stream</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Brief tidak ditemukan.'}</div>
      </div>
    );
  }

  const voided = brief.status === BRIEF_VOIDED_STATUS;
  const canCreateSession = canManage && !voided && brief.status === BRIEF_DISPATCHED_STATUS;
  const canReopen = canManage && !voided && brief.status === BRIEF_APPROVED_STATUS;

  return (
    <div className="stack">
      <div>
        <Link href="/livestream" className="muted">&larr; Kembali ke Live Stream</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{brief.title}</h1>
          <p className="muted">{brief.id}</p>
        </div>
        <StatusBadge status={brief.status} />
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Brief</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Divisi</div>
            <div>{brief.assigned_division}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>PIC</div>
            <div>{brief.assigned_pic || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Deliverable</div>
            <div>{brief.deliverable_type || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Jatuh Tempo</div>
            <div>{brief.due_date || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Prioritas</div>
            <div>{brief.priority || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Service ID</div>
            <div>{brief.service_id || '—'}</div>
          </div>
        </div>

        {voided && (
          <p className="muted" style={{ marginTop: 12 }}>
            Brief ini sudah dibatalkan &mdash; semua Session di bawahnya dibekukan, tidak ada transisi yang diterima.
          </p>
        )}

        {canReopen && (
          <div style={{ marginTop: 12 }}>
            {reopenError && <div className="alert alertError" role="alert">{reopenError}</div>}
            {reopenMessage && <div className="alert alertSuccess" role="status">{reopenMessage}</div>}
            <button type="button" className="btn btnSecondary" disabled={reopenSubmitting} onClick={handleReopen}>
              {reopenSubmitting ? 'Memproses...' : 'Buka Kembali'}
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Session</h2>
        </div>
        {sessions && sessions.length === 0 && (
          <div className="emptyState">Belum ada Session untuk Brief ini.</div>
        )}
        {sessions && sessions.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Platform</th>
                  <th>Requested Date/Time</th>
                  <th>Target Duration</th>
                  <th>Actual Date/Time Held</th>
                  <th>GMV from Live</th>
                  <th>Data Confidence Tier</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/livestream/sessions/${s.id}`}>{s.id}</Link></td>
                    <td>{s.platform}</td>
                    <td>{formatDateTime(s.requested_datetime)}</td>
                    <td>{s.target_duration_hours} jam</td>
                    <td>{formatDateTime(s.actual_datetime)}</td>
                    <td>{s.gmv_display || '—'}</td>
                    <td>
                      <span className={`badge badge-${confidenceBadgeTone(s.data_confidence_tier)}`}>
                        {s.data_confidence_tier}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-${sessionBadgeTone(s.status)}`}>{s.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canCreateSession && (
        <section className="card">
          <div className="cardHeader">
            <h2>Buat Session</h2>
          </div>
          <form className="form" onSubmit={handleCreate}>
            {createError && <div className="alert alertError" role="alert">{createError}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="create-platform">Platform</label>
                <select id="create-platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                  {PLATFORM_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="create-requested">Requested Date/Time</label>
                <input
                  id="create-requested"
                  type="datetime-local"
                  required
                  value={requestedDatetime}
                  onChange={(e) => setRequestedDatetime(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="create-duration">Target Duration (jam)</label>
                <input
                  id="create-duration"
                  type="number"
                  min="0.1"
                  step="0.1"
                  required
                  value={targetDurationHours}
                  onChange={(e) => setTargetDurationHours(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="create-products">Products/Talent to Feature (opsional)</label>
              <input
                id="create-products"
                value={productsTalent}
                onChange={(e) => setProductsTalent(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="create-instructions">Special Instructions (opsional)</label>
              <textarea
                id="create-instructions"
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
              />
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={createSubmitting}>
                {createSubmitting ? 'Menyimpan...' : 'Buat Session'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
