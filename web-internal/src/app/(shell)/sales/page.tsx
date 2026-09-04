'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { ATTEMPT_STATUSES, listAttempts, type AttemptRow } from '@/lib/sales';
import {
  MAX_REGISTER_BATCH,
  SOURCES,
  registerLeadsBatch,
  type BatchRegisterReport,
} from '@/lib/leads';
import { OUTSIDE_CAMPAIGN, campaignRequiredForSource } from '@/lib/campaign-picker';
import { listSelectableCampaigns, type SelectableCampaign } from '@/lib/marketing';
import CampaignPicker from '@/components/CampaignPicker';
import StatusBadge from '@/components/StatusBadge';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID');
}

// Satu baris prospek di form registrasi (QA revisi 2026-08-07). Source dan
// Origin Campaign TIDAK ada di sini: keduanya dipilih sekali untuk seluruh batch,
// yang justru inti keluhannya — sales yang scouting 5 kontak sekaligus tidak
// perlu mengulang Source lima kali.
interface ProspectRow {
  lead_name: string;
  phone_number: string;
  email: string;
}

const emptyProspect = (): ProspectRow => ({ lead_name: '', phone_number: '', email: '' });

export default function SalesWorkspacePage() {
  const { role } = useAuth();

  // OD layered murni (od && !director) = read-only: registrasi disembunyikan.
  const odOnly = Boolean(role?.od) && !role?.director;
  // Gating registrasi: Sales division non-OD-murni ATAU Director. Divisi kanonik 'Sales'.
  const canRegister = Boolean(role && ((role.division === 'Sales' && !odOnly) || role.director));
  // Kolom owner hanya untuk Lead/OD/Director (Sales staff hanya melihat miliknya — server scope).
  const showOwner = Boolean(role && (role.level === 'lead' || role.od || role.director));

  const [attempts, setAttempts] = useState<AttemptRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('Semua');

  // Registrasi Lead (M0 §3) — sampai MAX_REGISTER_BATCH prospek per submit.
  const [prospects, setProspects] = useState<ProspectRow[]>([emptyProspect()]);
  const [source, setSource] = useState<string>(SOURCES[0]);
  // '' | OUTSIDE_CAMPAIGN | a CMP- id — see CampaignPicker.
  const [campaignChoice, setCampaignChoice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [regReport, setRegReport] = useState<BatchRegisterReport | null>(null);

  // Origin Campaign picker (M1 §9.3). Loaded once for the whole session of the
  // page: the list is small, Active/Paused only, and re-fetching per keystroke
  // would buy nothing (the search filters client-side).
  const [campaigns, setCampaigns] = useState<SelectableCampaign[] | null>(null);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);

  // M1 §9.3: mandatory for the four Marketing-channel sources. The server is the
  // authority and answers [data tidak lengkap...]; this only marks the field.
  const campaignRequired = campaignRequiredForSource(source);

  // P2 §6: server memaginasi. `nextCursor` null = sudah halaman terakhir.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Filter status dijalankan SERVER (query param), bukan menyaring array
      // yang sudah diambil — pola yang sama dengan tab Pool/Database. Sejak
      // P2 §6 daftar ini dipaginasi, jadi menyaring di klien akan menyaring
      // HALAMAN, bukan datanya: tab status bisa tampak kosong padahal barisnya
      // ada di halaman berikutnya.
      const res = await listAttempts(statusFilter === 'Semua' ? undefined : statusFilter);
      setAttempts(res.data);
      setNextCursor(res.next_cursor);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  // Menyambung, bukan mengganti.
  async function loadMore() {
    if (nextCursor === null) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const res = await listAttempts(statusFilter === 'Semua' ? undefined : statusFilter, { cursor: nextCursor });
      setAttempts((prev) => [...(prev ?? []), ...res.data]);
      setNextCursor(res.next_cursor);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  // Only the registration form uses the picker, so only fetch it for actors that
  // can register (an OD-only account never sees the form).
  useEffect(() => {
    if (!canRegister) return;
    let live = true;
    setCampaignsLoading(true);
    setCampaignsError(null);
    listSelectableCampaigns()
      .then((res) => {
        if (live) setCampaigns(res.data);
      })
      .catch((err) => {
        if (live) setCampaignsError(errorMessage(err));
      })
      .finally(() => {
        if (live) setCampaignsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [canRegister]);

  function addProspect() {
    setProspects((rows) => (rows.length >= MAX_REGISTER_BATCH ? rows : [...rows, emptyProspect()]));
  }
  function removeProspect(idx: number) {
    setProspects((rows) => (rows.length <= 1 ? rows : rows.filter((_, i) => i !== idx)));
  }
  function updateProspect(idx: number, field: keyof ProspectRow, value: string) {
    setProspects((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setRegError(null);
    setRegReport(null);
    setSubmitting(true);
    try {
      const report = await registerLeadsBatch({
        source,
        // The picker's sentinel never goes on the wire: "di luar campaign" is
        // sent as the outside_campaign declaration, which is what lets the server
        // tell it apart from a skipped field (M1 §9.3 gate).
        campaign_id:
          campaignChoice !== '' && campaignChoice !== OUTSIDE_CAMPAIGN ? campaignChoice : undefined,
        outside_campaign: campaignChoice === OUTSIDE_CAMPAIGN ? true : undefined,
        prospects: prospects.map((p) => ({
          lead_name: p.lead_name.trim(),
          phone_number: p.phone_number.trim(),
          email: p.email.trim() || undefined,
        })),
      });
      setRegReport(report);
      // Baris yang DITOLAK tetap di form supaya sales bisa memperbaikinya; yang
      // terdaftar dibuang. Kalau semuanya lolos, form kembali ke satu baris
      // kosong. Membersihkan seluruh form pada kegagalan sebagian akan
      // menghilangkan data yang baru saja diketik dan belum tersimpan.
      const failedPhones = new Set(report.rejections.map((r) => r.phone_number));
      const keep = prospects.filter((p) => failedPhones.has(p.phone_number.trim()));
      setProspects(keep.length > 0 ? keep : [emptyProspect()]);
      if (report.rejected === 0) {
        setSource(SOURCES[0]);
        setCampaignChoice('');
      }
      await load();
    } catch (err) {
      setRegError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }


  return (
    <div className="stack">
      <div>
        <h1>Sales Workspace</h1>
        <p className="muted">
          Workspace Sales (M0) &mdash; registrasi lead, kelola Prospect attempt (PRSP), kualifikasi,
          negosiasi, hingga closing. Butuh klaim lead dari antrean? Buka{' '}
          <Link href="/leads">Leads (Pool)</Link>.
        </p>
      </div>

      {canRegister && (
        <section className="card">
          <div className="cardHeader">
            <h2>Registrasi Lead</h2>
          </div>
          <form className="form" onSubmit={handleRegister}>
            {regError && <div className="alert alertError" role="alert">{regError}</div>}
            {regReport && (
              <div
                className={`alert ${regReport.rejected === 0 ? 'alertSuccess' : 'alertInfo'}`}
                role="status"
              >
                {regReport.summary}
              </div>
            )}

            <div className="field">
              <label htmlFor="reg-source">Source</label>
              <select id="reg-source" value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Source &amp; Origin Campaign berlaku untuk semua prospek di bawah.
              </p>
            </div>

            <CampaignPicker
              id="reg-campaign"
              campaigns={campaigns}
              loading={campaignsLoading}
              error={campaignsError}
              value={campaignChoice}
              onChange={setCampaignChoice}
              required={campaignRequired}
              disabled={submitting}
            />

            <div className="field">
              <label>Data Prospek (maks {MAX_REGISTER_BATCH})</label>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Lead Name</th>
                      <th>Phone Number</th>
                      <th>Email (opsional)</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {prospects.map((p, idx) => (
                      <tr key={idx}>
                        <td className="muted">{idx + 1}</td>
                        <td>
                          <input
                            aria-label={`Lead Name prospek ${idx + 1}`}
                            required
                            value={p.lead_name}
                            onChange={(e) => updateProspect(idx, 'lead_name', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Phone Number prospek ${idx + 1}`}
                            type="tel"
                            inputMode="numeric"
                            required
                            value={p.phone_number}
                            onChange={(e) => updateProspect(idx, 'phone_number', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Email prospek ${idx + 1}`}
                            type="email"
                            value={p.email}
                            onChange={(e) => updateProspect(idx, 'email', e.target.value)}
                          />
                        </td>
                        <td>
                          {prospects.length > 1 && (
                            <button
                              type="button"
                              className="btn btnGhost btnSm"
                              onClick={() => removeProspect(idx)}
                            >
                              Hapus
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btnSecondary btnSm"
                  onClick={addProspect}
                  disabled={submitting || prospects.length >= MAX_REGISTER_BATCH}
                >
                  Tambah Prospek
                </button>
              </div>
            </div>

            {/* Verdict per baris: satu duplikat tidak menggagalkan yang lain. */}
            {regReport && regReport.rows.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Lead</th>
                      <th>Telepon</th>
                      <th>Hasil</th>
                      <th>Keterangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regReport.rows.map((r) => (
                      <tr key={r.row_number}>
                        <td className="muted">{r.row_number}</td>
                        <td>{r.lead_name || '—'}</td>
                        <td>{r.phone_number || '—'}</td>
                        <td>{r.registered ? 'Terdaftar' : 'Ditolak'}</td>
                        <td>
                          {r.registered
                            ? `${r.lead_id} · attempt ${r.attempt_id}${r.notice ? ` · ${r.notice}` : ''}`
                            : r.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div>
              <button type="submit" className="btn btnPrimary" disabled={submitting}>
                {submitting ? 'Memproses...' : 'Registrasi Lead'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Prospect Attempt</h2>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {['Semua', ...ATTEMPT_STATUSES].map((s) => (
            <button
              key={s}
              type="button"
              className={`btn btnSm ${statusFilter === s ? 'btnPrimary' : 'btnSecondary'}`}
              onClick={() => setStatusFilter(s)}
            >
              {s}
            </button>
          ))}
        </div>

        {loading && <p className="muted">Memuat...</p>}
        {loadError && <div className="alert alertError" role="alert">{loadError}</div>}
        {!loading && !loadError && attempts && attempts.length === 0 && (
          <div className="emptyState">Tidak ada attempt yang cocok dengan filter.</div>
        )}
        {!loading && !loadError && attempts && attempts.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>PRSP</th>
                  <th>Lead</th>
                  <th>Telepon</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Diklaim</th>
                  {showOwner && <th>Owner</th>}
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id}>
                    <td><Link href={`/sales/${a.id}`}>{a.id}</Link></td>
                    <td>{a.lead_name}</td>
                    <td>{a.phone_number}</td>
                    <td>{a.source}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td>{formatDate(a.claimed_at)}</td>
                    {showOwner && <td>{a.owner_nama || a.owner_employee_id || '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {nextCursor !== null && (
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button type="button" className="btn btnSecondary" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? 'Memuat...' : 'Muat lebih banyak'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
