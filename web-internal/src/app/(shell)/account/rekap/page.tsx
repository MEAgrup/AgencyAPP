'use client';

/**
 * M6D — Rekap Hasil Mingguan. Two surfaces in one route:
 *
 *  - Worklist (no query param): the self-service landing the "Rekap Mingguan"
 *    nav item points at. For an AM/Account/OD/Director it lists every active
 *    client in scope (via the M13 portfolio) with its CURRENT-week recap status
 *    and a direct fill link, plus a fill-discipline summary. For a touching
 *    execution-division lead — whose portfolio is empty server-side — it degrades
 *    to an open-by-client panel, so they can reach a recap of a client they
 *    worked and fill their RM-D6 division note.
 *  - Per-client chain (`?clientId=`): the recap history of one client, reached
 *    from a notification, Client Health, or the open-by-client panel below.
 *
 * Every write path (who may fill / close / dispute) is enforced server-side; this
 * page only lists and links — the detail page (`/account/rekap/[id]`) carries the
 * two-party inputs (AM fields + the division-note form gated by canWriteDivisiNote).
 */
import { Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, errorMessage } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import {
  listRecapsForClient,
  WRR_TERBUKA,
  WRR_DITUTUP,
  WRR_DITUTUP_OTOMATIS,
  type Recap,
} from '@/lib/recap';
import { getHealthPortfolio } from '@/lib/health';

// ---------------------------------------------------------------------------
// Open-by-client panel — shared by both surfaces (mirrors the "Buka Langsung"
// idiom on the division workspaces: no aggregate endpoint, jump by ID).
// ---------------------------------------------------------------------------

