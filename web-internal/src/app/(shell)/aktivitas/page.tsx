'use client';

/**
 * Aktivitas Harian — F-6 (feedback lapangan 2026-09-14, Account): riwayat
 * aktivitas harian karyawan (Meeting Klien/Internal, Training, Webinar, Input
 * Data), waktu, bukti pelaksanaan. Nyambung ke M14 Team Performance.
 *
 * Universal (setiap orang mencatat aktivitasnya sendiri): daftarnya
 * menampilkan APA PUN yang RLS `daily_activities_select` izinkan tanpa filter
 * tambahan — staff otomatis hanya melihat miliknya, Lead/SPV seluruh
 * divisinya, OD/Director semuanya. Halaman ini tidak menduplikasi aturan itu.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/api';
import { ACTIVITY_TYPES, listDailyActivities, logDailyActivity, type DailyActivity } from '@/lib/dailyactivity';

function formatDate(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AktivitasHarianPage() {
  const { employee, role } = useAuth();
  // Hanya label heading ("Riwayat Saya" vs "(divisi Anda)") — server
  // (`jwt_can_read_all()` / `jwt_is_lead()`) yang benar-benar memutuskan baris
  // mana yang datang; kolom Karyawan di tabel dirender berdasarkan APAKAH baris
  // milik orang lain benar-benar muncul, bukan berdasarkan tebakan peran ini.
  const seeOthers = !!role && (role.level === 'lead' || role.od || role.director);

  const [rows, setRows] = useState<DailyActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activityType, setActivityType] = useState<string>(ACTIVITY_TYPES[0]);
  const [activityDate, setActivityDate] = useState(today());
  const [jamMulai, setJamMulai] = useState('');
  const [jamSelesai, setJamSelesai] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [buktiPelaksanaan, setBuktiPelaksanaan] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listDailyActivities();
      setRows(res.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      await logDailyActivity({
        activity_type: activityType,
        activity_date: activityDate,
        jam_mulai: jamMulai,
        jam_selesai: jamSelesai || undefined,
        keterangan,
        bukti_pelaksanaan: buktiPelaksanaan || undefined,
      });
      setJamMulai('');
      setJamSelesai('');
      setKeterangan('');
      setBuktiPelaksanaan('');
      await load();
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const showWhose = rows.some((r) => r.employee_id !== employee?.employee_id);

  return (
    <div className="stack">
      <div>
        <h1>Aktivitas Harian</h1>
        <p className="muted">
          Catat kegiatan kerja harian Anda — meeting klien/internal, training, webinar, input data.
          Ini bukan absensi (jam masuk/pulang tetap di sistem HR); ini catatan APA yang dikerjakan.
        </p>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Catat Aktivitas Baru</h2>
        </div>
        {submitError && <div className="alert alertError" role="alert">{submitError}</div>}
        <form className="form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="dact-type">Jenis Kegiatan</label>
            <select id="dact-type" value={activityType} onChange={(e) => setActivityType(e.target.value)} disabled={submitting}>
              {ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="field">
              <label htmlFor="dact-date">Tanggal</label>
              <input id="dact-date" type="date" required value={activityDate} onChange={(e) => setActivityDate(e.target.value)} disabled={submitting} />
            </div>
            <div className="field">
              <label htmlFor="dact-start">Jam Mulai</label>
              <input id="dact-start" type="time" required value={jamMulai} onChange={(e) => setJamMulai(e.target.value)} disabled={submitting} />
            </div>
            <div className="field">
              <label htmlFor="dact-end">Jam Selesai (opsional)</label>
              <input id="dact-end" type="time" value={jamSelesai} onChange={(e) => setJamSelesai(e.target.value)} disabled={submitting} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="dact-keterangan">Keterangan (wajib)</label>
            <textarea
              id="dact-keterangan"
              required
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              disabled={submitting}
              placeholder="Contoh: Meeting kick-off campaign Ramadan dengan klien Alpha Digital"
            />
          </div>
          <div className="field">
            <label htmlFor="dact-bukti">Bukti Pelaksanaan (link, opsional)</label>
            <input
              id="dact-bukti"
              type="text"
              value={buktiPelaksanaan}
              onChange={(e) => setBuktiPelaksanaan(e.target.value)}
              disabled={submitting}
              placeholder="Link foto/dokumen/rekaman, kalau ada"
            />
          </div>
          <div>
            <button type="submit" className="btn btnPrimary" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Simpan Aktivitas'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Riwayat{seeOthers ? ' (divisi Anda)' : ' Saya'}</h2>
        </div>
        {loading && <p className="muted">Memuat...</p>}
        {loadError && <div className="alert alertError" role="alert">{loadError}</div>}
        {!loading && !loadError && rows.length === 0 && (
          <div className="emptyState">Belum ada aktivitas tercatat.</div>
        )}
        {!loading && !loadError && rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Jam</th>
                  {showWhose && <th>Karyawan</th>}
                  <th>Jenis</th>
                  <th>Keterangan</th>
                  <th>Bukti</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.activity_date)}</td>
                    <td>{r.jam_mulai}{r.jam_selesai ? `–${r.jam_selesai}` : ''}</td>
                    {showWhose && <td>{r.employee_nama || r.employee_id}</td>}
                    <td>{r.activity_type}</td>
                    <td>{r.keterangan}</td>
                    <td>
                      {r.bukti_pelaksanaan
                        ? <a href={r.bukti_pelaksanaan} target="_blank" rel="noreferrer">Lihat</a>
                        : '—'}
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
