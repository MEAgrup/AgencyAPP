'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  isCreativeDivision,
  isDirector,
  listCreativeBriefQueue,
  listMyAssets,
  scanAssetReminders,
  type Brief,
  type MyAssetQueueItem,
  type ReminderScanResult,
} from '@/lib/creative';
import StatusBadge from '@/components/StatusBadge';

export default function CreativeWorkspacePage() {
  const { role } = useAuth();
  const router = useRouter();
  const canScanReminders = isCreativeDivision(role) || isDirector(role);

  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [myAssets, setMyAssets] = useState<MyAssetQueueItem[] | null>(null);
  const [myAssetsLoading, setMyAssetsLoading] = useState(true);
  const [myAssetsError, setMyAssetsError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ReminderScanResult | null>(null);

  const [briefJump, setBriefJump] = useState('');
  const [assetJump, setAssetJump] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listCreativeBriefQueue();
      setBriefs(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMyAssets = useCallback(async () => {
    setMyAssetsLoading(true);
    setMyAssetsError(null);
    try {
      const res = await listMyAssets();
      setMyAssets(res.data);
    } catch (err) {
      setMyAssetsError(errorMessage(err));
    } finally {
      setMyAssetsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadMyAssets();
  }, [load, loadMyAssets]);

  async function handleScan() {
    setScanError(null);
    setScanResult(null);
    setScanning(true);
    try {
      const res = await scanAssetReminders();
      setScanResult(res);
    } catch (err) {
      setScanError(errorMessage(err));
    } finally {
      setScanning(false);
    }
  }

  function handleBriefJump(e: FormEvent) {
    e.preventDefault();
    const id = briefJump.trim();
    if (!id) return;
    router.push(`/creative/briefs/${encodeURIComponent(id)}`);
  }

  function handleAssetJump(e: FormEvent) {
    e.preventDefault();
    const id = assetJump.trim();
    if (!id) return;
    router.push(`/creative/assets/${encodeURIComponent(id)}`);
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Creative</h1>
          <p className="muted">
            Workspace Creative (M7) &mdash; assign team untuk creative production per brief, loop
            revisi, dan Daily Output. Lapisan RENCANA-nya (jadwal harian per studio) ada di
            Jadwal Produksi (M19).
          </p>
        </div>
        {/* Sub-layar Creative dijangkau dari sini, bukan dari menu utama —
            pola yang sama dengan Daily Output. Menaruhnya di nav akan membuat
            Creative satu-satunya divisi yang punya sub-item, dan simetri lima
            papan divisi itu yang dijaga `nav.test.ts`. */}
        <div className="row" style={{ gap: 8 }}>
          <Link href="/creative/schedule" className="btn btnPrimary">
            Jadwal Produksi
          </Link>
          <Link href="/creative/schedule/rekap" className="btn btnSecondary">
            Rekap Hari-Sama
          </Link>
          <Link href="/creative/ketersediaan" className="btn btnSecondary">
            Ketidaktersediaan
          </Link>
          <Link href="/creative/daily-output" className="btn btnSecondary">
            Daily Output
          </Link>
        </div>
      </div>

      {canScanReminders && (
        <section className="card">
          <div className="cardHeader">
            <h2>Reminder Hours Logged</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Aman dipanggil berulang kali &mdash; idempotent per Asset per hari WIB (m7.md §6.11).
          </p>
          {scanError && <div className="alert alertError" role="alert">{scanError}</div>}
          {scanResult && (
            <div className="alert alertSuccess" role="status">
              Reminder terkirim: {scanResult.reminders_sent}
            </div>
          )}
          <button type="button" className="btn btnPrimary btnSm" disabled={scanning} onClick={handleScan}>
            {scanning ? 'Memindai...' : 'Scan Sekarang'}
          </button>
        </section>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Antrean Aset Saya</h2>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Semua Asset yang ditugaskan ke Anda, lintas Brief/klien, urut jatuh tempo (M7 §3 Rule 2).
        </p>
        {myAssetsLoading && <p className="muted">Memuat...</p>}
        {myAssetsError && <div className="alert alertError" role="alert">{myAssetsError}</div>}
        {!myAssetsLoading && !myAssetsError && myAssets && myAssets.length === 0 && (
          <div className="emptyState">Tidak ada Asset yang ditugaskan ke Anda.</div>
        )}
        {!myAssetsLoading && !myAssetsError && myAssets && myAssets.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Tipe</th>
                  <th>Klien</th>
                  <th>Brief</th>
                  <th>Prioritas</th>
                  <th>Status</th>
                  <th>Jatuh Tempo</th>
                </tr>
              </thead>
              <tbody>
                {myAssets.map((a) => (
                  <tr key={a.id}>
                    <td><Link href={`/creative/assets/${a.id}`}>{a.id}</Link> <span className="muted">#{a.sequence_no}</span></td>
                    <td>{a.asset_type}</td>
                    <td>{a.client_name}</td>
                    <td><Link href={`/creative/briefs/${a.brief_id}`}>{a.brief_title}</Link></td>
                    <td>{a.priority || '—'}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td>{a.due_date || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Buka Langsung</h2>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Buka Brief atau Asset langsung dari ID-nya, atau pilih dari antrean di bawah.
        </p>
        <div className="formRow">
          <form className="field" onSubmit={handleBriefJump}>
            <label htmlFor="brief-jump">Brief ID</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                id="brief-jump"
                placeholder="BRF-..."
                value={briefJump}
                onChange={(e) => setBriefJump(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn btnSecondary btnSm">Buka</button>
            </div>
          </form>
          <form className="field" onSubmit={handleAssetJump}>
            <label htmlFor="asset-jump">Asset ID</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                id="asset-jump"
                placeholder="AST-..."
                value={assetJump}
                onChange={(e) => setAssetJump(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn btnSecondary btnSm">Buka</button>
            </div>
          </form>
        </div>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Antrean Brief Divisi Creative</h2>
        </div>
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && briefs && briefs.length === 0 && (
          <div className="emptyState">Tidak ada Brief di antrean divisi Creative.</div>
        )}
        {!loading && !error && briefs && briefs.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  {/* B-2 / Creative #3: Leader melihat MEREK, bukan cuma BRF-.
                      Sebelum ini antrean divisi tidak menyebut klien sama
                      sekali, jadi Leader harus membuka tiap Brief satu-satu
                      untuk tahu pekerjaan siapa yang sedang ia bagi. */}
                  <th>Klien</th>
                  <th>Judul</th>
                  <th>Deliverable</th>
                  <th>Target Qty</th>
                  <th>PIC</th>
                  <th>Prioritas</th>
                  <th>Status</th>
                  <th>Jatuh Tempo</th>
                </tr>
              </thead>
              <tbody>
                {briefs.map((b) => (
                  <tr key={b.id}>
                    <td><Link href={`/creative/briefs/${b.id}`}>{b.id}</Link></td>
                    <td>
                      {b.client_nama || '—'}
                      {b.client_id && <div className="muted" style={{ fontSize: 11 }}>{b.client_id}</div>}
                    </td>
                    <td>{b.title}</td>
                    <td>{b.deliverable_type}</td>
                    <td>{b.quantity_target}</td>
                    {/* Nama dulu, ID di baris kedua: yang orang kenali adalah
                        namanya, dan ID-nya yang tercatat di jejak audit. */}
                    <td>
                      {b.assigned_pic_nama || (b.assigned_pic ? b.assigned_pic : '—')}
                      {b.assigned_pic_nama && b.assigned_pic && (
                        <div className="muted" style={{ fontSize: 11 }}>{b.assigned_pic}</div>
                      )}
                    </td>
                    <td>{b.priority}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td>{b.due_date || '—'}</td>
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
