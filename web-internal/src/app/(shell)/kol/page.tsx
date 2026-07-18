'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api';
import { listKolBriefQueue, type Brief } from '@/lib/kol';
import StatusBadge from '@/components/StatusBadge';

export default function KolWorkspacePage() {
  const router = useRouter();

  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Buka langsung by id — M9 tidak punya endpoint agregat lintas-Brief untuk
  // booking (m9 brief "TIDAK TERSEDIA" #1/#3), jadi buka Booking/Payment
  // Request langsung dari ID-nya.
  const [bookingJump, setBookingJump] = useState('');
  const [paymentJump, setPaymentJump] = useState('');

  const load = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
          <h2>Antrean Brief Divisi KOL</h2>
        </div>
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
