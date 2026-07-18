'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { formatIDR } from '@/lib/money';
import { useAuth } from '@/lib/auth-context';
import {
  CHANGE_TYPE_OPTIONS,
  ENTRY_METHOD_OPTIONS,
  campaignBadgeTone,
  createMetric,
  createOptimization,
  endCampaign,
  getBrief,
  getCampaign,
  isRoasTarget,
  launchCampaign,
  linkAsset,
  listMetrics,
  listOptimizations,
  pauseCampaign,
  unlinkAsset,
  type AdsBrief,
  type Campaign,
  type MetricEntry,
  type Optimization,
} from '@/lib/ads';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID');
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

export default function AdCampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();

  const canManage = Boolean(
    role && ((role.division === 'ads' && (role.level === 'staff' || role.level === 'lead')) || role.director),
  );
  // Optimization may also be logged by the owning AM (m8 brief §1.11); backend is
  // the final authority, so we show the form to Account too and let it 403 if not owner.
  const canLogOptimization = canManage || Boolean(role && role.division === 'account');

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [brief, setBrief] = useState<AdsBrief | null>(null);

  const [metrics, setMetrics] = useState<MetricEntry[]>([]);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [optimizations, setOptimizations] = useState<Optimization[]>([]);
  const [optimizationsError, setOptimizationsError] = useState<string | null>(null);

  // Lifecycle (mutually-exclusive buttons → one error slot + a pending-action tag).
  const [lifecyclePending, setLifecyclePending] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  // Link / unlink creative asset
  const [linkAssetId, setLinkAssetId] = useState('');
  const [linkSubmitting, setLinkSubmitting] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [unlinkPendingId, setUnlinkPendingId] = useState<string | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  // Metric Entry
  const [mPeriodStart, setMPeriodStart] = useState('');
  const [mPeriodEnd, setMPeriodEnd] = useState('');
  const [mSpend, setMSpend] = useState('');
  const [mGmv, setMGmv] = useState('');
  const [mCtr, setMCtr] = useState('');
  const [mCvr, setMCvr] = useState('');
  const [mEntryMethod, setMEntryMethod] = useState<string>(ENTRY_METHOD_OPTIONS[0]);
  const [metricSubmitting, setMetricSubmitting] = useState(false);
  const [metricError, setMetricError] = useState<string | null>(null);
  const [metricMessage, setMetricMessage] = useState<string | null>(null);

  // Optimization Log
  const [oChangeType, setOChangeType] = useState<string>(CHANGE_TYPE_OPTIONS[0]);
  const [oBefore, setOBefore] = useState('');
  const [oAfter, setOAfter] = useState('');
  const [oReason, setOReason] = useState('');
  const [oOldAsset, setOOldAsset] = useState('');
  const [oNewAsset, setONewAsset] = useState('');
  const [optSubmitting, setOptSubmitting] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);
  const [optMessage, setOptMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const c = await getCampaign(id);
      setCampaign(c);
      // Best-effort parent-brief context for the launch guardrail; never blocks the page.
      try {
        const b = await getBrief(c.brief_id);
        setBrief(b);
      } catch {
        setBrief(null);
      }
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadMetrics = useCallback(async () => {
    setMetricsError(null);
    try {
      const res = await listMetrics(id);
      setMetrics(res.data);
    } catch (err) {
      setMetricsError(errorMessage(err));
    }
  }, [id]);

  const loadOptimizations = useCallback(async () => {
    setOptimizationsError(null);
    try {
      const res = await listOptimizations(id);
      setOptimizations(res.data);
    } catch (err) {
      setOptimizationsError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    load();
    loadMetrics();
    loadOptimizations();
  }, [load, loadMetrics, loadOptimizations]);

  async function runLifecycle(action: string, fn: () => Promise<unknown>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setLifecycleError(null);
    setLifecyclePending(action);
    try {
      await fn();
      await load();
    } catch (err) {
      setLifecycleError(errorMessage(err));
    } finally {
      setLifecyclePending(null);
    }
  }

  async function handleLink(e: FormEvent) {
    e.preventDefault();
    setLinkError(null);
    setLinkSubmitting(true);
    try {
      await linkAsset(id, linkAssetId.trim());
      setLinkAssetId('');
      await load();
    } catch (err) {
      setLinkError(errorMessage(err));
    } finally {
      setLinkSubmitting(false);
    }
  }

  async function handleUnlink(assetId: string) {
    if (!window.confirm(`Lepas tautan aset kreatif "${assetId}" dari kampanye ini?`)) return;
    setUnlinkError(null);
    setUnlinkPendingId(assetId);
    try {
      await unlinkAsset(id, assetId);
      await load();
    } catch (err) {
      setUnlinkError(errorMessage(err));
    } finally {
      setUnlinkPendingId(null);
    }
  }

  async function handleMetric(e: FormEvent) {
    e.preventDefault();
    setMetricError(null);
    setMetricMessage(null);
    setMetricSubmitting(true);
    try {
      await createMetric(id, {
        period_start: mPeriodStart,
        period_end: mPeriodEnd,
        spend: mSpend,
        gmv: mGmv,
        ctr: mCtr.trim() === '' ? null : Number(mCtr),
        cvr: mCvr.trim() === '' ? null : Number(mCvr),
        entry_method: mEntryMethod,
      });
      setMetricMessage('Metric entry berhasil dicatat.');
      setMSpend('');
      setMGmv('');
      setMCtr('');
      setMCvr('');
      await load();
      await loadMetrics();
    } catch (err) {
      setMetricError(errorMessage(err));
    } finally {
      setMetricSubmitting(false);
    }
  }

  const isCreativeSwap = oChangeType === 'Creative Swap';

  // Budget guardrail UX hint (M8-OA-3): |after-before|/before > 50% needs AM/SPV
  // Ads/Director sign-off; an invalid/<=0 before is treated as >50% server-side.
  const budgetNeedsSignoff =
    oChangeType === 'Budget' &&
    (() => {
      const before = Number(oBefore);
      const after = Number(oAfter);
      if (oBefore.trim() === '' || Number.isNaN(before) || before <= 0) return true;
      if (oAfter.trim() === '' || Number.isNaN(after)) return false;
      return Math.abs(after - before) / before > 0.5;
    })();

  async function handleOptimization(e: FormEvent) {
    e.preventDefault();
    setOptError(null);
    setOptMessage(null);
    setOptSubmitting(true);
    try {
      await createOptimization(id, {
        change_type: oChangeType,
        before_value: isCreativeSwap ? '' : oBefore,
        after_value: isCreativeSwap ? '' : oAfter,
        reason: oReason,
        old_asset_id: isCreativeSwap ? oOldAsset : '',
        new_asset_id: isCreativeSwap ? oNewAsset : '',
      });
      setOptMessage('Optimization berhasil dicatat.');
      setOBefore('');
      setOAfter('');
      setOReason('');
      setOOldAsset('');
      setONewAsset('');
      await load(); // refresh optimization_count + linkage after a Creative Swap
      await loadOptimizations();
    } catch (err) {
      setOptError(errorMessage(err));
    } finally {
      setOptSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !campaign) {
    return (
      <div className="stack">
        <Link href="/ads" className="muted">&larr; Kembali ke Ads</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Kampanye iklan tidak ditemukan.'}</div>
      </div>
    );
  }

  const roasTyped = isRoasTarget(campaign.target_kpi);
  const isPaused = campaign.status === '[Paused]';
  const isActive = campaign.status === '[Active]';
  const isEnded = campaign.status === '[Ended]';
  const hasLinkedAssets = campaign.linked_asset_ids.length > 0;

  return (
    <div className="stack">
      <div>
        <Link href="/ads" className="muted">&larr; Kembali ke Ads</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{campaign.id}</h1>
          <p className="muted">
            Klien: <Link href={`/clients/${campaign.client_id}`}>{campaign.client_id}</Link>
            {' '}&middot; Brief: {campaign.brief_id}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {roasTyped && campaign.escalation_flagged && (
            <span className="badge badge-red">ROAS di bawah target 2+ periode</span>
          )}
          <span className={`badge badge-${campaignBadgeTone(campaign.status)}`}>{campaign.status}</span>
        </div>
      </div>

      {/* Detail kampanye */}
      <section className="card">
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Platform</div>
            <div>{campaign.platform}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Objective</div>
            <div>{campaign.objective}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Budget</div>
            <div>{campaign.budget_display}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Target KPI</div>
            <div>{campaign.target_kpi}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Tanggal Mulai</div>
            <div>{formatDate(campaign.start_date)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Tanggal Selesai</div>
            <div>{formatDate(campaign.end_date)}</div>
          </div>
        </div>
      </section>

      {/* Metrik computed read-only */}
      <section className="card">
        <div className="cardHeader">
          <h2>Metrik <span className="muted" style={{ fontSize: 12 }} title="Auto-calculated dari Metric Entry, tidak dapat diubah">🔒 read-only</span></h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Total Spend</div>
            <div>{campaign.total_spend_display}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Total GMV</div>
            <div>{campaign.total_gmv_display}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>ROAS</div>
            <div>{campaign.roas_display}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Jumlah Metric Entry</div>
            <div>{campaign.metric_entry_count}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Jumlah Optimasi</div>
            <div>{campaign.optimization_count}</div>
          </div>
          {roasTyped && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Periode ROAS di Bawah Target (beruntun)</div>
              <div>{campaign.underperforming_streak}</div>
            </div>
          )}
        </div>
      </section>

      {/* Aset kreatif tertaut + guardrail launch */}
      <section className="card">
        <div className="cardHeader">
          <h2>Aset Kreatif Tertaut</h2>
        </div>

        {isPaused && !hasLinkedAssets && (
          <div className="alert alertError" role="alert">
            Belum ada aset kreatif tertaut. Kampanye tidak dapat diluncurkan sebelum minimal satu aset
            kreatif [Approved] ditautkan.
          </div>
        )}
        {isPaused && brief && brief.status !== '[Approved]' && (
          <div className="alert alertError" role="alert">
            Brief setup ({brief.id}) berstatus {brief.status} &mdash; kampanye tidak dapat diluncurkan
            sebelum brief [Approved].
          </div>
        )}

        {campaign.linked_asset_ids.length === 0 ? (
          <div className="emptyState">Belum ada aset kreatif tertaut.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Asset ID</th>
                  {canManage && <th>Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {campaign.linked_asset_ids.map((assetId) => (
                  <tr key={assetId}>
                    <td>{assetId}</td>
                    {canManage && (
                      <td>
                        <button
                          type="button"
                          className="btn btnGhost btnSm"
                          disabled={unlinkPendingId === assetId}
                          onClick={() => handleUnlink(assetId)}
                        >
                          {unlinkPendingId === assetId ? 'Memproses...' : 'Lepas Tautan'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {unlinkError && <div className="alert alertError" role="alert">{unlinkError}</div>}

        {canManage && !isEnded && (
          <form className="form" onSubmit={handleLink} style={{ marginTop: 12 }}>
            {linkError && <div className="alert alertError" role="alert">{linkError}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="link-asset">Tautkan Aset (Asset ID [Approved] milik klien yang sama)</label>
                <input
                  id="link-asset"
                  placeholder="AST-202607-0001"
                  required
                  value={linkAssetId}
                  onChange={(e) => setLinkAssetId(e.target.value)}
                />
              </div>
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={linkSubmitting}>
                {linkSubmitting ? 'Menautkan...' : 'Tautkan Aset'}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Aksi lifecycle */}
      {canManage && !isEnded && (
        <section className="card">
          <div className="cardHeader">
            <h2>Aksi Kampanye</h2>
          </div>
          {lifecycleError && <div className="alert alertError" role="alert">{lifecycleError}</div>}
          <div className="row" style={{ gap: 10 }}>
            {isPaused && (
              <button
                type="button"
                className="btn btnPrimary"
                disabled={lifecyclePending !== null}
                onClick={() => runLifecycle('launch', () => launchCampaign(id))}
              >
                {lifecyclePending === 'launch' ? 'Memproses...' : 'Luncurkan / Resume'}
              </button>
            )}
            {isActive && (
              <button
                type="button"
                className="btn btnSecondary"
                disabled={lifecyclePending !== null}
                onClick={() => runLifecycle('pause', () => pauseCampaign(id))}
              >
                {lifecyclePending === 'pause' ? 'Memproses...' : 'Jeda (Pause)'}
              </button>
            )}
            <button
              type="button"
              className="btn btnDanger"
              disabled={lifecyclePending !== null}
              onClick={() =>
                runLifecycle('end', () => endCampaign(id), 'Akhiri kampanye ini? Status [Ended] bersifat final dan tidak dapat dibatalkan.')
              }
            >
              {lifecyclePending === 'end' ? 'Memproses...' : 'Akhiri (End)'}
            </button>
          </div>
        </section>
      )}

      {/* Metric Entry */}
      <section className="card">
        <div className="cardHeader">
          <h2>Metric Entry</h2>
        </div>

        {canManage && (
          <form className="form" onSubmit={handleMetric}>
            {metricError && <div className="alert alertError" role="alert">{metricError}</div>}
            {metricMessage && <div className="alert alertSuccess" role="status">{metricMessage}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="m-start">Periode Mulai</label>
                <input id="m-start" type="date" required value={mPeriodStart} onChange={(e) => setMPeriodStart(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="m-end">Periode Selesai</label>
                <input id="m-end" type="date" required value={mPeriodEnd} onChange={(e) => setMPeriodEnd(e.target.value)} />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="m-spend">Spend (Rp)</label>
                <input id="m-spend" type="number" min="0" step="0.01" required value={mSpend} onChange={(e) => setMSpend(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="m-gmv">GMV dari Ads (Rp)</label>
                <input id="m-gmv" type="number" min="0" step="0.01" required value={mGmv} onChange={(e) => setMGmv(e.target.value)} />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="m-ctr">CTR % (opsional)</label>
                <input id="m-ctr" type="number" step="0.01" value={mCtr} onChange={(e) => setMCtr(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="m-cvr">CVR % (opsional)</label>
                <input id="m-cvr" type="number" step="0.01" value={mCvr} onChange={(e) => setMCvr(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="m-method">Metode Input</label>
                <select id="m-method" value={mEntryMethod} onChange={(e) => setMEntryMethod(e.target.value)}>
                  {ENTRY_METHOD_OPTIONS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={metricSubmitting}>
                {metricSubmitting ? 'Menyimpan...' : 'Catat Metric Entry'}
              </button>
            </div>
          </form>
        )}

        {metricsError && <div className="alert alertError" role="alert">{metricsError}</div>}
        {metrics.length === 0 ? (
          <div className="emptyState">Belum ada metric entry.</div>
        ) : (
          <div className="table-wrap" style={{ marginTop: canManage ? 12 : 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Periode</th>
                  <th>Spend</th>
                  <th>GMV</th>
                  <th>Metode</th>
                  <th>Dicatat Oleh</th>
                  <th>Waktu</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => (
                  <tr key={m.id}>
                    <td>{m.id}</td>
                    <td>{formatDate(m.period_start)} &ndash; {formatDate(m.period_end)}</td>
                    <td>{formatIDR(m.spend)}</td>
                    <td>{formatIDR(m.gmv)}</td>
                    <td>{m.entry_method}</td>
                    <td>{m.entered_by || '—'}</td>
                    <td>{formatDateTime(m.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Optimization Log */}
      <section className="card">
        <div className="cardHeader">
          <h2>Optimization Log</h2>
        </div>

        {canLogOptimization && !isEnded && (
          <form className="form" onSubmit={handleOptimization}>
            {optError && <div className="alert alertError" role="alert">{optError}</div>}
            {optMessage && <div className="alert alertSuccess" role="status">{optMessage}</div>}
            {budgetNeedsSignoff && (
              <div className="alert alertInfo" role="status">
                Penyesuaian budget lebih dari 50% memerlukan persetujuan AM/SPV Ads. Advertiser biasa
                akan ditolak server.
              </div>
            )}
            <div className="formRow">
              <div className="field">
                <label htmlFor="o-type">Jenis Perubahan</label>
                <select id="o-type" value={oChangeType} onChange={(e) => setOChangeType(e.target.value)}>
                  {CHANGE_TYPE_OPTIONS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            {isCreativeSwap ? (
              <div className="formRow">
                <div className="field">
                  <label htmlFor="o-old-asset">Aset Lama (tertaut)</label>
                  <select id="o-old-asset" required value={oOldAsset} onChange={(e) => setOOldAsset(e.target.value)}>
                    <option value="">Pilih aset...</option>
                    {campaign.linked_asset_ids.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="o-new-asset">Aset Baru (Asset ID [Approved] klien yang sama)</label>
                  <input
                    id="o-new-asset"
                    placeholder="AST-202607-0002"
                    required
                    value={oNewAsset}
                    onChange={(e) => setONewAsset(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="formRow">
                <div className="field">
                  <label htmlFor="o-before">Nilai Sebelum</label>
                  <input id="o-before" required value={oBefore} onChange={(e) => setOBefore(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="o-after">Nilai Sesudah</label>
                  <input id="o-after" required value={oAfter} onChange={(e) => setOAfter(e.target.value)} />
                </div>
              </div>
            )}

            <div className="field">
              <label htmlFor="o-reason">Alasan</label>
              <input id="o-reason" required value={oReason} onChange={(e) => setOReason(e.target.value)} />
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={optSubmitting}>
                {optSubmitting ? 'Menyimpan...' : 'Catat Optimasi'}
              </button>
            </div>
          </form>
        )}

        {optimizationsError && <div className="alert alertError" role="alert">{optimizationsError}</div>}
        {optimizations.length === 0 ? (
          <div className="emptyState">Belum ada catatan optimasi.</div>
        ) : (
          <div className="table-wrap" style={{ marginTop: canLogOptimization ? 12 : 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Jenis</th>
                  <th>Sebelum &rarr; Sesudah</th>
                  <th>Alasan</th>
                  <th>Aktor</th>
                  <th>Waktu</th>
                </tr>
              </thead>
              <tbody>
                {optimizations.map((o) => (
                  <tr key={o.id}>
                    <td>{o.id}</td>
                    <td>{o.change_type}</td>
                    <td>{o.before_value || '—'} &rarr; {o.after_value || '—'}</td>
                    <td>{o.reason}</td>
                    <td>{o.actor}</td>
                    <td>{formatDateTime(o.created_at)}</td>
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
