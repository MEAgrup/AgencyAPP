'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { listClients, type Client, type ListClientsParams, type StatusRilisFilter, type UrutClients } from '@/lib/clients';
import { SisaBadge } from '@/components/clients/ContractSection';
import { TanggalClosing } from '@/components/clients/TanggalClosing';

// FS-5b (feedback tim Sales 2026-09-09) — "durasi kontrak service klien bisa
// di cek di halaman klien" (roster), bukan hanya di Client Record (FS-5).
// Sama badge, `SisaBadge`, supaya roster dan detail konsisten.
function DurasiKontrak({ c }: { c: Client }) {
  if (c.contract_durasi_bulan === null || c.contract_tanggal_mulai === null || c.contract_tanggal_akhir === null) {
    // Bukan '—' diam-diam (alasan sama dengan ContractSection.tsx): klien ini
    // hanya membeli layanan sekali jadi, jadi memang tidak punya jendela
    // kontrak — bukan data yang hilang.
    return <span className="muted">Layanan tidak ada durasi</span>;
  }
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <span>{c.contract_durasi_bulan} bulan</span>
      <SisaBadge mulai={c.contract_tanggal_mulai} akhir={c.contract_tanggal_akhir} />
    </span>
  );
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // P2 §6: server memaginasi. `nextCursor` null = sudah halaman terakhir.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Pencarian nama klien / toko dijalankan di server (daftar dipaginasi, jadi
  // filter sisi-klien hanya akan melihat halaman yang sudah dimuat).
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');

  // Feedback OD 27-10-2026: follow-up "Menunggu Finance". Sama alasannya dengan
  // pencarian — filter & urutan dijalankan server, kursor membawa filter yang sama.
  const [closingDari, setClosingDari] = useState('');
  const [closingSampai, setClosingSampai] = useState('');
  const [statusRilis, setStatusRilis] = useState<StatusRilisFilter>('');
  const [urut, setUrut] = useState<UrutClients>('terbaru');
  const filterAktif = query !== '' || closingDari !== '' || closingSampai !== '' || statusRilis !== '';

  const params: ListClientsParams = useMemo(
    () => ({ q: query, closing_dari: closingDari, closing_sampai: closingSampai, status_rilis: statusRilis, urut }),
    [query, closingDari, closingSampai, statusRilis, urut],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listClients(params);
      setClients(res.data);
      setNextCursor(res.next_cursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [params]);

  // Menyambung, bukan mengganti.
  async function loadMore() {
    if (nextCursor === null) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await listClients({ ...params, cursor: nextCursor });
      setClients((prev) => [...(prev ?? []), ...res.data]);
      setNextCursor(res.next_cursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="stack">
      <div>
        <h1>Klien</h1>
        <p className="muted">Daftar Client Record (M4) &mdash; provenance &amp; visibilitas per peran.</p>
      </div>

      <form
        className="row"
        style={{ gap: 8 }}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(searchInput.trim());
        }}
      >
        <input
          type="search"
          className="input"
          style={{ maxWidth: 360 }}
          placeholder="Cari nama klien / nama toko..."
          aria-label="Cari klien berdasarkan nama klien atau nama toko"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button type="submit" className="btn">Cari</button>
        {filterAktif && (
          <button
            type="button"
            className="btn btnSecondary"
            onClick={() => {
              setSearchInput('');
              setQuery('');
              setClosingDari('');
              setClosingSampai('');
              setStatusRilis('');
            }}
          >
            Reset
          </button>
        )}
      </form>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">Tanggal closing dari</span>
          <input
            type="date"
            className="input"
            value={closingDari}
            max={closingSampai || undefined}
            onChange={(e) => setClosingDari(e.target.value)}
          />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">sampai</span>
          <input
            type="date"
            className="input"
            value={closingSampai}
            min={closingDari || undefined}
            onChange={(e) => setClosingSampai(e.target.value)}
          />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">Status Rilis</span>
          <select
            className="input"
            value={statusRilis}
            onChange={(e) => setStatusRilis(e.target.value as StatusRilisFilter)}
          >
            <option value="">Semua</option>
            <option value="menunggu_finance">Menunggu Finance</option>
            <option value="dirilis">Dirilis</option>
          </select>
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">Urutkan</span>
          <select className="input" value={urut} onChange={(e) => setUrut(e.target.value as UrutClients)}>
            <option value="terbaru">Closing terbaru</option>
            <option value="terlama">Paling lama menunggu (closing terlama)</option>
          </select>
        </label>
      </div>

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && clients && clients.length === 0 && (
          <div className="emptyState">
            {query !== ''
              ? `Tidak ada klien yang cocok dengan "${query}".`
              : filterAktif
                ? 'Tidak ada klien yang cocok dengan filter ini.'
                : 'Belum ada klien yang terlihat untuk peran Anda.'}
          </div>
        )}
        {!loading && !error && clients && clients.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Client ID</th>
                  <th>Nama Klien</th>
                  <th>Toko</th>
                  <th>Kota</th>
                  <th>Kategori</th>
                  <th>Sales PIC</th>
                  <th>Tanggal Closing</th>
                  <th>Durasi Kontrak</th>
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
                    <td>{c.nama_pic || '—'}</td>
                    <td>{c.toko}</td>
                    <td>{c.kota}</td>
                    <td>{c.kategori}</td>
                    <td>{c.sales_pic_id}</td>
                    <td><TanggalClosing c={c} /></td>
                    <td><DurasiKontrak c={c} /></td>
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
        {nextCursor !== null && (
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button type="button" className="btn btnSecondary" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? 'Memuat...' : 'Muat lebih banyak'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
