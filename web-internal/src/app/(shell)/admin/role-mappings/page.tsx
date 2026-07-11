'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { AdminEmployee, RoleMapping } from '@/lib/types';
import { DIVISIONS, LEVELS } from '@/lib/types';

export default function RoleMappingsPage() {
  const [mappings, setMappings] = useState<RoleMapping[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [divisi, setDivisi] = useState('');
  const [jabatan, setJabatan] = useState('');
  const [division, setDivision] = useState<string>(DIVISIONS[0]);
  const [level, setLevel] = useState<string>(LEVELS[0]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [layeredEmployeeId, setLayeredEmployeeId] = useState('');
  const [layeredError, setLayeredError] = useState<string | null>(null);
  const [layeredMessage, setLayeredMessage] = useState<string | null>(null);
  const [layeredSubmitting, setLayeredSubmitting] = useState<'od' | 'director' | null>(null);

  const loadMappings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: RoleMapping[] }>('/admin/role-mappings');
      setMappings(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEmployees = useCallback(async () => {
    try {
      const res = await api.get<{ data: AdminEmployee[] }>('/admin/employees');
      setEmployees(res.data);
      if (res.data.length > 0) setLayeredEmployeeId((prev) => prev || res.data[0].employee_id);
    } catch {
      // The picker degrades to empty; the main table error already surfaces load issues.
    }
  }, []);

  useEffect(() => {
    loadMappings();
    loadEmployees();
  }, [loadMappings, loadEmployees]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api.post('/admin/role-mappings', { divisi, jabatan, division, level });
      setDivisi('');
      setJabatan('');
      await loadMappings();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      await api.delete(`/admin/role-mappings/${id}`);
      await loadMappings();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleLayeredToggle(role: 'od' | 'director', enabled: boolean) {
    if (!layeredEmployeeId) return;
    setLayeredError(null);
    setLayeredMessage(null);
    setLayeredSubmitting(role);
    try {
      await api.post('/admin/layered-roles', { employee_id: layeredEmployeeId, role, enabled });
      setLayeredMessage(`Peran ${role === 'od' ? 'OD' : 'Direktur'} berhasil ${enabled ? 'diaktifkan' : 'dinonaktifkan'}.`);
    } catch (err) {
      setLayeredError(errorMessage(err));
    } finally {
      setLayeredSubmitting(null);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Role Mapping</h1>
        <p className="muted">Pemetaan jabatan/divisi HRIS ke peran CDPS.</p>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Tambah Role Mapping</h2>
        </div>
        <form className="form" onSubmit={handleCreate}>
          {formError && <div className="alert alertError" role="alert">{formError}</div>}
          <div className="formRow">
            <div className="field">
              <label htmlFor="divisi">Divisi (HRIS)</label>
              <input id="divisi" required value={divisi} onChange={(e) => setDivisi(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="jabatan">Jabatan (HRIS)</label>
              <input id="jabatan" required value={jabatan} onChange={(e) => setJabatan(e.target.value)} />
            </div>
          </div>
          <div className="formRow">
            <div className="field">
              <label htmlFor="division">Division (CDPS)</label>
              <select id="division" value={division} onChange={(e) => setDivision(e.target.value)}>
                {DIVISIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="level">Level (CDPS)</label>
              <select id="level" value={level} onChange={(e) => setLevel(e.target.value)}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <button type="submit" className="btn btnPrimary" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Tambah'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Daftar Role Mapping</h2>
        </div>
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError">{error}</div>}
        {!loading && !error && mappings && mappings.length === 0 && (
          <div className="emptyState">Belum ada role mapping.</div>
        )}
        {!loading && !error && mappings && mappings.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Divisi (HRIS)</th>
                  <th>Jabatan (HRIS)</th>
                  <th>Division</th>
                  <th>Level</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id}>
                    <td>{m.divisi}</td>
                    <td>{m.jabatan}</td>
                    <td>{m.division}</td>
                    <td>{m.level}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btnDanger btnSm"
                        disabled={deletingId === m.id}
                        onClick={() => handleDelete(m.id)}
                      >
                        {deletingId === m.id ? 'Menghapus...' : 'Hapus'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Layered Roles (OD / Direktur)</h2>
        </div>
        {layeredError && <div className="alert alertError">{layeredError}</div>}
        {layeredMessage && <div className="alert alertSuccess">{layeredMessage}</div>}
        <div className="form">
          <div className="field">
            <label htmlFor="employee">Karyawan</label>
            <select
              id="employee"
              value={layeredEmployeeId}
              onChange={(e) => setLayeredEmployeeId(e.target.value)}
            >
              {employees.length === 0 && <option value="">Tidak ada data karyawan</option>}
              {employees.map((emp) => (
                <option key={emp.employee_id} value={emp.employee_id}>
                  {emp.nama} — {emp.divisi}/{emp.jabatan}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button
              type="button"
              className="btn btnPrimary"
              disabled={!layeredEmployeeId || layeredSubmitting !== null}
              onClick={() => handleLayeredToggle('od', true)}
            >
              {layeredSubmitting === 'od' ? 'Memproses...' : 'Aktifkan OD'}
            </button>
            <button
              type="button"
              className="btn btnSecondary"
              disabled={!layeredEmployeeId || layeredSubmitting !== null}
              onClick={() => handleLayeredToggle('od', false)}
            >
              Nonaktifkan OD
            </button>
            <button
              type="button"
              className="btn btnPrimary"
              disabled={!layeredEmployeeId || layeredSubmitting !== null}
              onClick={() => handleLayeredToggle('director', true)}
            >
              {layeredSubmitting === 'director' ? 'Memproses...' : 'Aktifkan Direktur'}
            </button>
            <button
              type="button"
              className="btn btnSecondary"
              disabled={!layeredEmployeeId || layeredSubmitting !== null}
              onClick={() => handleLayeredToggle('director', false)}
            >
              Nonaktifkan Direktur
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
