'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { claimLead, getLead, type LeadDetailResponse } from '@/lib/leads';
import { useAuth } from '@/lib/auth-context';
import StatusBadge from '@/components/StatusBadge';

const RECORD_STATUS_POOL = '[Pool]';

function formatDate(value: string) {
  return new Date(value).toLocaleString('id-ID');
}

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();

  const [detail, setDetail] = useState<LeadDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getLead(id);
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

  async function handleClaim() {
    setClaimError(null);
    setClaimMessage(null);
    setClaiming(true);
    try {
      await claimLead(id);
      setClaimMessage('Lead berhasil di-klaim.');
      await load();
    } catch (err) {
      setClaimError(errorMessage(err));
    } finally {
      setClaiming(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !detail) {
    return (
      <div className="stack">
        <Link href="/leads" className="muted">&larr; Kembali ke Leads</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Lead tidak ditemukan.'}</div>
      </div>
    );
  }

  const { lead, attempts } = detail;
  const isSales = (role?.division ?? '').toLowerCase() === 'sales';
  const canClaim = lead.record_status === RECORD_STATUS_POOL && isSales;

  return (
    <div className="stack">
      <div>
        <Link href="/leads" className="muted">&larr; Kembali ke Leads</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{lead.lead_name}</h1>
          <p className="muted">{lead.id}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {lead.manual_review_flag && <span className="badge badge-amber">Perlu review manual</span>}
          {lead.stale && <span className="badge badge-red">STALE</span>}
          <StatusBadge status={lead.record_status} />
        </div>
      </div>

      {claimError && <div className="alert alertError" role="alert">{claimError}</div>}
      {claimMessage && <div className="alert alertSuccess" role="status">{claimMessage}</div>}

      <section className="card">
        <div className="cardHeader">
          <h2>Detail Lead</h2>
          {canClaim && (
            <button type="button" className="btn btnPrimary" disabled={claiming} onClick={handleClaim}>
              {claiming ? 'Memproses...' : 'Klaim'}
            </button>
          )}
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Nama</div>
            <div>{lead.lead_name || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Telepon</div>
            <div>{lead.phone_number || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Sumber</div>
            <div>{lead.source || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Divisi Asal</div>
            <div>{lead.origin_division || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Pemilik Aktif</div>
            <div>
              {lead.active_owners.length > 0
                ? lead.active_owners.map((o) => o.name || o.employee_id).join(', ')
                : '—'}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Masuk</div>
            <div>{formatDate(lead.created_at)}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Attempts</h2>
        </div>
        {attempts.length === 0 ? (
          <div className="emptyState">Belum ada attempt.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Pemenang</th>
                  <th>Dibuat</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((att) => (
                  <tr key={att.id}>
                    <td>{att.owner_name || att.owner_employee_id || '—'}</td>
                    <td><StatusBadge status={att.status} /></td>
                    <td>{att.is_winner ? <span className="badge badge-green">Pemenang</span> : '—'}</td>
                    <td>{formatDate(att.created_at)}</td>
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
