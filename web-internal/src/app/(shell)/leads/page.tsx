'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ApiError, errorMessage } from '@/lib/api';
import {
  claimLead,
  getMyAttempts,
  listLeads,
  registerLead,
  type LeadListItem,
  type MyAttemptItem,
  type RegisterLeadResult,
} from '@/lib/leads';
import StatusBadge from '@/components/StatusBadge';

type Tab = 'pool' | 'mine' | 'all';

function formatDate(value: string) {
  return new Date(value).toLocaleString('id-ID');
}

const EMPTY_REGISTER_FORM = { LeadName: '', PhoneNumber: '', Email: '', Source: '' };

export default function LeadsPage() {
  const [tab, setTab] = useState<Tab>('pool');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  // Simple debounce (CLAUDE.md/spec: "debounce sederhana").
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const [pool, setPool] = useState<LeadListItem[] | null>(null);
  const [poolLoading, setPoolLoading] = useState(true);
  const [poolError, setPoolError] = useState<string | null>(null);

  const [all, setAll] = useState<LeadListItem[] | null>(null);
  const [allLoading, setAllLoading] = useState(false);
  const [allError, setAllError] = useState<string | null>(null);
  // Tab "Semua" is hidden entirely when the view=all fetch comes back 403 —
  // detected from the failed request, never hardcoded off a role field
  // (spec: "deteksi dari kegagalan fetch, jangan hardcode role").
  const [allHidden, setAllHidden] = useState(false);

  const [mine, setMine] = useState<MyAttemptItem[] | null>(null);
  const [mineLoading, setMineLoading] = useState(false);
  const [mineError, setMineError] = useState<string | null>(null);

  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_REGISTER_FORM);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formResult, setFormResult] = useState<RegisterLeadResult | null>(null);

  const loadPool = useCallback(async (query: string) => {
    setPoolLoading(true);
    setPoolError(null);
    try {
      const res = await listLeads('pool', query);
      setPool(res.leads);
    } catch (err) {
      setPoolError(errorMessage(err));
    } finally {
      setPoolLoading(false);
    }
  }, []);

  const loadAll = useCallback(async (query: string) => {
    setAllLoading(true);
    setAllError(null);
    try {
      const res = await listLeads('all', query);
      setAll(res.leads);
      setAllHidden(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setAllHidden(true);
        setAll(null);
      } else {
        setAllError(errorMessage(err));
      }
    } finally {
      setAllLoading(false);
    }
  }, []);

  const loadMine = useCallback(async () => {
    setMineLoading(true);
    setMineError(null);
    try {
      const res = await getMyAttempts();
      setMine(res.attempts);
    } catch (err) {
      setMineError(errorMessage(err));
    } finally {
      setMineLoading(false);
    }
  }, []);

  // Probe "Semua" access once on mount so the tab can be hidden before the
  // user ever clicks it, per spec.
  useEffect(() => {
    loadAll('');
  }, [loadAll]);

  // Load whichever tab is active whenever the tab or the (Pool/Semua) search
  // query changes.
  useEffect(() => {
    if (tab === 'pool') loadPool(debouncedQ);
    else if (tab === 'all') loadAll(debouncedQ);
    else if (tab === 'mine') loadMine();
  }, [tab, debouncedQ, loadPool, loadAll, loadMine]);

  function reloadActiveTab() {
    if (tab === 'pool') loadPool(debouncedQ);
    else if (tab === 'all') loadAll(debouncedQ);
    else if (tab === 'mine') loadMine();
  }

  async function handleClaim(id: string) {
    setClaimError(null);
    setClaimingId(id);
    try {
      await claimLead(id);
      reloadActiveTab();
    } catch (err) {
      setClaimError(errorMessage(err));
    } finally {
      setClaimingId(null);
    }
  }

  function openForm() {
    setForm(EMPTY_REGISTER_FORM);
    setFormError(null);
    setFormResult(null);
    setShowForm(true);
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormResult(null);
    setFormSubmitting(true);
    try {
      const res = await registerLead(form);
      setFormResult(res);
      setForm(EMPTY_REGISTER_FORM);
      reloadActiveTab();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setFormSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Leads</h1>
          <p className="muted">Pool lead, worklist attempt, &amp; registrasi (M0/M1).</p>
        </div>
        <button type="button" className="btn btnPrimary" onClick={openForm}>
          Registrasi Lead
        </button>
      </div>

      {showForm && (
        <section className="card">
          <div className="cardHeader">
            <h2>Registrasi Lead</h2>
          </div>
          <form className="form" onSubmit={handleRegister}>
            {formError && <div className="alert alertError" role="alert">{formError}</div>}
            {formResult && !formResult.info && (
              <div className="alert alertSuccess" role="status">
                {formResult.lead.id} dibuat.
              </div>
            )}
            {formResult && formResult.info && (
              <div className="alert alertInfo" role="status">
                {formResult.info}
              </div>
            )}
            <div className="formRow">
              <div className="field">
                <label htmlFor="lead-name">Nama Lead</label>
                <input
                  id="lead-name"
                  required
                  value={form.LeadName}
                  onChange={(e) => setForm((f) => ({ ...f, LeadName: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="lead-phone">Telepon</label>
                <input
                  id="lead-phone"
                  required
                  value={form.PhoneNumber}
                  onChange={(e) => setForm((f) => ({ ...f, PhoneNumber: e.target.value }))}
                />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="lead-email">Email (opsional)</label>
                <input
                  id="lead-email"
                  type="email"
                  value={form.Email}
                  onChange={(e) => setForm((f) => ({ ...f, Email: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="lead-source">Sumber</label>
                <input
                  id="lead-source"
                  required
                  value={form.Source}
                  onChange={(e) => setForm((f) => ({ ...f, Source: e.target.value }))}
                />
              </div>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <button type="submit" className="btn btnPrimary" disabled={formSubmitting}>
                {formSubmitting ? 'Menyimpan...' : 'Simpan'}
              </button>
              <button type="button" className="btn btnGhost" onClick={() => setShowForm(false)}>
                Tutup
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className={`btn ${tab === 'pool' ? 'btnPrimary' : 'btnSecondary'}`}
          onClick={() => setTab('pool')}
        >
          Pool
        </button>
        <button
          type="button"
          className={`btn ${tab === 'mine' ? 'btnPrimary' : 'btnSecondary'}`}
          onClick={() => setTab('mine')}
        >
          Milik Saya
        </button>
        {!allHidden && (
          <button
            type="button"
            className={`btn ${tab === 'all' ? 'btnPrimary' : 'btnSecondary'}`}
            onClick={() => setTab('all')}
          >
            Semua
          </button>
        )}
      </div>

      {(tab === 'pool' || tab === 'all') && (
        <div className="field" style={{ maxWidth: 320 }}>
          <label htmlFor="lead-search">Cari (nama / telepon)</label>
          <input
            id="lead-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="mis. Andi atau 0812..."
          />
        </div>
      )}

      {claimError && <div className="alert alertError" role="alert">{claimError}</div>}

      {tab === 'pool' && (
        <section className="card">
          {poolLoading && <p className="muted">Memuat...</p>}
          {poolError && <div className="alert alertError" role="alert">{poolError}</div>}
          {!poolLoading && !poolError && pool && pool.length === 0 && (
            <div className="emptyState">Tidak ada lead di Pool.</div>
          )}
          {!poolLoading && !poolError && pool && pool.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nama</th>
                    <th>Telepon</th>
                    <th>Sumber</th>
                    <th>Masuk</th>
                    <th></th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pool.map((lead) => (
                    <tr key={lead.id}>
                      <td>{lead.id}</td>
                      <td>{lead.lead_name}</td>
                      <td>{lead.phone_number}</td>
                      <td>{lead.source}</td>
                      <td>{formatDate(lead.created_at)}</td>
                      <td>{lead.stale ? <span className="badge badge-red">STALE</span> : '—'}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <button
                            type="button"
                            className="btn btnPrimary btnSm"
                            disabled={claimingId !== null}
                            onClick={() => handleClaim(lead.id)}
                          >
                            {claimingId === lead.id ? 'Memproses...' : 'Klaim'}
                          </button>
                          <Link href={`/leads/${lead.id}`} className="btn btnGhost btnSm">
                            Lihat
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'mine' && (
        <section className="card">
          {mineLoading && <p className="muted">Memuat...</p>}
          {mineError && <div className="alert alertError" role="alert">{mineError}</div>}
          {!mineLoading && !mineError && mine && mine.length === 0 && (
            <div className="emptyState">Belum ada attempt milik Anda.</div>
          )}
          {!mineLoading && !mineError && mine && mine.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>PRSP ID</th>
                    <th>Lead</th>
                    <th>Telepon</th>
                    <th>Status</th>
                    <th>Dibuat</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((att) => (
                    <tr key={att.id}>
                      <td>{att.id}</td>
                      <td>
                        <Link href={`/leads/${att.lead_id}`}>{att.lead_name}</Link>
                      </td>
                      <td>{att.phone_number}</td>
                      <td><StatusBadge status={att.status} /></td>
                      <td>{formatDate(att.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'all' && !allHidden && (
        <section className="card">
          {allLoading && <p className="muted">Memuat...</p>}
          {allError && <div className="alert alertError" role="alert">{allError}</div>}
          {!allLoading && !allError && all && all.length === 0 && (
            <div className="emptyState">Tidak ada lead.</div>
          )}
          {!allLoading && !allError && all && all.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nama</th>
                    <th>Telepon</th>
                    <th>Sumber</th>
                    <th>Masuk</th>
                    <th>Status</th>
                    <th>Pemilik Aktif</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {all.map((lead) => (
                    <tr key={lead.id}>
                      <td>{lead.id}</td>
                      <td>{lead.lead_name}</td>
                      <td>{lead.phone_number}</td>
                      <td>{lead.source}</td>
                      <td>
                        {formatDate(lead.created_at)}
                        {lead.stale && (
                          <>
                            {' '}
                            <span className="badge badge-red">STALE</span>
                          </>
                        )}
                      </td>
                      <td><StatusBadge status={lead.record_status} /></td>
                      <td>
                        {lead.active_owners.length > 0
                          ? lead.active_owners.map((o) => o.name || o.employee_id).join(', ')
                          : '—'}
                      </td>
                      <td>
                        <Link href={`/leads/${lead.id}`} className="btn btnGhost btnSm">
                          Lihat
                        </Link>
                      </td>
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
