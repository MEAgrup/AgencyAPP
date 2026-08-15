'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  BRIEF_DIVISIONS,
  GMV_ADJ_APPROVED,
  GMV_ADJ_PENDING,
  GMV_TOLERANCE,
  STRATEGY_DRAFTING,
  STRATEGY_SUBMITTED,
  TASK_CATALOG,
  approveStrategy,
  canApproveStrategy,
  getStrategy,
  isAccountStaff,
  isReadOnlyOD,
  requestStrategyRevision,
  submitStrategy,
  updateStrategy,
  type DivisionTask,
  type Strategy,
} from '@/lib/account';
import StatusBadge from '@/components/StatusBadge';
import { formatIDR } from '@/lib/money';
import { transitionTo } from '@/lib/transition';

/** The human label for a stored task-satuan (divisi, jenis), or the raw jenis. */
function taskLabel(divisi: string, jenis: string): string {
  return (TASK_CATALOG[divisi] ?? []).find((t) => t.jenis === jenis)?.label ?? jenis;
}

/** Whether a task-satuan quota is a Rupiah amount (Ads spend) rather than a count. */
function taskIsMoney(divisi: string, jenis: string): boolean {
  return (TASK_CATALOG[divisi] ?? []).find((t) => t.jenis === jenis)?.money ?? false;
}

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

  // Edit draft form — the full Strategy & Plan content, including the structured
  // Target KPI and per-division task-satuan (QA revisi). The revision loop lands
  // back here, so an edit that omitted these fields would silently wipe them.
  const [objective, setObjective] = useState('');
  const [gmv, setGmv] = useState('');
  const [roas, setRoas] = useState('');
  const [ctr, setCtr] = useState('');
  const [cvr, setCvr] = useState('');
  const [gmvReason, setGmvReason] = useState('');
  const [kpiNote, setKpiNote] = useState('');
  const [tasks, setTasks] = useState<Record<string, string>>({});
  const [divisions, setDivisions] = useState<string[]>([]);
  const [outline, setOutline] = useState('');
  const [timelineStart, setTimelineStart] = useState('');
  const [timelineEnd, setTimelineEnd] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);

  // Submit (fallback path — see the card comment)
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
      setGmv(res.target_gmv ?? '');
      setRoas(res.target_roas ?? '');
      setCtr(res.target_ctr ?? '');
      setCvr(res.target_cvr ?? '');
      setGmvReason(res.gmv_adjustment_reason ?? '');
      setKpiNote(res.target_kpi ?? '');
      const taskMap: Record<string, string> = {};
      for (const t of res.division_tasks ?? []) taskMap[`${t.divisi}::${t.jenis}`] = t.jumlah;
      setTasks(taskMap);
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

  // The client's expectation and the AM's deviation from it, for the ±20% gate UI —
  // the same arithmetic the server runs (mirrors the Service create form).
  const clientGmv = strategy?.client_target_gmv ? Number(strategy.client_target_gmv) : 0;
  const gmvNum = gmv.trim() === '' ? clientGmv : Number(gmv);
  const gmvDeviation = clientGmv > 0 && !Number.isNaN(gmvNum) ? (gmvNum - clientGmv) / clientGmv : 0;
  const gmvOutOfTolerance = clientGmv > 0 && Math.abs(gmvDeviation) > GMV_TOLERANCE + 1e-9;

  /** Build division_tasks from the selected divisions' non-empty quota inputs. */
  function collectTasks(): DivisionTask[] {
    const out: DivisionTask[] = [];
    for (const divisi of divisions) {
      for (const t of TASK_CATALOG[divisi] ?? []) {
        const jumlah = (tasks[`${divisi}::${t.jenis}`] ?? '').trim();
        if (jumlah !== '') out.push({ divisi, jenis: t.jenis, jumlah });
      }
    }
    return out;
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault();
    setEditError(null);
    setEditMessage(null);
    setEditSubmitting(true);
    try {
      await updateStrategy(id, {
        objective,
        target_kpi: kpiNote,
        target_gmv: gmv.trim() === '' ? null : gmv.trim(),
        target_roas: roas.trim() === '' ? null : roas.trim(),
        target_ctr: ctr.trim() === '' ? null : ctr.trim(),
        target_cvr: cvr.trim() === '' ? null : cvr.trim(),
        gmv_adjustment_reason: gmvReason.trim() === '' ? null : gmvReason.trim(),
        division_tasks: collectTasks(),
        divisions_involved: divisions,
        planned_brief_outline: outline,
        timeline_start: timelineStart,
        timeline_end: timelineEnd,
      });
      // Saving IS submitting (QA revisi): no separate "Ajukan" click. The only
      // block is an out-of-tolerance GMV adjustment, which the submit gate refuses
      // until Head/SPV ACCs it — there the Plan stays a draft and the AM is told
      // why, instead of firing a submit the server rejects.
      if (gmvOutOfTolerance) {
        setEditMessage(
          'Draft disimpan. Penyesuaian target GMV di luar ±20% menunggu ACC Head/SPV sebelum bisa diajukan.',
        );
      } else {
        await submitStrategy(id);
        setEditMessage('Strategy & Plan disimpan dan diajukan untuk persetujuan.');
      }
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
      setSubmitMessage(`Status berpindah ke ${transitionTo(res)}.`);
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
  // Fallback submit path: a draft whose GMV adjustment was out of tolerance and is
  // now cleared by Head/SPV (approved). It could not auto-submit on save (the gate
  // held), and re-saving would re-open the gate — so the owner needs a way to
  // submit without editing. Not shown on the in-tolerance path (that auto-submits).
  const gmvAdjBlocking = strategy.gmv_adjustment_status === GMV_ADJ_PENDING;
  const gmvAdjCleared = strategy.gmv_adjustment_status === GMV_ADJ_APPROVED;

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
            <div className="muted" style={{ fontSize: 12 }}>Divisi Terlibat</div>
            <div>{strategy.divisions_involved.length > 0 ? strategy.divisions_involved.join(', ') : '—'}</div>
          </div>
        </div>

        {/* Structured Target KPI (QA revisi) — the four fixed points the reviewer
            reads before approving. Rendered here (not only on the Service hub) so
            the approval page shows the full plan, not just its objective. */}
        <div className="grid2" style={{ marginTop: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Target GMV</div>
            <div>{formatIDR(strategy.target_gmv)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Target ROAS</div>
            <div>{strategy.target_roas ?? '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Target CTR (%)</div>
            <div>{strategy.target_ctr ?? '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Target CVR (%)</div>
            <div>{strategy.target_cvr ?? '—'}</div>
          </div>
        </div>

        {/* GMV adjustment gate (±20% vs the client's expectation). */}
        {strategy.gmv_adjustment_status !== 'dalam_toleransi' && (
          <div
            className={`alert ${gmvAdjCleared ? 'alertSuccess' : 'alertInfo'}`}
            role="status"
            style={{ marginTop: 12 }}
          >
            <div>
              Penyesuaian target GMV di luar toleransi 20% (klien: {formatIDR(strategy.client_target_gmv)}) &mdash;{' '}
              {gmvAdjCleared
                ? `disetujui oleh ${strategy.gmv_adjustment_approved_by || 'Head/SPV'}.`
                : 'menunggu ACC Head/SPV. Plan belum bisa diajukan.'}
            </div>
            {strategy.gmv_adjustment_reason && (
              <div className="muted" style={{ fontSize: 12 }}>Alasan: {strategy.gmv_adjustment_reason}</div>
            )}
          </div>
        )}

        {/* Task-satuan per division — what the AM turns into Briefs (M6B P3). */}
        {strategy.division_tasks.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontSize: 12 }}>Strategi &mdash; task satuan per divisi</div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>
              {strategy.division_tasks.map((t) => (
                <li key={`${t.divisi}::${t.jenis}`}>
                  {t.divisi} &middot; {taskLabel(t.divisi, t.jenis)}:{' '}
                  <strong>{taskIsMoney(t.divisi, t.jenis) ? formatIDR(t.jumlah) : t.jumlah}</strong>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid2" style={{ marginTop: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Timeline</div>
            <div>{strategy.timeline_start || '—'} &rarr; {strategy.timeline_end || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Outline Brief</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{strategy.planned_brief_outline || '—'}</div>
          </div>
          {strategy.target_kpi && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Catatan KPI</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{strategy.target_kpi}</div>
            </div>
          )}
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
            <h2>Ubah &amp; Ajukan Draft</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Menyimpan draft otomatis mengajukannya untuk persetujuan &mdash; tidak perlu langkah
            &ldquo;ajukan&rdquo; terpisah.
          </p>
          <form className="form" onSubmit={handleEdit}>
            {editError && <div className="alert alertError" role="alert">{editError}</div>}
            {editMessage && <div className="alert alertSuccess" role="status">{editMessage}</div>}
            <div className="field">
              <label htmlFor="str-objective">Objective</label>
              <textarea id="str-objective" required value={objective} onChange={(e) => setObjective(e.target.value)} />
            </div>

            {/* Target KPI — the four fixed points (QA revisi). GMV anchors on the
                client's expectation and may move within ±20% freely. */}
            <fieldset style={{ border: '1px solid var(--border, #ddd)', padding: 12 }}>
              <legend style={{ fontSize: 13 }}>Target KPI</legend>
              <div className="formRow">
                <div className="field">
                  <label htmlFor="str-gmv">Target GMV (Rp)</label>
                  <input
                    id="str-gmv"
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={gmv}
                    onChange={(e) => setGmv(e.target.value)}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>
                    {clientGmv > 0
                      ? `Target klien (dari Sales): ${formatIDR(strategy.client_target_gmv)}`
                      : 'Klien belum menetapkan target GMV — tidak ada batas toleransi.'}
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="str-roas">Target ROAS</label>
                  <input id="str-roas" type="number" min="0" step="0.01" value={roas} onChange={(e) => setRoas(e.target.value)} />
                </div>
              </div>
              <div className="formRow">
                <div className="field">
                  <label htmlFor="str-ctr">Target CTR (%)</label>
                  <input id="str-ctr" type="number" min="0" step="0.001" value={ctr} onChange={(e) => setCtr(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="str-cvr">Target CVR (%)</label>
                  <input id="str-cvr" type="number" min="0" step="0.001" value={cvr} onChange={(e) => setCvr(e.target.value)} />
                </div>
              </div>
              {clientGmv > 0 && gmv.trim() !== '' && (
                <p className="muted" style={{ fontSize: 12 }}>
                  Penyesuaian GMV: {gmvDeviation >= 0 ? '+' : ''}
                  {(gmvDeviation * 100).toFixed(1)}% dari target klien.
                </p>
              )}
              {gmvOutOfTolerance && (
                <div className="field">
                  <label htmlFor="str-gmv-reason">
                    Alasan penyesuaian GMV di luar ±20% (wajib — perlu ACC Head/SPV)
                  </label>
                  <textarea
                    id="str-gmv-reason"
                    required
                    value={gmvReason}
                    onChange={(e) => setGmvReason(e.target.value)}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>
                    Di luar toleransi 20%: Plan tidak bisa diajukan sampai Head/SPV meng-ACC. Semua tercatat di log.
                  </span>
                </div>
              )}
              <div className="field">
                <label htmlFor="str-kpi-note">Catatan KPI (opsional)</label>
                <textarea id="str-kpi-note" value={kpiNote} onChange={(e) => setKpiNote(e.target.value)} />
              </div>
            </fieldset>

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

            {/* Strategi — task satuan per involved division (QA revisi). */}
            {divisions.some((d) => (TASK_CATALOG[d] ?? []).length > 0) && (
              <fieldset style={{ border: '1px solid var(--border, #ddd)', padding: 12 }}>
                <legend style={{ fontSize: 13 }}>Strategi &mdash; Task Satuan per Divisi</legend>
                {divisions.map((divisi) =>
                  (TASK_CATALOG[divisi] ?? []).length === 0 ? null : (
                    <div key={divisi} className="stack" style={{ gap: 6, marginBottom: 8 }}>
                      <div className="muted" style={{ fontSize: 12 }}>{divisi}</div>
                      <div className="formRow">
                        {(TASK_CATALOG[divisi] ?? []).map((t) => {
                          const key = `${divisi}::${t.jenis}`;
                          return (
                            <div key={key} className="field">
                              <label htmlFor={`str-task-${key}`}>{t.label}</label>
                              <input
                                id={`str-task-${key}`}
                                type="number"
                                min="0"
                                step="1"
                                value={tasks[key] ?? ''}
                                onChange={(e) => setTasks((prev) => ({ ...prev, [key]: e.target.value }))}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ),
                )}
              </fieldset>
            )}

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
                {editSubmitting ? 'Menyimpan & mengajukan...' : 'Simpan & Ajukan untuk Persetujuan'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Fallback submit — only when a draft's out-of-tolerance GMV adjustment has
          been cleared by Head/SPV (see gmvAdjCleared). The save above could not
          auto-submit while the gate held, and re-saving re-opens the gate, so this
          lets the owner submit the already-cleared draft directly. */}
      {canDraft && isDrafting && (gmvAdjCleared || gmvAdjBlocking) && (
        <section className="card">
          <div className="cardHeader">
            <h2>Ajukan Persetujuan</h2>
          </div>
          {submitError && <div className="alert alertError" role="alert">{submitError}</div>}
          {submitMessage && <div className="alert alertSuccess" role="status">{submitMessage}</div>}
          {gmvAdjBlocking ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Penyesuaian target GMV di luar ±20% masih menunggu ACC Head/SPV. Plan bisa diajukan setelah di-ACC.
            </p>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 13 }}>
                Penyesuaian GMV sudah di-ACC Head/SPV. Ajukan Plan ini untuk persetujuan.
              </p>
              <button type="button" className="btn btnPrimary" disabled={submitSubmitting} onClick={handleSubmit}>
                {submitSubmitting ? 'Memproses...' : 'Ajukan untuk Persetujuan'}
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
