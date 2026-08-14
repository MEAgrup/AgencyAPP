'use client';

/**
 * M6D — Rekap Hasil Mingguan, per-client chain (D-10). A thin index: given a
 * client (`?clientId=`), list its weekly recaps newest-first and link into the
 * detail page. Scope is enforced server-side (`listRecapsForClient`): owning AM /
 * Account lead / OD+Director.
 */
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { errorMessage } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import { listRecapsForClient, type Recap } from '@/lib/recap';

function RekapListInner() {
  const params = useSearchParams();
  const clientId = params.get('clientId') ?? '';
  const [rows, setRows] = useState<Recap[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (clientId === '') return;
    setLoading(true);
    setError(null);
    try {
      const res = await listRecapsForClient(clientId);
      setRows(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="page" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820 }}>
      <h1 style={{ margin: 0 }}>Rekap Hasil Mingguan</h1>
      {clientId === '' ? (
        <p>
          Buka rekap dari sebuah klien — halaman ini menerima parameter{' '}
          <code>?clientId=CLT-…</code> (mis. dari notifikasi atau halaman Client Health).
        </p>
      ) : (
        <>
          <p style={{ color: 'var(--muted, #666)' }}>Klien {clientId}</p>
          {loading && <p>Memuat…</p>}
          {error && <p className="error">{error}</p>}
          {!loading && !error && rows.length === 0 && <p><em>Belum ada rekap untuk klien ini.</em></p>}
          {rows.length > 0 && (
            <table className="table">
              <thead>
                <tr><th>Minggu</th><th>Periode</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.iso_week} / {r.iso_year}</td>
                    <td>{r.minggu_mulai} – {r.minggu_akhir}</td>
                    <td>
                      <StatusBadge status={r.status} />{' '}
                      {r.pernah_ditutup_otomatis && <span className="badge badge-amber" title="Pernah ditutup otomatis">auto</span>}
                    </td>
                    <td><Link href={`/account/rekap/${encodeURIComponent(r.id)}`}>Buka</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </main>
  );
}

export default function RekapListPage() {
  return (
    <Suspense fallback={<main className="page"><p>Memuat…</p></main>}>
      <RekapListInner />
    </Suspense>
  );
}
