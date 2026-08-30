'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import StatusBadge from '@/components/StatusBadge';
import {
  PLATFORM_OPTIONS,
  TIPE_IKLAN_OPTIONS,
  createCampaign,
  listAdsBriefQueue,
  type AdsBrief,
} from '@/lib/ads';
import { BRIEF_TODO, gateHint, partitionAdsBriefs } from '@/lib/ads-brief-gate';
// The [To Do] → [In Progress] edge belongs to M12 (POST /tasks/{id}/start); the
// /ads page borrows it rather than growing a second copy of the brief_task
// engine, exactly as it already borrows the M6/M12 division brief-queue read.
import { startTask } from '@/lib/tasks';
import { transitionLabel } from '@/lib/transition';

export default function AdsWorkspacePage() {
  const { role } = useAuth();
  const router = useRouter();

  // canManageCampaign (m8 brief §9.1): Ads staff/lead OR Director. UX-only gate —
  // the backend re-checks on every write. Backend sends division as "Ads"
  // (capitalized, module8_ads AdsDivision) — compare case-insensitively.
  const canManage = Boolean(
    role &&
      ((role.division.toLowerCase() === 'ads' && (role.level === 'staff' || role.level === 'lead')) ||
        role.director),
  );

  const [briefs, setBriefs] = useState<AdsBrief[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Buka kampanye by id
  const [lookupId, setLookupId] = useState('');

  // Buat kampanye
  const [briefId, setBriefId] = useState('');
  const [platform, setPlatform] = useState<string>(PLATFORM_OPTIONS[0]);
  const [tipeIklan, setTipeIklan] = useState<string>(TIPE_IKLAN_OPTIONS[0]);
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [targetKpi, setTargetKpi] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Mulai brief ([To Do] → [In Progress]) — the prerequisite for creating a
  // campaign. Per-row submitting state so only the clicked button spins.
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [startMessage, setStartMessage] = useState<string | null>(null);

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
        tipe_iklan: tipeIklan,
      });
      router.push(`/ads/${campaign.id}`);
    } catch (err) {
      setCreateError(errorMessage(err));
      setCreateSubmitting(false);
    }
  }

  // Mulai brief: the M12 §3 start edge. The server is the authority on who may
  // drive it (PIC / division staff-lead / Director) — a 403 arrives as the verbatim
  // BI message, so nothing is pre-judged here beyond the canManage section gate.
  // On success the brief becomes selectable, so pre-select it for the form.
  async function handleStartBrief(id: string) {
    setStartError(null);
    setStartMessage(null);
    setStartingId(id);
    try {
      const res = await startTask('brief', id);
      setStartMessage(`${id}: ${transitionLabel(res)}`);
      setBriefId(id);
      await load();
    } catch (err) {
      setStartError(errorMessage(err));
    } finally {
      setStartingId(null);
    }
  }

  // Campaigns can only be created while the parent Brief is [In Progress] (§4 Rule 1);
  // a brief still [To Do] is one start edge away, and the hint says so instead of
  // leaving an empty dropdown to explain itself.
  const gate = useMemo(() => partitionAdsBriefs(briefs), [briefs]);
  const inProgressBriefs = gate.selectable;
  const hint = gateHint(gate);

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
          {!loading && hint && (
            <div className="alert" role="status">
              {hint}
              {gate.startable.length > 0 && (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  {gate.startable.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      className="btn btnPrimary btnSm"
                      disabled={startingId !== null}
                      onClick={() => handleStartBrief(b.id)}
                    >
                      {startingId === b.id ? 'Memulai...' : `Mulai ${b.id}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {startError && <div className="alert alertError" role="alert">{startError}</div>}
          {startMessage && <div className="alert alertSuccess" role="status">Brief dimulai &mdash; {startMessage}</div>}
          <form className="form" onSubmit={handleCreate}>
            {createError && <div className="alert alertError" role="alert">{createError}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="create-brief">Brief (Ads, [In Progress])</label>
                <select
                  id="create-brief"
                  required
                  disabled={inProgressBriefs.length === 0}
                  value={briefId}
                  onChange={(e) => setBriefId(e.target.value)}
                >
                  <option value="">
                    {inProgressBriefs.length === 0 ? 'Belum ada brief [In Progress]' : 'Pilih brief...'}
                  </option>
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
            <div className="formRow">
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
              <div className="field">
                <label htmlFor="create-tipe-iklan">Tipe Iklan</label>
                <select id="create-tipe-iklan" value={tipeIklan} onChange={(e) => setTipeIklan(e.target.value)}>
                  {TIPE_IKLAN_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <button
                type="submit"
                className="btn btnPrimary"
                disabled={createSubmitting || inProgressBriefs.length === 0}
              >
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
        <p className="muted" style={{ fontSize: 13 }}>
          Urutannya: brief <strong>[To Do]</strong> &rarr; <em>Mulai</em> &rarr; <strong>[In Progress]</strong>{' '}
          (baru bisa menampung kampanye) &rarr; kampanye dibuat &amp; aset creative ditautkan &rarr; brief
          di-<em>submit</em> &rarr; AM approve &rarr; kampanye baru boleh di-<em>Launch</em>.
        </p>
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
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {briefs.map((b) => (
                  <tr key={b.id}>
                    <td><Link href={`/tasks/${b.id}`}>{b.id}</Link></td>
                    <td>{b.title}</td>
                    <td>{b.assigned_pic || '—'}</td>
                    <td>{b.due_date || '—'}</td>
                    <td>{b.priority || '—'}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td>
                      {canManage && b.status === BRIEF_TODO ? (
                        <button
                          type="button"
                          className="btn btnSecondary btnSm"
                          disabled={startingId !== null}
                          onClick={() => handleStartBrief(b.id)}
                        >
                          {startingId === b.id ? 'Memulai...' : 'Mulai'}
                        </button>
                      ) : (
                        <Link href={`/tasks/${b.id}`} className="btn btnSecondary btnSm">Buka</Link>
                      )}
                    </td>
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
