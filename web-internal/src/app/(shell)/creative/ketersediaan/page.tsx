'use client';

/**
 * Ketidaktersediaan Produksi (M19 Gap D / D4).
 *
 * ⚠️ INI BUKAN PENGAJUAN CUTI, dan halaman ini harus mengatakannya dengan jelas
 * kepada penggunanya. CDPS bukan HRIS (CLAUDE.md): tidak ada approval, tidak
 * ada saldo, tidak ada hak cuti. Satu-satunya pertanyaan yang dijawab tabel di
 * belakangnya adalah &ldquo;boleh dijadwalkan hari itu atau tidak&rdquo;.
 * Kalau layar ini terbaca seperti sistem cuti, orang akan memakainya sebagai
 * sistem cuti dan mengharapkan hal-hal yang memang tidak ada.
 *
 * Ditulis Leader/SPV saja (D4 — bukan self-service PIC). Bisa DICABUT tapi
 * tidak bisa disunting: menyunting rentang sesudah jadwal disusun di atasnya
 * mengubah arti peringatan yang sudah ditampilkan.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { LEVEL_STAFF, useAssignableEmployees } from '@/lib/directory';
import EmployeePicker from '@/components/EmployeePicker';
import {
  ALASAN_TIDAK_TERSEDIA,
  DIVISION,
  canWriteUnavailability,
  geserHari,
  hariIniWib,
  listUnavailability,
  markUnavailable,
  removeUnavailability,
  type UnavailabilityInput,
  type UnavailabilityRow,
} from '@/lib/dailyops';

const KOSONG: UnavailabilityInput = {
  employee_id: '', tanggal_mulai: '', tanggal_selesai: '', alasan: 'Cuti', catatan: null,
};

export default function KetersediaanPage() {
  const { role } = useAuth();
  const bolehTulis = canWriteUnavailability(role);

  const [dari, setDari] = useState(hariIniWib());
  const [sampai, setSampai] = useState(geserHari(hariIniWib(), 30));
  const [rows, setRows] = useState<UnavailabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sukses, setSukses] = useState<string | null>(null);
  const [form, setForm] = useState<UnavailabilityInput>({
    ...KOSONG, tanggal_mulai: hariIniWib(), tanggal_selesai: hariIniWib(),
  });
  const [menyimpan, setMenyimpan] = useState(false);

  const { employees: picCandidates, loading: picLoading, error: picError } =
    useAssignableEmployees(DIVISION, LEVEL_STAFF, bolehTulis);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listUnavailability(dari, sampai);
      setRows(res.data);
    } catch (err) {
      setError(errorMessage(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [dari, sampai]);

  useEffect(() => { load(); }, [load]);

  async function simpan(e: FormEvent) {
    e.preventDefault();
    setMenyimpan(true);
    setError(null);
    setSukses(null);
    try {
      await markUnavailable(form);
      setSukses('Tercatat.');
      setForm({ ...KOSONG, tanggal_mulai: hariIniWib(), tanggal_selesai: hariIniWib() });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setMenyimpan(false);
    }
  }

  async function cabut(id: number) {
    if (!window.confirm('Cabut catatan ini? Untuk mengubah rentangnya, cabut lalu catat ulang.')) return;
    setError(null);
    setSukses(null);
    try {
      await removeUnavailability(id);
      setSukses('Dicabut.');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      <div>
        <Link href="/creative/schedule" className="muted">&larr; Kembali ke Jadwal Produksi</Link>
      </div>

      <div>
        <h1>Ketidaktersediaan Produksi</h1>
        <p className="muted">
          Dipakai saat menyusun jadwal: menandai siapa yang <strong>tidak bisa dijadwalkan</strong>
          {' '}pada tanggal tertentu (M19 §5.1).
        </p>
        <div className="alert" role="note" style={{ background: '#f4f6f8' }}>
          <strong>Ini bukan pengajuan cuti.</strong> CDPS bukan sistem HRIS: di sini tidak ada
          persetujuan, tidak ada saldo atau hak cuti, dan mencatat di sini tidak menggantikan
          pengajuan cuti di HRIS. Satu-satunya gunanya adalah supaya jadwal produksi tidak
          menempatkan orang yang tidak ada. Menjadwalkan orang yang ditandai di sini{' '}
          <strong>tetap bisa dilakukan</strong> &mdash; sistem hanya memperingatkan.
        </div>
      </div>

      <section className="card">
        <div className="formRow">
          <div className="field">
            <label htmlFor="dari">Dari (WIB)</label>
            <input id="dari" type="date" value={dari} onChange={(e) => setDari(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sampai">Sampai (WIB)</label>
            <input id="sampai" type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </div>
        </div>
      </section>

      {error && <div className="alert alertError" role="alert">{error}</div>}
      {sukses && <div className="alert alertSuccess" role="status">{sukses}</div>}

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {!loading && !error && (
          rows.length === 0 ? (
            <div className="emptyState">Tidak ada catatan pada rentang ini.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Orang</th>
                    <th>Dari</th>
                    <th>Sampai</th>
                    <th>Alasan</th>
                    <th>Catatan</th>
                    <th>Dicatat oleh</th>
                    {bolehTulis && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.employee_nama || r.employee_id}</td>
                      <td>{r.tanggal_mulai}</td>
                      <td>{r.tanggal_selesai}</td>
                      <td>{r.alasan}</td>
                      <td>{r.catatan ?? '—'}</td>
                      <td>{r.dicatat_oleh}</td>
                      {bolehTulis && (
                        <td>
                          <button type="button" className="btn btnSecondary btnSm" onClick={() => cabut(r.id)}>
                            Cabut
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

      {bolehTulis && (
        <section className="card">
          <div className="cardHeader"><h2>Catat ketidaktersediaan</h2></div>
          <form className="stack" onSubmit={simpan}>
            <div className="formRow">
              <EmployeePicker
                id="orang" label="Orang" required
                employees={picCandidates} loading={picLoading} error={picError}
                value={form.employee_id}
                onChange={(v) => setForm({ ...form, employee_id: v })}
                emptyHint="Belum ada staff Creative aktif."
              />
              <div className="field">
                <label htmlFor="mulai">Dari</label>
                <input
                  id="mulai" type="date" required value={form.tanggal_mulai}
                  onChange={(e) => setForm({ ...form, tanggal_mulai: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="selesai">Sampai</label>
                <input
                  id="selesai" type="date" required value={form.tanggal_selesai}
                  onChange={(e) => setForm({ ...form, tanggal_selesai: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="alasan">Alasan</label>
                <select
                  id="alasan" required value={form.alasan}
                  onChange={(e) => setForm({ ...form, alasan: e.target.value })}
                >
                  {ALASAN_TIDAK_TERSEDIA.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="catatan">Catatan</label>
              <input
                id="catatan" value={form.catatan ?? ''}
                onChange={(e) => setForm({ ...form, catatan: e.target.value || null })}
              />
            </div>
            <div>
              <button type="submit" className="btn btnPrimary btnSm" disabled={menyimpan}>
                {menyimpan ? 'Menyimpan...' : 'Catat'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
