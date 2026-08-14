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
  scanAssetReminders,
  type Brief,
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

  useEffect(() => {
    load();
  }, [load]);

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
            revisi, dan Daily Output.
          </p>
        </div>
        <Link href="/creative/daily-output" className="btn btnSecondary">
          Daily Output
        </Link>
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
          <h2>Buka Langsung</h2>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          M7 tidak punya endpoint agregat lintas-Brief untuk personal queue (lihat catatan build) &mdash;
          buka Brief atau Asset langsung dari ID-nya, atau pilih dari antrean di bawah.
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
                    <td>{b.title}</td>
                    <td>{b.deliverable_type}</td>
                    <td>{b.quantity_target}</td>
                    <td>{b.assigned_pic || '—'}</td>
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
