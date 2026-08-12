'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api';
import { getBoard, UNIVERSAL_COLUMNS, type Card } from '@/lib/board';
import { listClients, type Client } from '@/lib/clients';
import BoardCard from './BoardCard';

// Max client matches rendered under the search box — the roster can be large and
// a 200-row dropdown is unusable; the user narrows with more keystrokes instead.
const MAX_SEARCH_RESULTS = 20;

export default function ClientBoardPage() {
  // There is no route param here — Client Board is one page keyed by a
  // Client id the user supplies (query `client=` is mandatory server-side,
  // 422 otherwise; brief §1 GET /board). Beyond the raw-id lookup, the board
  // can also be reached by searching the client roster (GET /clients, the same
  // RLS-scoped read the Klien page uses) by store name (`toko`) / PIC name —
  // the resolved id is what actually loads the board.
  const [clientIdInput, setClientIdInput] = useState('');
  const [appliedClientId, setAppliedClientId] = useState<string | null>(null);

  const [cards, setCards] = useState<Card[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Client search over the roster. Loaded lazily on first search interaction so
  // a user who pastes a known Client ID never triggers the extra fetch. The
  // roster is RLS-scoped server-side — the search can only surface Clients the
  // actor may already see, so this adds no visibility the board doesn't grant.
  const [search, setSearch] = useState('');
  const [roster, setRoster] = useState<Client[] | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);

  // Client-side-only filters (PRD §5.3 asks for Division/PIC/Overdue filters
  // on the Client Board; backend GET /board only accepts `client=` — brief §5
  // TIDAK TERSEDIA point 1 — so these are applied to the already-fetched set).
  const [filterDivision, setFilterDivision] = useState('');
  const [filterPic, setFilterPic] = useState('');
  const [filterOverdueOnly, setFilterOverdueOnly] = useState(false);

  const load = useCallback(async () => {
    if (!appliedClientId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getBoard(appliedClientId);
      setCards(res.data);
    } catch (err) {
      setError(errorMessage(err));
      setCards(null);
    } finally {
      setLoading(false);
    }
  }, [appliedClientId]);

  useEffect(() => {
    load();
  }, [load]);

  const loadRoster = useCallback(async () => {
    // Fetch once; subsequent searches filter the cached roster in memory.
    if (roster || rosterLoading) return;
    setRosterLoading(true);
    setRosterError(null);
    try {
      const res = await listClients();
      setRoster(res.data);
    } catch (err) {
      setRosterError(errorMessage(err));
    } finally {
      setRosterLoading(false);
    }
  }, [roster, rosterLoading]);

  function applyClientId(id: string) {
    const trimmed = id.trim();
    if (!trimmed) return;
    setFilterDivision('');
    setFilterPic('');
    setFilterOverdueOnly(false);
    setClientIdInput(trimmed);
    setAppliedClientId(trimmed);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    applyClientId(clientIdInput);
  }

  function handleSelectClient(id: string) {
    setSearch('');
    applyClientId(id);
  }

  // Case-insensitive match on store name, PIC name, city and Client ID — the
  // fields a user is likely to remember when they don't have the raw id.
  const allMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !roster) return [];
    return roster.filter(
      (c) =>
        c.toko.toLowerCase().includes(q) ||
        c.nama_pic.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.kota.toLowerCase().includes(q),
    );
  }, [search, roster]);

  const searchResults = allMatches.slice(0, MAX_SEARCH_RESULTS);
  const totalMatches = allMatches.length;

  const filteredCards = cards
    ? cards.filter((c) => {
        if (filterDivision && c.division !== filterDivision) return false;
        if (filterPic && !(c.pic ?? '').toLowerCase().includes(filterPic.trim().toLowerCase())) return false;
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
        <h1>Unified Board</h1>
        <p className="muted">
          Board universal per Client (M11) &mdash; kolom hasil mapping Universal Column dari status asli
          tiap modul sumber (Creative/Ads/KOL/Live Stream).
        </p>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Pilih Client</h2>
        </div>

        <div className="field">
          <label htmlFor="board-client-search">Cari Client (nama toko / nama PIC / kota / ID)</label>
          <input
            id="board-client-search"
            type="search"
            placeholder="Ketik nama toko atau nama klien..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              void loadRoster();
            }}
            onFocus={() => void loadRoster()}
            autoComplete="off"
          />
          {rosterLoading && <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Memuat daftar client...</p>}
          {rosterError && (
            <div className="alert alertError" role="alert" style={{ marginTop: 4 }}>{rosterError}</div>
          )}
          {!rosterLoading && !rosterError && search.trim() && searchResults.length === 0 && (
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Tidak ada client yang cocok dengan &ldquo;{search.trim()}&rdquo;.
            </p>
          )}
          {searchResults.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Toko</th>
                    <th>Nama PIC</th>
                    <th>Kota</th>
                    <th>Client ID</th>
                    <th aria-label="aksi"></th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((c) => (
                    <tr key={c.id}>
                      <td>{c.toko || '—'}</td>
                      <td>{c.nama_pic || '—'}</td>
                      <td>{c.kota || '—'}</td>
                      <td><code>{c.id}</code></td>
                      <td>
                        <button
                          type="button"
                          className="btn btnPrimary btnSm"
                          onClick={() => handleSelectClient(c.id)}
                        >
                          Buka Board
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {totalMatches > searchResults.length && (
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Menampilkan {searchResults.length} dari {totalMatches} hasil &mdash; persempit pencarian untuk melihat sisanya.
                </p>
              )}
            </div>
          )}
        </div>

        <form className="form" onSubmit={handleSubmit} style={{ marginTop: 12 }}>
          <div className="formRow">
            <div className="field">
              <label htmlFor="board-client-id">...atau langsung dengan Client ID</label>
              <input
                id="board-client-id"
                placeholder="CLT-202607-0001"
                value={clientIdInput}
                onChange={(e) => setClientIdInput(e.target.value)}
              />
            </div>
          </div>
          <div>
            <button type="submit" className="btn btnPrimary" disabled={loading || !clientIdInput.trim()}>
              {loading ? 'Memuat...' : 'Muat Board'}
            </button>
          </div>
        </form>
      </section>

      {appliedClientId && (
        <section className="card">
          <div className="cardHeader">
            <h2>{appliedClientId}</h2>
            <button type="button" className="btn btnSecondary btnSm" disabled={loading} onClick={() => load()}>
              {loading ? 'Memuat...' : 'Refresh'}
            </button>
          </div>

          <div className="formRow">
            <div className="field">
              <label htmlFor="board-filter-division">Divisi</label>
              <select
                id="board-filter-division"
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
              <label htmlFor="board-filter-pic">PIC</label>
              <input
                id="board-filter-pic"
                placeholder="Filter PIC..."
                value={filterPic}
                onChange={(e) => setFilterPic(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="board-filter-overdue">Overdue</label>
              <label className="row" style={{ gap: 6, fontSize: 13 }}>
                <input
                  id="board-filter-overdue"
                  type="checkbox"
                  checked={filterOverdueOnly}
                  onChange={(e) => setFilterOverdueOnly(e.target.checked)}
                />
                Hanya yang overdue
              </label>
            </div>
          </div>

          {error && <div className="alert alertError" role="alert">{error}</div>}
          {!loading && !error && filteredCards && filteredCards.length === 0 && (
            <div className="emptyState">
              {cards && cards.length > 0
                ? 'Tidak ada Brief yang cocok dengan filter ini.'
                : 'Belum ada Brief untuk Client ini.'}
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
                        colCards.map((c) => <BoardCard key={`${c.type}-${c.id}`} card={c} />)
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
