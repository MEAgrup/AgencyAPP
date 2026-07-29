'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { AdminEmployee, CredentialInfo, EmployeeImportResult } from '@/lib/types';

export default function AdminEmployeesPage() {
  const [employees, setEmployees] = useState<AdminEmployee[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [csv, setCsv] = useState('');
  const [full, setFull] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<EmployeeImportResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // B1 recovery path: credential status + temp-password reset.
  const [creds, setCreds] = useState<CredentialInfo[] | null>(null);
  const [credError, setCredError] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: AdminEmployee[] }>('/admin/employees');
      setEmployees(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Credential status is a separate gate from the directory (Director OR division
  // Lead), so a 403 here must not blank the employee table — keep the errors apart.
  const loadCreds = useCallback(async () => {
    setCredError(null);
    try {
      const res = await api.get<{ data: CredentialInfo[] }>('/auth/admin/credentials');
      setCreds(res.data);
    } catch (err) {
      setCredError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
    loadCreds();
  }, [load, loadCreds]);

  async function handleReset() {
    setResetMsg(null);
    setCredError(null);
    setResetting(true);
    try {
      await api.post('/auth/admin/set-password', {
        employee_id: resetTarget,
        temp_password: tempPassword,
      });
      setResetMsg(
        `Password sementara untuk ${resetTarget} berhasil disetel. ` +
          'Sampaikan lewat kanal pribadi; karyawan wajib menggantinya saat login.',
      );
      setResetTarget('');
      setTempPassword('');
      await loadCreds();
    } catch (err) {
      setCredError(errorMessage(err));
    } finally {
      setResetting(false);
    }
  }

  /**
   * Imports employees from a pasted CSV. The employee source is an admin upload,
   * NOT an HRIS pull (DECISIONS OQ-4 dropped the HRIS endpoint) — this page used
   * to POST `/admin/employee-sync`, which no endpoint ever served on this stack.
   */
  async function handleImport() {
    if (csv.trim() === '') {
      setSyncError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
      return;
    }
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const res = await api.post<{ result: EmployeeImportResult }>('/admin/employee-import', {
        csv,
        full,
      });
      setSyncResult(res.result);
      await load();
    } catch (err) {
      setSyncError(errorMessage(err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Karyawan</h1>
        <p className="muted">Data karyawan hasil impor CSV admin.</p>
      </div>

      <section className="card stack">
        <div>
          <h2>Impor karyawan</h2>
          <p className="muted">
            Tempel CSV karyawan (kolom: employee_id, nama, email, divisi, jabatan, status_aktif).
            Impor bersifat idempoten — menjalankannya ulang dengan data sama tidak menduplikasi.
          </p>
        </div>
        <textarea
          className="input"
          rows={6}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder="employee_id,nama,email,divisi,jabatan,status_aktif"
        />
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
          <span>
            Impor penuh — karyawan yang ada di CDPS tapi tidak ada di CSV akan{' '}
            <strong>ditandai untuk review</strong> (tidak pernah dihapus).
          </span>
        </label>
        <div className="row">
          <button type="button" className="btn btnPrimary" disabled={syncing} onClick={handleImport}>
            {syncing ? 'Mengimpor...' : 'Impor CSV'}
          </button>
        </div>
      </section>

      {syncError && <div className="alert alertError">{syncError}</div>}
      {syncResult && (
        <div className="alert alertSuccess">
          Sumber: {syncResult.source} &middot; Sinkron: {syncResult.sync.synced} &middot;
          Dinonaktifkan: {syncResult.sync.deactivated} &middot; Diaktifkan kembali:{' '}
          {syncResult.sync.reactivated} &middot; Ditandai: {syncResult.sync.flagged} &middot;
          Kredensial dibuat: {syncResult.provisioned} &middot; Tertaut GoTrue: {syncResult.linked}
        </div>
      )}

      <section className="card stack">
        <div>
          <h2>Reset password (password sementara)</h2>
          <p className="muted">
            Jalur pemulihan untuk karyawan yang lupa password. Director dapat
            mereset siapa pun; Lead divisi hanya karyawan di divisinya sendiri.
            Setelah direset, sesi lama karyawan itu dimatikan dan ia{' '}
            <strong>wajib mengganti password saat login berikutnya</strong>.
          </p>
        </div>
        {credError && <div className="alert alertError">{credError}</div>}
        {resetMsg && <div className="alert alertSuccess">{resetMsg}</div>}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select
            className="input"
            value={resetTarget}
            onChange={(e) => setResetTarget(e.target.value)}
          >
            <option value="">— pilih karyawan —</option>
            {(creds ?? []).map((c) => (
              <option key={c.employee_id} value={c.employee_id}>
                {c.employee_id} — {c.nama}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="text"
            autoComplete="off"
            placeholder="password sementara (min. 8 karakter)"
            value={tempPassword}
            onChange={(e) => setTempPassword(e.target.value)}
          />
          <button
            type="button"
            className="btn btnPrimary"
            disabled={resetting || resetTarget === '' || tempPassword === ''}
            onClick={handleReset}
          >
            {resetting ? 'Menyetel...' : 'Setel Password Sementara'}
          </button>
        </div>

        {creds && creds.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nama</th>
                  <th>Punya Password</th>
                  <th>Wajib Ganti</th>
                  <th>Terakhir Ganti</th>
                </tr>
              </thead>
              <tbody>
                {creds.map((c) => (
                  <tr key={c.employee_id}>
                    <td>{c.employee_id}</td>
                    <td>{c.nama}</td>
                    <td>
                      <span className={`badge badge-${c.has_password ? 'green' : 'red'}`}>
                        {c.has_password ? 'Ya' : 'Belum'}
                      </span>
                    </td>
                    <td>
                      {c.must_change_password ? (
                        <span className="badge badge-orange">Wajib ganti</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {c.password_changed_at
                        ? new Date(c.password_changed_at).toLocaleDateString('id-ID')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError">{error}</div>}
        {!loading && !error && employees && employees.length === 0 && (
          <div className="emptyState">Belum ada data karyawan.</div>
        )}
        {!loading && !error && employees && employees.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nama</th>
                  <th>Email</th>
                  <th>Divisi</th>
                  <th>Jabatan</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.employee_id} className={emp.flagged ? 'flaggedRow' : ''}>
                    <td>{emp.employee_id}</td>
                    <td>{emp.nama}</td>
                    <td>{emp.email}</td>
                    <td>{emp.divisi}</td>
                    <td>{emp.jabatan}</td>
                    <td>
                      <span className={`badge badge-${emp.status_aktif ? 'green' : 'darkgray'}`}>
                        {emp.status_aktif ? 'Aktif' : 'Nonaktif'}
                      </span>
                      {emp.flagged && (
                        <span className="badge badge-red" style={{ marginLeft: 6 }}>Ditandai</span>
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
