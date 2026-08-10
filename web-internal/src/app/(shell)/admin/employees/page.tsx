'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { CredentialInfo, EmployeeImportResult } from '@/lib/types';

export default function AdminEmployeesPage() {
  const { role } = useAuth();

  const [csv, setCsv] = useState('');
  const [full, setFull] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<EmployeeImportResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // The single employee roster. Sourced from /auth/admin/credentials, which
  // already carries email/divisi/jabatan alongside the credential status — so the
  // page shows ONE table (DECISIONS 2026-08-10: the second, /admin/employees
  // directory table was a duplicate and was removed).
  const [creds, setCreds] = useState<CredentialInfo[] | null>(null);
  const [credError, setCredError] = useState<string | null>(null);

  // Reset password (temp-password recovery path).
  const [resetTarget, setResetTarget] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  // Name search over the roster.
  const [query, setQuery] = useState('');

  // Mutasi (edit divisi/jabatan) — Director or HR-division Lead only. Server is
  // the real gate (the button is a cosmetic hide, per house convention).
  const canMutate = !!role?.director || (role?.level === 'lead' && role?.division === 'HR');
  const [editId, setEditId] = useState<string | null>(null);
  const [editDivisi, setEditDivisi] = useState('');
  const [editJabatan, setEditJabatan] = useState('');
  const [savingMut, setSavingMut] = useState(false);
  const [mutError, setMutError] = useState<string | null>(null);
  const [mutMsg, setMutMsg] = useState<string | null>(null);

  // Tambah karyawan manual (bukan lewat CSV/sheet) — same gate as mutasi.
  const [addOpen, setAddOpen] = useState(false);
  const [newEmp, setNewEmp] = useState({
    employee_id: '',
    nama: '',
    email: '',
    divisi: '',
    jabatan: '',
    temp_password: '',
  });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addMsg, setAddMsg] = useState<string | null>(null);

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
    loadCreds();
  }, [loadCreds]);

  const filtered = useMemo(() => {
    const list = creds ?? [];
    const q = query.trim().toLowerCase();
    if (q === '') return list;
    return list.filter(
      (c) =>
        c.nama.toLowerCase().includes(q) ||
        c.employee_id.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q),
    );
  }, [creds, query]);

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
      await loadCreds();
    } catch (err) {
      setSyncError(errorMessage(err));
    } finally {
      setSyncing(false);
    }
  }

  function startEdit(c: CredentialInfo) {
    setEditId(c.employee_id);
    setEditDivisi(c.divisi);
    setEditJabatan(c.jabatan);
    setMutError(null);
    setMutMsg(null);
  }

  function cancelEdit() {
    setEditId(null);
    setEditDivisi('');
    setEditJabatan('');
  }

  async function saveEdit(employeeId: string) {
    setMutError(null);
    setMutMsg(null);
    setSavingMut(true);
    try {
      await api.put(`/admin/employees/${employeeId}`, {
        divisi: editDivisi,
        jabatan: editJabatan,
      });
      setMutMsg(
        `Mutasi ${employeeId} tersimpan. Peran baru berlaku saat karyawan login/refresh berikutnya.`,
      );
      cancelEdit();
      await loadCreds();
    } catch (err) {
      setMutError(errorMessage(err));
    } finally {
      setSavingMut(false);
    }
  }

  async function handleAddEmployee() {
    setAddError(null);
    setAddMsg(null);
    setAdding(true);
    try {
      await api.post('/admin/employees', {
        employee_id: newEmp.employee_id,
        nama: newEmp.nama,
        email: newEmp.email,
        divisi: newEmp.divisi,
        jabatan: newEmp.jabatan,
        status_aktif: true,
        temp_password: newEmp.temp_password,
      });
      const tempNote =
        newEmp.temp_password.trim() === ''
          ? 'password sementara default'
          : 'password sementara yang Anda isi';
      setAddMsg(
        `Karyawan ${newEmp.nama} (${newEmp.employee_id}) ditambahkan. ` +
          `Ia bisa login dengan ${tempNote} dan wajib menggantinya saat login pertama.`,
      );
      setNewEmp({ employee_id: '', nama: '', email: '', divisi: '', jabatan: '', temp_password: '' });
      setAddOpen(false);
      await loadCreds();
    } catch (err) {
      setAddError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  const addComplete =
    newEmp.employee_id.trim() !== '' &&
    newEmp.nama.trim() !== '' &&
    newEmp.email.trim() !== '' &&
    newEmp.divisi.trim() !== '' &&
    newEmp.jabatan.trim() !== '';

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
      </section>

      <section className="card stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <h2>Direktori karyawan</h2>
            <p className="muted">
              Cari karyawan berdasarkan nama, ID, atau email.
              {canMutate && ' Gunakan “Mutasi” untuk memindahkan divisi/jabatan.'}
            </p>
          </div>
          {canMutate && (
            <button
              type="button"
              className="btn btnPrimary"
              onClick={() => {
                setAddOpen((v) => !v);
                setAddError(null);
                setAddMsg(null);
              }}
            >
              {addOpen ? 'Tutup form' : '+ Tambah Karyawan'}
            </button>
          )}
        </div>

        {/* Pencarian nama — bar penuh yang jelas, di atas tabel. */}
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">Cari karyawan</span>
          <input
            className="input"
            type="search"
            autoComplete="off"
            placeholder="Ketik nama, ID, atau email karyawan…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        {canMutate && addOpen && (
          <div className="card stack" style={{ gap: 12 }}>
            <div>
              <h3>Tambah karyawan manual</h3>
              <p className="muted">
                Menambah satu karyawan tanpa CSV. <strong>ID (NIK)</strong> diterbitkan HRIS —
                masukkan apa adanya. Karyawan langsung bisa login dengan password sementara dan
                wajib menggantinya saat login pertama. Divisi/Jabatan menentukan peran lewat Role
                Mapping (petakan bila belum ada).
              </p>
            </div>
            <div className="grid2" style={{ gap: 12 }}>
              <label className="stack" style={{ gap: 4 }}>
                <span className="muted">ID / NIK karyawan *</span>
                <input
                  className="input"
                  value={newEmp.employee_id}
                  onChange={(e) => setNewEmp({ ...newEmp, employee_id: e.target.value })}
                  placeholder="mis. 2601270613"
                />
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="muted">Nama *</span>
                <input
                  className="input"
                  value={newEmp.nama}
                  onChange={(e) => setNewEmp({ ...newEmp, nama: e.target.value })}
                />
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="muted">Email *</span>
                <input
                  className="input"
                  type="email"
                  value={newEmp.email}
                  onChange={(e) => setNewEmp({ ...newEmp, email: e.target.value })}
                />
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="muted">Divisi *</span>
                <input
                  className="input"
                  value={newEmp.divisi}
                  onChange={(e) => setNewEmp({ ...newEmp, divisi: e.target.value })}
                  placeholder="mis. ACCOUNT"
                />
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="muted">Jabatan *</span>
                <input
                  className="input"
                  value={newEmp.jabatan}
                  onChange={(e) => setNewEmp({ ...newEmp, jabatan: e.target.value })}
                  placeholder="mis. ACCOUNT MANAGER"
                />
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="muted">Password sementara (opsional)</span>
                <input
                  className="input"
                  type="text"
                  autoComplete="off"
                  value={newEmp.temp_password}
                  onChange={(e) => setNewEmp({ ...newEmp, temp_password: e.target.value })}
                  placeholder="kosongkan untuk default"
                />
              </label>
            </div>
            {addError && <div className="alert alertError">{addError}</div>}
            <div className="row">
              <button
                type="button"
                className="btn btnPrimary"
                disabled={adding || !addComplete}
                onClick={handleAddEmployee}
              >
                {adding ? 'Menambahkan...' : 'Tambah Karyawan'}
              </button>
            </div>
          </div>
        )}

        {addMsg && <div className="alert alertSuccess">{addMsg}</div>}
        {credError && <div className="alert alertError">{credError}</div>}
        {mutError && <div className="alert alertError">{mutError}</div>}
        {mutMsg && <div className="alert alertSuccess">{mutMsg}</div>}

        {creds && creds.length > 0 && (
          <p className="muted">
            Menampilkan {filtered.length} dari {creds.length} karyawan
            {query.trim() !== '' && ` untuk “${query.trim()}”`}.
          </p>
        )}

        {!creds && !credError && <p className="muted">Memuat...</p>}
        {creds && creds.length === 0 && <div className="emptyState">Belum ada data karyawan.</div>}
        {creds && creds.length > 0 && filtered.length === 0 && (
          <div className="emptyState">Tidak ada karyawan yang cocok dengan “{query}”.</div>
        )}

        {creds && filtered.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nama</th>
                  <th>Email</th>
                  <th>Divisi</th>
                  <th>Jabatan</th>
                  <th>Punya Password</th>
                  <th>Wajib Ganti</th>
                  <th>Terakhir Ganti</th>
                  {canMutate && <th>Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const editing = editId === c.employee_id;
                  return (
                    <tr key={c.employee_id}>
                      <td>{c.employee_id}</td>
                      <td>{c.nama}</td>
                      <td>{c.email}</td>
                      <td>
                        {editing ? (
                          <input
                            className="input"
                            value={editDivisi}
                            onChange={(e) => setEditDivisi(e.target.value)}
                            placeholder="Divisi"
                          />
                        ) : (
                          c.divisi
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <input
                            className="input"
                            value={editJabatan}
                            onChange={(e) => setEditJabatan(e.target.value)}
                            placeholder="Jabatan"
                          />
                        ) : (
                          c.jabatan
                        )}
                      </td>
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
                      {canMutate && (
                        <td>
                          {editing ? (
                            <div className="row" style={{ gap: 6 }}>
                              <button
                                type="button"
                                className="btn btnPrimary"
                                disabled={savingMut || editDivisi.trim() === '' || editJabatan.trim() === ''}
                                onClick={() => saveEdit(c.employee_id)}
                              >
                                {savingMut ? 'Menyimpan...' : 'Simpan'}
                              </button>
                              <button type="button" className="btn" disabled={savingMut} onClick={cancelEdit}>
                                Batal
                              </button>
                            </div>
                          ) : (
                            <button type="button" className="btn" onClick={() => startEdit(c)}>
                              Mutasi
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
