'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { getReminders, scanReminders, type RemindersResponse, type ScanResult } from '@/lib/finance';
import StatusBadge from '@/components/StatusBadge';

// Exact installment status the row-highlight rule targets (M5 §6). A
// substring match here would also flag '[Belum Jatuh Tempo]' rows, since it
// contains 'Jatuh Tempo' as a substring.
const STATUS_JATUH_TEMPO = '[Jatuh Tempo]';

export default function RemindersPage() {
  const [data, setData] = useState<RemindersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getReminders();
      setData(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleScan() {
    setScanError(null);
    setScanResult(null);
    setScanning(true);
    try {
      const res = await scanReminders();
      setScanResult(res);
      await load();
    } catch (err) {
      setScanError(errorMessage(err));
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Reminder Pembayaran</h1>
          <p className="muted">Dashboard reminder dual-audience (M5 §6).</p>
        </div>
        <button type="button" className="btn btnPrimary" disabled={scanning} onClick={handleScan}>
          {scanning ? 'Memindai...' : 'Scan Sekarang'}
        </button>
      </div>

      {scanError && <div className="alert alertError" role="alert">{scanError}</div>}
      {scanResult && (
        <div className="alert alertSuccess" role="status">
          Overdue ditandai: {scanResult.overdue_flagged} &middot; Reminder H-3 terkirim: {scanResult.h3_reminders_sent}{' '}
          &middot; Flag kontrak terlambat: {scanResult.contract_flags_raised}
        </div>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Jatuh Tempo &amp; Akan Jatuh Tempo</h2>
        </div>
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && data && data.reminders.length === 0 && (
          <div className="emptyState">Tidak ada installment jatuh tempo atau akan jatuh tempo.</div>
        )}
        {!loading && !error && data && data.reminders.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Klien</th>
                  <th>Toko</th>
                  <th>Termin #</th>
                  <th>Amount</th>
                  <th>Jatuh Tempo</th>
                  <th>Status</th>
                  <th>Hari Terlambat</th>
                  <th>Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {data.reminders.map((r) => (
                  <tr key={r.installment_id} className={r.status === STATUS_JATUH_TEMPO && r.days_overdue > 0 ? 'flaggedRow' : ''}>
                    <td>
                      <Link href={`/clients/${r.client_id}`}>{r.client_id}</Link>
                    </td>
                    <td>{r.toko}</td>
                    <td>{r.installment_no}</td>
                    <td>{r.amount}</td>
                    <td>{r.due_date}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>{r.days_overdue > 0 ? r.days_overdue : '—'}</td>
                    <td>{r.label || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Outstanding &mdash; Tanpa Jatuh Tempo</h2>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Bayar Sebagian dengan sisa terbuka, tanpa jadwal termin. Awareness only.
        </p>
        {!loading && !error && data && data.outstanding_no_due_date.length === 0 && (
          <div className="emptyState">Tidak ada outstanding tanpa jatuh tempo.</div>
        )}
        {!loading && !error && data && data.outstanding_no_due_date.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Klien</th>
                  <th>Toko</th>
                  <th>Transaksi</th>
                  <th>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {data.outstanding_no_due_date.map((o) => (
                  <tr key={o.transaction_id}>
                    <td>
                      <Link href={`/clients/${o.client_id}`}>{o.client_id}</Link>
                    </td>
                    <td>{o.toko}</td>
                    <td>
                      <Link href={`/finance/transactions/${o.transaction_id}`}>{o.transaction_id}</Link>
                    </td>
                    <td>{o.amount_outstanding}</td>
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
