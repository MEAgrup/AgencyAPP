'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import StatusBadge from '@/components/StatusBadge';
import {
  PLATFORM_OPTIONS,
  createCampaign,
  listAdsBriefQueue,
  type AdsBrief,
} from '@/lib/ads';

export default function AdsWorkspacePage() {
  const { role } = useAuth();
  const router = useRouter();

  // canManageCampaign (m8 brief §9.1): Ads staff/lead OR Director. UX-only gate —
  // the backend re-checks on every write.
  const canManage = Boolean(
    role && ((role.division === 'ads' && (role.level === 'staff' || role.level === 'lead')) || role.director),
  );

  const [briefs, setBriefs] = useState<AdsBrief[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Buka kampanye by id
  const [lookupId, setLookupId] = useState('');

  // Buat kampanye
  const [briefId, setBriefId] = useState('');
  const [platform, setPlatform] = useState<string>(PLATFORM_OPTIONS[0]);
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [targetKpi, setTargetKpi] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAdsBriefQueue();
      setBriefs(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleLookup(e: FormEvent) {
    e.preventDefault();
    const id = lookupId.trim();
    if (!id) return;
    router.push(`/ads/${id}`);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateSubmitting(true);
    try {
      const campaign = await createCampaign(briefId, {
        platform,
        objective,
        budget,
        start_date: startDate,
        end_date: endDate,
        target_kpi: targetKpi,
      });
      router.push(`/ads/${campaign.id}`);
    } catch (err) {
      setCreateError(errorMessage(err));
      setCreateSubmitting(false);
    }
  }

  // Campaigns can only be created while the parent Brief is [In Progress] (§1.1).
  const inProgressBriefs = briefs ? briefs.filter((b) => b.status === '[In Progress]') : [];

  return (
    <div className="stack">
      <div>
        <h1>Ads</h1>
        <p className="muted">
          Workspace Ad Campaign (M8) &mdash; buat kampanye di bawah brief divisi Ads, lalu buka
          untuk input metrik &amp; optimasi.
        </p>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Buka Kampanye</h2>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Belum ada daftar kampanye tersentral di backend M8 &mdash; buka langsung dengan ID kampanye
          (ADC-YYYYMM-NNNN).
        </p>
        <form className="form" onSubmit={handleLookup}>
          <div className="formRow">
            <div className="field">
              <label htmlFor="lookup-id">ID Kampanye</label>
              <input
                id="lookup-id"
                placeholder="ADC-202607-0001"
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value)}
              />
            </div>
          </div>
          <div>
            <button type="submit" className="btn btnSecondary">Buka</button>
          </div>
        </form>
      </section>

      {canManage && (
        <section className="card">
          <div className="cardHeader">
            <h2>Buat Kampanye</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Kampanye hanya dapat dibuat saat brief divisi Ads berstatus [In Progress].
          </p>
          <form className="form" onSubmit={handleCreate}>
            {createError && <div className="alert alertError" role="alert">{createError}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="create-brief">Brief (Ads, [In Progress])</label>
                <select id="create-brief" required value={briefId} onChange={(e) => setBriefId(e.target.value)}>
                  <option value="">Pilih brief...</option>
                  {inProgressBriefs.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.id} &mdash; {b.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="create-platform">Platform</label>
                <select id="create-platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                  {PLATFORM_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="create-objective">Objective</label>
                <input id="create-objective" required value={objective} onChange={(e) => setObjective(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="create-budget">Budget (Rp)</label>
                <input
                  id="create-budget"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="create-start">Tanggal Mulai</label>
                <input id="create-start" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="create-end">Tanggal Selesai</label>
                <input id="create-end" type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="create-kpi">Target KPI</label>
              <input
                id="create-kpi"
                required
                placeholder="mis. ROAS ≥ 4x / GMV target Rp 50.000.000"
                value={targetKpi}
                onChange={(e) => setTargetKpi(e.target.value)}
              />
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={createSubmitting}>
                {createSubmitting ? 'Menyimpan...' : 'Buat Kampanye'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Brief Divisi Ads</h2>
        </div>
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && briefs && briefs.length === 0 && (
          <div className="emptyState">Belum ada brief divisi Ads yang terlihat untuk peran Anda.</div>
        )}
        {!loading && !error && briefs && briefs.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Brief</th>
                  <th>Judul</th>
                  <th>PIC</th>
                  <th>Jatuh Tempo</th>
                  <th>Prioritas</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {briefs.map((b) => (
                  <tr key={b.id}>
                    <td>{b.id}</td>
                    <td>{b.title}</td>
                    <td>{b.assigned_pic || '—'}</td>
                    <td>{b.due_date || '—'}</td>
                    <td>{b.priority || '—'}</td>
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
