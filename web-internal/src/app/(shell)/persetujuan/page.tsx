'use client';

/**
 * "Perlu Persetujuan Saya" — a small, combined approval inbox for Sales
 * lead/SPV/Director: Sales negotiation attempts + Renewal/Cross-Sell requests
 * currently sitting in Pending Approval, in one page. Owner explicitly scoped
 * this down (2026-08-31, "Mulai kecil: Sales + Renewal saja") from the full
 * universal approval inbox (Finance TCR, Lead Delete, Hold Service, M12
 * Block, KOL escalation, Strategi review, Plan gate, Interview, …) — those
 * stay out of scope here; see `docs/DECISIONS.md`.
 *
 * Both lists reuse existing endpoints/status filters as-is
 * (`sales.listAttempts` / `renewal.listRenewals`, both `?status=`-filtered,
 * both RLS-scoped) — this page adds no new permission logic, it only merges
 * two already-correct reads into one view. Links go to each item's real
 * detail page (`/sales/{id}`, `/clients/{id}#renewal`); there is no new
 * "approve here" action.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { listAttempts, type AttemptRow } from '@/lib/sales';
import { listAllRenewals, JENIS_PERPANJANGAN, type RenewalListRow } from '@/lib/renewal';
import StatusBadge from '@/components/StatusBadge';

const ATTEMPT_PENDING = 'Negotiation - Pending Approval';
const RENEWAL_PENDING = 'Pending Approval';

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('id-ID');
}

export default function PerluPersetujuanPage() {
  const [attempts, setAttempts] = useState<AttemptRow[] | null>(null);
  const [renewals, setRenewals] = useState<RenewalListRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [attemptRes, renewalRes] = await Promise.all([
        listAttempts(ATTEMPT_PENDING),
        listAllRenewals(RENEWAL_PENDING),
      ]);
      setAttempts(attemptRes.data);
      setRenewals(renewalRes.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const total = (attempts?.length ?? 0) + (renewals?.length ?? 0);

  return (
    <div className="stack">
      <div>
        <h1>Perlu Persetujuan Saya</h1>
        <p className="muted">
          Semua negosiasi Sales &amp; Renewal/Cross-Sell yang sedang menunggu keputusan Anda, dalam
          satu tempat. Baris yang tampil sudah mengikuti hak akses Anda (staff = milik sendiri,
          Lead/SPV = seluruh divisi, Director = semua).
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
        </>
      )}
    </div>
  );
}
