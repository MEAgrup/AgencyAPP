'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { ATTEMPT_STATUSES, listAttempts, type AttemptRow } from '@/lib/sales';
import { SOURCES, registerLead } from '@/lib/leads';
import StatusBadge from '@/components/StatusBadge';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID');
}

export default function SalesWorkspacePage() {
  const { role } = useAuth();

  // OD layered murni (od && !director) = read-only: registrasi disembunyikan.
  const odOnly = Boolean(role?.od) && !role?.director;
  // Gating registrasi: Sales division non-OD-murni ATAU Director. Divisi kanonik 'Sales'.
  const canRegister = Boolean(role && ((role.division === 'Sales' && !odOnly) || role.director));
  // Kolom owner hanya untuk Lead/OD/Director (Sales staff hanya melihat miliknya — server scope).
  const showOwner = Boolean(role && (role.level === 'lead' || role.od || role.director));
  // Cermin gate server GET /attempts (module0 reads): divisi Sales, OD, Director.
  // Role lain tidak menembak endpoint yang pasti 403.
  const canSeeAttempts = Boolean(role && (role.division === 'Sales' || role.od || role.director));

  const [attempts, setAttempts] = useState<AttemptRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('Semua');

  // Registrasi Lead (M0 §3)
  const [leadName, setLeadName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState<string>(SOURCES[0]);
  const [campaignId, setCampaignId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [regMessage, setRegMessage] = useState<string | null>(null);
  const [regNotice, setRegNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listAttempts();
      setAttempts(res.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canSeeAttempts) load();
  }, [canSeeAttempts, load]);

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setRegError(null);
    setRegMessage(null);
    setRegNotice(null);
    setSubmitting(true);
    try {
      const res = await registerLead({
        lead_name: leadName,
        phone_number: phone,
        email: email || undefined,
        source,
        campaign_id: campaignId || undefined,
      });
      setRegMessage(`Lead terdaftar: ${res.lead.id} · attempt ${res.attempt.id}.`);
      if (res.notice) setRegNotice(res.notice);
      setLeadName('');
      setPhone('');
      setEmail('');
      setSource(SOURCES[0]);
      setCampaignId('');
      await load();
    } catch (err) {
      setRegError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const filtered =
    attempts?.filter((a) => statusFilter === 'Semua' || a.status === statusFilter) ?? null;

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

      {role && !canSeeAttempts && (
        <div className="alert alertInfo" role="status">
          Role Anda tidak memiliki akses ke daftar Prospect attempt (khusus divisi Sales, OD, dan
          Direktur). Untuk memasukkan lead baru, gunakan pintu Import Marketing di{' '}
          <Link href="/leads">Leads</Link>.
        </div>
      )}

      {canRegister && (
        <section className="card">
          <div className="cardHeader">
            <h2>Registrasi Lead</h2>
          </div>
          <form className="form" onSubmit={handleRegister}>
            {regError && <div className="alert alertError" role="alert">{regError}</div>}
            {regMessage && <div className="alert alertSuccess" role="status">{regMessage}</div>}
            {regNotice && <div className="alert alertInfo" role="status">{regNotice}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="reg-name">Lead Name</label>
                <input id="reg-name" required value={leadName} onChange={(e) => setLeadName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="reg-phone">Phone Number</label>
                <input
                  id="reg-phone"
                  type="tel"
                  inputMode="numeric"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="reg-email">Email (opsional)</label>
                <input id="reg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="reg-source">Source</label>
                <select id="reg-source" value={source} onChange={(e) => setSource(e.target.value)}>
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="reg-campaign">Campaign ID (opsional)</label>
              <input id="reg-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} />
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={submitting}>
                {submitting ? 'Memproses...' : 'Registrasi Lead'}
              </button>
            </div>
          </form>
        </section>
      )}

      {canSeeAttempts && (
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
        {!loading && !loadError && filtered && filtered.length === 0 && (
          <div className="emptyState">Tidak ada attempt yang cocok dengan filter.</div>
        )}
        {!loading && !loadError && filtered && filtered.length > 0 && (
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
                {filtered.map((a) => (
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
      </section>
      )}
    </div>
  );
}
