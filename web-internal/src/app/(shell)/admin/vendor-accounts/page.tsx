'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { VendorAccount } from '@/lib/types';

export default function AdminVendorAccountsPage() {
  const { role } = useAuth();

  // Only Account lead / Director may provision or deactivate/reactivate — the
  // same authority as managing the vendor record itself. OD sees this page
  // read-only (Phase 0 §4), same split as Karyawan/Role Mapping.
  const canWrite = !!role?.director || (role?.level === 'lead' && role?.division === 'Account');

  const [rows, setRows] = useState<VendorAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState('');

  // Provisioning form.
  const [formOpen, setFormOpen] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [email, setEmail] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [provisionMsg, setProvisionMsg] = useState<string | null>(null);

  // Deactivate/reactivate — per-row busy state so one action can't block another row.
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await api.get<{ data: VendorAccount[] }>('/admin/vendor-accounts');
      setRows(res.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const q = query.trim().toLowerCase();
    if (q === '') return list;
    return list.filter(
      (r) =>
        r.nama_vendor.toLowerCase().includes(q) ||
        r.vendor_id.toLowerCase().includes(q) ||
        (r.email ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  // Vendors with no account yet — the only valid choices for the provision form.
  const unprovisioned = useMemo(() => (rows ?? []).filter((r) => r.status_aktif === null), [rows]);

  async function handleProvision() {
    setProvisionError(null);
    setProvisionMsg(null);
    setProvisioning(true);
    try {
      await api.post('/admin/vendor-accounts', {
        vendor_id: vendorId,
        email,
        temp_password: tempPassword,
      });
      const vendor = unprovisioned.find((v) => v.vendor_id === vendorId);
      const tempNote =
        tempPassword.trim() === '' ? 'password sementara default' : 'password sementara yang Anda isi';
      setProvisionMsg(
        `Akun untuk ${vendor?.nama_vendor ?? vendorId} berhasil dibuat. ` +
          `Vendor bisa login dengan ${tempNote}; sampaikan lewat kanal pribadi.`,
      );
      setVendorId('');
      setEmail('');
      setTempPassword('');
      setFormOpen(false);
      await load();
    } catch (err) {
      setProvisionError(errorMessage(err));
    } finally {
      setProvisioning(false);
    }
  }

  async function handleToggle(row: VendorAccount) {
    setToggleError(null);
    setTogglingId(row.vendor_id);
    try {
      await api.put(`/admin/vendor-accounts/${row.vendor_id}`, {
        status_aktif: !row.status_aktif,
      });
      await load();
    } catch (err) {
      setToggleError(errorMessage(err));
    } finally {
      setTogglingId(null);
    }
  }

  const provisionComplete = vendorId.trim() !== '' && email.trim() !== '';

  return (
    <div className="stack">
      <div>
        <h1>Akun Vendor</h1>
        <p className="muted">
          Kelola login vendor untuk Portal Vendor Live Stream (LT-61). Hanya vendor yang
          diprovisikan di sini yang bisa login sendiri; sisanya tetap dikelola AM seperti biasa.
        </p>
      </div>

      {canWrite && (
        <section className="card stack">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <h2>Provisikan akun baru</h2>
              <p className="muted">
                Pilih vendor yang belum punya akun, isi email login. Vendor langsung bisa login
                dengan password sementara dan wajib menggantinya saat login pertama.
              </p>
            </div>
            <button
              type="button"
              className="btn btnPrimary"
              onClick={() => {
                setFormOpen((v) => !v);
                setProvisionError(null);
                setProvisionMsg(null);
              }}
            >
              {formOpen ? 'Tutup form' : '+ Provisikan Akun'}
            </button>
          </div>

          {formOpen && (
            <div className="grid2" style={{ gap: 12 }}>
              <label className="stack" style={{ gap: 4, gridColumn: '1 / -1' }}>
                <span className="muted">Vendor *</span>
                <select className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                  <option value="">— pilih vendor —</option>
                  {unprovisioned.map((v) => (
                    <option key={v.vendor_id} value={v.vendor_id}>
                      {v.nama_vendor} ({v.vendor_id})
                    </option>
                  ))}
                </select>
                {rows && unprovisioned.length === 0 && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    Semua vendor sudah punya akun (aktif atau nonaktif).
                  </span>
                )}
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="muted">Email login *</span>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vendor@contoh.com"
                />
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="muted">Password sementara (opsional)</span>
                <input
                  className="input"
                  type="text"
                  autoComplete="off"
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                  placeholder="kosongkan untuk default"
                />
              </label>
              {provisionError && <div className="alert alertError">{provisionError}</div>}
              <div className="row">
                <button
                  type="button"
                  className="btn btnPrimary"
                  disabled={provisioning || !provisionComplete}
                  onClick={handleProvision}
                >
                  {provisioning ? 'Memprovisikan...' : 'Provisikan Akun'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {provisionMsg && <div className="alert alertSuccess">{provisionMsg}</div>}
      {toggleError && <div className="alert alertError">{toggleError}</div>}
      {loadError && <div className="alert alertError">{loadError}</div>}

      <section className="card stack">
        <div>
          <h2>Daftar vendor</h2>
          <p className="muted">Status login setiap vendor. Cari berdasarkan nama, ID, atau email.</p>
        </div>

        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">Cari vendor</span>
          <input
            className="input"
            type="search"
            autoComplete="off"
            placeholder="Ketik nama, ID, atau email vendor…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        {rows && rows.length > 0 && (
          <p className="muted">
            Menampilkan {filtered.length} dari {rows.length} vendor
            {query.trim() !== '' && ` untuk “${query.trim()}”`}.
          </p>
        )}

        {!rows && !loadError && <p className="muted">Memuat...</p>}
        {rows && rows.length === 0 && <div className="emptyState">Belum ada data vendor.</div>}
        {rows && rows.length > 0 && filtered.length === 0 && (
          <div className="emptyState">Tidak ada vendor yang cocok dengan “{query}”.</div>
        )}

        {rows && filtered.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>ID</th>
                  <th>Email login</th>
                  <th>Status akun</th>
                  {canWrite && <th>Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.vendor_id}>
                    <td>{r.nama_vendor}</td>
                    <td>{r.vendor_id}</td>
                    <td>{r.email ?? <span className="muted">—</span>}</td>
                    <td>
                      {r.status_aktif === null ? (
                        <span className="badge badge-orange">Belum ada akun</span>
                      ) : r.status_aktif ? (
                        <span className="badge badge-green">Aktif</span>
                      ) : (
                        <span className="badge badge-red">Nonaktif</span>
                      )}
                    </td>
                    {canWrite && (
                      <td>
                        {r.status_aktif !== null && (
                          <button
                            type="button"
                            className="btn"
                            disabled={togglingId === r.vendor_id}
                            onClick={() => handleToggle(r)}
                          >
                            {togglingId === r.vendor_id
                              ? 'Menyimpan...'
                              : r.status_aktif
                                ? 'Nonaktifkan'
                                : 'Aktifkan'}
                          </button>
                        )}
                      </td>
                    )}
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
