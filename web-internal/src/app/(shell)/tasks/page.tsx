'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { isAccountLead, isAccountStaff } from '@/lib/account';
import {
  DIVISIONS,
  TASK_STATUSES,
  listDivisionQueue,
  myTasks,
  type Brief,
  type Card,
} from '@/lib/tasks';
import StatusBadge from '@/components/StatusBadge';

type ViewMode = 'mine' | 'division';

// Cards for booking/session sources are NOT M12 execution tasks (KOL/Live Stream
// use their own engines) — they show read-only, without a link into task detail.
const EXECUTABLE_TYPES = new Set(['brief', 'asset']);

export default function TasksListPage() {
  const { role } = useAuth();
  // An AM landing here looking for "how do I onboard my new client" is looking in
  // the wrong module: M12 executes work that ALREADY exists as a Brief or Asset,
  // and a Brief is only born from a Service in M6 §5. Rather than grow a second
  // onboarding UI here (a second copy of the §4/§5 gate order), point at the one
  // place that owns it.
  const showOnboardingPointer = isAccountStaff(role) || isAccountLead(role);

  const [mode, setMode] = useState<ViewMode>('mine');
  const [division, setDivision] = useState<string>('');
  const [assigneeInput, setAssigneeInput] = useState('');
  const [appliedAssignee, setAppliedAssignee] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const [cards, setCards] = useState<Card[] | null>(null);
  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCards(null);
    setBriefs(null);
    try {
      if (mode === 'mine') {
        const res = await myTasks(appliedAssignee || undefined);
        setCards(res.data);
      } else {
        if (!division) {
          setBriefs(null);
          return;
        }
        const res = await listDivisionQueue(division);
        setBriefs(res.data);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [mode, division, appliedAssignee]);

  useEffect(() => {
    load();
  }, [load]);

  function applyAssignee(e: FormEvent) {
    e.preventDefault();
    setAppliedAssignee(assigneeInput.trim());
  }

  const filteredCards =
    cards?.filter((c) => !statusFilter || c.native_status === statusFilter) ?? null;
  const filteredBriefs =
    briefs?.filter((b) => !statusFilter || b.status === statusFilter) ?? null;

  return (
    <div className="stack">
      <div>
        <h1>Task Execution</h1>
        <p className="muted">
          Workspace eksekusi task (M12) &mdash; Brief-as-task (Ads) &amp; Creative Asset. Filter status
          di sisi klien; tidak ada satu endpoint gabungan.
        </p>
      </div>

      {showOnboardingPointer && (
        <section className="card">
          <div className="cardHeader">
            <h2>Onboarding klien baru?</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Halaman ini mengeksekusi task yang <strong>sudah ada</strong>. Task lahir dari Brief, dan Brief
            lahir dari layanan klien (M6 §5) &mdash; jadi klien berstatus <strong>[Awaiting Onboarding]</strong>{' '}
            ditangani di antrean layanan, bukan di sini: buat Strategy &amp; Plan (untuk layanan plan-gated)
            atau langsung Brief (layanan Direct).
          </p>
          <div>
            <Link href="/account" className="btn btnPrimary btnSm">
              Buka Antrean Layanan Klien
            </Link>
          </div>
        </section>
      )}

      <section className="card">
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className={`btn ${mode === 'mine' ? 'btnPrimary' : 'btnSecondary'} btnSm`}
            onClick={() => setMode('mine')}
          >
            Task Saya
          </button>
          <button
            type="button"
            className={`btn ${mode === 'division' ? 'btnPrimary' : 'btnSecondary'} btnSm`}
            onClick={() => setMode('division')}
          >
            Antrian Divisi
          </button>
        </div>

        <div className="formRow" style={{ marginTop: 14 }}>
          {mode === 'division' && (
            <div className="field">
              <label htmlFor="filter-division">Divisi</label>
              <select
                id="filter-division"
                value={division}
                onChange={(e) => setDivision(e.target.value)}
              >
                <option value="">Pilih divisi...</option>
                {DIVISIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          )}

          {mode === 'mine' && (
            <form className="field" onSubmit={applyAssignee}>
              <label htmlFor="filter-assignee">Assignee (Employee ID, opsional)</label>
              <div className="row" style={{ gap: 8 }}>
                <input
                  id="filter-assignee"
                  placeholder="Kosongkan untuk task Anda sendiri"
                  value={assigneeInput}
                  onChange={(e) => setAssigneeInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button type="submit" className="btn btnSecondary btnSm">Cari</button>
              </div>
            </form>
          )}

          <div className="field">
            <label htmlFor="filter-status">Status</label>
            <select
              id="filter-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Semua status</option>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}

        {/* Task Saya (Cards) */}
        {!loading && !error && mode === 'mine' && filteredCards && filteredCards.length === 0 && (
          <div className="emptyState">Tidak ada task yang cocok dengan filter.</div>
        )}
        {!loading && !error && mode === 'mine' && filteredCards && filteredCards.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Tipe</th>
                  <th>Divisi</th>
                  <th>PIC</th>
                  <th>Kolom</th>
                  <th>Status</th>
                  <th>Jatuh Tempo</th>
                  <th>Overdue</th>
                </tr>
              </thead>
              <tbody>
                {filteredCards.map((c) => (
                  <tr key={c.id} className={c.overdue ? 'flaggedRow' : ''}>
                    <td>
                      {EXECUTABLE_TYPES.has(c.type) ? (
                        <Link href={`/tasks/${c.id}`}>{c.id}</Link>
                      ) : (
                        c.id
                      )}
                    </td>
                    <td>{c.type}</td>
                    <td>{c.division}</td>
                    <td>{c.pic || '—'}</td>
                    <td><span className="badge badge-gray">{c.universal_column}</span></td>
                    <td><StatusBadge status={c.native_status} /></td>
                    <td>{c.due_date || '—'}</td>
                    <td>{c.overdue ? <span className="badge badge-red">Overdue</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Antrian Divisi (Briefs) */}
        {!loading && !error && mode === 'division' && !division && (
          <div className="emptyState">Pilih divisi untuk melihat antrian brief.</div>
        )}
        {!loading && !error && mode === 'division' && division && filteredBriefs && filteredBriefs.length === 0 && (
          <div className="emptyState">Tidak ada brief yang cocok dengan filter.</div>
        )}
        {!loading && !error && mode === 'division' && division && filteredBriefs && filteredBriefs.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Judul</th>
                  <th>Deliverable</th>
                  <th>PIC</th>
                  <th>Prioritas</th>
                  <th>Status</th>
                  <th>Jatuh Tempo</th>
                  <th>Flag</th>
                </tr>
              </thead>
              <tbody>
                {filteredBriefs.map((b) => (
                  <tr key={b.id}>
                    <td><Link href={`/tasks/${b.id}`}>{b.id}</Link></td>
                    <td>{b.title}</td>
                    <td>{b.deliverable_type}</td>
                    <td>{b.assigned_pic || '—'}</td>
                    <td>{b.priority || '—'}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td>{b.due_date || '—'}</td>
                    <td>{b.revision_flagged ? <span className="badge badge-purple">Quality Flag</span> : '—'}</td>
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
