'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { AdminEmployee, EmployeeSyncResult } from '@/lib/types';

export default function AdminEmployeesPage() {
  const [employees, setEmployees] = useState<AdminEmployee[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<EmployeeSyncResult | null>(null);
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

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const res = await api.post<EmployeeSyncResult>('/admin/employee-sync');
      setSyncResult(res);
      await load();
    } catch (err) {
      setSyncError(errorMessage(err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Karyawan</h1>
          <p className="muted">Data karyawan hasil sinkronisasi HRIS.</p>
        </div>
        <button type="button" className="btn btnPrimary" disabled={syncing} onClick={handleSync}>
          {syncing ? 'Menyinkronkan...' : 'Sync Sekarang'}
        </button>
      </div>

      {syncError && <div className="alert alertError">{syncError}</div>}
      {syncResult && (
        <div className="alert alertSuccess">
          Sinkron: {syncResult.synced} &middot; Dinonaktifkan: {syncResult.deactivated} &middot; Ditandai: {syncResult.flagged}
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
