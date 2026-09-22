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
 *
 * F-6b (interview lapangan 2026-09-22, via Handa Anthy): "Edit" TIDAK meng-
 * UPDATE baris lama — `daily_activities` tetap append-only (DECISIONS.md
 * F-6, house rule #3). Tombol Edit membuka form dengan data lama terisi;
 * submit meng-INSERT baris BARU beserta `koreksi_dari` menunjuk ke baris
 * lama. Baris lama tetap ada di riwayat, ditandai "Dikoreksi" dan kehilangan
 * tombol Edit-nya sendiri — untuk mengoreksi lagi, edit versi terbaru
 * (ujung rantai), bukan versi asli.
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
  const [filterDate, setFilterDate] = useState('');

  const [activityType, setActivityType] = useState<string>(ACTIVITY_TYPES[0]);
  const [activityDate, setActivityDate] = useState(today());
  const [jamMulai, setJamMulai] = useState('');
  const [jamSelesai, setJamSelesai] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [buktiPelaksanaan, setBuktiPelaksanaan] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // F-6b — id baris yang sedang dikoreksi, null berarti form sedang mencatat
  // entri baru (bukan koreksi).
  const [koreksiDari, setKoreksiDari] = useState<string | null>(null);

  const load = useCallback(async (date: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listDailyActivities(date ? { from: date, to: date } : {});
      setRows(res.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filterDate);
  }, [load, filterDate]);

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
        koreksi_dari: koreksiDari || undefined,
      });
      setActivityType(ACTIVITY_TYPES[0]);
      setActivityDate(today());
      setJamMulai('');
      setJamSelesai('');
      setKeterangan('');
      setBuktiPelaksanaan('');
      setKoreksiDari(null);
      await load(filterDate);
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(r: DailyActivity) {
    setSubmitError(null);
    setActivityType(r.activity_type);
    setActivityDate(r.activity_date);
    setJamMulai(r.jam_mulai);
    setJamSelesai(r.jam_selesai ?? '');
    setKeterangan(r.keterangan);
    setBuktiPelaksanaan(r.bukti_pelaksanaan ?? '');
    setKoreksiDari(r.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setSubmitError(null);
    setActivityType(ACTIVITY_TYPES[0]);
    setActivityDate(today());
    setJamMulai('');
    setJamSelesai('');
    setKeterangan('');
    setBuktiPelaksanaan('');
    setKoreksiDari(null);
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
          <h2>{koreksiDari ? 'Koreksi Aktivitas' : 'Catat Aktivitas Baru'}</h2>
        </div>
        {koreksiDari && (
          <div className="alert" role="status">
            Mengoreksi entri lama — entri lama tetap tersimpan di riwayat (ditandai &quot;Dikoreksi&quot;), ini akan menjadi entri baru.{' '}
            <button type="button" className="btn" onClick={cancelEdit} disabled={submitting}>Batal Koreksi</button>
          </div>
        )}
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
              {submitting ? 'Menyimpan...' : koreksiDari ? 'Simpan Koreksi' : 'Simpan Aktivitas'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Riwayat{seeOthers ? ' (divisi Anda)' : ' Saya'}</h2>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field">
            <label htmlFor="dact-filter-date">Filter Tanggal</label>
            <input
              id="dact-filter-date"
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              disabled={loading}
            />
          </div>
          {filterDate && (
            <button type="button" className="btn" onClick={() => setFilterDate('')} disabled={loading}>
              Semua Tanggal
            </button>
          )}
        </div>
        {loading && <p className="muted">Memuat...</p>}
        {loadError && <div className="alert alertError" role="alert">{loadError}</div>}
        {!loading && !loadError && rows.length === 0 && (
          <div className="emptyState">
            {filterDate ? `Tidak ada aktivitas tercatat pada ${formatDate(filterDate)}.` : 'Belum ada aktivitas tercatat.'}
          </div>
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
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isMine = r.employee_id === employee?.employee_id;
                  const superseded = !!r.dikoreksi_oleh;
                  return (
                    <tr key={r.id} style={superseded ? { opacity: 0.6 } : undefined}>
                      <td style={superseded ? { textDecoration: 'line-through' } : undefined}>
                        {formatDate(r.activity_date)}
                      </td>
                      <td>{r.jam_mulai}{r.jam_selesai ? `–${r.jam_selesai}` : ''}</td>
                      {showWhose && <td>{r.employee_nama || r.employee_id}</td>}
                      <td>{r.activity_type}</td>
                      <td>
                        {r.keterangan}
                        {r.koreksi_dari && <span className="muted"> (koreksi)</span>}
                      </td>
                      <td>
                        {r.bukti_pelaksanaan
                          ? <a href={r.bukti_pelaksanaan} target="_blank" rel="noreferrer">Lihat</a>
                          : '—'}
                      </td>
                      <td>
                        {superseded ? (
                          <span className="muted">Dikoreksi</span>
                        ) : isMine ? (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => startEdit(r)}
                            disabled={submitting || koreksiDari === r.id}
                          >
                            Edit
                          </button>
                        ) : '—'}
                      </td>
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
