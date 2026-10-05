'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import StatusBadge from '@/components/StatusBadge';
import { briefDisplayStatus } from '@/lib/brief';
import {
  PLATFORM_OPTIONS,
  TIPE_IKLAN_OPTIONS,
  campaignBadgeTone,
  createCampaign,
  endCampaign,
  getBriefTargetKpi,
  listAdsBriefQueue,
  listCampaigns,
  pauseCampaign,
  resumeCampaign,
  type AdsBrief,
  type AdsTargetKpi,
  type CampaignListRow,
} from '@/lib/ads';
import { BRIEF_TODO, gateHint, partitionAdsBriefs } from '@/lib/ads-brief-gate';
import {
  aksiKampanye,
  daftarAdvertiser,
  kelompokBriefPerKlien,
  klienSaya,
  saringKampanye,
  type AksiKampanye,
} from '@/lib/ads-queue';
// The [To Do] → [In Progress] edge belongs to M12 (POST /tasks/{id}/start); the
// /ads page borrows it rather than growing a second copy of the brief_task
// engine, exactly as it already borrows the M6/M12 division brief-queue read.
import { startTask } from '@/lib/tasks';
import { transitionLabel } from '@/lib/transition';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID');
}

const AKSI_LABEL: Record<AksiKampanye, string> = {
  pause: 'Jeda',
  resume: 'Lanjutkan',
  end: 'Matikan',
};

