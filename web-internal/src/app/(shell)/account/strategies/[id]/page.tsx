'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  BRIEF_DIVISIONS,
  STRATEGY_DRAFTING,
  STRATEGY_SUBMITTED,
  approveStrategy,
  canApproveStrategy,
  getStrategy,
  isAccountStaff,
  isReadOnlyOD,
  requestStrategyRevision,
  submitStrategy,
  updateStrategy,
  type Strategy,
} from '@/lib/account';
import StatusBadge from '@/components/StatusBadge';

export default function StrategyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();
  const canApprove = canApproveStrategy(role);
  // Draft edit/submit belongs to the owner AM (Account staff) or Director
  // (strategy.go:290-296, 327-329). Owner can't be checked client-side (the
  // Strategy response carries no owner field), but OD must never see write
  // controls and non-Account divisions get a guaranteed 403 — hide for both.
  // Server remains the final authority (CLAUDE.md #6).
  const canDraft = !isReadOnlyOD(role) && (isAccountStaff(role) || !!role?.director);

  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Edit draft form
  const [objective, setObjective] = useState('');
  const [targetKpi, setTargetKpi] = useState('');
  const [divisions, setDivisions] = useState<string[]>([]);
  const [outline, setOutline] = useState('');
  const [timelineStart, setTimelineStart] = useState('');
  const [timelineEnd, setTimelineEnd] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);

  // Submit
  const [submitSubmitting, setSubmitSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  // Approve / request revision
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getStrategy(id);
      setStrategy(res);
      setObjective(res.objective ?? '');
      setTargetKpi(res.target_kpi ?? '');
      setDivisions(res.divisions_involved ?? []);
      setOutline(res.planned_brief_outline ?? '');
      setTimelineStart(res.timeline_start ?? '');
      setTimelineEnd(res.timeline_end ?? '');
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function toggleDivision(div: string) {
    setDivisions((prev) => (prev.includes(div) ? prev.filter((d) => d !== div) : [...prev, div]));
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault();
    setEditError(null);
    setEditMessage(null);
    setEditSubmitting(true);
    try {
      await updateStrategy(id, {
        objective,
        target_kpi: targetKpi,
        divisions_involved: divisions,
        planned_brief_outline: outline,
        timeline_start: timelineStart,
        timeline_end: timelineEnd,
      });
      setEditMessage('Draft Strategy & Plan berhasil disimpan.');
      await load();
    } catch (err) {
      setEditError(errorMessage(err));
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleSubmit() {
    if (!window.confirm('Ajukan Strategy & Plan ini untuk persetujuan? Form akan terkunci.')) return;
    setSubmitError(null);
    setSubmitMessage(null);
    setSubmitSubmitting(true);
    try {
      const res = await submitStrategy(id);
      setSubmitMessage(`Status berpindah ke ${res.To}.`);
      await load();
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitSubmitting(false);
    }
  }

  async function handleApprove() {
    if (!window.confirm('Setujui Strategy & Plan ini? Layanan akan berpindah ke [Strategy Approved].')) return;
    setReviewError(null);
    setReviewMessage(null);
    setReviewSubmitting(true);
    try {
      const res = await approveStrategy(id);
      setReviewMessage(`Strategy & Plan disetujui (${res.status}).`);
      await load();
    } catch (err) {
      setReviewError(errorMessage(err));
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function handleRequestRevision() {
    const notes = window.prompt('Catatan revisi untuk AM pemilik:');
    if (!notes) return;
    setReviewError(null);
    setReviewMessage(null);
    setReviewSubmitting(true);
    try {
      const res = await requestStrategyRevision(id, notes);
      setReviewMessage(`Revisi diminta, status kembali ke ${res.status}.`);
      await load();
    } catch (err) {
      setReviewError(errorMessage(err));
    } finally {
      setReviewSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !strategy) {
    return (
      <div className="stack">
        <Link href="/account" className="muted">&larr; Kembali ke Account</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Strategy & Plan tidak ditemukan.'}</div>
      </div>
    );
  }

  const isDrafting = strategy.status === STRATEGY_DRAFTING;
  const isSubmitted = strategy.status === STRATEGY_SUBMITTED;

  return (
    <div className="stack">
      <div>
        <Link href="/account" className="muted">&larr; Kembali ke Account</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{strategy.id}</h1>
          <p className="muted">
            Layanan:{' '}
            <Link href={`/account/services/${encodeURIComponent(strategy.service_id)}`}>{strategy.service_id}</Link>
          </p>
        </div>
        <StatusBadge status={strategy.status} />
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Ringkasan</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Objective</div>
            <div>{strategy.objective || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Target KPI</div>
            <div>{strategy.target_kpi || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Divisi Terlibat</div>
            <div>{strategy.divisions_involved.length > 0 ? strategy.divisions_involved.join(', ') : '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Timeline</div>
            <div>{strategy.timeline_start || '—'} &rarr; {strategy.timeline_end || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Outline Brief</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{strategy.planned_brief_outline || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Jumlah Revisi &middot; <span title="Auto-calculated dari audit log">🔒 read-only</span>
            </div>
            <div>{strategy.revision_count}</div>
          </div>
          {strategy.approved_by && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Disetujui Oleh</div>
              <div>{strategy.approved_by}</div>
            </div>
          )}
          {strategy.revision_notes && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Catatan Revisi</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{strategy.revision_notes}</div>
            </div>
          )}
        </div>
      </section>

      {canApprove && isSubmitted && (
        <section className="card">
          <div className="cardHeader">
            <h2>Persetujuan</h2>
          </div>
          {reviewError && <div className="alert alertError" role="alert">{reviewError}</div>}
          {reviewMessage && <div className="alert alertSuccess" role="status">{reviewMessage}</div>}
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn btnPrimary" disabled={reviewSubmitting} onClick={handleApprove}>
              {reviewSubmitting ? 'Memproses...' : 'Setujui'}
            </button>
            <button type="button" className="btn btnSecondary" disabled={reviewSubmitting} onClick={handleRequestRevision}>
              {reviewSubmitting ? 'Memproses...' : 'Minta Revisi'}
            </button>
          </div>
        </section>
      )}

      {canDraft && isDrafting && (
        <section className="card">
          <div className="cardHeader">
            <h2>Ubah Draft</h2>
          </div>
          <form className="form" onSubmit={handleEdit}>
            {editError && <div className="alert alertError" role="alert">{editError}</div>}
            {editMessage && <div className="alert alertSuccess" role="status">{editMessage}</div>}
            <div className="field">
              <label htmlFor="str-objective">Objective</label>
              <textarea id="str-objective" required value={objective} onChange={(e) => setObjective(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="str-kpi">Target KPI</label>
              <textarea id="str-kpi" required value={targetKpi} onChange={(e) => setTargetKpi(e.target.value)} />
            </div>
            <div className="field">
              <label>Divisi Terlibat (min. 1)</label>
              <div className="stack" style={{ gap: 6 }}>
                {BRIEF_DIVISIONS.map((div) => (
                  <label key={div} className="row" style={{ gap: 8, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={divisions.includes(div)}
                      onChange={() => toggleDivision(div)}
                    />
                    {div}
                  </label>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="str-outline">Outline Brief Terencana</label>
              <textarea id="str-outline" required value={outline} onChange={(e) => setOutline(e.target.value)} />
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="str-start">Timeline Mulai</label>
                <input id="str-start" type="date" required value={timelineStart} onChange={(e) => setTimelineStart(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="str-end">Timeline Selesai</label>
                <input id="str-end" type="date" required value={timelineEnd} onChange={(e) => setTimelineEnd(e.target.value)} />
              </div>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <button type="submit" className="btn btnPrimary" disabled={editSubmitting}>
                {editSubmitting ? 'Menyimpan...' : 'Simpan Draft'}
              </button>
            </div>
          </form>
        </section>
      )}

      {canDraft && isDrafting && (
        <section className="card">
          <div className="cardHeader">
            <h2>Ajukan Persetujuan</h2>
          </div>
          {submitError && <div className="alert alertError" role="alert">{submitError}</div>}
          {submitMessage && <div className="alert alertSuccess" role="status">{submitMessage}</div>}
          <p className="muted" style={{ fontSize: 13 }}>
            Simpan draft terlebih dahulu bila ada perubahan, lalu ajukan untuk disetujui Account lead.
          </p>
          <button type="button" className="btn btnPrimary" disabled={submitSubmitting} onClick={handleSubmit}>
            {submitSubmitting ? 'Memproses...' : 'Ajukan untuk Persetujuan'}
          </button>
        </section>
      )}
    </div>
  );
}
