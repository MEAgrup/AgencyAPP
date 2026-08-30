'use client';

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { SOURCES } from '@/lib/leads';
import {
  listSalesTargets,
  METRIC_KEYS,
  METRIC_LABELS,
  metricNeedsParam,
  salesPerfByMonth,
  salesPerfBySalesperson,
  salesPerfBySource,
  setSalesTarget,
  type LeadSourceRow,
  type MetricKey,
  type SalesPerfMonthRow,
  type SalesPerfRow,
  type SalesTarget,
} from '@/lib/salesperf';

type Tab = 'sales' | 'bulan' | 'sumber' | 'target';

/** "—" for a null ratio/day/money field — the server already decided division-by-zero, never recompute. */
function dash(v: string | number | null): string {
  return v === null ? '—' : String(v);
}

/** Renders a metric-keyed OKR value in its own unit: Rupiah when the server sent an `_idr` sibling, a percentage for the ratio metric, a plain count otherwise. Never re-derives the unit from the metric_key string itself — that stays server-decided. */
function formatMetricValue(value: string | null, valueIdr: string | null, metricKey: string): string {
  if (value === null) return '—';
  if (valueIdr !== null) return valueIdr;
  return metricKey === 'closing_ratio_qualified_pct' ? `${Number(value)}%` : String(Number(value));
}

