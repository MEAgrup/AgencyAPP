'use client';

/**
 * `/bridge/inbox/{id}` — detail satu order MSDPS + Accept/Reject.
 *
 * Payload imutabel dirender terbaca (deal, merchant, PIC, kategori, jendela
 * kontrak, baris bridge, atestasi + cross-charge), pemilih kandidat dedup
 * (never auto-selects — human chooses), empat field manual AM
 * (gmv_baseline/target_gmv/link_toko/kategori — D7: TIDAK PERNAH diturunkan
 * dari payload), dan Reject dengan alasan wajib.
 *
 * Gerbang D10 (lead Account atau Director) ditegakkan SERVER-side
 * (`bridge.canDecideOrder`, mirror `sm_edges` machine #35); di sini hanya
 * menyembunyikan tombol untuk peran yang pasti ditolak (mis. OD read-only).
 */
import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage, isForbidden } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { isAccountLead } from '@/lib/account';
import {
  acceptBridgeOrder,
  getBridgeOrder,
  rejectBridgeOrder,
  type BridgeCandidate,
  type BridgeOrderDetail,
} from '@/lib/bridge';
import { formatIDR } from '@/lib/money';
import StatusBadge from '@/components/StatusBadge';
import { MetaGrid } from '@/components/persetujuan/ApprovalCard';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

const CONFIDENCE_LABEL: Record<string, string> = {
  exact: 'Cocok persis (referensi tersimpan)',
  link: 'Kemungkinan cocok (tautan toko)',
  fuzzy: 'Mirip (nama + kota)',
};

