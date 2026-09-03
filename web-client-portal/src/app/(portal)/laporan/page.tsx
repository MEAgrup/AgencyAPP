'use client';

/**
 * Daftar laporan performa yang sudah diterbitkan tim.
 *
 * Only `[Terbit]` reports appear — a draft, or one the team has withdrawn, is
 * simply not in the list and cannot be opened by guessing its id (the server
 * scopes and status-gates every read).
 *
 * The list itself is navigation, so it carries no score and no GMV: those
 * numbers belong inside the report page, which is written for this audience.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { getReports, labelPeriode, labelTipe } from '@/lib/portal-data';
import { type PortalReportRow } from '@/lib/types';

export default function LaporanPage() {
  const [rows, setRows] = useState<PortalReportRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getReports().then(setRows).catch((e) => setErr(errorMessage(e)));
  }, []);

  return (
    <div className="stack">
      <div>
        <h1>Laporan Performa</h1>
        <p className="muted">Laporan yang sudah diterbitkan tim MEA untuk akun Anda.</p>
      </div>

      {err && <div className="alert alertError">{err}</div>}

      {rows === null && !err && <p className="muted">Memuat laporan…</p>}

      {rows !== null && rows.length === 0 && (
        <div className="card">
          <p>Belum ada laporan yang diterbitkan.</p>
          <p className="muted">
            Laporan mingguan dan bulanan akan muncul di sini begitu tim menerbitkannya.
          </p>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="stack">
          {rows.map((r) => (
            <Link
              key={r.report_id}
              href={`/laporan/${r.report_id}`}
              className="card"
              style={{ display: 'block', textDecoration: 'none' }}
            >
              <strong>{labelTipe(r.periode_tipe)} — {r.platform}</strong>
              <div className="muted" style={{ marginTop: 4 }}>
                {labelPeriode(r.periode_mulai, r.periode_akhir)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
