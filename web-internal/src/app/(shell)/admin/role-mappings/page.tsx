'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { AdminEmployee, RoleMapping } from '@/lib/types';
import { DIVISIONS, LEVELS } from '@/lib/types';
import {
  filterPairs,
  orphanMappings,
  pairKey,
  pairLabel,
  parsePairKey,
  rolePairs,
} from '@/lib/role-mapping-pairs';

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

  // The HRIS pair is CHOSEN from the roster, not typed (see lib/role-mapping-pairs.ts).
  const [pairQuery, setPairQuery] = useState('');
  const [manualPair, setManualPair] = useState(false);

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

  // Derived, not fetched: both inputs are already on the page.
  const pairs = useMemo(() => rolePairs(employees, mappings ?? []), [employees, mappings]);
  const selectedKey = divisi !== '' && jabatan !== '' ? pairKey(divisi, jabatan) : '';
  const shownPairs = useMemo(
    () => filterPairs(pairs, pairQuery, selectedKey),
    [pairs, pairQuery, selectedKey],
  );
  const unmappedCount = pairs.filter((p) => p.mappedTo === null).length;
  const orphans = useMemo(() => orphanMappings(employees, mappings ?? []), [employees, mappings]);
  const selectedPair = pairs.find((p) => pairKey(p.divisi, p.jabatan) === selectedKey);

  /**
   * Picking a pair also PRE-FILLS its current CDPS target, so re-mapping one
   * jabatan cannot accidentally re-target it to whatever the form happened to
   * show — the create endpoint upserts on the pair, so this form edits as well
   * as creates.
   */
  function choosePair(key: string) {
    const parsed = key === '' ? null : parsePairKey(key);
    if (!parsed) {
      setDivisi('');
      setJabatan('');
      return;
    }
    setDivisi(parsed.divisi);
    setJabatan(parsed.jabatan);
    const existing = pairs.find((p) => pairKey(p.divisi, p.jabatan) === key)?.mappedTo;
    if (existing) {
      setDivision(existing.division);
      setLevel(existing.level);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api.post('/admin/role-mappings', { divisi, jabatan, division, level });
      setDivisi('');
      setJabatan('');
      setPairQuery('');
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
        <p className="muted">
          Pemetaan jabatan/divisi HRIS ke peran CDPS &mdash; ini akar izin: karyawan yang jabatannya
          belum dipetakan tidak punya divisi CDPS, jadi ia tidak muncul di dropdown penugasan mana pun
          dan ditolak server saat ditugaskan. <strong>AM dan CRO fungsinya sama</strong> (yang berbeda
          hanya level layanan kliennya), jadi keduanya dipetakan ke <strong>Account/staff</strong> dan
          keduanya bisa ditunjuk sebagai Account Manager.
        </p>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Tambah Role Mapping</h2>
        </div>
        <form className="form" onSubmit={handleCreate}>
          {formError && <div className="alert alertError" role="alert">{formError}</div>}
          {manualPair ? (
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
          ) : (
            <div className="field">
              <label htmlFor="hris-pair">Divisi + Jabatan (HRIS)</label>
              {/* Search is a plain filter over the pairs already loaded. */}
              <input
                id="hris-pair-search"
                type="search"
                placeholder="Cari jabatan — mis. relation, manager, atau 'belum'"
                aria-label="Cari jabatan HRIS"
                value={pairQuery}
                disabled={pairs.length === 0}
                onChange={(e) => setPairQuery(e.target.value)}
              />
              <select
                id="hris-pair"
                required
                value={selectedKey}
                disabled={pairs.length === 0}
                onChange={(e) => choosePair(e.target.value)}
              >
                <option value="">— pilih divisi + jabatan —</option>
                {shownPairs.map((p) => (
                  <option key={pairKey(p.divisi, p.jabatan)} value={pairKey(p.divisi, p.jabatan)}>
                    {pairLabel(p)}
                  </option>
                ))}
              </select>
              {pairs.length === 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  Belum ada data karyawan untuk diambil jabatannya. Impor karyawan lebih dulu di
                  Admin &rsaquo; Karyawan, atau isi pasangannya manual.
                </span>
              )}
              {pairs.length > 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {unmappedCount === 0
                    ? 'Semua jabatan pada data karyawan sudah dipetakan.'
                    : `${unmappedCount} jabatan BELUM DIPETAKAN (diurutkan paling atas) — pemegangnya belum ` +
                      'muncul di dropdown penugasan mana pun dan akan ditolak server saat ditugaskan.'}
                </span>
              )}
              {selectedPair?.mappedTo && (
                <span className="muted" style={{ fontSize: 12 }}>
                  Jabatan ini sudah dipetakan ke{' '}
                  <strong>{selectedPair.mappedTo.division}/{selectedPair.mappedTo.level}</strong> &mdash;
                  menyimpan akan MENGUBAH pemetaannya (berlaku untuk {selectedPair.activeCount} karyawan aktif).
                </span>
              )}
            </div>
          )}
          <label className="row" style={{ gap: 8, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={manualPair}
              onChange={(e) => {
                setManualPair(e.target.checked);
                setDivisi('');
                setJabatan('');
              }}
            />
            <span className="muted">
              Isi manual &mdash; untuk jabatan yang karyawannya belum diimpor. Ejaannya harus SAMA
              PERSIS dengan data HRIS; kalau beda, pemetaannya tidak berlaku untuk siapa pun.
            </span>
          </label>
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
            <button
              type="submit"
              className="btn btnPrimary"
              disabled={submitting || divisi.trim() === '' || jabatan.trim() === ''}
            >
              {submitting ? 'Menyimpan...' : selectedPair?.mappedTo ? 'Ubah Pemetaan' : 'Tambah'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Daftar Role Mapping</h2>
        </div>
        {orphans.length > 0 && (
          <div className="alert alertError" role="alert">
            {orphans.length} pemetaan tidak cocok dengan karyawan mana pun (
            {orphans.map((m) => `${m.divisi}/${m.jabatan}`).join(', ')}). Pemetaan seperti ini tidak
            memberi izin kepada siapa pun &mdash; biasanya salah ejaan saat diisi manual. Hapus, lalu
            pilih pasangannya dari dropdown di atas.
          </div>
        )}
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