export default function BridgeOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { role } = useAuth();
  const canDecide = Boolean(role?.director) || isAccountLead(role);

  const [order, setOrder] = useState<BridgeOrderDetail | null>(null);
  const [candidates, setCandidates] = useState<BridgeCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [terlarang, setTerlarang] = useState(false);

  const [pilihan, setPilihan] = useState<string>(''); // '' = klien baru
  const [gmvBaseline, setGmvBaseline] = useState('');
  const [targetGmv, setTargetGmv] = useState('');
  const [linkToko, setLinkToko] = useState('');
  const [kategori, setKategori] = useState('');
  const [alasanTolak, setAlasanTolak] = useState('');
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const [aksiError, setAksiError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getBridgeOrder(id);
      setOrder(res.order);
      setCandidates(res.candidates);
      setKategori((prev) => prev || res.order.payload.merchant.kategori_poi);
    } catch (err) {
      if (isForbidden(err)) {
        setTerlarang(true);
        return;
      }
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function doAccept() {
    setAksiError(null);
    setBusy('accept');
    try {
      await acceptBridgeOrder(id, {
        existing_client_id: pilihan === '' ? null : pilihan,
        gmv_baseline: gmvBaseline,
        target_gmv: targetGmv,
        link_toko: linkToko,
        kategori,
      });
      router.push('/bridge/inbox');
    } catch (err) {
      setAksiError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function doReject() {
    if (alasanTolak.trim() === '') {
      setAksiError('[alasan penolakan wajib diisi]');
      return;
    }
    if (!window.confirm(`Tolak order ${id}? MSDPS tidak menerima callback di Fase 1 — pastikan tim MEAGO diberi tahu di luar sistem.`)) {
      return;
    }
    setAksiError(null);
    setBusy('reject');
    try {
      await rejectBridgeOrder(id, alasanTolak);
      router.push('/bridge/inbox');
    } catch (err) {
      setAksiError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (terlarang) return null;
  if (loading) return <p className="muted">Memuat...</p>;
  if (error) {
    return (
      <div className="alert alertError" role="alert">
        {error}
      </div>
    );
  }
  if (!order) return null;

  const p = order.payload;
  const belumDiputuskan = order.status === '[Masuk]';

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>{order.id}</h1>
          <p className="muted">{p.deal_code} — MSDPS (MEAGO!/MCN MEA)</p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <section className="card" style={{ padding: 14 }}>
        <div className="cardHeader">
          <h2>Merchant</h2>
        </div>
        <MetaGrid
          items={[
            { label: 'Nama', value: p.merchant.nama },
            { label: 'Kota', value: p.merchant.kota },
            { label: 'Kategori POI', value: p.merchant.kategori_poi },
            { label: 'PIC', value: p.merchant.pic_nama },
            { label: 'WhatsApp PIC', value: p.merchant.pic_whatsapp ?? '—' },
            { label: 'Jendela kontrak', value: `${p.merchant.tanggal_mulai_kontrak} s/d ${p.merchant.tanggal_akhir_kontrak}` },
            { label: 'ID eksternal', value: p.merchant.external_id },
          ]}
        />
      </section>

      <section className="card" style={{ padding: 14 }}>
        <div className="cardHeader">
          <h2>Atestasi pembayaran (MSDPS Finance)</h2>
        </div>
        <MetaGrid
          items={[
            { label: 'Bentuk kerjasama', value: p.attestation.bentuk_kerjasama },
            { label: 'Ref transaksi MSDPS', value: p.attestation.external_trx_ref },
            { label: 'Nilai', value: p.attestation.nilai ? formatIDR(p.attestation.nilai) : '—' },
            { label: 'Diverifikasi pada', value: formatDateTime(p.attestation.diverifikasi_pada) },
            { label: 'Diverifikasi/dibawa oleh', value: p.attestation.diverifikasi_oleh_external ?? '—' },
          ]}
        />
      </section>

      <section className="card" style={{ padding: 14 }}>
        <div className="cardHeader">
          <h2>Baris bridge ({p.lines.length})</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Jenis</th>
              <th>Qty</th>
              <th>Catatan</th>
              <th>Cross-charge</th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={i}>
                <td>
                  {l.jenis}
                  {l.jenis === 'KOL-Non-Roster' && l.alasan_non_roster && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      Alasan non-roster: {l.alasan_non_roster}
                    </div>
                  )}
                </td>
                <td>{l.qty ?? '—'}</td>
                <td>{l.catatan ?? '—'}</td>
                <td>{l.nilai_cross_charge ? formatIDR(l.nilai_cross_charge) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {belumDiputuskan && canDecide && (
        <section className="card" style={{ padding: 14 }}>
          <div className="cardHeader">
            <h2>Terima order</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Pilih klien yang sudah ada bila merchant ini sudah dikenal CDPS, atau
            biarkan &quot;Klien baru&quot; untuk membuat <code>CLI-</code> baru
            ber-<code>sumber=&apos;meago&apos;</code>. Sistem TIDAK PERNAH memilih
            sendiri — cocokkan dengan hati-hati, penggabungan yang salah tidak bisa
            dibatalkan.
          </p>

          {candidates.length > 0 && (
            <div className="field">
              <label htmlFor="kandidat">Kandidat klien yang sudah ada</label>
              <select id="kandidat" value={pilihan} onChange={(e) => setPilihan(e.target.value)}>
                <option value="">— Klien baru —</option>
                {candidates.map((c) => (
                  <option key={c.client_id} value={c.client_id}>
                    {c.client_id} — {c.toko} ({c.kota}) — {CONFIDENCE_LABEL[c.confidence] ?? c.confidence}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div className="field">
              <label htmlFor="gmv-baseline">GMV baseline</label>
              <input id="gmv-baseline" value={gmvBaseline} onChange={(e) => setGmvBaseline(e.target.value)} placeholder="0" />
            </div>
            <div className="field">
              <label htmlFor="target-gmv">Target GMV</label>
              <input id="target-gmv" value={targetGmv} onChange={(e) => setTargetGmv(e.target.value)} placeholder="0" />
            </div>
            <div className="field">
              <label htmlFor="link-toko">Link toko</label>
              <input id="link-toko" value={linkToko} onChange={(e) => setLinkToko(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="kategori">Kategori</label>
              <input id="kategori" value={kategori} onChange={(e) => setKategori(e.target.value)} />
            </div>
          </div>

          {aksiError && (
            <div className="alert alertError" role="alert">
              {aksiError}
            </div>
          )}

          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btnApprove" disabled={busy !== null} onClick={doAccept}>
              {busy === 'accept' ? 'Memproses...' : 'Terima order'}
            </button>
          </div>

          <hr style={{ margin: '16px 0' }} />

          <div className="field">
            <label htmlFor="alasan-tolak">Alasan penolakan (wajib untuk Tolak)</label>
            <textarea id="alasan-tolak" rows={2} value={alasanTolak} onChange={(e) => setAlasanTolak(e.target.value)} />
          </div>
          <button type="button" className="btn btnReject" disabled={busy !== null} onClick={doReject}>
            {busy === 'reject' ? 'Memproses...' : 'Tolak order'}
          </button>
        </section>
      )}

      {belumDiputuskan && !canDecide && (
        <p className="muted">
          Menunggu keputusan lead Account atau Director. Anda melihat order ini
          karena berada dalam lingkup baca Anda.
        </p>
      )}
    </div>
  );
}
