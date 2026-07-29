'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { AdminEmployee, EmployeeImportResult } from '@/lib/types';

export default function AdminEmployeesPage() {
  const [employees, setEmployees] = useState<AdminEmployee[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [csv, setCsv] = useState('');
  const [full, setFull] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<EmployeeImportResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

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

  useEffect(() => {
    load();
  }, [load]);

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
