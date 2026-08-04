'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { getQueue, type Transaction } from '@/lib/finance';
import StatusBadge from '@/components/StatusBadge';

export default function FinanceQueuePage() {
  const [trxs, setTrxs] = useState<Transaction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getQueue();
      setTrxs(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="stack">
      <div>
        <h1>Finance</h1>
        <p className="muted">
          Antrean transaksi yang belum lunas (M5 §8.1) — menunggu verifikasi lebih dulu, lalu yang
          sudah terverifikasi sebagian dan masih punya kekurangan pembayaran.
        </p>
      </div>

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && trxs && trxs.length === 0 && (
          <div className="emptyState">Tidak ada transaksi yang belum lunas.</div>
        )}
        {!loading && !error && trxs && trxs.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Transaksi</th>
                  <th>Klien</th>
                  <th>Status</th>
                  <th>Skema</th>
                  <th>Total</th>
                  <th>Terverifikasi</th>
                  <th>Kekurangan</th>
                </tr>
              </thead>
              <tbody>
                {trxs.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/finance/transactions/${t.id}`}>{t.id}</Link>
                    </td>
                    <td>
                      <Link href={`/clients/${t.client_id}`}>{t.client_id}</Link>
                    </td>
                    <td><StatusBadge status={t.payment_status} /></td>
                    <td>{t.payment_intent_scheme || '—'}</td>
                    <td>{t.total_agreed_value}</td>
                    <td>{t.amount_verified}</td>
                    <td>{t.amount_outstanding}</td>
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