function OpenByClient() {
  const router = useRouter();
  const [clientId, setClientId] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const id = clientId.trim();
    if (id === '') return;
    router.push(`/account/rekap?clientId=${encodeURIComponent(id)}`);
  }

  return (
    <form className="field" onSubmit={submit}>
      <label htmlFor="rekap-client-jump">Buka rekap sebuah klien (Client ID)</label>
      <div className="row" style={{ gap: 8 }}>
        <input
          id="rekap-client-jump"
          placeholder="CLI-…"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btnSecondary btnSm">Buka</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Worklist (no clientId) — portfolio-driven for AM/OD/Director, open-by-client
// fallback for execution-division leads.
// ---------------------------------------------------------------------------

interface WorklistRow {
  clientId: string;
  toko: string;
  current: Recap | null; // newest recap = current week (auto-opened Monday), null if none yet
}

/** Ordering: things that need action first (Terbuka, then Ditutup Otomatis), then the rest, then no recap. */
function rowPriority(r: WorklistRow): number {
  const s = r.current?.status;
  if (s === WRR_TERBUKA) return 0;
  if (s === WRR_DITUTUP_OTOMATIS) return 1;
  if (s === WRR_DITUTUP) return 3;
  if (r.current) return 2; // Terjadwal
  return 4; // no recap yet
}

function Worklist() {
  const [rows, setRows] = useState<WorklistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // noPortfolio = the portfolio endpoint is out of scope for this role (403).
  // Expected for execution-division leads — degrade to open-by-client, not an error.
  const [noPortfolio, setNoPortfolio] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNoPortfolio(false);
    try {
      const portfolio = await getHealthPortfolio();
      const settled = await Promise.all(
        portfolio.data.map(async (p): Promise<WorklistRow> => {
          try {
            const recaps = await listRecapsForClient(p.client_id);
            return { clientId: p.client_id, toko: p.toko, current: recaps.data[0] ?? null };
          } catch {
            // A single client's recap read failing must not blank the whole worklist.
            return { clientId: p.client_id, toko: p.toko, current: null };
          }
        }),
      );
      setRows(settled);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setNoPortfolio(true);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => rowPriority(a) - rowPriority(b) || a.clientId.localeCompare(b.clientId)),
    [rows],
  );

  const needConfirm = rows.filter((r) => r.current?.status === WRR_TERBUKA).length;
  const autoClosed = rows.filter(
    (r) => r.current?.status === WRR_DITUTUP_OTOMATIS || r.current?.pernah_ditutup_otomatis,
  ).length;

  return (
    <div className="stack">
      <div>
        <h1>Rekap Hasil Mingguan</h1>
        <p className="muted">
          Rekap mingguan per klien aktif — status minggu berjalan, disiplin pengisian, dan tautan langsung
          untuk mengisi (M6D). Rekap dibuka otomatis tiap Senin 00:00 WIB.
        </p>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Buka Langsung</h2>
        </div>
        <OpenByClient />
      </section>

      {loading && <p className="muted">Memuat…</p>}
      {error && !loading && <div className="alert alertError" role="alert">{error}</div>}

      {!loading && !error && noPortfolio && (
        <section className="card">
          <div className="alert alertInfo" role="status">
            Worklist portofolio tidak tersedia untuk peran Anda. Buka rekap klien yang Anda kerjakan lewat
            <strong> Client ID</strong> di atas (atau dari notifikasi / antrean divisi), lalu isi bagian
            <strong> Catatan Divisi</strong> di halaman rekapnya.
          </div>
        </section>
      )}

      {!loading && !error && !noPortfolio && (
        <section className="card">
          <div className="cardHeader">
            <h2>Portofolio Klien Aktif</h2>
            <span className="muted" style={{ fontSize: 13 }}>
              {needConfirm > 0 && <><strong>{needConfirm}</strong> perlu dikonfirmasi</>}
              {needConfirm > 0 && autoClosed > 0 && ' · '}
              {autoClosed > 0 && <><strong>{autoClosed}</strong> pernah tutup otomatis</>}
            </span>
          </div>

          {rows.length === 0 && <p className="muted">Tidak ada klien aktif dalam cakupan Anda.</p>}

          {rows.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Klien</th>
                    <th>Minggu Berjalan</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const rec = r.current;
                    const actionable = rec?.status === WRR_TERBUKA || rec?.status === WRR_DITUTUP_OTOMATIS;
                    return (
                      <tr key={r.clientId}>
                        <td>
                          <strong>{r.toko || r.clientId}</strong>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
                            {r.clientId}
                          </div>
                        </td>
                        <td>
                          {rec ? (
                            <>
                              W{String(rec.iso_week).padStart(2, '0')} · {rec.iso_year}
                              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                {rec.minggu_mulai} – {rec.minggu_akhir}
                              </div>
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          {rec ? (
                            <>
                              <StatusBadge status={rec.status} />{' '}
                              {rec.pernah_ditutup_otomatis && (
                                <span className="badge badge-amber" title="Pernah ditutup otomatis oleh sistem">auto</span>
                              )}
                            </>
                          ) : (
                            <span className="muted">Belum dibuka</span>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {rec && (
                            <Link
                              href={`/account/rekap/${encodeURIComponent(rec.id)}`}
                              className={`btn btnSm ${actionable ? 'btnPrimary' : 'btnSecondary'}`}
                            >
                              {actionable ? 'Isi Rekap →' : 'Lihat →'}
                            </Link>
                          )}{' '}
                          <Link href={`/account/rekap?clientId=${encodeURIComponent(r.clientId)}`} className="btn btnSecondary btnSm">
                            Riwayat
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-client chain (`?clientId=`) — the recap history of one client. Scope is
// enforced server-side (`listRecapsForClient`): owning AM / Account lead / OD /
// Director / touching-division lead.
// ---------------------------------------------------------------------------

function ClientChain({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<Recap[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listRecapsForClient(clientId);
      setRows(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack">
      <div>
        <h1>Rekap Hasil Mingguan</h1>
        <p className="muted">Klien {clientId}</p>
      </div>

      <section className="card">
        <div className="cardHeader">
          <Link href="/account/rekap" className="btn btnSecondary btnSm">← Semua Klien</Link>
        </div>
        {loading && <p className="muted">Memuat…</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && rows.length === 0 && <p><em>Belum ada rekap untuk klien ini.</em></p>}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Minggu</th><th>Periode</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>W{String(r.iso_week).padStart(2, '0')} / {r.iso_year}</td>
                    <td>{r.minggu_mulai} – {r.minggu_akhir}</td>
                    <td>
                      <StatusBadge status={r.status} />{' '}
                      {r.pernah_ditutup_otomatis && (
                        <span className="badge badge-amber" title="Pernah ditutup otomatis">auto</span>
                      )}
                    </td>
                    <td><Link href={`/account/rekap/${encodeURIComponent(r.id)}`} className="btn btnSecondary btnSm">Buka</Link></td>
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

function RekapInner() {
  const params = useSearchParams();
  const clientId = params.get('clientId') ?? '';
  return clientId === '' ? <Worklist /> : <ClientChain clientId={clientId} />;
}

export default function RekapPage() {
  return (
    <Suspense fallback={<div className="stack"><p className="muted">Memuat…</p></div>}>
      <RekapInner />
    </Suspense>
  );
}