export default function KinerjaSalesPage() {
  const { role } = useAuth();
  const canView = !!(role?.director || role?.od || (role?.division ?? '').toLowerCase() === 'sales');
  const canManageTarget = !!(role?.director || role?.od);

  const [tab, setTab] = useState<Tab>('sales');
  const [from, setFrom] = useState(''); // "YYYY-MM"
  const [to, setTo] = useState('');
  const [salesperson, setSalesperson] = useState('');
  const [source, setSource] = useState('');

  const [salesRows, setSalesRows] = useState<SalesPerfRow[]>([]);
  const [monthRows, setMonthRows] = useState<SalesPerfMonthRow[]>([]);
  const [sourceRows, setSourceRows] = useState<LeadSourceRow[]>([]);
  const [targets, setTargets] = useState<SalesTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filter = { from: from || undefined, to: to || undefined, salesperson: salesperson || undefined, source: source || undefined };

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (tab === 'sales') {
        setSalesRows((await salesPerfBySalesperson(filter)).data);
      } else if (tab === 'bulan') {
        setMonthRows((await salesPerfByMonth(filter)).data);
      } else if (tab === 'sumber') {
        setSourceRows((await salesPerfBySource(filter)).data);
      } else if (tab === 'target') {
        const periodStart = from ? `${from}-01` : `${new Date().toISOString().slice(0, 7)}-01`;
        setTargets((await listSalesTargets(periodStart)).data);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, tab, from, to, salesperson, source]);

  useEffect(() => {
    load();
  }, [load]);

  // --- Target edit form (Director/OD only) ---
  const [editSalesperson, setEditSalesperson] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editKind, setEditKind] = useState<'bulan' | 'kuartal' | 'tahun'>('bulan');
  const [editMetric, setEditMetric] = useState<MetricKey>('omzet');
  const [editParam, setEditParam] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function handleSetTarget(e: React.FormEvent) {
    e.preventDefault();
    setEditError(null);
    setEditSubmitting(true);
    try {
      const periodStart = editKind === 'tahun'
        ? `${(from || new Date().toISOString().slice(0, 7)).slice(0, 4)}-01-01`
        : from ? `${from}-01` : `${new Date().toISOString().slice(0, 7)}-01`;
      await setSalesTarget({
        salesperson_id: editSalesperson,
        period_start: periodStart,
        period_kind: editKind,
        metric_key: editMetric,
        metric_param: metricNeedsParam(editMetric) ? editParam : undefined,
        target_value: editAmount,
      });
      setEditSalesperson('');
      setEditAmount('');
      setEditParam('');
      await load();
    } catch (err) {
      setEditError(errorMessage(err));
    } finally {
      setEditSubmitting(false);
    }
  }

  if (!canView) {
    return (
      <div className="stack">
        <div>
          <h1>Kinerja Sales</h1>
          <p className="muted">Dashboard M0 §7.1: closing rate, deal cycle, lead per sumber, dan OKR per sales.</p>
        </div>
        <section className="card">
          <div className="alert alertError" role="alert">Anda tidak memiliki akses ke data ini.</div>
        </section>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h1>Kinerja Sales</h1>
        <p className="muted">
          Dashboard M0 §7.1: closing rate, deal cycle, lead per sumber, dan OKR per sales. Sales staff
          otomatis hanya melihat barisnya sendiri — server yang membatasi.
        </p>
      </div>

      <section className="card">
        <div className="cardHeader">
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={`btn btnSm ${tab === 'sales' ? 'btnPrimary' : 'btnSecondary'}`} onClick={() => setTab('sales')}>Per Sales</button>
            <button className={`btn btnSm ${tab === 'bulan' ? 'btnPrimary' : 'btnSecondary'}`} onClick={() => setTab('bulan')}>Per Bulan</button>
            <button className={`btn btnSm ${tab === 'sumber' ? 'btnPrimary' : 'btnSecondary'}`} onClick={() => setTab('sumber')}>Sumber Lead</button>
            <button className={`btn btnSm ${tab === 'target' ? 'btnPrimary' : 'btnSecondary'}`} onClick={() => setTab('target')}>Target</button>
          </div>
        </div>

        <div className="formRow" style={{ marginBottom: 16 }}>
          <div className="field">
            <label htmlFor="kinerja-from">Dari (bulan)</label>
            <input id="kinerja-from" type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="kinerja-to">Sampai (bulan)</label>
            <input id="kinerja-to" type="month" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {tab !== 'target' && (
            <div className="field">
              <label htmlFor="kinerja-sales">Sales (Employee ID)</label>
              <input
                id="kinerja-sales"
                type="text"
                placeholder="Kosongkan untuk semua"
                value={salesperson}
                onChange={(e) => setSalesperson(e.target.value)}
              />
            </div>
          )}
          {(tab === 'sales' || tab === 'bulan' || tab === 'sumber') && (
            <div className="field">
              <label htmlFor="kinerja-source">Sumber Lead</label>
              <select id="kinerja-source" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">Semua sumber</option>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}

        {!loading && !error && tab === 'sales' && (
          salesRows.length === 0 ? (
            <div className="emptyState">Tidak ada data untuk filter ini.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Sales</th><th>Level</th><th>Leads</th><th>Scouting</th><th>Contacted</th>
                    <th>Qualified</th><th>Non-Qualified</th><th>Negotiating</th><th>Closed</th><th>Lost</th>
                    <th>Closing Rate</th><th>Qualified Rate</th><th>Deal Cycle (hari)</th>
                    <th>Follow Up</th><th>Visit</th><th>Online Meeting</th>
                    <th>Klien Baru</th><th>Perpanjangan</th><th>Cross Sell</th>
                    <th>Omzet</th><th>Komisi Kontrak</th><th>Komisi Diakui</th>
                    <th>Target</th><th>Pencapaian</th><th>Sisa Target</th><th>MoM</th>
                  </tr>
                </thead>
                <tbody>
                  {salesRows.map((r) => (
                    <tr key={r.salesperson_id}>
                      <td>{r.nama} <span className="muted">({r.salesperson_id})</span></td>
                      <td>{r.level_sales}</td>
                      <td>{r.leads_registered}</td>
                      <td>{r.leads_scouting}</td>
                      <td>{r.contacted}</td>
                      <td>{r.qualified}</td>
                      <td>{r.non_qualified}</td>
                      <td>{r.negotiating}</td>
                      <td>{r.closed_success}</td>
                      <td>{r.closed_lost}</td>
                      <td>{dash(r.closing_rate_pct === null ? null : `${r.closing_rate_pct}%`)}</td>
                      <td>{dash(r.qualified_rate_pct === null ? null : `${r.qualified_rate_pct}%`)}</td>
                      <td>{dash(r.avg_deal_cycle_days)}</td>
                      <td>{r.effort_follow_up}</td>
                      <td>{r.effort_visit}</td>
                      <td>{r.effort_online_meeting}</td>
                      <td>{r.klien_baru}</td>
                      <td>{r.klien_perpanjangan}</td>
                      <td>{r.klien_cross_sell}</td>
                      <td>{r.omzet_idr}</td>
                      <td>{r.komisi_kontrak_idr}</td>
                      <td>{r.komisi_diakui_idr}</td>
                      <td>{dash(r.target_omzet_idr)}</td>
                      <td>{dash(r.pencapaian_pct === null ? null : `${r.pencapaian_pct}%`)}</td>
                      <td>{dash(r.sisa_target_idr)}</td>
                      <td>{dash(r.mom_pct === null ? null : `${r.mom_pct}%`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {!loading && !error && tab === 'bulan' && (
          monthRows.length === 0 ? (
            <div className="emptyState">Tidak ada data untuk filter ini.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Periode</th><th>Sales</th><th>Closing</th><th>Closing Rate</th>
                    <th>Deal Cycle (hari)</th><th>Omzet</th><th>Komisi Diakui</th><th>Pencapaian</th><th>MoM</th>
                  </tr>
                </thead>
                <tbody>
                  {monthRows.map((r) => (
                    <tr key={`${r.salesperson_id}-${r.period}`}>
                      <td>{r.period}</td>
                      <td>{r.nama}</td>
                      <td>{r.closed_success}</td>
                      <td>{dash(r.closing_rate_pct === null ? null : `${r.closing_rate_pct}%`)}</td>
                      <td>{dash(r.avg_deal_cycle_days)}</td>
                      <td>{r.omzet_idr}</td>
                      <td>{r.komisi_diakui_idr}</td>
                      <td>{dash(r.pencapaian_pct === null ? null : `${r.pencapaian_pct}%`)}</td>
                      <td>{dash(r.mom_pct === null ? null : `${r.mom_pct}%`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {!loading && !error && tab === 'sumber' && (
          sourceRows.length === 0 ? (
            <div className="emptyState">Tidak ada data untuk filter ini.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Periode</th><th>Sumber</th><th>Campaign</th><th>Leads</th>
                    <th>Qualified</th><th>Non-Qualified</th><th>Closing</th><th>Conversion Rate</th><th>Omzet</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceRows.map((r, i) => (
                    <tr key={`${r.period}-${r.source}-${r.campaign_id ?? ''}-${i}`}>
                      <td>{r.period}</td>
                      <td>{r.source}</td>
                      <td>{r.campaign_name ?? (r.campaign_id ?? '—')}</td>
                      <td>{r.leads}</td>
                      <td>{r.qualified}</td>
                      <td>{r.non_qualified}</td>
                      <td>{r.closing}</td>
                      <td>{dash(r.conversion_rate_pct === null ? null : `${r.conversion_rate_pct}%`)}</td>
                      <td>{r.omzet_idr}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {!loading && !error && tab === 'target' && (
          <>
            {canManageTarget && (
              <form onSubmit={handleSetTarget} className="formRow" style={{ marginBottom: 16 }}>
                <div className="field">
                  <label htmlFor="target-sales">Sales (Employee ID)</label>
                  <input id="target-sales" type="text" required value={editSalesperson} onChange={(e) => setEditSalesperson(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="target-kind">Jenis Periode</label>
                  <select id="target-kind" value={editKind} onChange={(e) => setEditKind(e.target.value as 'bulan' | 'kuartal' | 'tahun')}>
                    <option value="bulan">Bulanan</option>
                    <option value="kuartal">Kuartalan</option>
                    <option value="tahun">Tahunan</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="target-metric">Metrik OKR</label>
                  <select id="target-metric" value={editMetric} onChange={(e) => setEditMetric(e.target.value as MetricKey)}>
                    {METRIC_KEYS.map((k) => (
                      <option key={k} value={k}>{METRIC_LABELS[k]}</option>
                    ))}
                  </select>
                </div>
                {metricNeedsParam(editMetric) && (
                  <div className="field">
                    <label htmlFor="target-param">Ambang Nilai Kontrak (Rp)</label>
                    <input id="target-param" type="text" required placeholder="10000000" value={editParam} onChange={(e) => setEditParam(e.target.value)} />
                  </div>
                )}
                <div className="field">
                  <label htmlFor="target-amount">Nilai Target</label>
                  <input id="target-amount" type="text" required placeholder={editMetric === 'omzet' ? '10000000' : editMetric === 'closing_ratio_qualified_pct' ? '35' : '30'} value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                </div>
                <div className="field" style={{ alignSelf: 'flex-end' }}>
                  <button type="submit" className="btn btnPrimary btnSm" disabled={editSubmitting}>
                    {editSubmitting ? 'Menyimpan...' : 'Simpan Target'}
                  </button>
                </div>
              </form>
            )}
            {editError && <div className="alert alertError" role="alert">{editError}</div>}
            {targets.length === 0 ? (
              <div className="emptyState">Belum ada target untuk periode ini.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Sales</th><th>Periode</th><th>Jenis</th><th>Metrik</th>
                      <th>Ambang</th><th>Target</th><th>Realisasi</th><th>Pencapaian</th><th>Diperbarui</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targets.map((t) => (
                      <tr key={`${t.salesperson_id}-${t.period_start}-${t.period_kind}-${t.metric_key}`}>
                        <td>{t.salesperson_id}</td>
                        <td>{t.period_start}</td>
                        <td>{t.period_kind}</td>
                        <td>{METRIC_LABELS[t.metric_key as MetricKey] ?? t.metric_key}</td>
                        <td>{t.metric_param_idr ?? '—'}</td>
                        <td>{formatMetricValue(t.target_value, t.target_value_idr, t.metric_key)}</td>
                        <td>{formatMetricValue(t.actual_value, t.actual_value_idr, t.metric_key)}</td>
                        <td>{dash(t.achieved_pct === null ? null : `${t.achieved_pct}%`)}</td>
                        <td>{t.updated_by}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
