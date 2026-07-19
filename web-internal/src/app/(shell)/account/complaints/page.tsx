'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  SEVERITIES,
  createComplaint,
  isAccountStaff,
  isReadOnlyOD,
  listComplaints,
  type Complaint,
} from '@/lib/account';
import StatusBadge from '@/components/StatusBadge';

export default function ComplaintsWorkspacePage() {
  const { role } = useAuth();
  const readOnly = isReadOnlyOD(role);
  // Only the client's AM (Account staff) or Director may log a complaint
  // (complaint.go:146-149, ErrLogComplaintForbidden) — brief §4: the log form
  // is hidden for every other role. Per-client ownership stays server-checked.
  const canLog = !readOnly && (isAccountStaff(role) || !!role?.director);

  const [clientIdInput, setClientIdInput] = useState('');
  const [activeClientId, setActiveClientId] = useState<string | null>(null);

  const [complaints, setComplaints] = useState<Complaint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Log new complaint
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<string>(SEVERITIES[0].value);
  const [relatedRef, setRelatedRef] = useState('');
  const [logSubmitting, setLogSubmitting] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logMessage, setLogMessage] = useState<string | null>(null);

  async function loadComplaints(clientId: string) {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listComplaints(clientId);
      setComplaints(res.data);
    } catch (err) {
      setLoadError(errorMessage(err));
      setComplaints(null);
    } finally {
      setLoading(false);
    }
  }

  function handleLoad(e: FormEvent) {
    e.preventDefault();
    const id = clientIdInput.trim();
    if (!id) return;
    setActiveClientId(id);
    setLogMessage(null);
    setLogError(null);
    loadComplaints(id);
  }

  async function handleLog(e: FormEvent) {
    e.preventDefault();
    if (!activeClientId) return;
    setLogError(null);
    setLogMessage(null);
    setLogSubmitting(true);
    try {
      const res = await createComplaint(activeClientId, {
        description,
        severity,
        related_ref: relatedRef.trim(),
      });
      setLogMessage(`Komplain ${res.id} berhasil dicatat.`);
      setDescription('');
      setRelatedRef('');
      await loadComplaints(activeClientId);
    } catch (err) {
      setLogError(errorMessage(err));
    } finally {
      setLogSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <Link href="/account" className="muted">&larr; Kembali ke Account</Link>
      </div>

      <div>
        <h1>Pintu Komplain</h1>
        <p className="muted">Catat dan kelola komplain per klien (M6 §8). Masukkan Client ID untuk mulai.</p>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Pilih Klien</h2>
        </div>
        <form className="form" onSubmit={handleLoad}>
          <div className="field">
            <label htmlFor="cpl-client">Client ID</label>
            <input
              id="cpl-client"
              placeholder="CLI-YYYYMM-NNNN"
              value={clientIdInput}
              onChange={(e) => setClientIdInput(e.target.value)}
            />
          </div>
          <div>
            <button type="submit" className="btn btnPrimary" disabled={!clientIdInput.trim()}>
              Muat Komplain
            </button>
          </div>
        </form>
      </section>

      {activeClientId && (
        <section className="card">
          <div className="cardHeader">
            <h2>Komplain &mdash; {activeClientId}</h2>
          </div>
          {loading && <p className="muted">Memuat...</p>}
          {loadError && <div className="alert alertError" role="alert">{loadError}</div>}
          {!loading && !loadError && complaints && complaints.length === 0 && (
            <div className="emptyState">Belum ada komplain untuk klien ini.</div>
          )}
          {!loading && !loadError && complaints && complaints.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Komplain ID</th>
                    <th>Deskripsi</th>
                    <th>Severity</th>
                    <th>Sumber</th>
                    <th>Referensi</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {complaints.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/account/complaints/${c.id}`}>{c.id}</Link>
                      </td>
                      <td>{c.description}</td>
                      <td>{c.severity}</td>
                      <td>{c.source}</td>
                      <td>{c.related_ref || '—'}</td>
                      <td><StatusBadge status={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeClientId && canLog && (
        <section className="card">
          <div className="cardHeader">
            <h2>Catat Komplain Baru</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Penalti Health Score per severity: Low &minus;5, Medium &minus;15, High &minus;30 (otomatis, hanya info).
          </p>
          <form className="form" onSubmit={handleLog}>
            {logError && <div className="alert alertError" role="alert">{logError}</div>}
            {logMessage && <div className="alert alertSuccess" role="status">{logMessage}</div>}
            <div className="field">
              <label htmlFor="cpl-desc">Deskripsi</label>
              <textarea id="cpl-desc" required value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="cpl-severity">Severity</label>
                <select id="cpl-severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
                  {SEVERITIES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.value} (Health {s.penalty})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="cpl-ref">Referensi SVC-/BRF- (opsional)</label>
                <input
                  id="cpl-ref"
                  placeholder="SVC-... atau BRF-..."
                  value={relatedRef}
                  onChange={(e) => setRelatedRef(e.target.value)}
                />
              </div>
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={logSubmitting}>
                {logSubmitting ? 'Menyimpan...' : 'Catat Komplain'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
