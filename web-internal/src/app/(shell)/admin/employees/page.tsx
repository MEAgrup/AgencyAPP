'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type {
  AdminEmployee,
  CredentialInfo,
  EmployeeImportResult,
  HandoverItem,
  RoleMapping,
} from '@/lib/types';
import { pairKey, parsePairKey } from '@/lib/role-mapping-pairs';
import {
  employeeHandover,
  handoverLabel,
  listAdminEmployees,
  resignEmployee,
} from '@/lib/admin-employees';

/**
 * One roster row: the employee directory record, plus the credential columns
 * where the caller is allowed to see them.
 *
 * The roster SPINE is `/admin/employees`, not `/auth/admin/credentials` as it
 * was until 2026-09-10 — that endpoint filters `WHERE status_aktif` (so a
 * resigned employee vanished from the table, leaving the operator no
 * confirmation their own action landed) and scopes a Lead to their own mapped
 * division (so an HR Lead saw HR staff only, and could never reach the person
 * they were asked to mutate). Credentials are merged in on top; a row without
 * them simply shows `—` in those columns, which is honest — an HR Lead has no
 * business reading, let alone resetting, another division's password.
 *
 * Still ONE table, so DECISIONS 2026-08-10 stands.
 */
type RosterRow = AdminEmployee & {
  cred: CredentialInfo | null;
};

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
  const [creds, setCreds] = useState<RosterRow[] | null>(null);
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

  // Resign — permanent access revocation. Same gate as mutasi (`canMutate`);
  // the server is the real one. Two steps on purpose: step 1 shows what the
  // person still holds, step 2 makes the operator retype the ID. This is a
  // one-way door with no undo, so a single mis-click must not be enough.
  const [resignTarget, setResignTarget] = useState<RosterRow | null>(null);
  const [resignHandover, setResignHandover] = useState<HandoverItem[] | null>(null);
  const [resignAlasan, setResignAlasan] = useState('');
  const [resignConfirmId, setResignConfirmId] = useState('');
  const [resigning, setResigning] = useState(false);
  const [resignError, setResignError] = useState<string | null>(null);
  const [resignMsg, setResignMsg] = useState<string | null>(null);

  // Divisi/jabatan are CHOSEN from existing Role Mapping entries, never typed —
  // a free-text pair that matches no mapping strands the employee with no CDPS
  // division/level at all (silently, until someone notices they have no access).
  // A position that doesn't exist yet must be created first at Admin › Role
  // Mapping; this page only assigns employees to positions that already exist.
  const [mappings, setMappings] = useState<RoleMapping[] | null>(null);
  const [mappingsError, setMappingsError] = useState<string | null>(null);

  const loadMappings = useCallback(async () => {
    try {
      const res = await api.get<{ data: RoleMapping[] }>('/admin/role-mappings');
      setMappings(res.data);
    } catch (err) {
      setMappingsError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (canMutate) loadMappings();
  }, [canMutate, loadMappings]);

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
    // The directory is required; credentials are a bonus. Fetched with
    // allSettled rather than await-in-sequence so a caller who may read the
    // roster but NOT passwords (an HR Lead) still gets a table instead of an
    // error page — the exact case that made this feature unusable before.
    const [dir, cred] = await Promise.allSettled([
      listAdminEmployees(),
      api.get<{ data: CredentialInfo[] }>('/auth/admin/credentials'),
    ]);
    if (dir.status === 'rejected') {
      setCredError(errorMessage(dir.reason));
      return;
    }
    const credById = new Map<string, CredentialInfo>(
      cred.status === 'fulfilled' ? cred.value.data.map((c) => [c.employee_id, c]) : [],
    );
    setCreds(dir.value.data.map((e) => ({ ...e, cred: credById.get(e.employee_id) ?? null })));
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

  // Grouped by divisi for the <optgroup>s below; already ordered divisi/jabatan
  // by the API, so groups and options within them come out sorted for free.
  const mappingsByDivisi = useMemo(() => {
    const groups = new Map<string, RoleMapping[]>();
    for (const m of mappings ?? []) {
      const list = groups.get(m.divisi) ?? [];
      list.push(m);
      groups.set(m.divisi, list);
    }
    return [...groups.entries()];
  }, [mappings]);

  const mappedKeys = useMemo(
    () => new Set((mappings ?? []).map((m) => pairKey(m.divisi, m.jabatan))),
    [mappings],
  );

  /** The <select> value for a divisi/jabatan pair — "" only when both are empty. */
  function pairSelectValue(divisi: string, jabatan: string): string {
    return divisi === '' && jabatan === '' ? '' : pairKey(divisi, jabatan);
  }

  /** One <select> of every mapped divisi+jabatan, grouped by divisi. */
  function PositionOptions() {
    return (
      <>
        <option value="">— pilih divisi + jabatan —</option>
        {mappingsByDivisi.map(([divisi, list]) => (
          <optgroup key={divisi} label={divisi}>
            {list.map((m) => (
              <option key={pairKey(m.divisi, m.jabatan)} value={pairKey(m.divisi, m.jabatan)}>
                {m.jabatan} — {m.division}/{m.level}
              </option>
            ))}
          </optgroup>
        ))}
      </>
    );
  }

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

  function startEdit(c: RosterRow) {
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

  async function openResign(c: RosterRow) {
    setResignTarget(c);
    setResignHandover(null);
    setResignAlasan('');
    setResignConfirmId('');
    setResignError(null);
    setResignMsg(null);
    try {
      setResignHandover((await employeeHandover(c.employee_id)).data);
    } catch (err) {
      // The preview failing must not block the revocation itself — but it must
      // not be silently rendered as "nothing assigned" either, which would be a
      // false reassurance at exactly the wrong moment.
      setResignError(errorMessage(err));
    }
  }

  function closeResign() {
    setResignTarget(null);
    setResignHandover(null);
    setResignAlasan('');
    setResignConfirmId('');
    setResignError(null);
  }

  async function confirmResign() {
    if (!resignTarget) return;
    setResignError(null);
    setResigning(true);
    try {
      const res = await resignEmployee(resignTarget.employee_id, { alasan: resignAlasan });
      const left = res.data.handover.length;
      setResignMsg(
        `Akses ${resignTarget.nama} (${resignTarget.employee_id}) dicabut permanen.` +
          (left > 0
            ? ` ${left} penugasan masih menunjuk namanya — serahkan lewat halaman terkait.`
            : ' Tidak ada penugasan yang tertinggal.'),
      );
      closeResign();
      await loadCreds();
    } catch (err) {
      setResignError(errorMessage(err));
    } finally {
      setResigning(false);
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
    mappedKeys.has(pairKey(newEmp.divisi, newEmp.jabatan));

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
                wajib menggantinya saat login pertama. Divisi + Jabatan dipilih dari posisi yang
                sudah dipetakan di Role Mapping — kalau posisinya belum ada, buat dulu di Admin
                &rsaquo; Role Mapping, baru kembali ke sini.
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
              <label className="stack" style={{ gap: 4, gridColumn: '1 / -1' }}>
                <span className="muted">Divisi + Jabatan *</span>
                <select
                  className="input"
                  value={pairSelectValue(newEmp.divisi, newEmp.jabatan)}
                  onChange={(e) => {
                    const parsed = parsePairKey(e.target.value);
                    setNewEmp({
                      ...newEmp,
                      divisi: parsed?.divisi ?? '',
                      jabatan: parsed?.jabatan ?? '',
                    });
                  }}
                >
                  <PositionOptions />
                </select>
                {mappingsError && <span className="alert alertError" style={{ fontSize: 12 }}>{mappingsError}</span>}
                {mappings && mappings.length === 0 && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    Belum ada Role Mapping. Buat posisinya dulu di Admin &rsaquo; Role Mapping.
                  </span>
                )}
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
        {resignMsg && <div className="alert alertSuccess">{resignMsg}</div>}

        {resignTarget && (
          <div className="card" style={{ borderColor: 'var(--danger, #b91c1c)' }}>
            <div className="cardHeader">
              <h2>
                Cabut akses: {resignTarget.nama}{' '}
                <span className="muted">({resignTarget.employee_id})</span>
              </h2>
            </div>

            <div className="alert alertError" role="alert">
              <strong>Ini permanen dan tidak bisa dibatalkan.</strong> Karyawan langsung tidak
              bisa login, sesinya dicabut, dan namanya hilang dari semua pilihan penugasan.
              Sinkron karyawan berikutnya <strong>tidak akan</strong> mengaktifkannya kembali,
              walau sheet HRIS masih menyebutnya aktif. Baris datanya tetap disimpan supaya
              riwayat lama (klien, komisi, aset) tetap terbaca — memperbaiki kekeliruan di sini
              butuh Director dan migrasi, bukan satu klik.
            </div>

            <h3>Yang masih menunjuk namanya</h3>
            {resignError && <div className="alert alertError" role="alert">{resignError}</div>}
            {resignHandover === null && !resignError && <p className="muted">Memuat...</p>}
            {resignHandover !== null && resignHandover.length === 0 && (
              <div className="emptyState">
                Tidak ada penugasan aktif. Aman untuk dicabut.
              </div>
            )}
            {resignHandover !== null && resignHandover.length > 0 && (
              <>
                <p className="muted" style={{ fontSize: 12 }}>
                  Sistem <strong>tidak</strong> memindahkan ini otomatis. Kepemilikan klien
                  menentukan komisi, jadi pemindahannya harus keputusan yang tercatat — lakukan
                  lewat halaman klien/divisi terkait (jalur reassign M4), bukan dari sini.
                </p>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Jenis</th>
                        <th>ID</th>
                        <th>Keterangan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resignHandover.map((h) => (
                        <tr key={`${h.kind}-${h.id}`}>
                          <td>{handoverLabel(h.kind)}</td>
                          <td>{h.id}</td>
                          <td>{h.label || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="formRow">
              <div className="field">
                <label htmlFor="resign-alasan">Alasan (wajib)</label>
                <input
                  id="resign-alasan"
                  className="input"
                  value={resignAlasan}
                  onChange={(e) => setResignAlasan(e.target.value)}
                  placeholder="mis. resign efektif 30 September"
                />
              </div>
              <div className="field">
                <label htmlFor="resign-confirm">
                  Ketik ulang ID karyawan (<code>{resignTarget.employee_id}</code>)
                </label>
                <input
                  id="resign-confirm"
                  className="input"
                  value={resignConfirmId}
                  onChange={(e) => setResignConfirmId(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btnDanger"
                disabled={
                  resigning ||
                  resignAlasan.trim() === '' ||
                  resignConfirmId.trim() !== resignTarget.employee_id
                }
                onClick={confirmResign}
              >
                {resigning ? 'Mencabut...' : 'Cabut akses permanen'}
              </button>
              <button type="button" className="btn" disabled={resigning} onClick={closeResign}>
                Batal
              </button>
            </div>
          </div>
        )}

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
                  <th>Status</th>
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
                      <td colSpan={editing ? 2 : 1}>
                        {editing ? (
                          <select
                            className="input"
                            value={pairSelectValue(editDivisi, editJabatan)}
                            onChange={(e) => {
                              const parsed = parsePairKey(e.target.value);
                              setEditDivisi(parsed?.divisi ?? '');
                              setEditJabatan(parsed?.jabatan ?? '');
                            }}
                          >
                            {editDivisi !== '' &&
                              editJabatan !== '' &&
                              !mappedKeys.has(pairKey(editDivisi, editJabatan)) && (
                                <option value={pairKey(editDivisi, editJabatan)}>
                                  (belum dipetakan) {editDivisi} &middot; {editJabatan}
                                </option>
                              )}
                            <PositionOptions />
                          </select>
                        ) : (
                          c.divisi
                        )}
                      </td>
                      {!editing && <td>{c.jabatan}</td>}
                      <td>
                        {/* `—`, bukan "Belum": tanpa hak baca kredensial kita
                            memang TIDAK TAHU, dan itu beda dari "belum punya". */}
                        {c.cred === null ? (
                          <span className="muted">—</span>
                        ) : (
                          <span className={`badge badge-${c.cred.has_password ? 'green' : 'red'}`}>
                            {c.cred.has_password ? 'Ya' : 'Belum'}
                          </span>
                        )}
                      </td>
                      <td>
                        {c.cred?.must_change_password ? (
                          <span className="badge badge-orange">Wajib ganti</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {c.cred?.password_changed_at
                          ? new Date(c.cred.password_changed_at).toLocaleDateString('id-ID')
                          : '—'}
                      </td>
                      <td>
                        {c.resigned_at ? (
                          <span
                            className="badge badge-darkgray"
                            title={`Akses dicabut permanen ${new Date(c.resigned_at).toLocaleDateString('id-ID')}`}
                          >
                            Resign
                          </span>
                        ) : c.status_aktif ? (
                          <span className="badge badge-green">Aktif</span>
                        ) : (
                          <span className="badge badge-orange">Nonaktif</span>
                        )}
                      </td>
                      {canMutate && (
                        <td>
                          {editing ? (
                            <div className="row" style={{ gap: 6 }}>
                              <button
                                type="button"
                                className="btn btnPrimary"
                                disabled={savingMut || !mappedKeys.has(pairKey(editDivisi, editJabatan))}
                                onClick={() => saveEdit(c.employee_id)}
                              >
                                {savingMut ? 'Menyimpan...' : 'Simpan'}
                              </button>
                              <button type="button" className="btn" disabled={savingMut} onClick={cancelEdit}>
                                Batal
                              </button>
                            </div>
                          ) : c.resigned_at ? (
                            // No actions on someone who has already left. There
                            // is no un-resign, so offering anything here could
                            // only mislead.
                            <span className="muted">—</span>
                          ) : (
                            <div className="row" style={{ gap: 6 }}>
                              <button type="button" className="btn" onClick={() => startEdit(c)}>
                                Mutasi
                              </button>
                              <button
                                type="button"
                                className="btn btnDanger"
                                onClick={() => openResign(c)}
                              >
                                Resign
                              </button>
                            </div>
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
