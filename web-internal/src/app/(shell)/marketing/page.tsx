'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  CHANNEL_SUGGESTIONS,
  campaignBadgeTone,
  createCampaign,
  listCampaigns,
  type Campaign,
} from '@/lib/marketing';

const INCOMPLETE_MESSAGE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';

export default function MarketingWorkspacePage() {
  const { role } = useAuth();
  const router = useRouter();

  // canViewMarketing (brief §"Gate role"): director || od || division Marketing.
  // Staff Marketing hanya melihat campaign miliknya — backend yang memfilter.
  const canView = Boolean(role && (role.director || role.od || role.division.toLowerCase() === 'marketing'));

  // canCreateCampaign (brief §"Gate role"): director || (Marketing && staff/lead).
  const canCreate = Boolean(
    role &&
      (role.director ||
        (role.division.toLowerCase() === 'marketing' && (role.level === 'staff' || role.level === 'lead'))),
  );

  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Buat campaign
  const [name, setName] = useState('');
  const [channel, setChannel] = useState('');
  const [online, setOnline] = useState(false);
  const [offline, setOffline] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // P2 §6: server memaginasi. `nextCursor` null = sudah halaman terakhir.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listCampaigns();
      setCampaigns(res.data);
      setNextCursor(res.next_cursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Menyambung, bukan mengganti.
  async function loadMore() {
    if (nextCursor === null) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await listCampaigns({ cursor: nextCursor });
      setCampaigns((prev) => [...(prev ?? []), ...res.data]);
      setNextCursor(res.next_cursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    // Cermin gate server: role tanpa akses tidak pernah fetch (brief commit 70b27d0).
    if (!canView) {
      setLoading(false);
      return;
    }
    load();
  }, [canView, load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);

    if (!online && !offline) {
      setCreateError(INCOMPLETE_MESSAGE);
      return;
    }

    setCreateSubmitting(true);
    try {
      const campaign = await createCampaign({ name, channel, online, offline, start_date: startDate });
      router.push(`/marketing/${campaign.id}`);
    } catch (err) {
      setCreateError(errorMessage(err));
      setCreateSubmitting(false);
    }
  }

  function onlineOfflineLabel(c: Campaign): string {
    const labels: string[] = [];
    if (c.online) labels.push('Online');
    if (c.offline) labels.push('Offline');
    return labels.length > 0 ? labels.join(', ') : '—';
  }

  return (
    <div className="stack">
      <div>
        <h1>Marketing — Campaign</h1>
        <p className="muted">
          Kelola campaign marketing (M3) dan pantau performanya (M2) di satu tempat.
        </p>
      </div>

      {!canView && (
        <section className="card">
          <div className="emptyState">Anda tidak memiliki akses ke halaman ini.</div>
        </section>
      )}

      {canView && canCreate && (
        <section className="card">
          <div className="cardHeader">
            <h2>Buat Campaign</h2>
          </div>
          <form className="form" onSubmit={handleCreate}>
            {createError && <div className="alert alertError" role="alert">{createError}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="create-name">Nama Campaign</label>
                <input id="create-name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="create-channel">Channel</label>
                <input
                  id="create-channel"
                  list="channel-suggestions"
                  required
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                />
                <datalist id="channel-suggestions">
                  {CHANNEL_SUGGESTIONS.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="create-online">
                  <input
                    id="create-online"
                    type="checkbox"
                    checked={online}
                    onChange={(e) => setOnline(e.target.checked)}
                  />{' '}
                  Online
                </label>
              </div>
              <div className="field">
                <label htmlFor="create-offline">
                  <input
                    id="create-offline"
                    type="checkbox"
                    checked={offline}
                    onChange={(e) => setOffline(e.target.checked)}
                  />{' '}
                  Offline
                </label>
              </div>
              <div className="field">
                <label htmlFor="create-start">Tanggal Mulai</label>
                <input
                  id="create-start"
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={createSubmitting}>
                {createSubmitting ? 'Menyimpan...' : 'Buat Campaign'}
              </button>
            </div>
          </form>
        </section>
      )}

      {canView && (
        <section className="card">
          <div className="cardHeader">
            <h2>Daftar Campaign</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Staf Marketing hanya melihat campaign miliknya sendiri (server yang memfilter).
          </p>
          {loading && <p className="muted">Memuat...</p>}
          {error && <div className="alert alertError" role="alert">{error}</div>}
          {!loading && !error && campaigns && campaigns.length === 0 && (
            <div className="emptyState">Belum ada campaign yang terlihat untuk peran Anda.</div>
          )}
          {!loading && !error && campaigns && campaigns.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nama</th>
                    <th>Channel</th>
                    <th>Online/Offline</th>
                    <th>Mulai</th>
                    <th>Selesai</th>
                    <th>Owner</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/marketing/${c.id}`}>{c.id}</Link>
                      </td>
                      <td>{c.name}</td>
                      <td>{c.channel}</td>
                      <td>{onlineOfflineLabel(c)}</td>
                      <td>{c.start_date}</td>
                      <td>{c.end_date ?? '—'}</td>
                      <td>{c.owner_employee_id}</td>
                      <td>
                        <span className={`badge badge-${campaignBadgeTone(c.status)}`}>{c.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {nextCursor !== null && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button type="button" className="btn btnSecondary" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? 'Memuat...' : 'Muat lebih banyak'}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
