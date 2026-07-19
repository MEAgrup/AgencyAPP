'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import StatusBadge from '@/components/StatusBadge';
import {
  CAMPAIGN_TRANSITIONS,
  campaignBadgeTone,
  createPerformanceRecord,
  getCampaign,
  getCampaignRollup,
  getPerformance,
  reassignCampaign,
  transitionCampaign,
  updateBudget,
  type Campaign,
  type CampaignStatus,
  type Metrics,
  type Record as PerformanceRecord,
  type Rollup,
} from '@/lib/marketing';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID');
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

// "Online, Offline" per flag (both may be true); "—" when neither.
function channelModes(online: boolean, offline: boolean) {
  const parts: string[] = [];
  if (online) parts.push('Online');
  if (offline) parts.push('Offline');
  return parts.length > 0 ? parts.join(', ') : '—';
}

export default function MarketingCampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role, employee } = useAuth();

  // Backend sends division capitalized ("Marketing") — compare case-insensitively.
  // These are UX-only mirrors of the backend gate (brief §"Gate role"); server re-checks.
  const me = employee?.employee_id ?? '';
  const isMarketing = Boolean(role && role.division.toLowerCase() === 'marketing');
  // canReassign: director || (marketing && lead)
  const canReassign = Boolean(role && (role.director || (isMarketing && role.level === 'lead')));

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [rollupError, setRollupError] = useState<string | null>(null);

  // Performance record + metrics (M2). perfNotFound = 404 (no record yet).
  const [perf, setPerf] = useState<{ record: PerformanceRecord; metrics: Metrics } | null>(null);
  const [perfNotFound, setPerfNotFound] = useState(false);
  const [perfError, setPerfError] = useState<string | null>(null);

  // Lifecycle transition (mutually-exclusive edge buttons → one error slot + pending tag).
  const [transitionPending, setTransitionPending] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  // Reassign
  const [reassignTarget, setReassignTarget] = useState('');
  const [reassignSubmitting, setReassignSubmitting] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);

  // Create budget
  const [createBudget, setCreateBudget] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit budget
  const [editBudget, setEditBudget] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const c = await getCampaign(id);
      setCampaign(c);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadRollup = useCallback(async () => {
    setRollupError(null);
    try {
      const r = await getCampaignRollup(id);
      setRollup(r);
    } catch (err) {
      setRollupError(errorMessage(err));
    }
  }, [id]);

  const loadPerformance = useCallback(async () => {
    setPerfError(null);
    setPerfNotFound(false);
    try {
      const res = await getPerformance(id);
      setPerf(res);
    } catch (err) {
      // 404 [data tidak ditemukan] = record belum ada → tampilkan form create.
      if (err instanceof ApiError && err.status === 404) {
        setPerf(null);
        setPerfNotFound(true);
      } else {
        setPerf(null);
        setPerfError(errorMessage(err));
      }
    }
  }, [id]);

  useEffect(() => {
    load();
    loadRollup();
    loadPerformance();
  }, [load, loadRollup, loadPerformance]);

  async function runTransition(to: string) {
    setTransitionError(null);
    setTransitionPending(to);
    try {
      // Return keys are CAPITALIZED (From/To) with no json tags — do NOT parse; refetch.
      await transitionCampaign(id, to);
      // Closed stamps end_date server-side, which moves the M3-OA-4 attribution
      // window — refresh the derived reads too, not just the record.
      await Promise.all([load(), loadRollup(), loadPerformance()]);
    } catch (err) {
      setTransitionError(errorMessage(err));
    } finally {
      setTransitionPending(null);
    }
  }

  async function handleReassign(e: FormEvent) {
    e.preventDefault();
    setReassignError(null);
    setReassignSubmitting(true);
    try {
      await reassignCampaign(id, reassignTarget.trim());
      setReassignTarget('');
      await load();
      await loadPerformance();
    } catch (err) {
      setReassignError(errorMessage(err));
    } finally {
      setReassignSubmitting(false);
    }
  }

  async function handleCreateBudget(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateSubmitting(true);
    try {
      await createPerformanceRecord(id, createBudget.trim());
      setCreateBudget('');
      await loadPerformance();
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function handleEditBudget(e: FormEvent) {
    e.preventDefault();
    setEditError(null);
    setEditSubmitting(true);
    try {
      await updateBudget(id, editBudget.trim());
      setEditBudget('');
      await loadPerformance();
    } catch (err) {
      setEditError(errorMessage(err));
    } finally {
      setEditSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !campaign) {
    return (
      <div className="stack">
        <Link href="/marketing" className="muted">&larr; Kembali ke Marketing</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Campaign tidak ditemukan.'}</div>
      </div>
    );
  }

  const owner = campaign.owner_employee_id;
  // canManageCampaign(owner) [transisi]: director || (marketing && (lead || (staff && me==owner)))
  const canManageCampaign = Boolean(
    role &&
      (role.director ||
        (isMarketing &&
          (role.level === 'lead' || (role.level === 'staff' && me === owner)))),
  );
  // canManageRecord(owner) [budget M2]: director || (marketing && me==owner).
  // NB beda dari transisi: Lead non-owner = read-only ("monitor, not edit").
  const canManageRecord = Boolean(role && (role.director || (isMarketing && me === owner)));

  const edges = CAMPAIGN_TRANSITIONS[campaign.status as CampaignStatus] ?? [];

  return (
    <div className="stack">
      <div>
        <Link href="/marketing" className="muted">&larr; Kembali ke Marketing</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{campaign.id}</h1>
          <p className="muted">{campaign.name}</p>
        </div>
        <StatusBadge status={campaign.status} tone={campaignBadgeTone(campaign.status)} />
      </div>

      {/* Info campaign */}
      <section className="card">
        <div className="cardHeader">
          <h2>Info Campaign</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Nama</div>
            <div>{campaign.name}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Channel</div>
            <div>{campaign.channel}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Online / Offline</div>
            <div>{channelModes(campaign.online, campaign.offline)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Owner</div>
            <div>{campaign.owner_employee_id}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Tanggal Mulai</div>
            <div>{formatDate(campaign.start_date)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Tanggal Selesai</div>
            <div>{campaign.end_date ? formatDate(campaign.end_date) : '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Dibuat Oleh</div>
            <div>{campaign.created_by}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Dibuat Pada</div>
            <div>{formatDateTime(campaign.created_at)}</div>
          </div>
        </div>

        {canManageCampaign && edges.length > 0 && (
          <>
            {transitionError && <div className="alert alertError" role="alert" style={{ marginTop: 12 }}>{transitionError}</div>}
            <div className="row" style={{ gap: 10, marginTop: 12 }}>
              {edges.map((to) => (
                <button
                  key={to}
                  type="button"
                  className="btn btnPrimary"
                  disabled={transitionPending !== null}
                  onClick={() => runTransition(to)}
                >
                  {transitionPending === to ? 'Memproses...' : `Ubah ke ${to}`}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Reassign */}
      {canReassign && (
        <section className="card">
          <div className="cardHeader">
            <h2>Reassign Owner</h2>
          </div>
          <form className="form" onSubmit={handleReassign}>
            {reassignError && <div className="alert alertError" role="alert">{reassignError}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="reassign-target">Employee ID (Marketing Staff aktif)</label>
                <input
                  id="reassign-target"
                  placeholder="EMP-..."
                  required
                  value={reassignTarget}
                  onChange={(e) => setReassignTarget(e.target.value)}
                />
              </div>
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={reassignSubmitting}>
                {reassignSubmitting ? 'Memproses...' : 'Reassign'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Rollup Funnel (read-only) */}
      <section className="card">
        <div className="cardHeader">
          <h2>Rollup Funnel <span className="muted" style={{ fontSize: 12 }}>🔒 read-only</span></h2>
        </div>
        {rollupError && <div className="alert alertError" role="alert">{rollupError}</div>}
        {rollup && (
          <div className="grid2">
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Leads Generated</div>
              <div>{rollup.leads_generated}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Real Leads</div>
              <div>{rollup.real_leads}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Clients Won</div>
              <div>{rollup.clients_won}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Total Value Won</div>
              <div>{rollup.total_value_won_idr}</div>
            </div>
          </div>
        )}
      </section>

      {/* Performance Record (M2) */}
      <section className="card">
        <div className="cardHeader">
          <h2>Performance Record</h2>
        </div>

        {perfError && <div className="alert alertError" role="alert">{perfError}</div>}

        {perfNotFound && (
          <>
            <div className="emptyState">Belum ada performance record untuk campaign ini.</div>
            {canManageRecord && (
              <form className="form" onSubmit={handleCreateBudget} style={{ marginTop: 12 }}>
                {createError && <div className="alert alertError" role="alert">{createError}</div>}
                <div className="formRow">
                  <div className="field">
                    <label htmlFor="create-budget">Budget (Rp)</label>
                    <input
                      id="create-budget"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={createBudget}
                      onChange={(e) => setCreateBudget(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <button type="submit" className="btn btnPrimary" disabled={createSubmitting}>
                    {createSubmitting ? 'Menyimpan...' : 'Buat Performance Record'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        {perf && (
          <>
            <div className="grid2">
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Budget</div>
                <div>{perf.record.budget_idr}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Online / Offline</div>
                <div>{channelModes(perf.record.online, perf.record.offline)}</div>
              </div>
            </div>
            {canManageRecord && (
              <form className="form" onSubmit={handleEditBudget} style={{ marginTop: 12 }}>
                {editError && <div className="alert alertError" role="alert">{editError}</div>}
                <div className="formRow">
                  <div className="field">
                    <label htmlFor="edit-budget">Ubah Budget (Rp)</label>
                    <input
                      id="edit-budget"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={editBudget}
                      onChange={(e) => setEditBudget(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <button type="submit" className="btn btnPrimary" disabled={editSubmitting}>
                    {editSubmitting ? 'Menyimpan...' : 'Simpan Budget'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </section>

      {/* Auto-Metrics (read-only) — hanya bila record ada */}
      {perf && (
        <section className="card">
          <div className="cardHeader">
            <h2>Auto-Metrics <span className="muted" style={{ fontSize: 12 }}>🔒 read-only</span></h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                <tr>
                  <td>Lead-by-Dashboard</td>
                  <td>{perf.metrics.lead_by_dashboard}</td>
                </tr>
                <tr>
                  <td>Lead-Real-by-Sales</td>
                  <td>{perf.metrics.lead_real_by_sales}</td>
                </tr>
                <tr>
                  <td>Lead-Quality Rate</td>
                  <td>{perf.metrics.lead_quality_rate}</td>
                </tr>
                <tr>
                  <td>Attributed Sales</td>
                  <td>{perf.metrics.attributed_sales}</td>
                </tr>
                <tr>
                  <td>Cost per Lead</td>
                  <td>{perf.metrics.cost_per_lead}</td>
                </tr>
                <tr>
                  <td>Cost per Real Lead</td>
                  <td>{perf.metrics.cost_per_real_lead}</td>
                </tr>
                <tr>
                  <td>ROAS</td>
                  <td>{perf.metrics.roas}</td>
                </tr>
                <tr>
                  <td>Collected Sales</td>
                  <td>{perf.metrics.collected_sales}</td>
                </tr>
                <tr>
                  <td>Collected-ROAS</td>
                  <td>{perf.metrics.collected_roas}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Junk Breakdown */}
      {perf && (
        <section className="card">
          <div className="cardHeader">
            <h2>Junk Breakdown</h2>
          </div>
          {perf.metrics.junk_breakdown.length === 0 ? (
            <div className="emptyState">Belum ada junk lead.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Reason</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {perf.metrics.junk_breakdown.map((j) => (
                    <tr key={j.reason}>
                      <td>{j.reason}</td>
                      <td>{j.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
