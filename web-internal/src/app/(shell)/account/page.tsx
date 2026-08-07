'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { LEVEL_STAFF, useAssignableEmployees } from '@/lib/directory';
import EmployeePicker from '@/components/EmployeePicker';
import {
  ACCOUNT_DIVISION,
  assignAM,
  canManageAssignment,
  canReadIntake,
  listIntake,
  listServiceQueue,
  listStrategies,
  listWorkload,
  needsOnboarding,
  nextOnboardingStep,
  reassignAM,
  STRATEGY_SUBMITTED,
  type AMWorkload,
  type IntakeClient,
  type ServiceQueueRow,
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

  // Service queue (§3 Rule 4) — the AM's own work list, and the ONLY navigable
  // door into §4/§5. Every actor who reaches this page may read it (the endpoint
  // scopes itself: AM → own clients, lead/OD/Director → all).
  const [services, setServices] = useState<ServiceQueueRow[] | null>(null);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [serviceFilter, setServiceFilter] = useState<'onboarding' | 'all'>('onboarding');

  // Strategies
  const [strategies, setStrategies] = useState<Strategy[] | null>(null);
  const [strategiesLoading, setStrategiesLoading] = useState(true);
  const [strategiesError, setStrategiesError] = useState<string | null>(null);
  const [strategyFilter, setStrategyFilter] = useState<'all' | 'inbox'>('all');

  // Assign AM (per-row → a panel with the AM picker; no more window.prompt)
  const [assignTarget, setAssignTarget] = useState<IntakeClient | null>(null);
  const [assignAmId, setAssignAmId] = useState('');
  const [assignPendingId, setAssignPendingId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);

  // The AM directory — Account-division STAFF, exactly what `validateAMCandidate`
  // accepts (§3 Rule 2). Fetched only for the roles that may assign, so a staff
  // AM does not fire a request for a control they never see.
  const {
    employees: amCandidates,
    loading: amLoading,
    error: amError,
  } = useAssignableEmployees(ACCOUNT_DIVISION, LEVEL_STAFF, canManage);

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

  const loadServices = useCallback(async () => {
    setServicesLoading(true);
    setServicesError(null);
    try {
      const res = await listServiceQueue();
      setServices(res.data);
    } catch (err) {
      setServicesError(errorMessage(err));
    } finally {
      setServicesLoading(false);
    }
  }, []);

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
    loadServices();
    loadStrategies();
  }, [loadIntake, loadWorkload, loadServices, loadStrategies]);

  /** Opens the assign panel for one intake row (nothing is sent yet). */
  function openAssign(client: IntakeClient) {
    setAssignTarget(client);
    setAssignAmId('');
    setAssignError(null);
    setAssignMessage(null);
  }

  async function handleAssign() {
    if (!assignTarget || assignAmId === '') return;
    const clientId = assignTarget.client_id;
    setAssignError(null);
    setAssignMessage(null);
    setAssignPendingId(clientId);
    try {
      const res = await assignAM(clientId, assignAmId);
      const am = amCandidates?.find((e) => e.employee_id === res.assigned_am);
      setAssignMessage(
        `AM ${am ? `${am.nama} (${res.assigned_am})` : res.assigned_am} ditugaskan untuk ${res.client_id}. ` +
          'Semua layanan klien ini kini ada di antrean onboarding AM tersebut.',
      );
      setAssignTarget(null);
      setAssignAmId('');
      await loadIntake();
      await loadWorkload();
      // The client just LEFT the intake queue and ENTERED the service queue —
      // refresh both, or the row appears to vanish into nothing.
      await loadServices();
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
      const res = await reassignAM(reClient.trim(), reAm, reReason);
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

  const visibleServices =
    services && serviceFilter === 'onboarding' ? services.filter(needsOnboarding) : services;

  /**
   * Per-AM workload note inside the picker (§3 Rule 5): the count is a REFERENCE,
   * not a hard cap, and it belongs next to the choice it informs — the table below
   * only lists AMs who already own clients, so an AM with zero is invisible there
   * and looks unavailable when they are in fact the freest person on the team.
   */
  const workloadHint = (employeeId: string): string => {
    const row = workload?.find((w) => w.am_employee_id === employeeId);
    return `${row?.active_client_count ?? 0} klien aktif`;
  };

  /**
   * Shared by BOTH AM doors (assign + reassign), so the answer to "kenapa nama X
   * tidak ada?" cannot drift between them. It names the real mechanism: the list
   * is driven by `role_mappings`, and AM vs CRO is a jabatan label on the same
   * CDPS role (owner 2026-08-04 — the two differ only in the client's service
   * tier, which CDPS does not model as a role).
   */
  const amPickerNote = (
    <>
      Daftar = karyawan <strong>aktif</strong> yang jabatan HRIS-nya dipetakan ke{' '}
      <strong>Account/staff</strong>. AM dan CRO fungsinya sama (yang berbeda hanya level layanan
      kliennya), jadi keduanya muncul di sini. Ada nama yang belum muncul? Petakan jabatannya di{' '}
      <Link href="/admin/role-mappings">Admin &rsaquo; Role Mapping</Link>.
    </>
  );

  return (
    <div className="stack">
      <div>
        <h1>Account &amp; Service</h1>
        <p className="muted">
          Workspace Account (M6) &mdash; intake &amp; penunjukan AM, Strategy &amp; Plan, Brief, dan komplain.
        </p>
      </div>

      {/* §3 Rule 4 — the AM's personal queue. First on the page because it is the
          work: every §4/§5 door is keyed by a Service ID, and before this list
          existed the only way to obtain one was to already know it. */}
      <section className="card">
        <div className="cardHeader">
          <h2>Antrean Layanan Klien</h2>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className={`btn btnSm ${serviceFilter === 'onboarding' ? 'btnPrimary' : 'btnSecondary'}`}
              onClick={() => setServiceFilter('onboarding')}
            >
              Perlu Onboarding
            </button>
            <button
              type="button"
              className={`btn btnSm ${serviceFilter === 'all' ? 'btnPrimary' : 'btnSecondary'}`}
              onClick={() => setServiceFilter('all')}
            >
              Semua
            </button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Layanan klien yang Anda pegang. Kolom <strong>Langkah Berikutnya</strong> menunjukkan pintu yang
          harus dibuka: layanan <em>plan-gated</em>{' '}
          wajib punya Strategy &amp; Plan yang disetujui SPV sebelum Brief bisa dibuat (M6 §4 Rule 5),
          layanan <em>Direct</em> langsung ke Brief (§5 Rule 3).
        </p>
        {servicesLoading && <p className="muted">Memuat...</p>}
        {servicesError && <div className="alert alertError" role="alert">{servicesError}</div>}
        {!servicesLoading && !servicesError && visibleServices && visibleServices.length === 0 && (
          <div className="emptyState">
            {serviceFilter === 'onboarding'
              ? 'Tidak ada layanan yang menunggu onboarding.'
              : 'Belum ada layanan klien yang terlihat untuk peran Anda.'}
          </div>
        )}
        {!servicesLoading && !servicesError && visibleServices && visibleServices.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Klien</th>
                  <th>Layanan</th>
                  <th>Service ID</th>
                  <th>Jalur</th>
                  <th>Status</th>
                  <th>Brief</th>
                  <th>Langkah Berikutnya</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleServices.map((s) => {
                  const step = nextOnboardingStep(s);
                  return (
                    <tr key={s.service_id}>
                      <td>
                        <Link href={`/clients/${encodeURIComponent(s.client_id)}`}>{s.toko || s.client_id}</Link>
                      </td>
                      <td>{s.name}</td>
                      <td>{s.service_id}</td>
                      <td>
                        {s.requires_strategy_plan ? (
                          <span className="badge badge-purple">Plan-gated</span>
                        ) : (
                          <span className="badge badge-gray">Direct</span>
                        )}
                        {s.overridden && (
                          <span className="muted" style={{ fontSize: 11, marginLeft: 6 }} title="Kebutuhan Strategy & Plan di-override dari pin Master Service List">
                            override
                          </span>
                        )}
                      </td>
                      <td><StatusBadge status={s.status} /></td>
                      <td>{s.brief_count}</td>
                      <td>
                        {step.label}
                        {s.strategy_id && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            <Link href={`/account/strategies/${s.strategy_id}`}>{s.strategy_id}</Link>
                          </div>
                        )}
                      </td>
                      <td>
                        <Link
                          href={`/account/services/${encodeURIComponent(s.service_id)}`}
                          className="btn btnPrimary btnSm"
                        >
                          {step.kind === 'monitor' || step.kind === 'none' ? 'Buka' : 'Kelola'}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

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

          {/* The assign panel. Opened by the row's button, so the dropdown is
              rendered once (not per row) and the client it applies to is named
              in the heading — the old window.prompt named it in the prompt text. */}
          {canManage && assignTarget && (
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                Tugaskan AM untuk {assignTarget.toko || assignTarget.client_id}
                <span className="muted" style={{ fontWeight: 400 }}> &middot; {assignTarget.client_id}</span>
              </div>
              <EmployeePicker
                id="assign-am"
                label="Account Manager / CRO"
                required
                employees={amCandidates}
                loading={amLoading}
                error={amError}
                value={assignAmId}
                onChange={setAssignAmId}
                hint={(e) => workloadHint(e.employee_id)}
                note={amPickerNote}
                emptyHint={
                  'Belum ada karyawan Account/staff yang aktif. Satu klien hanya bisa dipegang staff ' +
                  'Account aktif — impor karyawannya di Admin › Karyawan, lalu petakan jabatan HRIS-nya ' +
                  '(Account Manager, CRO, dst.) ke Account/staff di Admin › Role Mapping.'
                }
              />
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btnPrimary btnSm"
                  disabled={assignAmId === '' || assignPendingId !== null}
                  onClick={handleAssign}
                >
                  {assignPendingId === assignTarget.client_id ? 'Memproses...' : 'Tugaskan'}
                </button>
                <button
                  type="button"
                  className="btn btnSecondary btnSm"
                  disabled={assignPendingId !== null}
                  onClick={() => setAssignTarget(null)}
                >
                  Batal
                </button>
              </div>
            </div>
          )}
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
                            onClick={() => openAssign(c)}
                          >
                            {assignTarget?.client_id === c.client_id ? 'Pilih AM di atas' : 'Assign AM'}
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
                  {workload.map((w) => {
                    // Name from the same directory the picker uses; the endpoint
                    // returns ids only, and an id alone is not who anyone is.
                    const am = amCandidates?.find((e) => e.employee_id === w.am_employee_id);
                    return (
                      <tr key={w.am_employee_id}>
                        <td>{am ? `${am.nama} (${w.am_employee_id})` : w.am_employee_id}</td>
                        <td>{w.active_client_count}</td>
                      </tr>
                    );
                  })}
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
              <EmployeePicker
                id="re-am"
                label="AM / CRO Tujuan"
                required
                employees={amCandidates}
                loading={amLoading}
                error={amError}
                value={reAm}
                onChange={setReAm}
                hint={(e) => workloadHint(e.employee_id)}
                note={amPickerNote}
                emptyHint={
                  'Belum ada karyawan Account/staff yang aktif untuk dijadikan AM tujuan. Impor ' +
                  'karyawannya di Admin › Karyawan, lalu petakan jabatan HRIS-nya (Account Manager, ' +
                  'CRO, dst.) ke Account/staff di Admin › Role Mapping.'
                }
              />
            </div>
            <div className="field">
              <label htmlFor="re-reason">Alasan</label>
              <input id="re-reason" required value={reReason} onChange={(e) => setReReason(e.target.value)} />
            </div>
            <div>
              <button
                type="submit"
                className="btn btnPrimary"
                disabled={reSubmitting || reAm === '' || reClient.trim() === ''}
              >
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