export default function AdsWorkspacePage() {
  const { role, employee } = useAuth();
  const router = useRouter();
  const me = employee?.employee_id ?? '';

  // canManageCampaign (m8 brief §9.1): Ads staff/lead OR Director. UX-only gate —
  // the backend re-checks on every write. Backend sends division as "Ads"
  // (capitalized, module8_ads AdsDivision) — compare case-insensitively.
  const isAds = Boolean(role && role.division.toLowerCase() === 'ads');
  const isAdsStaff = isAds && role?.level === 'staff' && !role?.director && !role?.od;
  const canManage = Boolean(
    role && ((isAds && (role.level === 'staff' || role.level === 'lead')) || role.director),
  );

  const [briefs, setBriefs] = useState<AdsBrief[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ADS-REVISI-UI R4 — daftar kampanye yang sudah dibuat.
  const [campaigns, setCampaigns] = useState<CampaignListRow[] | null>(null);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [advertiser, setAdvertiser] = useState('');
  const [aksiPending, setAksiPending] = useState<string | null>(null);
  const [aksiError, setAksiError] = useState<string | null>(null);

  // ADS-REVISI-UI R7 — satu kotak cari menyaring antrean brief dan daftar kampanye.
  const [cari, setCari] = useState('');
  // ADS-REVISI-UI R6 — antrean per klien; staff mulai dari "Klien saya".
  const [lingkup, setLingkup] = useState<'saya' | 'semua' | null>(null);

  // Buat kampanye
  const [briefId, setBriefId] = useState('');
  const [platform, setPlatform] = useState<string>(PLATFORM_OPTIONS[0]);
  const [tipeIklan, setTipeIklan] = useState<string>(TIPE_IKLAN_OPTIONS[0]);
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState('');
  const [startDate, setStartDate] = useState('');
  const [pakaiEndDate, setPakaiEndDate] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [targetKpi, setTargetKpi] = useState('');
  const [kpiBrief, setKpiBrief] = useState<AdsTargetKpi | null>(null);
  const [kpiLoading, setKpiLoading] = useState(false);
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

  const loadCampaigns = useCallback(async () => {
    setCampaignsError(null);
    try {
      const res = await listCampaigns();
      setCampaigns(res.data);
    } catch (err) {
      setCampaignsError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
    loadCampaigns();
  }, [load, loadCampaigns]);

  // R3 — Target KPI diwarisi dari brief; input manual hanya bila brief tidak membawanya.
  useEffect(() => {
    if (!briefId) {
      setKpiBrief(null);
      return;
    }
    let batal = false;
    setKpiLoading(true);
    getBriefTargetKpi(briefId)
      .then((k) => {
        if (!batal) setKpiBrief(k);
      })
      .catch(() => {
        if (!batal) setKpiBrief({ target_kpi: '', sumber: '' });
      })
      .finally(() => {
        if (!batal) setKpiLoading(false);
      });
    return () => {
      batal = true;
    };
  }, [briefId]);

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
        end_date: pakaiEndDate && endDate ? endDate : null,
        target_kpi: kpiBrief?.target_kpi ? '' : targetKpi,
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

  // R4 — Jeda / Lanjutkan / Matikan langsung dari daftar, lewat edge lifecycle
  // yang sudah ada (server tetap penentu: brief [Approved], aset tertaut [Approved]).
  async function handleAksi(c: CampaignListRow, aksi: AksiKampanye) {
    if (aksi === 'end' && !window.confirm(`Matikan iklan ${c.id}? Status [Ended] bersifat final dan tidak dapat dibatalkan.`)) {
      return;
    }
    setAksiError(null);
    setAksiPending(`${c.id}:${aksi}`);
    try {
      if (aksi === 'pause') await pauseCampaign(c.id);
      else if (aksi === 'resume') await resumeCampaign(c.id);
      else await endCampaign(c.id);
      await loadCampaigns();
    } catch (err) {
      setAksiError(`${c.id}: ${errorMessage(err)}`);
    } finally {
      setAksiPending(null);
    }
  }

  // Campaigns can only be created while the parent Brief is [In Progress] (§4 Rule 1);
  // a brief still [To Do] is one start edge away, and the hint says so instead of
  // leaving an empty dropdown to explain itself.
  const gate = useMemo(() => partitionAdsBriefs(briefs), [briefs]);
  const inProgressBriefs = gate.selectable;
  const hint = gateHint(gate);

  const mine = useMemo(() => klienSaya(briefs ?? [], campaigns ?? [], me), [briefs, campaigns, me]);
  // Staff mulai dari "Klien saya" bila ia memang memegang klien; selain itu "Semua".
  const lingkupEfektif = lingkup ?? (isAdsStaff && mine.size > 0 ? 'saya' : 'semua');
  const kelompok = useMemo(
    () => kelompokBriefPerKlien(briefs ?? [], { cari, hanyaKlien: lingkupEfektif === 'saya' ? mine : null }),
    [briefs, cari, lingkupEfektif, mine],
  );
  const kampanyeTampil = useMemo(
    () => saringKampanye(campaigns ?? [], { cari, advertiser }),
    [campaigns, cari, advertiser],
  );
  const advertisers = useMemo(() => daftarAdvertiser(campaigns ?? []), [campaigns]);
  const kpiDariBrief = Boolean(kpiBrief?.target_kpi);

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
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="ads-cari">Cari klien</label>
          <input
            id="ads-cari"
            type="search"
            placeholder="Nama klien / nama toko / ID klien atau kampanye"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
          />
        </div>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>{isAdsStaff ? 'Kampanye Saya' : 'Daftar Kampanye'}</h2>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          {isAdsStaff
            ? 'Semua kampanye yang sudah Anda buat.'
            : 'Kampanye yang terlihat untuk peran Anda, per advertiser pembuatnya.'}{' '}
          Estimasi Terpakai = Budget Harian &times; hari iklan aktif (hari tayang dikurangi hari jeda) &mdash;
          dihitung otomatis; spend aktual tetap dari Metric Entry.
        </p>
        {!isAdsStaff && advertisers.length > 1 && (
          <div className="field" style={{ maxWidth: 320, marginBottom: 12 }}>
            <label htmlFor="ads-advertiser">Advertiser</label>
            <select id="ads-advertiser" value={advertiser} onChange={(e) => setAdvertiser(e.target.value)}>
              <option value="">Semua advertiser</option>
              {advertisers.map((a) => (
                <option key={a.id} value={a.id}>{a.nama}</option>
              ))}
            </select>
          </div>
        )}
        {campaignsError && <div className="alert alertError" role="alert">{campaignsError}</div>}
        {aksiError && <div className="alert alertError" role="alert">{aksiError}</div>}
        {!campaigns && !campaignsError && <p className="muted">Memuat...</p>}
        {campaigns && kampanyeTampil.length === 0 && (
          <div className="emptyState">
            {campaigns.length === 0 ? 'Belum ada kampanye.' : 'Tidak ada kampanye yang cocok dengan pencarian.'}
          </div>
        )}
        {campaigns && kampanyeTampil.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Kampanye</th>
                  <th>Klien</th>
                  <th>Toko</th>
                  <th>Platform</th>
                  <th>Budget Harian</th>
                  <th title="Budget Harian × hari iklan aktif — dihitung otomatis">Estimasi Terpakai 🔒</th>
                  <th>Dibuat</th>
                  {!isAdsStaff && <th>Advertiser</th>}
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {kampanyeTampil.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/ads/${c.id}`}>{c.id}</Link></td>
                    <td>
                      {c.client_nama || '—'}
                      <div className="muted" style={{ fontSize: 11 }}>{c.client_id}</div>
                    </td>
                    <td>{c.client_toko || '—'}</td>
                    <td>
                      {c.platform}
                      <div className="muted" style={{ fontSize: 11 }}>{c.tipe_iklan}</div>
                    </td>
                    <td>{c.budget_display}</td>
                    <td>
                      {c.estimasi_budget_terpakai_display}
                      {c.hari_iklan_aktif !== null && (
                        <div className="muted" style={{ fontSize: 11 }}>{c.hari_iklan_aktif} hari aktif</div>
                      )}
                    </td>
                    <td>{formatDate(c.created_at)}</td>
                    {!isAdsStaff && <td>{c.created_by_nama || c.created_by}</td>}
                    <td><span className={`badge badge-${campaignBadgeTone(c.status)}`}>{c.status}</span></td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {canManage &&
                          aksiKampanye(c.status).map((a) => (
                            <button
                              key={a}
                              type="button"
                              className={`btn btnSm ${a === 'end' ? 'btnDanger' : 'btnSecondary'}`}
                              disabled={aksiPending !== null}
                              onClick={() => handleAksi(c, a)}
                            >
                              {aksiPending === `${c.id}:${a}` ? 'Memproses...' : AKSI_LABEL[a]}
                            </button>
                          ))}
                        <Link href={`/ads/${c.id}`} className="btn btnGhost btnSm">Buka</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
                      {b.client_nama ? `${b.client_nama} — ` : ''}{b.id} &mdash; {b.title}
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
                <label htmlFor="create-budget">Budget Harian (Rp)</label>
                <input
                  id="create-budget"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
                <span className="muted" style={{ fontSize: 12 }}>
                  Estimasi budget terpakai dihitung otomatis dari budget harian &times; hari iklan aktif.
                </span>
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="create-start">Tanggal Mulai</label>
                <input id="create-start" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="create-end-toggle" className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <input
                    id="create-end-toggle"
                    type="checkbox"
                    checked={pakaiEndDate}
                    onChange={(e) => setPakaiEndDate(e.target.checked)}
                  />
                  Tentukan tanggal selesai
                </label>
                {pakaiEndDate ? (
                  <input
                    id="create-end"
                    type="date"
                    aria-label="Tanggal Selesai"
                    required
                    min={startDate || undefined}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                ) : (
                  <span className="muted" style={{ fontSize: 12 }}>
                    Opsional &mdash; iklan berjalan sampai Anda menekan Selesai Iklan.
                  </span>
                )}
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="create-kpi">Target KPI{kpiDariBrief ? ' (dari brief)' : ''}</label>
                {kpiLoading ? (
                  <span className="muted" style={{ fontSize: 12 }}>Memuat Target KPI brief...</span>
                ) : kpiDariBrief ? (
                  <>
                    <input id="create-kpi" readOnly value={kpiBrief?.target_kpi ?? ''} />
                    <span className="muted" style={{ fontSize: 12 }}>
                      🔒 Diwarisi dari {kpiBrief?.sumber === 'plan' ? 'baris Plan' : 'Strategi'} brief yang disetujui AM
                      &mdash; tidak perlu diisi ulang.
                    </span>
                  </>
                ) : (
                  <>
                    <input
                      id="create-kpi"
                      required
                      placeholder="mis. ROAS ≥ 4x / GMV target Rp 50.000.000"
                      value={targetKpi}
                      onChange={(e) => setTargetKpi(e.target.value)}
                    />
                    {briefId && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        Brief ini tidak membawa Target KPI &mdash; isi sesuai kesepakatan AM.
                      </span>
                    )}
                  </>
                )}
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
                disabled={createSubmitting || inProgressBriefs.length === 0 || kpiLoading}
              >
                {createSubmitting ? 'Menyimpan...' : 'Buat Kampanye'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Antrean Brief Ads</h2>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Urutannya: brief <strong>[To Do]</strong> &rarr; <em>Mulai</em> &rarr; <strong>[In Progress]</strong>{' '}
          (baru bisa menampung kampanye) &rarr; kampanye dibuat (aset creative opsional) &rarr; brief
          di-<em>submit</em> &rarr; AM approve &rarr; kampanye baru boleh di-<em>Launch</em>.
        </p>
        <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btnSm ${lingkupEfektif === 'saya' ? 'btnPrimary' : 'btnSecondary'}`}
            onClick={() => setLingkup('saya')}
          >
            Klien saya ({mine.size})
          </button>
          <button
            type="button"
            className={`btn btnSm ${lingkupEfektif === 'semua' ? 'btnPrimary' : 'btnSecondary'}`}
            onClick={() => setLingkup('semua')}
          >
            Semua klien
          </button>
        </div>
        {lingkupEfektif === 'saya' && (
          <p className="muted" style={{ fontSize: 12 }}>
            &ldquo;Klien saya&rdquo; = klien yang brief Ads-nya ber-PIC Anda atau kampanyenya Anda buat. Brief klien
            baru yang belum dipegang siapa pun ada di &ldquo;Semua klien&rdquo;.
          </p>
        )}
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && briefs && briefs.length === 0 && (
          <div className="emptyState">Belum ada brief divisi Ads yang terlihat untuk peran Anda.</div>
        )}
        {!loading && !error && briefs && briefs.length > 0 && kelompok.length === 0 && (
          <div className="emptyState">
            {cari ? 'Tidak ada klien yang cocok dengan pencarian.' : 'Belum ada brief untuk klien Anda.'}
          </div>
        )}
        {!loading && !error && kelompok.map((g) => (
          <div key={g.clientId || '-'} style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, margin: '8px 0' }}>
              {g.clientNama || 'Klien tidak diketahui'}
              {g.clientId && <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}> &middot; {g.clientId}</span>}
              <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}> &middot; {g.briefs.length} brief</span>
            </h3>
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
                  {g.briefs.map((b) => (
                    <tr key={b.id}>
                      <td><Link href={`/tasks/${b.id}`}>{b.id}</Link></td>
                      <td>{b.title}</td>
                      <td>
                        {b.assigned_pic_nama || (b.assigned_pic ? b.assigned_pic : '—')}
                        {b.assigned_pic_nama && b.assigned_pic && (
                          <div className="muted" style={{ fontSize: 11 }}>{b.assigned_pic}</div>
                        )}
                      </td>
                      <td>{b.due_date || '—'}</td>
                      <td>{b.priority || '—'}</td>
                      <td><StatusBadge status={briefDisplayStatus(b)} /></td>
                      <td>
                        {canManage && b.status === BRIEF_TODO && b.intake_state !== 'dikembalikan' ? (
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
          </div>
        ))}
      </section>
    </div>
  );
}
