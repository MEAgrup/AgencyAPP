'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  assignAM,
  canManageAssignment,
  canReadIntake,
  listIntake,
  listStrategies,
  listWorkload,
  reassignAM,
  STRATEGY_SUBMITTED,
  type AMWorkload,
  type IntakeClient,
  type Strategy,
} from '@/lib/account';
import StatusBadge from '@/components/StatusBadge';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

export default function AccountWorkspacePage() {
  const { role } = useAuth();
  const router = useRouter();

  const showIntake = canReadIntake(role);
  const canManage = canManageAssignment(role);

  // Intake queue
  const [intake, setIntake] = useState<IntakeClient[] | null>(null);
  const [intakeLoading, setIntakeLoading] = useState(true);
  const [intakeError, setIntakeError] = useState<string | null>(null);

  // Workload
  const [workload, setWorkload] = useState<AMWorkload[] | null>(null);
  const [workloadLoading, setWorkloadLoading] = useState(true);
  const [workloadError, setWorkloadError] = useState<string | null>(null);

  // Strategies
  const [strategies, setStrategies] = useState<Strategy[] | null>(null);
  const [strategiesLoading, setStrategiesLoading] = useState(true);
  const [strategiesError, setStrategiesError] = useState<string | null>(null);
  const [strategyFilter, setStrategyFilter] = useState<'all' | 'inbox'>('all');

  // Assign AM (inline, per-row)
  const [assignPendingId, setAssignPendingId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);

  // Reassign AM (form)
  const [reClient, setReClient] = useState('');
  const [reAm, setReAm] = useState('');
  const [reReason, setReReason] = useState('');
  const [reSubmitting, setReSubmitting] = useState(false);
  const [reError, setReError] = useState<string | null>(null);
  const [reMessage, setReMessage] = useState<string | null>(null);

  // Open-by-id navigation
  const [serviceIdInput, setServiceIdInput] = useState('');

  const loadIntake = useCallback(async () => {
    if (!showIntake) {
      setIntakeLoading(false);
      setWorkloadLoading(false);
      return;
    }
    setIntakeLoading(true);
    setIntakeError(null);
    try {
      const res = await listIntake();
      setIntake(res.data);
    } catch (err) {
      setIntakeError(errorMessage(err));
    } finally {
      setIntakeLoading(false);
    }
  }, [showIntake]);

  const loadWorkload = useCallback(async () => {
    if (!showIntake) return;
    setWorkloadLoading(true);
    setWorkloadError(null);
    try {
      const res = await listWorkload();
      setWorkload(res.data);
    } catch (err) {
      setWorkloadError(errorMessage(err));
    } finally {
      setWorkloadLoading(false);
    }
  }, [showIntake]);

  const loadStrategies = useCallback(async () => {
    setStrategiesLoading(true);
    setStrategiesError(null);
    try {
      const res = await listStrategies();
      setStrategies(res.data);
    } catch (err) {
      setStrategiesError(errorMessage(err));
    } finally {
      setStrategiesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIntake();
    loadWorkload();
    loadStrategies();
  }, [loadIntake, loadWorkload, loadStrategies]);

  async function handleAssign(clientId: string, toko: string) {
    const amId = window.prompt(`Employee ID Account Manager untuk klien "${toko}":`);
    if (!amId) return;
    setAssignError(null);
    setAssignMessage(null);
    setAssignPendingId(clientId);
    try {
      const res = await assignAM(clientId, amId.trim());
      setAssignMessage(`AM ${res.assigned_am} ditugaskan untuk ${res.client_id}.`);
      await loadIntake();
      await loadWorkload();
    } catch (err) {
      setAssignError(errorMessage(err));
    } finally {
      setAssignPendingId(null);
    }
  }

  async function handleReassign(e: FormEvent) {
    e.preventDefault();
    setReError(null);
    setReMessage(null);
    setReSubmitting(true);
    try {
      const res = await reassignAM(reClient.trim(), reAm.trim(), reReason);
      setReMessage(
        `AM klien ${res.client_id} diubah dari ${res.previous_am || '—'} ke ${res.assigned_am}.`,
      );
      setReReason('');
      await loadWorkload();
    } catch (err) {
      setReError(errorMessage(err));
    } finally {
      setReSubmitting(false);
    }
  }

  function handleOpenService(e: FormEvent) {
    e.preventDefault();
    const id = serviceIdInput.trim();
    if (id) router.push(`/account/services/${encodeURIComponent(id)}`);
  }

  const visibleStrategies =
    strategies && strategyFilter === 'inbox'
      ? strategies.filter((s) => s.status === STRATEGY_SUBMITTED)
      : strategies;

  return (
    <div className="stack">
      <div>
        <h1>Account &amp; Service</h1>
        <p className="muted">
          Workspace Account (M6) &mdash; intake &amp; penunjukan AM, Strategy &amp; Plan, Brief, dan komplain.
        </p>
      </div>

      <div className="grid2">
        <section className="card">
          <div className="cardHeader">
            <h2>Navigasi Cepat</h2>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <Link href="/account/briefs" className="card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 600 }}>Papan Brief (Kanban)</div>
              <div className="muted" style={{ fontSize: 12 }}>Antrean Brief per divisi eksekusi.</div>
            </Link>
            <Link href="/account/complaints" className="card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 600 }}>Pintu Komplain</div>
              <div className="muted" style={{ fontSize: 12 }}>Catat &amp; kelola komplain per klien.</div>
            </Link>
          </div>
        </section>

        <section className="card">
          <div className="cardHeader">
            <h2>Buka Service</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Masukkan Service ID (SVC-...) untuk mengelola Strategy &amp; Plan dan Brief layanan tsb.
          </p>
          <form className="form" onSubmit={handleOpenService}>
            <div className="field">
              <label htmlFor="open-service">Service ID</label>
              <input
                id="open-service"
                placeholder="SVC-YYYYMM-NNNN"
                value={serviceIdInput}
                onChange={(e) => setServiceIdInput(e.target.value)}
              />
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={!serviceIdInput.trim()}>
                Buka
              </button>
            </div>
          </form>
        </section>
      </div>

      {showIntake && (
        <section className="card">
          <div className="cardHeader">
            <h2>Antrean Intake (Belum Ditugaskan)</h2>
          </div>
          {assignError && <div className="alert alertError" role="alert">{assignError}</div>}
          {assignMessage && <div className="alert alertSuccess" role="status">{assignMessage}</div>}
          {intakeLoading && <p className="muted">Memuat...</p>}
          {intakeError && <div className="alert alertError" role="alert">{intakeError}</div>}
          {!intakeLoading && !intakeError && intake && intake.length === 0 && (
            <div className="emptyState">Tidak ada klien yang menunggu penunjukan AM.</div>
          )}
          {!intakeLoading && !intakeError && intake && intake.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nama PIC</th>
                    <th>Toko</th>
                    <th>Kota</th>
                    <th>Kategori</th>
                    <th>Service</th>
                    <th>Dirilis ke Account</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {intake.map((c) => (
                    <tr key={c.client_id}>
                      <td>{c.nama_pic || '—'}</td>
                      <td>{c.toko || '—'}</td>
                      <td>{c.kota || '—'}</td>
                      <td>{c.kategori || '—'}</td>
                      <td>{c.service_count}</td>
                      <td>{formatDate(c.released_to_account_at)}</td>
                      <td>
                        {canManage && (
                          <button
                            type="button"
                            className="btn btnPrimary btnSm"
                            disabled={assignPendingId !== null}
                            onClick={() => handleAssign(c.client_id, c.toko)}
                          >
                            {assignPendingId === c.client_id ? 'Memproses...' : 'Assign AM'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {showIntake && (
        <section className="card">
          <div className="cardHeader">
            <h2>Beban Kerja AM</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Referensi saat menugaskan &mdash; jumlah klien aktif per AM (bukan batas keras).
          </p>
          {workloadLoading && <p className="muted">Memuat...</p>}
          {workloadError && <div className="alert alertError" role="alert">{workloadError}</div>}
          {!workloadLoading && !workloadError && workload && workload.length === 0 && (
            <div className="emptyState">Belum ada AM dengan klien aktif.</div>
          )}
          {!workloadLoading && !workloadError && workload && workload.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Account Manager</th>
                    <th>Klien Aktif</th>
                  </tr>
                </thead>
                <tbody>
                  {workload.map((w) => (
                    <tr key={w.am_employee_id}>
                      <td>{w.am_employee_id}</td>
                      <td>{w.active_client_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {canManage && (
        <section className="card">
          <div className="cardHeader">
            <h2>Reassign AM</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Pindahkan klien yang sudah punya AM ke AM lain. Alasan wajib diisi.
          </p>
          <form className="form" onSubmit={handleReassign}>
            {reError && <div className="alert alertError" role="alert">{reError}</div>}
            {reMessage && <div className="alert alertSuccess" role="status">{reMessage}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="re-client">Client ID</label>
                <input
                  id="re-client"
                  required
                  placeholder="CLI-YYYYMM-NNNN"
                  value={reClient}
                  onChange={(e) => setReClient(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="re-am">AM Tujuan (Employee ID)</label>
                <input id="re-am" required value={reAm} onChange={(e) => setReAm(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="re-reason">Alasan</label>
              <input id="re-reason" required value={reReason} onChange={(e) => setReReason(e.target.value)} />
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={reSubmitting}>
                {reSubmitting ? 'Memproses...' : 'Reassign AM'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Strategy &amp; Plan</h2>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className={`btn btnSm ${strategyFilter === 'all' ? 'btnPrimary' : 'btnSecondary'}`}
              onClick={() => setStrategyFilter('all')}
            >
              Semua
            </button>
            <button
              type="button"
              className={`btn btnSm ${strategyFilter === 'inbox' ? 'btnPrimary' : 'btnSecondary'}`}
              onClick={() => setStrategyFilter('inbox')}
            >
              Menunggu Persetujuan
            </button>
          </div>
        </div>
        {strategiesLoading && <p className="muted">Memuat...</p>}
        {strategiesError && <div className="alert alertError" role="alert">{strategiesError}</div>}
        {!strategiesLoading && !strategiesError && visibleStrategies && visibleStrategies.length === 0 && (
          <div className="emptyState">
            {strategyFilter === 'inbox'
              ? 'Tidak ada Strategy & Plan yang menunggu persetujuan.'
              : 'Belum ada Strategy & Plan yang terlihat untuk peran Anda.'}
          </div>
        )}
        {!strategiesLoading && !strategiesError && visibleStrategies && visibleStrategies.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Strategy ID</th>
                  <th>Service</th>
                  <th>Objective</th>
                  <th>Timeline</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleStrategies.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/account/strategies/${s.id}`}>{s.id}</Link>
                    </td>
                    <td>
                      <Link href={`/account/services/${encodeURIComponent(s.service_id)}`}>{s.service_id}</Link>
                    </td>
                    <td>{s.objective || '—'}</td>
                    <td>
                      {s.timeline_start || '—'} &rarr; {s.timeline_end || '—'}
                    </td>
                    <td><StatusBadge status={s.status} /></td>
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
