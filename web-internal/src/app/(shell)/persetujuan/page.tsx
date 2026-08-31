'use client';

/**
 * "Perlu Persetujuan Saya" — a combined approval inbox for Sales lead/SPV/
 * Account lead/KOL Team Leader/Director: every request-for-approval queue in
 * the system, pending only, in one page (owner decision 2026-08-31 — started
 * small with Sales + Renewal, then widened to all ~8 real queues on request).
 *
 * "Real queue" means a persisted pending STATUS someone else must act on —
 * Plan Gate and Interview verdicts were deliberately left OUT: both are
 * synchronous, one-call decisions with no persisted "awaiting approval" state
 * (`docs/DECISIONS.md` 2026-08-31), so there is nothing to list.
 *
 * Every section reuses an EXISTING read as-is — no new permission logic lives
 * here, this only merges already-correct, already-scoped reads into one view:
 *   - Sales negotiation   `sales.listAttempts` (?status=)
 *   - Renewal/Cross-Sell  `renewal.listRenewals` (?status=) — new list fn,
 *     same RLS posture as listAttempts
 *   - Finance TCR         `finance.schemeChangeRequests` (existing /finance queue)
 *   - Lead Delete         `leads.deleteRequestQueue` (existing /leads queue)
 *   - Hold Service        `client.pendingHoldRequests` (new — gates on canApproveHold)
 *   - M12 Block Request   `task.pendingBlockRequests` via existing `/portal/team`
 *     (same source as the dedicated /tasks/block-requests page)
 *   - KOL Escalation      `kol.pendingEscalations` (new — gates on canContinueEscalation)
 *   - Strategi Review     `account.pendingStrategyReviews` (new — gates on canApproveStrategy)
 *
 * Links go to each item's real detail/decision page; there is no new
 * "approve here" action on this page itself.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { listAttempts, type AttemptRow } from '@/lib/sales';
import { listAllRenewals, JENIS_PERPANJANGAN, type RenewalListRow } from '@/lib/renewal';
import { listSchemeChangeQueue, type SchemeChangeRequest } from '@/lib/finance';
import { listDeleteRequests, type DeleteRequestQueueRow } from '@/lib/leads';
import { listPendingHoldRequests, type PendingHoldRequest } from '@/lib/clients';
import { getTeamPortal, type PendingBlockRequest } from '@/lib/tasks';
import { listPendingEscalations, type PendingEscalation } from '@/lib/kol';
import { GMV_ADJ_PENDING, listPendingStrategyReviews, type PendingStrategyReview } from '@/lib/account';
import StatusBadge from '@/components/StatusBadge';

const ATTEMPT_PENDING = 'Negotiation - Pending Approval';
const RENEWAL_PENDING = 'Pending Approval';

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('id-ID');
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('id-ID');
}

export default function PerluPersetujuanPage() {
  const { role } = useAuth();
  // M12 Block Request comes from /portal/team, which 403s for anyone not a
  // division lead / Director (portal.go's own gate) — mirror the existing
  // /tasks/block-requests page's guard rather than firing a call sure to fail.
  const canViewBlockQueue = Boolean(role?.director || role?.level === 'lead');

  const [attempts, setAttempts] = useState<AttemptRow[] | null>(null);
  const [renewals, setRenewals] = useState<RenewalListRow[] | null>(null);
  const [tcrs, setTcrs] = useState<SchemeChangeRequest[] | null>(null);
  const [deleteRequests, setDeleteRequests] = useState<DeleteRequestQueueRow[] | null>(null);
  const [holdRequests, setHoldRequests] = useState<PendingHoldRequest[] | null>(null);
  const [blockRequests, setBlockRequests] = useState<PendingBlockRequest[] | null>(null);
  const [escalations, setEscalations] = useState<PendingEscalation[] | null>(null);
  const [strategyReviews, setStrategyReviews] = useState<PendingStrategyReview[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [attemptRes, renewalRes, tcrRes, deleteRes, holdRes, escalationRes, strategyRes, blockRes] =
        await Promise.all([
          listAttempts(ATTEMPT_PENDING),
          listAllRenewals(RENEWAL_PENDING),
          listSchemeChangeQueue(),
          listDeleteRequests(),
          listPendingHoldRequests(),
          listPendingEscalations(),
          listPendingStrategyReviews(),
          canViewBlockQueue ? getTeamPortal() : Promise.resolve(null),
        ]);
      setAttempts(attemptRes.data);
      setRenewals(renewalRes.data);
      setTcrs(tcrRes.data);
      setDeleteRequests(deleteRes.data);
      setHoldRequests(holdRes.data);
      setEscalations(escalationRes.data);
      setStrategyReviews(strategyRes.data);
      setBlockRequests(blockRes ? blockRes.block_queue : []);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [canViewBlockQueue]);

  useEffect(() => {
    load();
  }, [load]);

  const total =
    (attempts?.length ?? 0) +
    (renewals?.length ?? 0) +
    (tcrs?.length ?? 0) +
    (deleteRequests?.length ?? 0) +
    (holdRequests?.length ?? 0) +
    (blockRequests?.length ?? 0) +
    (escalations?.length ?? 0) +
    (strategyReviews?.length ?? 0);

  return (
    <div className="stack">
      <div>
        <h1>Perlu Persetujuan Saya</h1>
        <p className="muted">
          Semua permintaan yang sedang menunggu keputusan Anda, dari seluruh sistem, dalam satu
          tempat. Baris yang tampil sudah mengikuti hak akses Anda masing-masing (staff = milik
          sendiri, Lead/SPV = seluruh divisi, Director = semua) — halaman ini hanya menggabungkan,
          tidak menambah aturan akses baru.
        </p>
      </div>

      {loading && <p className="muted">Memuat...</p>}
      {loadError && <div className="alert alertError" role="alert">{loadError}</div>}

      {!loading && !loadError && (
        <>
          {total === 0 && (
            <div className="emptyState">Tidak ada yang menunggu persetujuan saat ini.</div>
          )}

          {(attempts?.length ?? 0) > 0 && (
            <section className="card">
              <div className="cardHeader">
                <h2>Negosiasi Sales ({attempts?.length})</h2>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>PRSP</th>
                      <th>Lead</th>
                      <th>Telepon</th>
                      <th>Status</th>
                      <th>Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts!.map((a) => (
                      <tr key={a.id}>
                        <td><Link href={`/sales/${a.id}`}>{a.id}</Link></td>
                        <td>{a.lead_name}</td>
                        <td>{a.phone_number}</td>
                        <td><StatusBadge status={a.status} /></td>
                        <td>{a.owner_nama || a.owner_employee_id || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {(renewals?.length ?? 0) > 0 && (
            <section className="card">
              <div className="cardHeader">
                <h2>Renewal / Cross-Sell ({renewals?.length})</h2>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>RNW</th>
                      <th>Klien</th>
                      <th>Jenis</th>
                      <th>Status</th>
                      <th>Diajukan</th>
                      <th>Tanggal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renewals!.map((r) => (
                      <tr key={r.id}>
                        <td>{r.id}</td>
                        <td><Link href={`/clients/${r.client_id}#renewal`}>{r.client_toko}</Link></td>
                        <td>{r.jenis === JENIS_PERPANJANGAN ? 'Perpanjangan' : 'Cross Sell'}</td>
                        <td><StatusBadge status={r.status} /></td>
                        <td>{r.proposed_by_nama}</td>
                        <td>{formatDate(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {(tcrs?.length ?? 0) > 0 && (
            <section className="card">
              <div className="cardHeader">
                <h2>Finance — Perubahan Skema Pembayaran ({tcrs?.length})</h2>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>TCR</th>
                      <th>Klien</th>
                      <th>Dari</th>
                      <th>Ke</th>
                      <th>Diajukan</th>
                      <th>Tanggal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tcrs!.map((r) => (
                      <tr key={r.id}>
                        <td><Link href={`/finance/transactions/${r.transaction_id}`}>{r.id}</Link></td>
                        <td>{r.toko || r.client_id || '—'}</td>
                        <td>{r.from_scheme}</td>
                        <td>{r.to_scheme}</td>
                        <td>{r.requested_by_nama || r.requested_by}</td>
                        <td>{formatDate(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {(deleteRequests?.length ?? 0) > 0 && (
            <section className="card">
              <div className="cardHeader">
                <h2>Permintaan Hapus Lead ({deleteRequests?.length})</h2>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Lead</th>
                      <th>Telepon</th>
                      <th>Alasan</th>
                      <th>Diajukan</th>
                      <th>Tanggal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deleteRequests!.map((r) => (
                      <tr key={r.id}>
                        <td><Link href={`/leads/${r.lead_id}`}>{r.lead_name}</Link></td>
                        <td>{r.phone_number}</td>
                        <td>{r.reason || '—'}</td>
                        <td>{r.requested_by_nama || r.requested_by}</td>
                        <td>{formatDate(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {(holdRequests?.length ?? 0) > 0 && (
            <section className="card">
              <div className="cardHeader">
                <h2>Permintaan Hold Service ({holdRequests?.length})</h2>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Klien</th>
                      <th>Service</th>
                      <th>AM</th>
                      <th>Diminta Pada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdRequests!.map((r) => (
                      <tr key={r.service_id}>
                        <td><Link href={`/clients/${r.client_id}`}>{r.toko}</Link></td>
                        <td>{r.service_name}</td>
                        <td>{r.owner_am_nama || r.owner_am || '—'}</td>
                        <td>{formatDateTime(r.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {(blockRequests?.length ?? 0) > 0 && (
            <section className="card">
              <div className="cardHeader">
                <h2>Permintaan Block Task — M12 ({blockRequests?.length})</h2>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Divisi</th>
                      <th>Klien</th>
                      <th>Alasan</th>
                      <th>Diajukan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blockRequests!.map((r) => (
                      <tr key={r.id}>
                        <td><Link href={`/tasks/${r.entity_id}`}>{r.entity_id}</Link></td>
                        <td>{r.division}</td>
                        <td>{r.toko || r.client_id || '—'}</td>
                        <td>{r.reason || '—'}</td>
                        <td>{r.requested_by_nama || r.requested_by}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Setujui/tolak di <Link href="/tasks/block-requests">Antrian Block-Request</Link>.
              </p>
            </section>
          )}

          {(escalations?.length ?? 0) > 0 && (
            <section className="card">
              <div className="cardHeader">
                <h2>Eskalasi KOL ({escalations?.length})</h2>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Booking</th>
                      <th>Klien</th>
                      <th>Creator</th>
                      <th>Coordinator</th>
                      <th>Waktu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {escalations!.map((r) => (
                      <tr key={r.booking_id}>
                        <td><Link href={`/kol/bookings/${r.booking_id}`}>{r.booking_id}</Link></td>
                        <td>{r.toko}</td>
                        <td>{r.creator_name}</td>
                        <td>{r.coordinator_nama || r.coordinator || '—'}</td>
                        <td>{formatDateTime(r.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {(strategyReviews?.length ?? 0) > 0 && (
            <section className="card">
              <div className="cardHeader">
                <h2>Review Strategi & Plan ({strategyReviews?.length})</h2>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Klien</th>
                      <th>Status</th>
                      <th>Penyesuaian GMV</th>
                      <th>Diajukan</th>
                      <th>Tanggal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {strategyReviews!.map((r) => (
                      <tr key={r.strategy_id}>
                        <td><Link href={`/clients/${r.client_id}`}>{r.toko}</Link></td>
                        <td><StatusBadge status={r.status} /></td>
                        <td>{r.gmv_adjustment_status === GMV_ADJ_PENDING ? 'Menunggu Persetujuan' : '—'}</td>
                        <td>{r.created_by_nama || r.created_by}</td>
                        <td>{formatDate(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
