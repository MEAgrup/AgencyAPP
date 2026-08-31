'use client';

/**
 * M15-C2 admin screen for provisioning Client Portal contacts. Mirrors
 * `admin/vendor-accounts/page.tsx` in structure; the real differences are (1)
 * the Client picker is the roster from `GET /clients` (already RLS-scoped —
 * every Client the actor can see is a valid provisioning target, there is no
 * "unprovisioned" concept since a Client can have zero-to-many contacts) and
 * (2) a plain Account-division AM also gets write buttons for THEIR OWN
 * Clients (spec §3.2) — not just Account leads/Director like the vendor
 * screen. The API has already scoped `rows` to what this actor may manage,
 * so showing write actions for every returned row is safe by construction.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { ClientContactAccount } from '@/lib/types';

interface ClientPickerRow {
  id: string;
  toko: string;
  assigned_am_id: string | null;
}

export default function AdminClientContactsPage() {
  const { role } = useAuth();

  const canWrite =
    !!role?.director ||
    (role?.division === 'Account' && (role?.level === 'lead' || role?.level === 'staff'));

  const [rows, setRows] = useState<ClientContactAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientPickerRow[]>([]);

  const [query, setQuery] = useState('');

  // Provisioning form.
  const [formOpen, setFormOpen] = useState(false);
  const [clientId, setClientId] = useState('');
  const [nama, setNama] = useState('');
  const [email, setEmail] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [provisionMsg, setProvisionMsg] = useState<string | null>(null);

  // Deactivate/reactivate — per-row busy state so one action can't block another row.
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Admin password reset — per-row busy state, separate from toggle.
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [contactsRes, clientsRes] = await Promise.all([
        api.get<{ data: ClientContactAccount[] }>('/admin/client-contacts'),
        api.get<{ data: ClientPickerRow[] }>('/clients'),
      ]);
      setRows(contactsRes.data);
      setClients(clientsRes.data);
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
        r.nama.toLowerCase().includes(q) ||
        r.nama_klien.toLowerCase().includes(q) ||
        (r.email ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  async function handleProvision() {
    setProvisionError(null);
    setProvisionMsg(null);
    setProvisioning(true);
    try {
      await api.post('/admin/client-contacts', {
        client_id: clientId,
        nama,
        email,
        temp_password: tempPassword,
      });
      const target = clients.find((c) => c.id === clientId);
      const tempNote =
        tempPassword.trim() === '' ? 'password sementara default' : 'password sementara yang Anda isi';
      setProvisionMsg(
        `Akun untuk ${nama} (${target?.toko ?? clientId}) berhasil dibuat. ` +
          `Kontak bisa login dengan ${tempNote}; sampaikan lewat kanal pribadi.`,
      );
      setClientId('');
      setNama('');
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

  async function handleToggle(row: ClientContactAccount) {
    setToggleError(null);
    setTogglingId(row.auth_user_id);
    try {
      await api.put(`/admin/client-contacts/${row.auth_user_id}`, {
        status_aktif: !row.status_aktif,
      });
      await load();
    } catch (err) {
      setToggleError(errorMessage(err));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleResetPassword(row: ClientContactAccount) {
    setResetError(null);
    setResetMsg(null);
    setResettingId(row.auth_user_id);
    try {
      await api.post(`/admin/client-contacts/${row.auth_user_id}/reset-password`, {});
      setResetMsg(
        `Password ${row.nama} berhasil direset ke password sementara default. ` +
          `Kontak wajib menggantinya saat login berikutnya; sampaikan lewat kanal pribadi.`,
      );
      await load();
    } catch (err) {
      setResetError(errorMessage(err));
    } finally {
      setResettingId(null);
    }
  }

  const provisionComplete = clientId.trim() !== '' && nama.trim() !== '' && email.trim() !== '';

  return (
    <div className="stack">
      <div>
        <h1>Kontak Klien (Client Portal)</h1>
        <p className="muted">
          Kelola login kontak klien untuk Client Portal (M15-C2). Satu Client bisa punya lebih dari
          satu kontak; masing-masing login sendiri dan melihat data Client yang sama.
        </p>
      </div>

      {canWrite && (
        <section className="card stack">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <h2>Undang kontak baru</h2>
              <p className="muted">
                Pilih Client, isi nama dan email kontak. Kontak langsung bisa login dengan password
                sementara dan wajib menggantinya saat login pertama.
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
              {formOpen ? 'Tutup form' : '+ Undang Kontak'}
            </button>
          </div>

          {formOpen && (
            <div className="grid2" style={{ gap: 12 }}>
              <label className="stack" style={{ gap: 4, gridColumn: '1 / -1' }}>
                <span className="muted">Client *</span>
                <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">— pilih Client —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.toko} ({c.id})
                    </option>
                  ))}
                </select>
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="muted">Nama kontak *</span>
                <input
                  className="input"
                  type="text"
                  value={nama}
                  onChange={(e) => setNama(e.target.value)}
                  placeholder="Nama PIC klien"
                />
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="muted">Email login *</span>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="kontak@contoh.com"
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
                  {provisioning ? 'Memprosikan...' : 'Undang Kontak'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {provisionMsg && <div className="alert alertSuccess">{provisionMsg}</div>}
      {resetMsg && <div className="alert alertSuccess">{resetMsg}</div>}
      {toggleError && <div className="alert alertError">{toggleError}</div>}
      {resetError && <div className="alert alertError">{resetError}</div>}
      {loadError && <div className="alert alertError">{loadError}</div>}

      <section className="card stack">
        <div>
          <h2>Daftar kontak</h2>
          <p className="muted">Cari berdasarkan nama kontak, Client, atau email.</p>
        </div>

        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">Cari</span>
          <input
            className="input"
            type="search"
            autoComplete="off"
            placeholder="Ketik nama kontak, Client, atau email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        {rows && rows.length > 0 && (
          <p className="muted">
            Menampilkan {filtered.length} dari {rows.length} kontak
            {query.trim() !== '' && ` untuk “${query.trim()}”`}.
          </p>
        )}

        {!rows && !loadError && <p className="muted">Memuat...</p>}
        {rows && rows.length === 0 && <div className="emptyState">Belum ada kontak klien.</div>}
        {rows && rows.length > 0 && filtered.length === 0 && (
          <div className="emptyState">Tidak ada kontak yang cocok dengan “{query}”.</div>
        )}

        {rows && filtered.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Kontak</th>
                  <th>Client</th>
                  <th>Email login</th>
                  <th>Status akun</th>
                  <th>Wajib ganti password</th>
                  {canWrite && <th>Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.auth_user_id}>
                    <td>{r.nama}</td>
                    <td>{r.nama_klien}</td>
                    <td>{r.email ?? <span className="muted">—</span>}</td>
                    <td>
                      {r.status_aktif ? (
                        <span className="badge badge-green">Aktif</span>
                      ) : (
                        <span className="badge badge-red">Nonaktif</span>
                      )}
                    </td>
                    <td>
                      {r.must_change_password ? (
                        <span className="badge badge-amber">Ya</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    {canWrite && (
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <button
                            type="button"
                            className="btn btnSm"
                            disabled={togglingId === r.auth_user_id}
                            onClick={() => handleToggle(r)}
                          >
                            {togglingId === r.auth_user_id
                              ? 'Menyimpan...'
                              : r.status_aktif
                                ? 'Nonaktifkan'
                                : 'Aktifkan'}
                          </button>
                          <button
                            type="button"
                            className="btn btnSm btnSecondary"
                            disabled={resettingId === r.auth_user_id}
                            onClick={() => handleResetPassword(r)}
                          >
                            {resettingId === r.auth_user_id ? 'Mereset...' : 'Reset Password'}
                          </button>
                        </div>
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
