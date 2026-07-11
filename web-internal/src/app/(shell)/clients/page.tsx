'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { listClients, type Client } from '@/lib/clients';

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listClients();
      setClients(res.data);
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
        <h1>Klien</h1>
        <p className="muted">Daftar Client Record (M4) &mdash; provenance &amp; visibilitas per peran.</p>
      </div>

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && clients && clients.length === 0 && (
          <div className="emptyState">Belum ada klien yang terlihat untuk peran Anda.</div>
        )}
        {!loading && !error && clients && clients.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Client ID</th>
                  <th>Toko</th>
                  <th>Kota</th>
                  <th>Kategori</th>
                  <th>Sales PIC</th>
                  <th>Payment Intent</th>
                  <th>Status Rilis</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/clients/${c.id}`}>{c.id}</Link>
                    </td>
                    <td>{c.toko}</td>
                    <td>{c.kota}</td>
                    <td>{c.kategori}</td>
                    <td>{c.sales_pic_id}</td>
                    <td>
                      {c.payment_intent ? (
                        <span className="badge badge-blue">{c.payment_intent}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {c.released_to_account_at ? (
                        <span className="badge badge-green">Released</span>
                      ) : (
                        <span className="badge badge-amber">Menunggu Finance</span>
                      )}
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
