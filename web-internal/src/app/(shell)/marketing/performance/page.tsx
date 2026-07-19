'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import StatusBadge from '@/components/StatusBadge';
import {
  listCampaigns,
  performanceDashboard,
  campaignBadgeTone,
  type Campaign,
  type Metrics,
} from '@/lib/marketing';

export default function PerformanceMarketingPage() {
  const { role } = useAuth();

  // Gate check: director || od || division==='marketing'
  const canViewMarketing = !!(
    role?.director ||
    role?.od ||
    (role?.division && role.division.toLowerCase() === 'marketing')
  );

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [metrics, setMetrics] = useState<Metrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canViewMarketing) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [campaignsRes, metricsRes] = await Promise.all([
        listCampaigns(),
        performanceDashboard(),
      ]);
      setCampaigns(campaignsRes.data);
      setMetrics(metricsRes.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [canViewMarketing]);

  useEffect(() => {
    load();
  }, [load]);

  // Build campaign map for join by campaign_id
  const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

  // Join metrics with campaign data
  const rows = metrics.map((m) => {
    const campaign = campaignMap.get(m.campaign_id);
    return {
      metrics: m,
      campaign,
    };
  });

  if (!canViewMarketing) {
    return (
      <div className="stack">
        <div>
          <h1>Performa Marketing</h1>
          <p className="muted">
            Dashboard M2: banding CPL/CPRL/ROAS/Quality antar campaign; staf Marketing otomatis hanya melihat miliknya — server yang filter.
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
        <h1>Performa Marketing</h1>
        <p className="muted">
          Dashboard M2: banding CPL/CPRL/ROAS/Quality antar campaign; staf Marketing otomatis hanya melihat miliknya — server yang filter.
        </p>
      </div>

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && rows.length === 0 && (
          <div className="emptyState">Tidak ada data kampanye untuk ditampilkan.</div>
        )}
        {!loading && !error && rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Budget</th>
                  <th>Leads</th>
                  <th>Real</th>
                  <th>Quality</th>
                  <th>Attributed Sales</th>
                  <th>CPL</th>
                  <th>CPRL</th>
                  <th>ROAS</th>
                  <th>Collected-ROAS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.metrics.campaign_id}>
                    <td>
                      <Link href={`/marketing/${row.metrics.campaign_id}`}>
                        {row.campaign
                          ? `${row.metrics.campaign_id} — ${row.campaign.name}`
                          : row.metrics.campaign_id}
                      </Link>
                    </td>
                    <td>{row.campaign?.owner_employee_id || '—'}</td>
                    <td>
                      {row.campaign ? (
                        <StatusBadge
                          status={row.campaign.status}
                          tone={campaignBadgeTone(row.campaign.status)}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{row.metrics.budget_idr}</td>
                    <td>{row.metrics.lead_by_dashboard}</td>
                    <td>{row.metrics.lead_real_by_sales}</td>
                    <td>{row.metrics.lead_quality_rate}</td>
                    <td>{row.metrics.attributed_sales}</td>
                    <td>{row.metrics.cost_per_lead}</td>
                    <td>{row.metrics.cost_per_real_lead}</td>
                    <td>{row.metrics.roas}</td>
                    <td>{row.metrics.collected_roas}</td>
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
