'use client';

/**
 * `/bridge/inbox` — antrean order eksternal dari MSDPS (MEAGO!/MCN MEA),
 * Bridge Fase 1. Pola KARTU-KEPUTUSAN (`app/(shell)/persetujuan/page.tsx`),
 * bukan tabel-berisi-tautan: setiap kartu membawa fakta order (kode deal,
 * merchant, kapan masuk) tanpa perlu klik. Accept/Reject butuh empat field
 * manual (gmv_baseline/target_gmv/link_toko/kategori) + pemilihan kandidat
 * dedup, jadi keduanya hidup di halaman DETAIL (`[id]/page.tsx`) — kartu di
 * sini hanya menaut ke sana.
 *
 * Gerbang D10 (dibaca ulang, DECISIONS.md 2026-09-10): lead Account atau
 * Director. RLS (`external_orders_select`) adalah jaring pengaman baca; OD
 * melihat lewat canReadAll tapi tidak bisa memutuskan — halaman detail
 * menyembunyikan tombol Accept/Reject untuknya, server menolak apa pun yang
 * lolos ke situ.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage, isForbidden } from '@/lib/api';
import { listBridgeOrders, ORDER_MASUK, type BridgeOrderSummary } from '@/lib/bridge';
import StatusBadge from '@/components/StatusBadge';
import ApprovalCard from '@/components/persetujuan/ApprovalCard';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

export default function BridgeInboxPage() {
  const [orders, setOrders] = useState<BridgeOrderSummary[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [terlarang, setTerlarang] = useState(false);

  const load = useCallback(async (all: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listBridgeOrders(all ? undefined : ORDER_MASUK);
      setOrders(res.data);
    } catch (err) {
      if (isForbidden(err)) {
        setTerlarang(true);
        setOrders(null);
        return;
      }
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(showAll);
  }, [load, showAll]);

  // 403 saat MEMUAT = senyap (halaman ini bukan untuk peran yang tidak
  // ditugasi memutuskan bridge — bukan error, cuma bukan miliknya).
  if (terlarang) return null;

  return (
    <div className="stack">
      <div>
        <h1>Bridge MSDPS (MEAGO!)</h1>
        <p className="muted">
          Order dari MEAGO!/MCN MEA yang perlu diterima atau ditolak sebelum masuk
          eksekusi divisi. Hanya deal berbayar yang pembayaran pertamanya sudah
          diverifikasi MSDPS Finance yang bisa sampai ke sini (D4+D13) — tidak ada
          gerbang tambahan yang perlu dicek di sini.
        </p>
      </div>

      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <button type="button" className="btn btnSecondary btnSm" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Tampilkan hanya [Masuk]' : 'Tampilkan semua (termasuk riwayat)'}
        </button>
      </div>

      {error && (
        <div className="alert alertError" role="alert">
          {error}
        </div>
      )}
      {loading && <p className="muted">Memuat...</p>}

      {!loading && orders && orders.length === 0 && (
        <p className="muted">
          {showAll ? 'Belum ada order yang pernah masuk.' : 'Tidak ada order [Masuk] yang menunggu keputusan.'}
        </p>
      )}

      <div className="stack" style={{ gap: 10 }}>
        {orders?.map((o) => (
          <ApprovalCard
            key={o.id}
            id={o.id}
            href={`/bridge/inbox/${o.id}`}
            title={o.external_deal_code}
            badge={<StatusBadge status={o.status} />}
            meta={[
              { label: 'Diterima', value: formatDateTime(o.diterima_pada) },
              { label: 'Klien', value: o.client_id ?? '—' },
              { label: 'Diputus oleh', value: o.diputus_oleh ?? '—' },
              { label: 'Alasan tolak', value: o.ditolak_alasan ?? '—' },
            ]}
          />
        ))}
      </div>
    </div>
  );
}
