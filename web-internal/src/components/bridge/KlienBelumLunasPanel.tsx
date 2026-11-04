'use client';

/**
 * Panel follow-up Finance — BRIDGE-DP (opsi b, keputusan pemilik 2026-11-04).
 *
 * Klien MEAGO yang order Bridge-nya diterima saat pembayaran klien belum
 * lunas. Angkanya SNAPSHOT saat MSDPS meneruskan order (MSDPS 0377): Fase 1
 * tidak mengirim update pelunasan, jadi baris tidak hilang sendiri — Finance
 * mengonfirmasi pelunasan ke tim MEAGO/MSDPS di luar sistem.
 *
 * Panel sekunder: dirender hanya kalau ada isinya, dan kegagalan memuatnya
 * tidak boleh mengosongkan antrean verifikasi di halaman yang sama.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listKlienBelumLunas, type KlienBelumLunas } from '@/lib/bridge';
import { formatIDR } from '@/lib/money';

function formatTanggal(value: string) {
  return new Date(value).toLocaleDateString('id-ID');
}

function formatPersen(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '—';
}

export default function KlienBelumLunasPanel() {
  const [rows, setRows] = useState<KlienBelumLunas[]>([]);

  useEffect(() => {
    let batal = false;
    listKlienBelumLunas()
      .then((res) => {
        if (!batal) setRows(res.data);
      })
      .catch(() => {
        if (!batal) setRows([]);
      });
    return () => {
      batal = true;
    };
  }, []);

  if (rows.length === 0) return null;

  return (
    <section className="card">
      <div className="cardHeader">
        <h2>Klien MEAGO belum lunas saat diteruskan — {rows.length}</h2>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Order Bridge MSDPS yang diterima saat klien baru membayar sebagian (DP). Angka adalah
        kondisi saat order diteruskan; MSDPS tidak mengirim kabar pelunasan, jadi konfirmasikan
        langsung ke tim MEAGO.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Klien</th>
              <th>Deal MSDPS</th>
              <th>Terbayar</th>
              <th>Nilai kontrak</th>
              <th>Diverifikasi MSDPS</th>
              <th>Diterima CDPS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.client_id}-${r.external_deal_code}`}>
                <td>
                  <Link href={`/clients/${r.client_id}`}>{r.toko || '—'}</Link>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {r.client_id} · {r.kota}
                  </div>
                </td>
                <td>{r.external_deal_code}</td>
                <td>
                  <span className="badge badge-amber">DP {formatPersen(r.persen_terbayar)}</span>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {formatIDR(r.nominal_terbayar)}
                  </div>
                </td>
                <td>{formatIDR(r.nilai)}</td>
                <td>{formatTanggal(r.diverifikasi_pada)}</td>
                <td>{formatTanggal(r.diterima_pada)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
