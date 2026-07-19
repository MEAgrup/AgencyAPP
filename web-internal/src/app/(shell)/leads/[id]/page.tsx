'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, errorMessage } from '@/lib/api';
import { getLead, type LeadDetail, type LeadAttemptRow } from '@/lib/leads';
import StatusBadge from '@/components/StatusBadge';
import { extractStatusLabel, summarizeJson } from '@/lib/audit';

interface AuditEntry {
  actor_employee_id: string;
  action: string;
  before_json: unknown;
  after_json: unknown;
  created_at: string;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [leadDetail, setLeadDetail] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const detail = await getLead(id);
      setLeadDetail(detail);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadAudit = useCallback(async () => {
    setAuditError(null);
    try {
      const res = await api.get<{ data: AuditEntry[] }>(
        `/audit?entity_type=lead&entity_id=${encodeURIComponent(id)}`,
      );
      setAuditEntries(res.data);
    } catch (err) {
      setAuditError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    load();
    loadAudit();
  }, [load, loadAudit]);

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !leadDetail) {
    return (
      <div className="stack">
        <Link href="/leads" className="muted">
          &larr; Kembali ke Leads
        </Link>
        <div className="alert alertError" role="alert">
          {loadError ?? '[data tidak ditemukan]'}
        </div>
      </div>
    );
  }

  const { lead, attempts } = leadDetail;

  return (
    <div className="stack">
      <div>
        <Link href="/leads" className="muted">
          &larr; Kembali ke Leads
        </Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{lead.id}</h1>
          <p className="muted">{lead.lead_name}</p>
        </div>
        <StatusBadge status={lead.record_status} />
      </div>

      {/* Info Lead */}
      <section className="card">
        <div className="cardHeader">
          <h2>Info Lead</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              ID
            </div>
            <div>{lead.id}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Nama Lead
            </div>
            <div>{lead.lead_name}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Nomor Telepon
            </div>
            <div>{lead.phone_number || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Email
            </div>
            <div>{lead.email || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Sumber
            </div>
            <div>{lead.source}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Divisi Asal
            </div>
            <div>{lead.origin_division}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Campaign ID (Asal)
            </div>
            <div>{lead.origin_campaign_id || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Campaign ID (Touch Terakhir)
            </div>
            <div>{lead.last_touch_campaign_id || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Status
            </div>
            <div>
              <StatusBadge status={lead.record_status} />
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Winning Attempt ID
            </div>
            <div>{lead.winning_attempt_id || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Dibuat
            </div>
            <div>{formatDateTime(lead.created_at)}</div>
          </div>
        </div>
      </section>

      {/* Prospect Attempts (Kontes) */}
      <section className="card">
        <div className="cardHeader">
          <h2>Prospect Attempts (Kontes)</h2>
        </div>
        {attempts.length === 0 ? (
          <p className="muted">Belum ada attempt.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Diklaim</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt: LeadAttemptRow) => (
                  <tr key={attempt.id}>
                    <td>
                      <Link href={`/sales/${attempt.id}`}>{attempt.id}</Link>
                    </td>
                    <td>{attempt.owner_nama}</td>
                    <td>
                      <StatusBadge status={attempt.status} />
                    </td>
                    <td>{formatDateTime(attempt.claimed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Histori Audit */}
      <section className="card">
        <div className="cardHeader">
          <h2>Histori</h2>
        </div>
        {auditError && <div className="alert alertError" role="alert">{auditError}</div>}
        {auditEntries.length === 0 ? (
          <p className="muted">Belum ada riwayat.</p>
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
                {auditEntries.map((entry, idx) => (
                  <tr key={`${entry.created_at}-${idx}`}>
                    <td>{entry.actor_employee_id}</td>
                    <td>{entry.action}</td>
                    <td>{extractStatusLabel(entry.before_json) ?? summarizeJson(entry.before_json)}</td>
                    <td>{extractStatusLabel(entry.after_json) ?? summarizeJson(entry.after_json)}</td>
                    <td>{formatDateTime(entry.created_at)}</td>
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
