'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatPeriodLabel } from '@/lib/performance';
import { PORTAL_TEAM_DIVISIONS, getTeamPortalFull, type TeamPortalFull } from '@/lib/portal';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

export default function TeamPortalPage() {
  const { role } = useAuth();

  // Cermin gate TeamPortalFor (portal.go): hanya lead divisi ybs. atau Director;
  // division kosong = 403 (Director wajib memilih). Audiens Rule 10 = divisi
  // ber-skor M14 — lead divisi lain (Sales/Finance/Marketing) mendapat 404 dari
  // rollup (edge terdokumentasi DECISIONS W3-M15-C1), jadi jangan ditembak.
  const isDirector = Boolean(role?.director);
  const isLead = role?.level === 'lead';
  const ownDivision = role?.division ?? '';
  const ownScored = (PORTAL_TEAM_DIVISIONS as readonly string[]).some(
    (d) => d.toLowerCase() === ownDivision.toLowerCase(),
  );
  const canView = isDirector || (isLead && ownScored);
  const leadOutOfScope = !isDirector && isLead && !ownScored;

  const [division, setDivision] = useState<string>('');
  const effectiveDivision = division || (isDirector ? '' : ownScored ? ownDivision : '');

  const [portal, setPortal] = useState<TeamPortalFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView || !effectiveDivision) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getTeamPortalFull(effectiveDivision);
      setPortal(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [canView, effectiveDivision]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canView) {
    return (
      <div className="stack">
        <div>
          <h1>Portal Tim</h1>
          <p className="muted">
            Landing SPV/Lead (M15-C1 Rule 10) &mdash; sumber: <code>GET /portal/team</code>.
          </p>
        </div>
        <div className="alert alertInfo" role="status">
          {leadOutOfScope
            ? `Portal Tim menampilkan rollup skor KPI M14 — cakupannya divisi Creative, Ads, KOL, dan Account. Divisi Anda (${ownDivision || '—'}) berada di luar cakupan tersebut.`
            : 'Halaman ini khusus SPV/Lead divisi dan Direktur.'}
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h1>Portal Tim</h1>
        <p className="muted">
          Landing SPV/Lead (M15-C1 Rule 10): rollup performa divisi + ringkas klien + antrian
          block-request &mdash; sumber: <code>GET /portal/team</code>.
        </p>
      </div>

      {isDirector && (
        <section className="card">
          <div className="formRow">
            <div className="field">
              <label htmlFor="team-division">Divisi</label>
              <select id="team-division" value={division} onChange={(e) => setDivision(e.target.value)}>
                {!division && <option value="">Pilih divisi...</option>}
                {PORTAL_TEAM_DIVISIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>
        </section>
      )}

      {!effectiveDivision && !loading && (
        <div className="alert alertInfo" role="status">
          Pilih divisi terlebih dahulu untuk melihat Portal Tim.
        </div>
      )}
      {loading && <p className="muted">Memuat...</p>}
      {error && <div className="alert alertError" role="alert">{error}</div>}

      {!loading && !error && portal && (
        <>
          <section className="card">
            <div className="cardHeader">
              <h2>
                Rollup Performa &mdash; {portal.division}{' '}
                <span className="muted" style={{ fontSize: 12 }} title="Auto-calculated (M14), tidak dapat diubah">🔒 read-only</span>
              </h2>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Periode {portal.performance_rollup.period ? formatPeriodLabel(portal.performance_rollup.period) : '—'} &middot;
              Rata-rata tim: <strong>{portal.performance_rollup.average_display}</strong>
            </p>
            {portal.performance_rollup.members.length === 0 ? (
              <div className="emptyState">Belum ada snapshot skor untuk divisi ini.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Staff</th>
                      <th>Role Type</th>
                      <th>Skor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portal.performance_rollup.members.map((m) => (
                      <tr key={m.staff_id}>
                        <td><Link href={`/performance/${m.staff_id}`}>{m.staff_id}</Link></td>
                        <td>{m.role_type}</td>
                        <td>{m.score_display}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <div className="cardHeader">
              <h2>Klien Divisi</h2>
            </div>
            {portal.client_shortcuts.length === 0 ? (
              <div className="emptyState">Tidak ada klien ber-brief divisi ini.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Klien</th>
                      <th>Nama</th>
                      <th>AM</th>
                      <th>Board</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portal.client_shortcuts.map((c) => (
                      <tr key={c.client_id}>
                        <td><Link href={`/clients/${c.client_id}`}>{c.client_id}</Link></td>
                        <td>{c.client_name}</td>
                        <td>{c.assigned_am || '—'}</td>
                        <td><Link href="/board">Client Board &rarr;</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <div className="cardHeader">
              <h2>Antrian Block-Request</h2>
              <Link href="/tasks/block-requests" className="btn btnSecondary btnSm">
                Putuskan di Antrian Block-Request &rarr;
              </Link>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Read-only di sini &mdash; aksi Setujui/Tolak ada di halaman Antrian Block-Request (M12).
            </p>
            {portal.block_queue.length === 0 ? (
              <div className="emptyState">Tidak ada permintaan block yang menunggu keputusan.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Tipe</th>
                      <th>Klien</th>
                      <th>Alasan</th>
                      <th>Diajukan Oleh</th>
                      <th>Waktu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portal.block_queue.map((req) => (
                      <tr key={req.id}>
                        <td><Link href={`/tasks/${req.entity_id}`}>{req.entity_id}</Link></td>
                        <td>{req.source}</td>
                        <td>{req.client_id || '—'}</td>
                        <td>{req.reason || '—'}</td>
                        <td>{req.requested_by || '—'}</td>
                        <td>{formatDateTime(req.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
