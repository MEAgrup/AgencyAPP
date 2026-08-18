'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getMonthlyKolReport, listKolBriefQueue, type Brief, type MonthlyKolReport } from '@/lib/kol';
import StatusBadge from '@/components/StatusBadge';

export default function KolWorkspacePage() {
  const router = useRouter();
  const { role } = useAuth();

  // Cermin gate ListDivisionQueue (module6 brief.go: CanReadAll / Account lead /
  // anggota divisi KOL). Role lain (mis. Finance yang membuka Payment Request via
  // "Buka Langsung") tidak boleh menembak GET brief-queue yang pasti 403.
  const canSeeQueue = Boolean(
    role &&
      (role.od ||
        role.director ||
        role.division.toLowerCase() === 'kol' ||
        (role.level === 'lead' && role.division.toLowerCase() === 'account')),
  );

  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [loading, setLoading] = useState(canSeeQueue);
  const [error, setError] = useState<string | null>(null);

  // Buka langsung by id — M9 tidak punya endpoint agregat lintas-Brief untuk
  // booking (m9 brief "TIDAK TERSEDIA" #1/#3), jadi buka Booking/Payment
  // Request langsung dari ID-nya.
  const [bookingJump, setBookingJump] = useState('');
  const [paymentJump, setPaymentJump] = useState('');

  const load = useCallback(async () => {
    if (!canSeeQueue) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listKolBriefQueue();
      setBriefs(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [canSeeQueue]);

  useEffect(() => {
    load();
  }, [load]);

  // Monthly KOL Report (§9). Coordinator sees own; lead/OD/Director may enter any
  // Coordinator id. year/month default to the current month.
  const now = new Date();
  const [reportCoord, setReportCoord] = useState('');
  const [reportYear, setReportYear] = useState(now.getUTCFullYear());
  const [reportMonth, setReportMonth] = useState(now.getUTCMonth() + 1);
  const [report, setReport] = useState<MonthlyKolReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  async function loadReport(e: FormEvent) {
    e.preventDefault();
    setReportLoading(true);
    setReportError(null);
    setReport(null);
    try {
      const r = await getMonthlyKolReport({
        coordinator: reportCoord.trim() || undefined,
        year: reportYear,
        month: reportMonth,
      });
      setReport(r);
    } catch (err) {
      setReportError(errorMessage(err));
    } finally {
      setReportLoading(false);
    }
  }

  function handleBookingJump(e: FormEvent) {
    e.preventDefault();
    const id = bookingJump.trim();
    if (!id) return;
    router.push(`/kol/bookings/${encodeURIComponent(id)}`);
  }

  function handlePaymentJump(e: FormEvent) {
    e.preventDefault();
    const id = paymentJump.trim();
    if (!id) return;
    router.push(`/kol/payment-requests/${encodeURIComponent(id)}`);
  }

  return (
    <div className="stack">
      <div>
        <h1>KOL</h1>
        <p className="muted">
          Workspace Creator Booking (M9) &mdash; sourcing, QC/eskalasi kreator, dan Creator Payment
          Request ke Finance.
        </p>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Buka Langsung</h2>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Belum ada daftar Booking/Payment Request tersentral di backend M9 &mdash; buka langsung
          dengan ID (BKG-YYYYMM-NNNN / CPR-YYYYMM-NNNN), atau buat Booking baru dari sebuah Brief di
          antrean di bawah.
        </p>
        <div className="formRow">
          <form className="field" onSubmit={handleBookingJump}>
            <label htmlFor="booking-jump">Booking ID</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                id="booking-jump"
                placeholder="BKG-202607-0001"
                value={bookingJump}
                onChange={(e) => setBookingJump(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn btnSecondary btnSm">Buka</button>
            </div>
          </form>
          <form className="field" onSubmit={handlePaymentJump}>
            <label htmlFor="payment-jump">Payment Request ID</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                id="payment-jump"
                placeholder="CPR-202607-0001"
                value={paymentJump}
                onChange={(e) => setPaymentJump(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn btnSecondary btnSm">Buka</button>
            </div>
          </form>
        </div>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Laporan Bulanan KOL</h2>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Rollup §9 per Coordinator: total booking, QC pass rate, rata-rata waktu sourcing,
          total spend (Σ Agreed Rate), dan jumlah eskalasi. Kosongkan Coordinator untuk laporan
          Anda sendiri.
        </p>
        <form className="formRow" onSubmit={loadReport}>
          <div className="field">
            <label htmlFor="report-coord">Coordinator (opsional)</label>
            <input
              id="report-coord"
              placeholder="EMP-... (kosong = Anda)"
              value={reportCoord}
              onChange={(e) => setReportCoord(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="report-year">Tahun</label>
            <input id="report-year" type="number" value={reportYear} onChange={(e) => setReportYear(Number(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="report-month">Bulan</label>
            <input id="report-month" type="number" min={1} max={12} value={reportMonth} onChange={(e) => setReportMonth(Number(e.target.value))} />
          </div>
          <div className="field" style={{ alignSelf: 'flex-end' }}>
            <button type="submit" className="btn btnPrimary btnSm" disabled={reportLoading}>
              {reportLoading ? 'Memuat...' : 'Muat Laporan'}
            </button>
          </div>
        </form>
        {reportError && <div className="alert alertError" role="alert">{reportError}</div>}
        {report && (
          <div className="grid2" style={{ marginTop: 8 }}>
            <div><div className="muted" style={{ fontSize: 12 }}>Coordinator</div><div>{report.coordinator_id}</div></div>
            <div><div className="muted" style={{ fontSize: 12 }}>Periode</div><div>{report.year}-{String(report.month).padStart(2, '0')}</div></div>
            <div><div className="muted" style={{ fontSize: 12 }}>Total Booking</div><div>{report.total_bookings}</div></div>
            <div><div className="muted" style={{ fontSize: 12 }}>QC Pass Rate</div><div>{report.qc_pass_rate_display} ({report.qc_passed_count}/{report.total_bookings})</div></div>
            <div><div className="muted" style={{ fontSize: 12 }}>Rata-rata Sourcing</div><div>{report.average_sourcing_display}</div></div>
            <div><div className="muted" style={{ fontSize: 12 }}>Total Spend (Σ Agreed Rate)</div><div>{report.total_spend_display}</div></div>
            <div><div className="muted" style={{ fontSize: 12 }}>Jumlah Eskalasi</div><div>{report.escalation_count}</div></div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Antrean Brief Divisi KOL</h2>
        </div>
        {!canSeeQueue && (
          <div className="alert alertInfo" role="status">
            Antrean Brief divisi KOL hanya dapat dibuka oleh anggota divisi KOL, Account
            Lead/SPV, OD, atau Direktur. Gunakan &quot;Buka Langsung&quot; di atas untuk membuka
            Booking / Payment Request berdasarkan ID.
          </div>
        )}
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && briefs && briefs.length === 0 && (
          <div className="emptyState">Tidak ada Brief di antrean divisi KOL.</div>
        )}
        {!loading && !error && briefs && briefs.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Judul</th>
                  <th>Deliverable</th>
                  <th>PIC</th>
                  <th>Prioritas</th>
                  <th>Status</th>
                  <th>Jatuh Tempo</th>
                </tr>
              </thead>
              <tbody>
                {briefs.map((b) => (
                  <tr key={b.id}>
                    <td><Link href={`/kol/briefs/${b.id}`}>{b.id}</Link></td>
                    <td>{b.title}</td>
                    <td>{b.deliverable_type}</td>
                    <td>{b.assigned_pic || '—'}</td>
                    <td>{b.priority}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td>{b.due_date || '—'}</td>
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
