'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import {
  getQueue,
  listSchemeChangeQueue,
  type SchemeChangeRequest,
  type Transaction,
} from '@/lib/finance';
import StatusBadge from '@/components/StatusBadge';

export default function FinanceQueuePage() {
  const [trxs, setTrxs] = useState<Transaction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<SchemeChangeRequest[]>([]);

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

  /**
   * Pending transaction changes (M5-OA-7). Rendered only when there are any —
   * the row scope is the server's (`transaction_change_requests_select`), so
   * this panel is a Director's ACC queue and Finance's own "waiting on the
   * Director" list, without either side needing a different page.
   */
  const loadChanges = useCallback(async () => {
    try {
      const res = await listSchemeChangeQueue();
      setChanges(res.data);
    } catch {
      // Secondary panel: a failure here must not blank the verification queue,
      // which is what this page exists for.
      setChanges([]);
    }
  }, []);

  useEffect(() => {
    load();
    loadChanges();
  }, [load, loadChanges]);

  return (
    <div className="stack">
      <div>
        <h1>Finance</h1>
        <p className="muted">
          Antrean transaksi yang belum lunas (M5 §8.1) — menunggu verifikasi lebih dulu, lalu yang
          sudah terverifikasi sebagian dan masih punya kekurangan pembayaran.
        </p>
      </div>

      {changes.length > 0 && (
        <section className="card">
          <div className="cardHeader">
            <h2>Pengajuan Perubahan Transaksi — menunggu ACC Direktur</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Diajukan SPV/Head Finance (M5-OA-7). Transaksi belum berubah sampai Direktur menyetujui;
            buka transaksinya untuk menyetujui, menolak, atau membatalkan.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Pengajuan</th>
                  <th>Transaksi</th>
                  <th>Klien</th>
                  <th>Perubahan</th>
                  <th>Kekurangan</th>
                  <th>Alasan</th>
                  <th>Diajukan</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>
                      <Link href={`/finance/transactions/${r.transaction_id}`}>{r.transaction_id}</Link>
                    </td>
                    <td>{r.toko || r.client_id || '—'}</td>
                    <td>{r.from_scheme || '—'} &rarr; {r.to_scheme}</td>
                    <td>{r.amount_outstanding}</td>
                    <td>{r.reason}</td>
                    <td>
                      {r.requested_by_nama || r.requested_by}
                      {' · '}
                      {new Date(r.created_at).toLocaleDateString('id-ID')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
