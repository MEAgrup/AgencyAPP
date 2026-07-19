'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  BRIEF_DIVISIONS,
  PRIORITIES,
  STRATEGY_APPROVED,
  createBrief,
  createStrategy,
  isAccountLead,
  isAccountStaff,
  isReadOnlyOD,
  listServiceBriefs,
  listStrategies,
  setStrategyRequirement,
  type Brief,
  type Strategy,
} from '@/lib/account';
import StatusBadge from '@/components/StatusBadge';

export default function ServiceHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();
  const readOnly = isReadOnlyOD(role);
  // Write forms (create Strategy/Brief, requirement override) belong to the
  // Account division (owner AM/lead) or Director — strategy.go:220-223,
  // brief.go:219-222. Execution-division staff/leads see this hub read-only;
  // owner-AM check stays server-side (final authority, CLAUDE.md #6).
  const canWrite =
    !readOnly && (isAccountStaff(role) || isAccountLead(role) || !!role?.director);

  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [strategyError, setStrategyError] = useState<string | null>(null);

  // Create Strategy form
  const [sObjective, setSObjective] = useState('');
  const [sKpi, setSKpi] = useState('');
  const [sDivisions, setSDivisions] = useState<string[]>([]);
  const [sOutline, setSOutline] = useState('');
  const [sStart, setSStart] = useState('');
  const [sEnd, setSEnd] = useState('');
  const [sSubmitting, setSSubmitting] = useState(false);
  const [sError, setSError] = useState<string | null>(null);

  // Strategy requirement override
  const [reqValue, setReqValue] = useState(false);
  const [reqReason, setReqReason] = useState('');
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);
  const [reqMessage, setReqMessage] = useState<string | null>(null);

  // Create Brief form
  const [bTitle, setBTitle] = useState('');
  const [bDivision, setBDivision] = useState<string>(BRIEF_DIVISIONS[0]);
  const [bPic, setBPic] = useState('');
  const [bDeliverable, setBDeliverable] = useState('');
  const [bQty, setBQty] = useState('');
  const [bDue, setBDue] = useState('');
  const [bPriority, setBPriority] = useState<string>(PRIORITIES[1]);
  const [bRecurring, setBRecurring] = useState(false);
  const [bFreq, setBFreq] = useState('');
  const [bCount, setBCount] = useState('');
  const [bEnd, setBEnd] = useState('');
  const [bInstructions, setBInstructions] = useState('');
  const [bRefs, setBRefs] = useState('');
  const [bAddendum, setBAddendum] = useState(false);
  const [bSubmitting, setBSubmitting] = useState(false);
  const [bError, setBError] = useState<string | null>(null);
  const [bMessage, setBMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listServiceBriefs(id);
      setBriefs(res.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadStrategy = useCallback(async () => {
    setStrategyError(null);
    try {
      const res = await listStrategies();
      setStrategy(res.data.find((s) => s.service_id === id) ?? null);
    } catch (err) {
      setStrategyError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    load();
    loadStrategy();
  }, [load, loadStrategy]);

  function toggleSDivision(div: string) {
    setSDivisions((prev) => (prev.includes(div) ? prev.filter((d) => d !== div) : [...prev, div]));
  }

  async function handleCreateStrategy(e: FormEvent) {
    e.preventDefault();
    setSError(null);
    setSSubmitting(true);
    try {
      const res = await createStrategy(id, {
        objective: sObjective,
        target_kpi: sKpi,
        divisions_involved: sDivisions,
        planned_brief_outline: sOutline,
        timeline_start: sStart,
        timeline_end: sEnd,
      });
      setStrategy(res);
      await loadStrategy();
    } catch (err) {
      setSError(errorMessage(err));
    } finally {
      setSSubmitting(false);
    }
  }

  async function handleOverride(e: FormEvent) {
    e.preventDefault();
    setReqError(null);
    setReqMessage(null);
    setReqSubmitting(true);
    try {
      const res = await setStrategyRequirement(id, reqValue, reqReason);
      setReqMessage(
        `Kebutuhan Strategy & Plan diset ke ${res.requires_strategy_plan ? 'wajib' : 'tidak wajib'} (pin MSL: ${res.pinned_requires_strategy_plan ? 'wajib' : 'tidak wajib'}).`,
      );
      setReqReason('');
    } catch (err) {
      setReqError(errorMessage(err));
    } finally {
      setReqSubmitting(false);
    }
  }

  const planGated = strategy !== null; // a Strategy row exists for this Service
  const approvedStrategy = strategy?.status === STRATEGY_APPROVED ? strategy : null;

  async function handleCreateBrief(e: FormEvent) {
    e.preventDefault();
    setBError(null);
    setBMessage(null);
    setBSubmitting(true);
    try {
      const res = await createBrief(id, {
        title: bTitle,
        // Plan-gated: locked to the APPROVED Strategy only (brief gotcha #6,
        // ErrBriefStrategyMismatch) — never fall back to a non-approved draft.
        strategy_id: planGated ? (approvedStrategy?.id ?? '') : '',
        assigned_division: bDivision,
        assigned_pic: bPic || undefined,
        deliverable_type: bDeliverable,
        quantity_target: Number(bQty),
        due_date: bDue,
        priority: bPriority,
        recurring: bRecurring,
        recurring_frequency: bRecurring ? bFreq : undefined,
        recurring_count: bRecurring ? Number(bCount) : undefined,
        recurring_end_date: bRecurring ? bEnd : undefined,
        instructions: bInstructions || undefined,
        reference_attachments: bRefs || undefined,
        is_addendum: planGated ? bAddendum : undefined,
      });
      setBMessage(`Brief ${res.id} berhasil dibuat.`);
      setBTitle('');
      setBDeliverable('');
      setBQty('');
      setBDue('');
      setBPic('');
      setBInstructions('');
      setBRefs('');
      setBAddendum(false);
      await load();
    } catch (err) {
      setBError(errorMessage(err));
    } finally {
      setBSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || briefs === null) {
    return (
      <div className="stack">
        <Link href="/account" className="muted">&larr; Kembali ke Account</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Layanan tidak ditemukan.'}</div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <Link href="/account" className="muted">&larr; Kembali ke Account</Link>
      </div>

      <div>
        <h1>Layanan {id}</h1>
        <p className="muted">Kelola Strategy &amp; Plan dan Brief untuk layanan ini (M6 §4/§5).</p>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Strategy &amp; Plan</h2>
        </div>
        {strategyError && <div className="alert alertError" role="alert">{strategyError}</div>}
        {strategy ? (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <Link href={`/account/strategies/${strategy.id}`}>{strategy.id}</Link>
              <div className="muted" style={{ fontSize: 12 }}>{strategy.objective || '—'}</div>
            </div>
            <StatusBadge status={strategy.status} />
          </div>
        ) : (
          <p className="muted">Belum ada Strategy &amp; Plan untuk layanan ini.</p>
        )}
      </section>

      {!strategy && canWrite && (
        <section className="card">
          <div className="cardHeader">
            <h2>Buat Strategy &amp; Plan</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Hanya untuk layanan plan-gated yang masih berstatus [Awaiting Onboarding].
          </p>
          <form className="form" onSubmit={handleCreateStrategy}>
            {sError && <div className="alert alertError" role="alert">{sError}</div>}
            <div className="field">
              <label htmlFor="cs-objective">Objective</label>
              <textarea id="cs-objective" required value={sObjective} onChange={(e) => setSObjective(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="cs-kpi">Target KPI</label>
              <textarea id="cs-kpi" required value={sKpi} onChange={(e) => setSKpi(e.target.value)} />
            </div>
            <div className="field">
              <label>Divisi Terlibat (min. 1)</label>
              <div className="stack" style={{ gap: 6 }}>
                {BRIEF_DIVISIONS.map((div) => (
                  <label key={div} className="row" style={{ gap: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={sDivisions.includes(div)} onChange={() => toggleSDivision(div)} />
                    {div}
                  </label>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="cs-outline">Outline Brief Terencana</label>
              <textarea id="cs-outline" required value={sOutline} onChange={(e) => setSOutline(e.target.value)} />
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="cs-start">Timeline Mulai</label>
                <input id="cs-start" type="date" required value={sStart} onChange={(e) => setSStart(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="cs-end">Timeline Selesai</label>
                <input id="cs-end" type="date" required value={sEnd} onChange={(e) => setSEnd(e.target.value)} />
              </div>
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={sSubmitting}>
                {sSubmitting ? 'Menyimpan...' : 'Buat Strategy & Plan'}
              </button>
            </div>
          </form>
        </section>
      )}

      {!strategy && canWrite && (
        <section className="card">
          <div className="cardHeader">
            <h2>Override Kebutuhan Strategy &amp; Plan</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Hanya bisa saat belum ada Strategy &amp; Plan dan layanan masih [Awaiting Onboarding]. Alasan wajib.
          </p>
          <form className="form" onSubmit={handleOverride}>
            {reqError && <div className="alert alertError" role="alert">{reqError}</div>}
            {reqMessage && <div className="alert alertSuccess" role="status">{reqMessage}</div>}
            <label className="row" style={{ gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={reqValue} onChange={(e) => setReqValue(e.target.checked)} />
              Wajib memiliki Strategy &amp; Plan
            </label>
            <div className="field">
              <label htmlFor="req-reason">Alasan</label>
              <input id="req-reason" required value={reqReason} onChange={(e) => setReqReason(e.target.value)} />
            </div>
            <div>
              <button type="submit" className="btn btnSecondary" disabled={reqSubmitting}>
                {reqSubmitting ? 'Menyimpan...' : 'Simpan Override'}
              </button>
            </div>
          </form>
        </section>
      )}

      {canWrite && (
        <section className="card">
          <div className="cardHeader">
            <h2>Buat Brief</h2>
          </div>
          <form className="form" onSubmit={handleCreateBrief}>
            {bError && <div className="alert alertError" role="alert">{bError}</div>}
            {bMessage && <div className="alert alertSuccess" role="status">{bMessage}</div>}
            <div className="field">
              <label htmlFor="b-title">Judul</label>
              <input id="b-title" required value={bTitle} onChange={(e) => setBTitle(e.target.value)} />
            </div>
            {planGated ? (
              <div className="field">
                <label htmlFor="b-strategy">Strategy ID (plan-gated, terkunci)</label>
                <input
                  id="b-strategy"
                  readOnly
                  value={approvedStrategy?.id ?? ''}
                />
                {!approvedStrategy && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    Strategy &amp; Plan belum disetujui &mdash; Brief hanya dapat dibuat setelah disetujui.
                  </span>
                )}
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 12 }}>Layanan Direct-path &mdash; tanpa Strategy ID.</p>
            )}
            <div className="formRow">
              <div className="field">
                <label htmlFor="b-division">Divisi Tujuan</label>
                <select id="b-division" value={bDivision} onChange={(e) => setBDivision(e.target.value)}>
                  {BRIEF_DIVISIONS.map((div) => (
                    <option key={div} value={div}>{div}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="b-pic">PIC (opsional, Employee ID)</label>
                <input id="b-pic" value={bPic} onChange={(e) => setBPic(e.target.value)} />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="b-deliverable">Deliverable Type</label>
                <input id="b-deliverable" required value={bDeliverable} onChange={(e) => setBDeliverable(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="b-qty">Quantity / Target</label>
                <input id="b-qty" type="number" min="1" required value={bQty} onChange={(e) => setBQty(e.target.value)} />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="b-due">Due Date</label>
                <input id="b-due" type="date" required value={bDue} onChange={(e) => setBDue(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="b-priority">Prioritas</label>
                <select id="b-priority" value={bPriority} onChange={(e) => setBPriority(e.target.value)}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
            <label className="row" style={{ gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={bRecurring} onChange={(e) => setBRecurring(e.target.checked)} />
              Brief berulang (recurring)
            </label>
            {bRecurring && (
              <div className="formRow">
                <div className="field">
                  <label htmlFor="b-freq">Frekuensi</label>
                  <input id="b-freq" required value={bFreq} onChange={(e) => setBFreq(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="b-count">Jumlah</label>
                  <input id="b-count" type="number" min="1" required value={bCount} onChange={(e) => setBCount(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="b-recur-end">Tanggal Berakhir</label>
                  <input id="b-recur-end" type="date" required value={bEnd} onChange={(e) => setBEnd(e.target.value)} />
                </div>
              </div>
            )}
            <div className="field">
              <label htmlFor="b-instructions">Instruksi (opsional)</label>
              <textarea id="b-instructions" value={bInstructions} onChange={(e) => setBInstructions(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="b-refs">Referensi / Lampiran (link, opsional)</label>
              <input id="b-refs" value={bRefs} onChange={(e) => setBRefs(e.target.value)} />
            </div>
            {planGated && (
              <label className="row" style={{ gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={bAddendum} onChange={(e) => setBAddendum(e.target.checked)} />
                Ini penambahan di luar outline Plan (addendum)
              </label>
            )}
            <div>
              <button
                type="submit"
                className="btn btnPrimary"
                disabled={bSubmitting || (planGated && !approvedStrategy)}
              >
                {bSubmitting ? 'Membuat...' : 'Buat Brief'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Daftar Brief</h2>
        </div>
        {briefs.length === 0 ? (
          <div className="emptyState">Belum ada Brief untuk layanan ini.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Brief ID</th>
                  <th>Judul</th>
                  <th>Divisi</th>
                  <th>Deliverable</th>
                  <th>Due</th>
                  <th>Prioritas</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {briefs.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/account/briefs/${b.id}`}>{b.id}</Link>
                    </td>
                    <td>{b.title}</td>
                    <td>{b.assigned_division}</td>
                    <td>{b.deliverable_type}</td>
                    <td>{b.due_date || '—'}</td>
                    <td>{b.priority}</td>
                    <td><StatusBadge status={b.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
