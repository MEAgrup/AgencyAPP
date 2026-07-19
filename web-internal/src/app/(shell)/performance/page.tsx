'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  DIVISIONS,
  formatPeriodLabel,
  getTeamRollup,
  normalizeM14Division,
  triggerPerformanceScan,
  type TeamRollup,
} from '@/lib/performance';

export default function PerformancePage() {
  const { role, employee } = useAuth();
  const isDirector = role?.director;
  const isOD = role?.od;
  const canScan = isDirector;
  const canViewMultipleDivisions = isDirector || isOD;
  // canViewTeam backend (snapshot.go:464-469): hanya Lead/SPV/OD/Director — staff murni
  // tidak boleh memanggil team rollup; tampilkan tautan skor sendiri saja.
  const isLeadLevel = role?.level === 'lead' || role?.level === 'spv';
  const isStaffOnly = !!role && !isDirector && !isOD && !isLeadLevel;

  // Determine which divisions to display
  // Note: role.division is lowercase from HRIS ('creative', 'ads', 'kol', 'account')
  // but M14 API expects uppercase, so normalize
  const userDivision = role?.division ? normalizeM14Division(role.division) : '';
  const displayDivisions = useMemo(
    () => (canViewMultipleDivisions ? [...DIVISIONS] : userDivision ? [userDivision] : []),
    [canViewMultipleDivisions, userDivision]
  );

  // Period & division selection
  const [selectedPeriod, setSelectedPeriod] = useState(''); // kosong = terbaru
  const [selectedDivisionIdx, setSelectedDivisionIdx] = useState(0);
  const selectedDivision = displayDivisions[selectedDivisionIdx] || '';

  // Load team rollup
  const [rollup, setRollup] = useState<TeamRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Scan action
  const [scanSubmitting, setScanSubmitting] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedDivision || isStaffOnly) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getTeamRollup(selectedDivision, selectedPeriod);
      setRollup(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [selectedDivision, selectedPeriod, isStaffOnly]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleScan() {
    if (!window.confirm('Jalankan pemindaian skor performa tim untuk semua divisi?')) return;
    setScanError(null);
    setScanMessage(null);
    setScanSubmitting(true);
    try {
      const res = await triggerPerformanceScan();
      setScanMessage(`Pemindaian selesai: ${res.snapshots_made} snapshot dibuat untuk periode ${formatPeriodLabel(res.period)}.`);
      // Reload data setelah scan
      await load();
    } catch (err) {
      setScanError(errorMessage(err));
    } finally {
      setScanSubmitting(false);
    }
  }

  const emptyOrNotAvailable = !rollup || rollup.members.length === 0;
  const showPlaceholder = rollup && rollup.period === '';

  if (isStaffOnly) {
    return (
      <div className="stack">
        <div>
          <h1>Team Performance</h1>
          <p className="muted">Snapshot skor KPI bulanan per karyawan (M14).</p>
        </div>
        <section className="card">
          <p className="muted">
            Role Anda hanya dapat melihat skor performa sendiri; ringkasan tim khusus Lead/SPV, OD, dan Director.
          </p>
          {employee ? (
            <Link href={`/performance/${employee.employee_id}`} className="btn btnPrimary btnSm">
              Lihat Skor Saya ({employee.employee_id})
            </Link>
          ) : (
            <p className="muted">Data karyawan tidak tersedia.</p>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h1>Team Performance</h1>
        <p className="muted">
          Snapshot skor KPI bulanan per karyawan per divisi (M14). Rincian lengkap breakdown komponen
          di halaman detail per staff.
        </p>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Ringkasan Tim</h2>
          {canScan && (
            <button
              className="btn btnPrimary btnSm"
              onClick={handleScan}
              disabled={scanSubmitting}
            >
              {scanSubmitting ? 'Memproses...' : 'Jalankan Pemindaian'}
            </button>
          )}
        </div>

        {scanError && <div className="alert alertError" role="alert">{scanError}</div>}
        {scanMessage && <div className="alert alertSuccess" role="status">{scanMessage}</div>}

        {/* Periode & Divisi selector */}
        <div className="formRow" style={{ marginBottom: '16px' }}>
          <div className="field">
            <label htmlFor="period-select">Periode</label>
            <select
              id="period-select"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
            >
              <option value="">Terbaru</option>
              {/* Catatan: tidak ada endpoint list periode — ini placeholder. Backend return empty jika belum ada data. */}
            </select>
          </div>
          {canViewMultipleDivisions && (
            <div className="field">
              <label htmlFor="division-select">Divisi</label>
              <select
                id="division-select"
                value={selectedDivisionIdx}
                onChange={(e) => setSelectedDivisionIdx(Number(e.target.value))}
              >
                {displayDivisions.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && showPlaceholder && (
          <div className="emptyState">
            Belum ada data skor untuk divisi {selectedDivision} pada periode ini. Jalankan pemindaian atau tunggu batch bulanan.
          </div>
        )}
        {!loading && !error && !showPlaceholder && emptyOrNotAvailable && (
          <div className="emptyState">Tidak ada data skor untuk divisi ini.</div>
        )}
        {!loading && !error && rollup && rollup.members && rollup.members.length > 0 && (
          <>
            <div
              style={{
                marginBottom: '16px',
                padding: '12px',
                backgroundColor: 'var(--color-surface-alt)',
                borderRadius: '4px',
              }}
            >
              <div style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>
                Rata-rata Tim: <strong>{rollup.average_display}</strong>
              </div>
              {rollup.period && (
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                  Periode: {formatPeriodLabel(rollup.period)}
                </div>
              )}
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Staff ID</th>
                    <th>Role</th>
                    <th style={{ textAlign: 'right' }}>Skor Akhir</th>
                  </tr>
                </thead>
                <tbody>
                  {rollup.members.map((member) => (
                    <tr key={member.staff_id}>
                      <td>
                        <Link href={`/performance/${member.staff_id}`}>
                          {member.staff_id}
                        </Link>
                      </td>
                      <td>{member.role_type}</td>
                      <td style={{ textAlign: 'right' }}>
                        <strong>{member.score_display}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Config links untuk Director */}
      {isDirector && (
        <section className="card">
          <h2>Konfigurasi</h2>
          <p className="muted">Kelola bobot KPI dan target periode untuk perhitungan skor.</p>
          <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
            <Link href="/performance/config" className="btn btnSecondary btnSm">
              Bobot KPI &amp; Target Periode
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
