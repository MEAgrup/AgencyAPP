'use client';

/**
 * Kinerja Sales (M0 §7.1) — RENCANA_KINERJA_SALES.md S-05.
 *
 * Template: `(shell)/marketing/performance/page.tsx` (dashboard agregat + gate
 * divisi) and `(shell)/performance/page.tsx` (selector periode). Every number
 * on this page is server-derived from the immutable logs (house rule #4) —
 * this file only shapes the fetch, the filter form, and the four tabs.
 *
 * The campaign FILTER here is a small bespoke <select> rather than
 * `components/CampaignPicker.tsx`: that component is built for the M1 §9.3
 * INTAKE door (mandatory-campaign language, an "outside campaign" sentinel, a
 * funnel summary for the picked campaign) — reusing it for an optional
 * dashboard filter would carry intake-only semantics into a filter control.
 * The DATA source (`listSelectableCampaigns`) is reused as-is.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAssignableEmployees } from '@/lib/directory';
import { listSelectableCampaigns, type SelectableCampaign } from '@/lib/marketing';
import {
  getSalesPerformance,
  getSalesPerformanceMonthly,
  getSalesPerformanceSources,
  getSalesTargets,
  setSalesTarget,
  type LeadSourceRow,
  type SalesPerfMonthRow,
  type SalesPerfRow,
  type SalesTarget,
} from '@/lib/salesperf';

type Tab = 'per-sales' | 'per-bulan' | 'sumber' | 'target';

const TABS: { key: Tab; label: string }[] = [
  { key: 'per-sales', label: 'Per Sales' },
  { key: 'per-bulan', label: 'Per Bulan' },
  { key: 'sumber', label: 'Sumber Lead' },
  { key: 'target', label: 'Target' },
];

/** Renders a nullable percentage the house way: "NN%" or "—" (rule #7). */
function pct(v: number | null): string {
  return v === null ? '—' : `${v}%`;
}

function currentMonthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function KinerjaSalesPage() {
  const { role } = useAuth();

  const canView = !!(
    role?.director ||
    role?.od ||
    (role?.division && role.division.toLowerCase() === 'sales')
  );
  const canManageTarget = !!(
    role?.director ||
    role?.od ||
    (role?.division && role.division.toLowerCase() === 'sales' && role.level === 'lead')
  );

  const [tab, setTab] = useState<Tab>('per-sales');

  // Filters
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [salesperson, setSalesperson] = useState('');
  const [source, setSource] = useState('');
  const [campaign, setCampaign] = useState('');

  const { employees: salesEmployees } = useAssignableEmployees('Sales', undefined, canView);
  const [campaigns, setCampaigns] = useState<SelectableCampaign[]>([]);

  useEffect(() => {
    if (!canView) return;
    listSelectableCampaigns()
      .then((res) => setCampaigns(res.data))
      .catch(() => setCampaigns([]));
  }, [canView]);

  const filter = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      salesperson: salesperson || undefined,
      source: source || undefined,
      campaign: campaign || undefined,
    }),
    [from, to, salesperson, source, campaign],
  );

  const [perSales, setPerSales] = useState<SalesPerfRow[]>([]);
  const [perBulan, setPerBulan] = useState<SalesPerfMonthRow[]>([]);
  const [sumber, setSumber] = useState<LeadSourceRow[]>([]);
  const [targets, setTargets] = useState<SalesTarget[]>([]);
  const [targetPeriod, setTargetPeriod] = useState(currentMonthStart());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (tab === 'per-sales') {
        const res = await getSalesPerformance(filter);
        setPerSales(res.data);
      } else if (tab === 'per-bulan') {
        const res = await getSalesPerformanceMonthly(filter);
        setPerBulan(res.data);
      } else if (tab === 'sumber') {
        const res = await getSalesPerformanceSources(filter);
        setSumber(res.data);
      } else {
        const res = await getSalesTargets(targetPeriod);
        setTargets(res.data);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [canView, tab, filter, targetPeriod]);

  useEffect(() => {
    load();
  }, [load]);

  const [savingTarget, setSavingTarget] = useState(false);
  const [targetForm, setTargetForm] = useState({ salespersonId: '', amount: '' });

  const submitTarget = async () => {
    if (!targetForm.salespersonId || !targetForm.amount) return;
    setSavingTarget(true);
    setError(null);
    try {
      await setSalesTarget({
        salesperson_id: targetForm.salespersonId,
        period_start: targetPeriod,
        period_kind: 'bulan',
        target_omzet: targetForm.amount,
      });
      setTargetForm({ salespersonId: '', amount: '' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingTarget(false);
    }
  };

  if (!canView) {
    return (
      <div className="stack">
        <div>
          <h1>Kinerja Sales</h1>
          <p className="muted">
            Dashboard M0 §7.1: closing rate, deal cycle, dan OKR per salesperson — dihitung ulang dari log immutable.
          </p>
        </div>
        <section className="card">
          <div className="alert alertError" role="alert">
            Anda tidak memiliki akses ke data ini.
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h1>Kinerja Sales</h1>
        <p className="muted">
          Dashboard M0 §7.1: closing rate, deal cycle, dan OKR per salesperson — dihitung ulang dari log immutable
          (leads, transisi status, aktivitas, alokasi klien). Staf Sales otomatis hanya melihat barisnya sendiri —
          server yang menyaring.
        </p>
      </div>

      <section className="card">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={tab === t.key ? 'btn btnPrimary' : 'btn'}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="field">
            <label htmlFor="kf-from">Dari (YYYY-MM)</label>
            <input id="kf-from" type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="kf-to">Sampai (YYYY-MM)</label>
            <input id="kf-to" type="month" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="kf-sales">Sales</label>
            <select id="kf-sales" value={salesperson} onChange={(e) => setSalesperson(e.target.value)}>
              <option value="">Semua Sales</option>
              {(salesEmployees ?? []).map((e) => (
                <option key={e.employee_id} value={e.employee_id}>
                  {e.nama}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="kf-source">Sumber</label>
            <input id="kf-source" placeholder="mis. Scouting" value={source} onChange={(e) => setSource(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="kf-campaign">Campaign</label>
            <select id="kf-campaign" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
              <option value="">Semua Campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} — {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {loading && <p className="muted">Memuat...</p>}
      {error && <div className="alert alertError" role="alert">{error}</div>}

      {!loading && !error && tab === 'per-sales' && (
        <section className="card">
          {perSales.length === 0 ? (
            <div className="emptyState">Tidak ada data untuk filter ini.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Sales</th><th>Level</th><th>Lead</th><th>Scouting</th><th>Contacted</th>
                    <th>Qualified</th><th>Non-Qualified</th><th>Closing</th><th>Closing Rate</th>
                    <th>Deal Cycle (hari)</th><th>Klien (Baru/Perpanjangan/Cross)</th>
                    <th>Omzet</th><th>Komisi Diakui</th><th>Target</th><th>Pencapaian</th><th>Sisa Target</th>
                  </tr>
                </thead>
                <tbody>
                  {perSales.map((r) => (
                    <tr key={r.salesperson_id}>
                      <td>{r.nama}</td>
                      <td>{r.level_sales}</td>
                      <td>{r.leads_registered}</td>
                      <td>{r.leads_scouting}</td>
                      <td>{r.contacted}</td>
                      <td>{r.qualified}</td>
                      <td>{r.non_qualified}</td>
                      <td>{r.closed_success} / {r.closed_lost}</td>
                      <td>{pct(r.closing_rate_pct)}</td>
                      <td>{r.avg_deal_cycle_days ?? '—'}</td>
                      <td>{r.klien_baru} / {r.klien_perpanjangan} / {r.klien_cross_sell}</td>
                      <td>{r.omzet_idr}</td>
                      <td>{r.komisi_diakui_idr}</td>
                      <td>{r.target_omzet_idr ?? '—'}</td>
                      <td>{pct(r.pencapaian_pct)}</td>
                      <td>{r.sisa_target_idr ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!loading && !error && tab === 'per-bulan' && (
        <section className="card">
          {perBulan.length === 0 ? (
            <div className="emptyState">Tidak ada data untuk filter ini.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Periode</th><th>Sales</th><th>Closing</th><th>Omzet</th><th>% vs Bulan Lalu</th><th>Pencapaian</th>
                  </tr>
                </thead>
                <tbody>
                  {perBulan.map((r) => (
                    <tr key={`${r.salesperson_id}-${r.period}`}>
                      <td>{r.period}</td>
                      <td>{r.nama}</td>
                      <td>{r.closed_success}</td>
                      <td>{r.omzet_idr}</td>
                      <td>{pct(r.mom_pct)}</td>
                      <td>{pct(r.pencapaian_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!loading && !error && tab === 'sumber' && (
        <section className="card">
          {sumber.length === 0 ? (
            <div className="emptyState">Tidak ada data untuk filter ini.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Periode</th><th>Sumber</th><th>Campaign</th><th>Lead</th><th>Qualified</th>
                    <th>Non-Qualified</th><th>Closing</th><th>Omzet</th>
                  </tr>
                </thead>
                <tbody>
                  {sumber.map((r, i) => (
                    <tr key={`${r.period}-${r.source}-${r.campaign_id ?? ''}-${i}`}>
                      <td>{r.period}</td>
                      <td>{r.source}</td>
                      <td>{r.campaign_name ?? r.campaign_id ?? '—'}</td>
                      <td>{r.leads}</td>
                      <td>{r.qualified}</td>
                      <td>{r.non_qualified}</td>
                      <td>{r.closing}</td>
                      <td>{r.omzet_idr}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!loading && !error && tab === 'target' && (
        <section className="card stack">
          <div className="field">
            <label htmlFor="kf-target-period">Bulan target</label>
            <input
              id="kf-target-period"
              type="month"
              value={targetPeriod.slice(0, 7)}
              onChange={(e) => setTargetPeriod(`${e.target.value}-01`)}
            />
          </div>

          {targets.length === 0 ? (
            <div className="emptyState">Belum ada target untuk bulan ini.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Sales</th><th>Periode</th><th>Target</th><th>Diperbarui</th></tr>
                </thead>
                <tbody>
                  {targets.map((t) => (
                    <tr key={`${t.salesperson_id}-${t.period_start}-${t.period_kind}`}>
                      <td>{t.salesperson_id}</td>
                      <td>{t.period_start} ({t.period_kind})</td>
                      <td>{t.target_omzet_idr}</td>
                      <td>{t.updated_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canManageTarget && (
            <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="field">
                <label htmlFor="kf-target-sales">Sales</label>
                <select
                  id="kf-target-sales"
                  value={targetForm.salespersonId}
                  onChange={(e) => setTargetForm((f) => ({ ...f, salespersonId: e.target.value }))}
                >
                  <option value="">— pilih sales —</option>
                  {(salesEmployees ?? []).map((e) => (
                    <option key={e.employee_id} value={e.employee_id}>
                      {e.nama}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="kf-target-amount">Target omzet (Rp)</label>
                <input
                  id="kf-target-amount"
                  type="number"
                  min={0}
                  value={targetForm.amount}
                  onChange={(e) => setTargetForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <button type="button" className="btn btnPrimary" disabled={savingTarget} onClick={submitTarget}>
                {savingTarget ? 'Menyimpan...' : 'Simpan Target'}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
