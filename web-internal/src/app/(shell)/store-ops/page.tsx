'use client';

// M18 — papan divisi Store Operation.
//
// Sampai sekarang divisi ini mendarat di antrean generik `/tasks?division=Store+Operation`
// (catatan `nav.ts`), yang menampilkan Brief tapi tidak punya tempat untuk unit
// kerjanya: satu Brief "optimasi 7 SKU" terbaca sebagai satu baris atom. Halaman
// ini memberi antrean itu kolom yang divisi ini sebetulnya pakai — berapa baris
// SKU, berapa yang sudah tayang, dan berapa yang pernah gagal upload.
//
// Angka ringkasannya ditarik PER BRIEF lewat `/sku-summary`. Itu N+1 yang
// disengaja dan dibatasi: antreannya adalah Brief yang belum selesai untuk satu
// divisi (puluhan, bukan ribuan), dan alternatifnya — menempelkan enam angka
// turunan ke `briefToWire` — akan membebani SETIAP pembacaan Brief di seluruh
// sistem demi satu halaman.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import StatusBadge from '@/components/StatusBadge';
import {
  DIVISION,
  fmtPersen,
  getBriefSkuSummary,
  type SkuSummary,
} from '@/lib/storeops';
import type { Brief } from '@/lib/tasks';

function listQueue(): Promise<{ data: Brief[] }> {
  return api.get<{ data: Brief[] }>(`/divisions/${encodeURIComponent(DIVISION)}/brief-queue`);
}

export default function StoreOpsBoardPage() {
  const { role } = useAuth();
  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [ringkas, setRingkas] = useState<Record<string, SkuSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listQueue();
      setBriefs(res.data);
      // Ringkasan per Brief ditarik berbarengan, bukan berurutan. Kegagalan satu
      // Brief tidak boleh mengosongkan seluruh papan — `allSettled`, dan yang
      // gagal sekadar tidak punya angka (dirender '—'), bukan halaman merah.
      const hasil = await Promise.allSettled(res.data.map((b) => getBriefSkuSummary(b.id)));
      const peta: Record<string, SkuSummary> = {};
      hasil.forEach((h, i) => {
        if (h.status === 'fulfilled') peta[res.data[i].id] = h.value;
      });
      setRingkas(peta);
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
      <header className="pageHeader">
        <h1>Store Operation</h1>
        <p className="muted">
          Antrean Brief divisi. Satu Brief dipecah jadi baris SKU — buka Brief-nya untuk
          melihat dan menggerakkan barisnya.
        </p>
      </header>

      {/* Divisi ini belum punya pipeline tahapan (LT-2 menunggu pemilik). Dikatakan
          di sini, bukan didiamkan: panel Tahapan Produksi di halaman Brief akan
          terlihat kosong, dan orang berhak tahu itu keadaan yang diketahui. */}
      <div className="alert alertInfo" role="status">
        Daftar tahapan produksi divisi ini belum ditetapkan (LT-2), jadi panel
        &quot;Tahapan Produksi&quot; pada Brief masih kosong. Gerbang <em>Cek Brief AM</em>,
        baris SKU, dan leadtime-nya tetap berjalan.
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Brief Masuk</h2>
          <button type="button" className="btn btnGhost" onClick={load} disabled={loading}>
            {loading ? 'Memuat...' : 'Muat ulang'}
          </button>
        </div>
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!error && briefs && briefs.length === 0 && (
          <div className="muted">Belum ada Brief untuk divisi ini.</div>
        )}
        {briefs && briefs.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Brief</th>
                  <th>Klien</th>
                  <th>Status</th>
                  <th>PIC</th>
                  <th>Baris SKU</th>
                  <th>Terupload</th>
                  <th>%Ontime</th>
                  <th>% Gagal Upload</th>
                </tr>
              </thead>
              <tbody>
                {briefs.map((b) => {
                  const s = ringkas[b.id];
                  return (
                    <tr key={b.id}>
                      <td>
                        <Link href={`/store-ops/briefs/${b.id}`}>{b.id}</Link>
                        <div className="muted" style={{ fontSize: 12 }}>{b.title}</div>
                      </td>
                      <td>
                        {b.client_nama || '—'}
                        <div className="muted" style={{ fontSize: 12 }}>{b.client_id || '—'}</div>
                      </td>
                      <td><StatusBadge status={b.status} /></td>
                      <td>{b.assigned_pic_nama || '—'}</td>
                      <td>
                        {/* A-req-3: "0" bukan data kosong, ia berarti BELUM DIPECAH —
                            dan itu justru baris yang paling perlu dilihat leader. */}
                        {s ? `${s.total} baris` : '—'}
                        {s && s.total === 0 && <span className="badge badge-amber">belum dipecah</span>}
                      </td>
                      <td>{s ? `${s.selesai} dari ${s.total}` : '—'}</td>
                      <td>{s ? fmtPersen(s.ontime_pct) : '—'}</td>
                      <td>{s ? fmtPersen(s.gagal_upload_pct) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {role === null && <div className="muted">Memuat peran…</div>}
    </div>
  );
}
