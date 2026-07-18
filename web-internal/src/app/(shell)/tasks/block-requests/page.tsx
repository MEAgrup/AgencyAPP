'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  DIVISIONS,
  approveBlock,
  getTeamPortal,
  rejectBlock,
  type PendingBlockRequest,
} from '@/lib/tasks';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

export default function BlockRequestsPage() {
  const { role } = useAuth();

  // SPV/Lead default to their own division; Director may switch across divisions.
  const isDirector = Boolean(role?.director);
  const isLead = role?.level === 'lead';
  const [division, setDivision] = useState<string>(role?.division ?? '');

  const [queue, setQueue] = useState<PendingBlockRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-row decision state (only the acted row shows progress / disables).
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setQueue(null);
    try {
      const res = await getTeamPortal(division || undefined);
      setQueue(res.block_queue);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [division]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDecision(req: PendingBlockRequest, decision: 'approve' | 'reject') {
    const verb = decision === 'approve' ? 'menyetujui' : 'menolak';
    if (!window.confirm(`Yakin ingin ${verb} permintaan block untuk ${req.entity_id}?`)) return;
    setDecisionError(null);
    setDecisionMessage(null);
    setPendingId(req.id);
    try {
      const fn = decision === 'approve' ? approveBlock : rejectBlock;
      const res = await fn(req.source, req.entity_id, req.id);
      setDecisionMessage(
        `Permintaan block ${req.id} untuk ${req.entity_id}: ${res.status}.`,
      );
      await load();
    } catch (err) {
      setDecisionError(errorMessage(err));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Antrian Block-Request</h1>
        <p className="muted">
          Permintaan block yang menunggu keputusan SPV/Lead (M12) &mdash; sumber:{' '}
          <code>GET /portal/team</code>. Approve memindahkan task ke <StatusInline status="[Blocked]" />;
          reject membiarkan status tetap.
        </p>
      </div>

      <section className="card">
        <div className="formRow">
          <div className="field">
            <label htmlFor="division-select">Divisi</label>
            <select
              id="division-select"
              value={division}
              onChange={(e) => setDivision(e.target.value)}
              disabled={!isDirector && isLead}
            >
              {!division && <option value="">Pilih divisi...</option>}
              {DIVISIONS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>
        {!isDirector && isLead && (
          <p className="muted" style={{ fontSize: 12 }}>
            Anda hanya dapat melihat antrian divisi Anda sendiri. Keputusan akhir tetap divalidasi server.
          </p>
        )}
      </section>

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {decisionError && <div className="alert alertError" role="alert">{decisionError}</div>}
        {decisionMessage && <div className="alert alertSuccess" role="status">{decisionMessage}</div>}

        {!loading && !error && queue && queue.length === 0 && (
          <div className="emptyState">Tidak ada permintaan block yang menunggu keputusan.</div>
        )}
        {!loading && !error && queue && queue.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Tipe</th>
                  <th>Divisi</th>
                  <th>Klien</th>
                  <th>Alasan</th>
                  <th>Diajukan Oleh</th>
                  <th>Waktu</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((req) => (
                  <tr key={req.id}>
                    <td><Link href={`/tasks/${req.entity_id}`}>{req.entity_id}</Link></td>
                    <td>{req.source}</td>
                    <td>{req.division}</td>
                    <td>{req.client_id || '—'}</td>
                    <td>{req.reason || '—'}</td>
                    <td>{req.requested_by || '—'}</td>
                    <td>{formatDateTime(req.created_at)}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <button
                          type="button"
                          className="btn btnPrimary btnSm"
                          disabled={pendingId === req.id}
                          onClick={() => handleDecision(req, 'approve')}
                        >
                          {pendingId === req.id ? 'Memproses...' : 'Setujui'}
                        </button>
                        <button
                          type="button"
                          className="btn btnDanger btnSm"
                          disabled={pendingId === req.id}
                          onClick={() => handleDecision(req, 'reject')}
                        >
                          Tolak
                        </button>
                      </div>
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

// Inline status badge for prose (not a lifecycle field on an entity — kept local).
function StatusInline({ status }: { status: string }) {
  return <span className="badge badge-red">{status}</span>;
}
