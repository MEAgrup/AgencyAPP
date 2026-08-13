'use client';

/**
 * Admin › Hari Libur — the national-holiday calendar.
 *
 * This page is not decoration around a nice-to-have: the Kelola Klien SLA is
 * measured in WORKING days (owner decision 2026-08-13), and "working" means
 * Mon–Fri minus the dates listed here. An empty calendar silently degrades the
 * measurement to weekends-only, so the page says so at the top rather than
 * looking merely empty.
 *
 * Indonesian holiday dates are set by joint decree and move every year, which is
 * why they are entered here instead of shipped in a migration — a hardcoded list
 * would be a business fact invented by code and wrong by the next January.
 *
 * Director writes; OD reads (the same gate as the rest of the admin plane). The
 * server enforces both — the disabled buttons here are courtesy, not security.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { HariLibur } from '@/lib/types';

function tahunDari(tanggal: string): string {
  return tanggal.slice(0, 4);
}

function formatTanggal(tanggal: string): string {
  const d = new Date(`${tanggal}T00:00:00`);
  if (Number.isNaN(d.getTime())) return tanggal;
  return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export default function HariLiburPage() {
  const { role } = useAuth();
  const canWrite = Boolean(role?.director);

  const [rows, setRows] = useState<HariLibur[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tanggal, setTanggal] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: HariLibur[] }>('/admin/hari-libur');
      setRows(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api.post('/admin/hari-libur', { tanggal, keterangan });
      setTanggal('');
      setKeterangan('');
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(row: HariLibur) {
    if (!window.confirm(`Hapus ${row.tanggal} (${row.keterangan}) dari kalender libur?`)) return;
    setFormError(null);
    setDeleting(row.tanggal);
    try {
      await api.delete(`/admin/hari-libur/${encodeURIComponent(row.tanggal)}`);
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1 style={{ marginBottom: 4 }}>Hari Libur Nasional</h1>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Dipakai untuk menghitung <strong>hari kerja</strong> pada timeline Kelola Klien (riset awal,
          interview meeting, brand strategy). Tanggal yang terdaftar di sini tidak dihitung sebagai hari
          kerja — sama seperti Sabtu &amp; Minggu.
        </p>
      </div>

      {error && (
        <div className="alert alertError" role="alert">
          {error}
        </div>
      )}
      {formError && (
        <div className="alert alertError" role="alert">
          {formError}
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="alert alertInfo">
          Kalender masih kosong — untuk saat ini hanya Sabtu &amp; Minggu yang dibuang dari hitungan hari
          kerja. Tambahkan tanggal libur nasional agar SLA tidak menghitung hari libur sebagai hari kerja.
        </div>
      )}

      {canWrite && (
        <section className="card">
          <div className="cardHeader">Tambah hari libur</div>
          <form onSubmit={handleAdd}>
            <div className="grid2">
              <div className="field">
                <label htmlFor="hl-tanggal">Tanggal</label>
                <input
                  id="hl-tanggal"
                  type="date"
                  required
                  value={tanggal}
                  onChange={(e) => setTanggal(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="hl-keterangan">Keterangan</label>
                <input
                  id="hl-keterangan"
                  required
                  placeholder="mis. Hari Kemerdekaan RI"
                  value={keterangan}
                  onChange={(e) => setKeterangan(e.target.value)}
                />
              </div>
            </div>
            <button
              type="submit"
              className="btn btnPrimary btnSm"
              style={{ marginTop: 12 }}
              disabled={submitting || tanggal === '' || keterangan.trim() === ''}
            >
              {submitting ? 'Menyimpan…' : 'Tambah'}
            </button>
          </form>
        </section>
      )}

      <section className="card">
        <div className="cardHeader">
          Kalender {rows !== null && <span className="muted">({rows.length} tanggal)</span>}
        </div>
        {loading ? (
          <p className="pageLoading">Memuat…</p>
        ) : rows === null || rows.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Belum ada tanggal terdaftar.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tahun</th>
                  <th>Tanggal</th>
                  <th>Keterangan</th>
                  <th>Ditambahkan oleh</th>
                  {canWrite && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.tanggal}>
                    <td>{tahunDari(row.tanggal)}</td>
                    <td>{formatTanggal(row.tanggal)}</td>
                    <td>{row.keterangan}</td>
                    <td className="muted">{row.created_by}</td>
                    {canWrite && (
                      <td>
                        <button
                          type="button"
                          className="btn btnDanger btnSm"
                          disabled={deleting === row.tanggal}
                          onClick={() => handleDelete(row)}
                        >
                          {deleting === row.tanggal ? 'Menghapus…' : 'Hapus'}
                        </button>
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
