'use client';

/**
 * Kategori pekerjaan SMO &amp; Content Strategist (M19 Gap G).
 *
 * Taksonomi ini adalah <strong>data</strong>, bukan skema. Migrasi hanya
 * menanam empat Kategori yang terbukti di sumber; sisanya diisi Leader di sini,
 * karena mengunci nama-nama itu di dalam CHECK constraint berarti satu migrasi
 * untuk setiap koreksi taksonomi.
 *
 * ⚠️ &ldquo;Standing&rdquo; adalah keputusan, bukan sekadar centang. Kategori
 * standing tidak boleh punya SLA (server menolaknya) dan Speed Score barisnya
 * jadi <code>N/A</code>. Menandai sebuah <em>deliverable</em> nyata sebagai
 * standing membuatnya hilang sepenuhnya dari seri deliverable &mdash; kesalahan
 * yang lebih buruk daripada sebaliknya.
 *
 * NOL tombol hapus, dan itu keputusan: baris pekerjaan historis menunjuk
 * Kategori-nya, jadi menghapus satu baris taksonomi membuat riwayat tak
 * terbaca. Yang ada: nonaktifkan.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  canManageTask,
  createKategori,
  listKategori,
  updateKategori,
  type KategoriInput,
  type KategoriRow,
} from '@/lib/scs';

const KOSONG: KategoriInput = {
  kode: '', nama: '', sub_type: null, is_standing: false, sla_jam: 24, aktif: true, urutan: 10,
};

export default function ScsKategoriPage() {
  const { role } = useAuth();
  const bolehKelola = canManageTask(role);

  const [rows, setRows] = useState<KategoriRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sukses, setSukses] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);
  const [form, setForm] = useState<KategoriInput>(KOSONG);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listKategori(true);
      setRows(res.kategori);
    } catch (err) {
      setError(errorMessage(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function simpan(e: FormEvent) {
    e.preventDefault();
    setMenyimpan(true);
    setError(null);
    setSukses(null);
    try {
      await createKategori(form);
      setSukses('Tersimpan.');
      setForm(KOSONG);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setMenyimpan(false);
    }
  }

  async function setAktif(k: KategoriRow, aktif: boolean) {
    setError(null);
    setSukses(null);
    try {
      await updateKategori(k.kode, {
        kode: k.kode, nama: k.nama, sub_type: k.sub_type,
        is_standing: k.is_standing, sla_jam: k.sla_jam, aktif, urutan: k.urutan,
      });
      setSukses(aktif ? 'Diaktifkan.' : 'Dinonaktifkan.');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      <div>
        <Link href="/creative/scs" className="muted">&larr; Kembali ke Antrean</Link>
      </div>

      <div>
        <h1>Kategori pekerjaan</h1>
        <div className="alert" role="note" style={{ background: '#f4f6f8' }}>
          <strong>&ldquo;Standing&rdquo; berarti pekerjaan berulang harian</strong> (mis. upload
          &amp; checklist tiap hari). Kategori standing dihitung sebagai <em>volume</em>, tidak
          punya SLA, dan Speed Score barisnya <code>N/A</code>. Jangan menandai deliverable
          nyata sebagai standing &mdash; ia akan hilang dari seri deliverable.
          <br />
          Kategori yang sudah dipakai <strong>tidak bisa dihapus</strong>, hanya dinonaktifkan:
          baris pekerjaan lama harus tetap bisa dibaca.
        </div>
      </div>

      {error && <div className="alert alertError" role="alert">{error}</div>}
      {sukses && <div className="alert alertSuccess" role="status">{sukses}</div>}

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {!loading && !error && (
          rows.length === 0 ? (
            <div className="emptyState">Belum ada Kategori.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Kode</th>
                    <th>Nama</th>
                    <th>Sub Type</th>
                    <th>Standing</th>
                    <th>SLA (jam)</th>
                    <th>Urutan</th>
                    <th>Aktif</th>
                    {bolehKelola && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((k) => (
                    <tr key={k.kode}>
                      <td>{k.kode}</td>
                      <td>{k.nama}</td>
                      <td>{k.sub_type ?? '—'}</td>
                      <td>{k.is_standing ? 'ya' : 'tidak'}</td>
                      {/* SLA kosong pada Kategori standing bukan data yang hilang:
                          ia memang tidak di-SLA-kan. '—' (aturan rumah #7). */}
                      <td>{k.sla_jam ?? '—'}</td>
                      <td>{k.urutan}</td>
                      <td>{k.aktif ? 'ya' : 'tidak'}</td>
                      {bolehKelola && (
                        <td>
                          <button
                            type="button" className="btn btnSecondary btnSm"
                            onClick={() => setAktif(k, !k.aktif)}
                          >
                            {k.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </section>

      {bolehKelola && (
        <section className="card">
          <div className="cardHeader"><h2>Tambah Kategori</h2></div>
          <form className="stack" onSubmit={simpan}>
            <div className="formRow">
              <div className="field">
                <label htmlFor="kode">Kode</label>
                <input
                  id="kode" required value={form.kode}
                  onChange={(e) => setForm({ ...form, kode: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="nama">Nama</label>
                <input
                  id="nama" required value={form.nama}
                  onChange={(e) => setForm({ ...form, nama: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="subtype">Sub Type</label>
                <input
                  id="subtype" value={form.sub_type ?? ''}
                  onChange={(e) => setForm({ ...form, sub_type: e.target.value || null })}
                />
              </div>
              <div className="field">
                <label htmlFor="urutan">Urutan</label>
                <input
                  id="urutan" type="number" min={1} required value={form.urutan}
                  onChange={(e) => setForm({ ...form, urutan: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="standing">Standing (berulang harian)</label>
                <select
                  id="standing" value={form.is_standing ? 'ya' : 'tidak'}
                  onChange={(e) => {
                    const st = e.target.value === 'ya';
                    // Standing ⇒ SLA WAJIB kosong (server menolak sebaliknya).
                    // Dikosongkan di sini supaya penolakannya tidak jadi kejutan.
                    setForm({ ...form, is_standing: st, sla_jam: st ? null : (form.sla_jam ?? 24) });
                  }}
                >
                  <option value="tidak">tidak</option>
                  <option value="ya">ya</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="sla">SLA (jam)</label>
                <input
                  id="sla" type="number" min={1} value={form.sla_jam ?? ''}
                  disabled={form.is_standing}
                  onChange={(e) => setForm({ ...form, sla_jam: e.target.value ? Number(e.target.value) : null })}
                />
              </div>
            </div>
            <div>
              <button type="submit" className="btn btnPrimary btnSm" disabled={menyimpan}>
                {menyimpan ? 'Menyimpan…' : 'Simpan'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
