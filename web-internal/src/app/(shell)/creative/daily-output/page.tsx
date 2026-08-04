'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CREATIVE_DIVISION, getDailyOutput, isCreativeLead, isDirector, type DailyOutputDay } from '@/lib/creative';
import { LEVEL_STAFF, useAssignableEmployees } from '@/lib/directory';
import EmployeePicker from '@/components/EmployeePicker';

function todayWIB(): string {
  // WIB = UTC+7. Take the UTC "now", shift by 7 hours, then read the calendar date.
  const now = new Date();
  const shifted = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

export default function DailyOutputPage() {
  const { employee, role } = useAuth();
  const canQueryOthers = isCreativeLead(role) || !!role?.od || isDirector(role);

  const [picId, setPicId] = useState('');

  // Whose day to read. Only the roles that may query SOMEONE ELSE get the list —
  // a staff member sees their own id, locked, exactly as before.
  const {
    employees: picCandidates,
    loading: picLoading,
    error: picError,
  } = useAssignableEmployees(CREATIVE_DIVISION, LEVEL_STAFF, canQueryOthers);
  const [date, setDate] = useState(todayWIB());
  const [day, setDay] = useState<DailyOutputDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (employee && !picId) setPicId(employee.employee_id);
  }, [employee, picId]);

  const load = useCallback(async () => {
    if (!picId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getDailyOutput(picId, date || undefined);
      setDay(res);
    } catch (err) {
      setError(errorMessage(err));
      setDay(null);
    } finally {
      setLoading(false);
    }
  }, [picId, date]);

  useEffect(() => {
    load();
  }, [load]);

  function handleFilter(e: FormEvent) {
    e.preventDefault();
    load();
  }

  return (
    <div className="stack">
      <div>
        <Link href="/creative" className="muted">&larr; Kembali ke Creative</Link>
      </div>

      <div>
        <h1>Daily Output</h1>
        <p className="muted">
          Dashboard read-only (M7 §7 Flow 2) &mdash; entri auto-logged per transisi, tanpa input manual.
          Tidak dapat dilihat oleh AM/Account (gate berbeda dari Asset biasa).
        </p>
      </div>

      <section className="card">
        <form className="formRow" onSubmit={handleFilter}>
          {canQueryOthers ? (
            <EmployeePicker
              id="pic-id"
              label="PIC"
              required
              employees={picCandidates}
              loading={picLoading}
              error={picError}
              value={picId}
              onChange={setPicId}
              emptyHint="Belum ada staff Creative aktif untuk dilihat output hariannya."
            />
          ) : (
            <div className="field">
              <label htmlFor="pic-id">PIC</label>
              <input id="pic-id" value={picId} readOnly disabled />
            </div>
          )}
          <div className="field">
            <label htmlFor="output-date">Tanggal (WIB)</label>
            <input id="output-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <button type="submit" className="btn btnPrimary btnSm" disabled={loading || !picId}>
              {loading ? 'Memuat...' : 'Tampilkan'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}

        {!loading && !error && day && (
          <>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>PIC</div>
                <div>{day.pic}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Tanggal (WIB)</div>
                <div>{day.date_wib}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Total</div>
                <div>{day.total}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Approved</div>
                <div>{day.approved_count}</div>
              </div>
              <div>
                {day.locked ? (
                  <span className="badge badge-darkgray">Terkunci</span>
                ) : (
                  <span className="badge badge-blue">Berjalan</span>
                )}
              </div>
            </div>

            {day.entries.length === 0 ? (
              <div className="emptyState">Belum ada output tercatat untuk tanggal ini.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Asset</th>
                      <th>Brief</th>
                      <th>Klien</th>
                      <th>Tipe Unit</th>
                      <th>Transisi</th>
                      <th>Terkunci</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.entries.map((entry) => (
                      <tr key={entry.output_id}>
                        <td>{formatDateTime(entry.timestamp)}</td>
                        <td><Link href={`/creative/assets/${entry.asset_id}`}>{entry.asset_id}</Link></td>
                        <td><Link href={`/creative/briefs/${entry.brief_id}`}>{entry.brief_id}</Link></td>
                        <td>{entry.client_id}</td>
                        <td>{entry.output_unit_type}</td>
                        <td>{entry.transition}</td>
                        <td>{entry.locked ? 'Ya' : 'Tidak'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
