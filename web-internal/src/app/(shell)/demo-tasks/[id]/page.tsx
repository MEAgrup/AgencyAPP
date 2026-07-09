'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, errorMessage } from '@/lib/api';
import type { DemoTaskDetail } from '@/lib/types';
import StatusBadge from '@/components/StatusBadge';
import { findPendingBlockRequest } from '@/lib/block-requests';
import { extractStatusLabel, summarizeJson } from '@/lib/audit';

export default function DemoTaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [detail, setDetail] = useState<DemoTaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get<DemoTaskDetail>(`/demo-tasks/${id}`);
      setDetail(res);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleTransition(to: string) {
    setActionError(null);
    setActionMessage(null);
    setPendingAction(`transition:${to}`);
    try {
      await api.post(`/demo-tasks/${id}/transition`, { to });
      setActionMessage(`Status berhasil diubah ke ${to}.`);
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleBlockRequest() {
    const reason = window.prompt('Alasan pengajuan block:');
    if (!reason) return;
    setActionError(null);
    setActionMessage(null);
    setPendingAction('block-request');
    try {
      await api.post(`/demo-tasks/${id}/block-request`, { reason });
      setActionMessage('Permintaan block berhasil diajukan.');
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleApproveBlock(reqId: string) {
    setActionError(null);
    setActionMessage(null);
    setPendingAction('approve-block');
    try {
      await api.post(`/demo-tasks/${id}/block-requests/${reqId}/approve`);
      setActionMessage('Permintaan block disetujui.');
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPendingAction(null);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !detail) {
    return (
      <div className="stack">
        <Link href="/demo-tasks" className="muted">&larr; Kembali ke Demo Tasks</Link>
        <div className="alert alertError">{loadError ?? 'Demo task tidak ditemukan.'}</div>
      </div>
    );
  }

  const { task, allowed_transitions, audit } = detail;
  const pendingBlock = findPendingBlockRequest(audit);

  return (
    <div className="stack">
      <div>
        <Link href="/demo-tasks" className="muted">&larr; Kembali ke Demo Tasks</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{task.title}</h1>
          <p className="muted">
            Dibuat oleh {task.created_by} &middot; {new Date(task.created_at).toLocaleString('id-ID')}
          </p>
        </div>
        <StatusBadge status={task.status} />
      </div>

      {task.description && (
        <section className="card">
          <h3>Deskripsi</h3>
          <p style={{ marginTop: 8 }}>{task.description}</p>
        </section>
      )}

      {actionError && <div className="alert alertError" role="alert">{actionError}</div>}
      {actionMessage && <div className="alert alertSuccess" role="status">{actionMessage}</div>}

      <section className="card">
        <div className="cardHeader">
          <h2>Aksi</h2>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          {allowed_transitions.length === 0 && (
            <span className="muted">Tidak ada transisi status yang tersedia.</span>
          )}
          {allowed_transitions.map((to) => (
            <button
              key={to}
              type="button"
              className="btn btnPrimary"
              disabled={pendingAction !== null}
              onClick={() => handleTransition(to)}
            >
              {pendingAction === `transition:${to}` ? 'Memproses...' : to}
            </button>
          ))}
          <button
            type="button"
            className="btn btnDanger"
            disabled={pendingAction !== null}
            onClick={handleBlockRequest}
          >
            {pendingAction === 'block-request' ? 'Memproses...' : 'Ajukan Block'}
          </button>
        </div>

        {pendingBlock && (
          <div className="alertInfo alert" style={{ marginTop: 14 }}>
            <div>
              Permintaan block menunggu persetujuan (diajukan oleh {pendingBlock.submittedBy} pada{' '}
              {new Date(pendingBlock.submittedAt).toLocaleString('id-ID')}).
            </div>
            <button
              type="button"
              className="btn btnPrimary btnSm"
              style={{ marginTop: 10 }}
              disabled={pendingAction !== null}
              onClick={() => handleApproveBlock(pendingBlock.id)}
            >
              {pendingAction === 'approve-block' ? 'Memproses...' : 'Setujui Block'}
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Riwayat Audit</h2>
        </div>
        {audit.length === 0 ? (
          <div className="emptyState">Belum ada riwayat.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Aktor</th>
                  <th>Aksi</th>
                  <th>Sebelum</th>
                  <th>Sesudah</th>
                  <th>Waktu</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((entry, idx) => (
                  <tr key={`${entry.created_at}-${idx}`}>
                    <td>{entry.actor}</td>
                    <td>{entry.action}</td>
                    <td>{extractStatusLabel(entry.before_json) ?? summarizeJson(entry.before_json)}</td>
                    <td>{extractStatusLabel(entry.after_json) ?? summarizeJson(entry.after_json)}</td>
                    <td>{new Date(entry.created_at).toLocaleString('id-ID')}</td>
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
