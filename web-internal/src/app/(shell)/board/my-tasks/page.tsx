'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getMyTasks, UNIVERSAL_COLUMNS, type Card } from '@/lib/board';
import BoardCard from '../BoardCard';

export default function MyTasksPage() {
  const { role } = useAuth();

  // Only OD/Director, or Account lead/SPV, may pass `employee=` for someone
  // else server-side (brief §1 GET /my-tasks, board.go:322-329) — this is
  // UX-only gating, the backend 403s regardless if a staff user forces it.
  const canViewOthers = Boolean(role && (role.od || role.director || (role.division === 'account' && role.level === 'lead')));

  const [employeeInput, setEmployeeInput] = useState('');
  const [appliedEmployee, setAppliedEmployee] = useState<string>('');

  const [cards, setCards] = useState<Card[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterDivision, setFilterDivision] = useState('');
  const [filterOverdueOnly, setFilterOverdueOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getMyTasks(appliedEmployee || undefined);
      setCards(res.data);
    } catch (err) {
      setError(errorMessage(err));
      setCards(null);
    } finally {
      setLoading(false);
    }
  }, [appliedEmployee]);

  useEffect(() => {
    load();
  }, [load]);

  function handleViewOther(e: FormEvent) {
    e.preventDefault();
    const id = employeeInput.trim();
    if (!id) return;
    setAppliedEmployee(id);
  }

  function handleViewSelf() {
    setEmployeeInput('');
    setAppliedEmployee('');
  }

  const filteredCards = cards
    ? cards.filter((c) => {
        if (filterDivision && c.division !== filterDivision) return false;
        if (filterOverdueOnly && !c.overdue) return false;
        return true;
      })
    : null;

  const knownColumns: readonly string[] = UNIVERSAL_COLUMNS;
  const extraColumns = filteredCards
    ? Array.from(new Set(filteredCards.map((c) => c.universal_column))).filter((c) => !knownColumns.includes(c))
    : [];
  const columns = [...UNIVERSAL_COLUMNS, ...extraColumns];

  const divisionOptions = cards ? Array.from(new Set(cards.map((c) => c.division))).sort() : [];

  return (
    <div className="stack">
      <div>
        <Link href="/board" className="muted">&larr; Kembali ke Board</Link>
      </div>

      <div>
        <h1>My Tasks</h1>
        <p className="muted">
          Tugas lintas Client untuk {appliedEmployee ? appliedEmployee : 'diri Anda'} (M11 §5.4). Tidak ada
          badge Dependency di sini &mdash; badge hanya dihitung untuk Client Board.
        </p>
      </div>

      {canViewOthers && (
        <section className="card">
          <div className="cardHeader">
            <h2>Lihat Tugas Staff Lain</h2>
          </div>
          <form className="form" onSubmit={handleViewOther}>
            <div className="formRow">
              <div className="field">
                <label htmlFor="my-tasks-employee">Employee ID</label>
                <input
                  id="my-tasks-employee"
                  placeholder="EMP-..."
                  value={employeeInput}
                  onChange={(e) => setEmployeeInput(e.target.value)}
                />
              </div>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <button type="submit" className="btn btnPrimary" disabled={loading || !employeeInput.trim()}>
                {loading ? 'Memuat...' : 'Tampilkan'}
              </button>
              {appliedEmployee && (
                <button type="button" className="btn btnSecondary" disabled={loading} onClick={handleViewSelf}>
                  Kembali ke Tugas Saya
                </button>
              )}
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Tugas</h2>
          <button type="button" className="btn btnSecondary btnSm" disabled={loading} onClick={() => load()}>
            {loading ? 'Memuat...' : 'Refresh'}
          </button>
        </div>

        <div className="formRow">
          <div className="field">
            <label htmlFor="my-tasks-filter-division">Divisi</label>
            <select
              id="my-tasks-filter-division"
              value={filterDivision}
              onChange={(e) => setFilterDivision(e.target.value)}
            >
              <option value="">Semua Divisi</option>
              {divisionOptions.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="my-tasks-filter-overdue">Overdue</label>
            <label className="row" style={{ gap: 6, fontSize: 13 }}>
              <input
                id="my-tasks-filter-overdue"
                type="checkbox"
                checked={filterOverdueOnly}
                onChange={(e) => setFilterOverdueOnly(e.target.checked)}
              />
              Hanya yang overdue
            </label>
          </div>
        </div>

        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && filteredCards && filteredCards.length === 0 && (
          <div className="emptyState">
            {cards && cards.length > 0
              ? 'Tidak ada tugas yang cocok dengan filter ini.'
              : 'Tidak ada tugas untuk ditampilkan.'}
          </div>
        )}
        {!loading && !error && filteredCards && filteredCards.length > 0 && (
          <div className="table-wrap" style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'flex-start' }}>
            {columns.map((col) => {
              const colCards = filteredCards.filter((c) => c.universal_column === col);
              return (
                <div key={col} style={{ flex: '0 0 260px', minWidth: 260 }}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                    <strong style={{ fontSize: 13 }}>{col}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>{colCards.length}</span>
                  </div>
                  <div className="stack" style={{ gap: 8 }}>
                    {colCards.length === 0 ? (
                      <div className="muted" style={{ fontSize: 12 }}>&mdash;</div>
                    ) : (
                      colCards.map((c) => <BoardCard key={`${c.type}-${c.id}`} card={c} showClientId />)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
