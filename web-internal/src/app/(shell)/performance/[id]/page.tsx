'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  COMPONENT_LABELS,
  formatPeriodLabel,
  getStaffPerformance,
  getStaffPerformanceTrend,
  type Snapshot,
} from '@/lib/performance';

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(2);
}

export default function PerformanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();

  // Main snapshot
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Trend history
  const [trend, setTrend] = useState<Snapshot[] | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [showTrend, setShowTrend] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getStaffPerformance(id);
      setSnapshot(res);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadTrend = useCallback(async () => {
    setTrendLoading(true);
    setTrendError(null);
    try {
      const res = await getStaffPerformanceTrend(id);
      setTrend(res.data);
    } catch (err) {
      setTrendError(errorMessage(err));
    } finally {
      setTrendLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !snapshot) {
    return (
      <div className="stack">
        <Link href="/performance" className="muted">
          &larr; Kembali ke Team Performance
        </Link>
        <div className="alert alertError" role="alert">
          {loadError ?? 'Data tidak ditemukan.'}
        </div>
      </div>
    );
  }

  const isPreview = snapshot.preview === true;
  const periodLabel = snapshot.period_start
    ? new Date(snapshot.period_start).toLocaleDateString('id-ID', {
        year: 'numeric',
        month: 'long',
      })
    : '—';

  // Components dibagi ke dalam tiga kategori: included, excluded, diagnostic
  const includedComponents = snapshot.components.filter((c) => c.included && !c.diagnostic);
  const excludedComponents = snapshot.components.filter((c) => !c.included && !c.diagnostic);
  const diagnosticComponents = snapshot.components.filter((c) => c.diagnostic);

  // Client-Outcome Modifier (tidak ada untuk AM atau saat tidak ada data)
  const hasModifier = snapshot.modifier.present;

  return (
    <div className="stack">
      <Link href="/performance" className="muted">
        &larr; Kembali ke Team Performance
      </Link>

      {isPreview && (
        <div
          className="alert"
          style={{
            backgroundColor: 'var(--color-surface-warning)',
            color: 'var(--color-text-default)',
            padding: '12px',
            borderRadius: '4px',
            border: '1px solid var(--color-border)',
          }}
          role="alert"
        >
          Preview: Ini adalah skor bulan berjalan yang belum final. Akan menjadi history setelah bulan tutup dan batch dijalankan.
        </div>
      )}

      {/* Header: Staff info & period */}
      <section className="card">
        <div className="grid2">
          <div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
              Staff ID
            </div>
            <div style={{ fontSize: '16px', fontWeight: '600' }}>{snapshot.staff_id}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
              Role
            </div>
            <div style={{ fontSize: '16px', fontWeight: '600' }}>{snapshot.role_type}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
              Periode
            </div>
            <div style={{ fontSize: '16px' }}>{periodLabel}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
              Computed
            </div>
            <div style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>
              {snapshot.computed_by ? `${snapshot.computed_by}` : '—'}
            </div>
          </div>
        </div>
        {snapshot.targets_placeholder && (
          <div
            style={{
              marginTop: '16px',
              padding: '8px 12px',
              backgroundColor: 'var(--color-surface-warning)',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          >
            ⚠️ Catatan: Target periode ini masih menggunakan nilai ilustratif. Bobot final akan diterapkan setelah target resmi disetujui.
          </div>
        )}
      </section>

      {/* Final Score & Modifier Summary */}
      <section className="card">
        <h2>Hasil Skor</h2>
        <div className="grid2">
          <div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
              Profile Score (KPI)
            </div>
            <div style={{ fontSize: '28px', fontWeight: '700' }}>
              {formatScore(snapshot.profile_score)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
              dari 100
            </div>
          </div>
          {hasModifier && (
            <div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
                Client-Outcome Modifier
              </div>
              <div style={{ fontSize: '28px', fontWeight: '700' }}>
                {snapshot.modifier.raw_average !== null
                  ? (snapshot.modifier.raw_average >= 0 ? '+' : '')
                  : ''}
                {formatScore(snapshot.modifier.value)}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                (clamped ±10)
              </div>
            </div>
          )}
          <div style={{ gridColumn: hasModifier ? '1 / -1' : '1 / 2' }}>
            <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
              Skor Akhir (Final)
            </div>
            <div
              style={{
                fontSize: '36px',
                fontWeight: '700',
                color: snapshot.final_score !== null ? 'var(--color-primary)' : 'var(--color-text-muted)',
              }}
            >
              {snapshot.score_display}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
              0..100
            </div>
          </div>
        </div>

        {/* Modifier details jika ada */}
        {hasModifier && snapshot.modifier.source_clients.length > 0 && (
          <div style={{ marginTop: '16px', borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>
              Sumber Modifier
            </div>
            <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
              Komponen: <strong>{COMPONENT_LABELS[snapshot.modifier.source_component] || snapshot.modifier.source_component}</strong>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
              Klien: {snapshot.modifier.source_clients.join(', ') || '—'}
            </div>
          </div>
        )}
      </section>

      {/* Breakdown KPI Components */}
      <section className="card">
        <h2>Breakdown Komponen KPI</h2>

        {includedComponents.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>
              Komponen Aktif (Termasuk dalam Perhitungan)
            </h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Komponen</th>
                    <th style={{ textAlign: 'right' }}>Raw Score</th>
                    <th style={{ textAlign: 'right' }}>Capped</th>
                    <th style={{ textAlign: 'right' }}>Bobot Dasar</th>
                    <th style={{ textAlign: 'right' }}>Bobot Efektif</th>
                  </tr>
                </thead>
                <tbody>
                  {includedComponents.map((comp) => (
                    <tr key={comp.name}>
                      <td>{COMPONENT_LABELS[comp.name] || comp.name}</td>
                      <td style={{ textAlign: 'right' }}>{formatScore(comp.raw)}</td>
                      <td style={{ textAlign: 'right' }}>{formatScore(comp.capped)}</td>
                      <td style={{ textAlign: 'right' }}>{formatScore(comp.base_weight)}%</td>
                      <td style={{ textAlign: 'right', fontWeight: '600' }}>
                        {formatScore(comp.effective_weight)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {excludedComponents.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>
              Komponen Dikecualikan
            </h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Komponen</th>
                    <th>Alasan</th>
                  </tr>
                </thead>
                <tbody>
                  {excludedComponents.map((comp) => (
                    <tr key={comp.name}>
                      <td>{COMPONENT_LABELS[comp.name] || comp.name}</td>
                      <td style={{ color: 'var(--color-text-muted)' }}>
                        {comp.excluded_reason || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {diagnosticComponents.length > 0 && (
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>
              Komponen Diagnostik (Informasi Tambahan)
            </h3>
            <div style={{ borderLeft: '3px solid var(--color-border-muted)', paddingLeft: '12px' }}>
              {diagnosticComponents.map((comp) => (
                <div key={comp.name} style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '500' }}>
                    {COMPONENT_LABELS[comp.name] || comp.name}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                    Value: <strong>{formatScore(comp.raw)}</strong>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                    Catatan: Komponen ini untuk referensi saja dan TIDAK termasuk dalam perhitungan skor akhir.
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Trend History */}
      <section className="card">
        <div className="cardHeader">
          <h2>Riwayat Skor (Trend)</h2>
          {!showTrend && (
            <button
              className="btn btnSecondary btnSm"
              onClick={() => {
                setShowTrend(true);
                if (!trend) loadTrend();
              }}
            >
              Tampilkan Riwayat
            </button>
          )}
        </div>

        {showTrend && (
          <>
            {trendLoading && <p className="muted">Memuat riwayat...</p>}
            {trendError && <div className="alert alertError" role="alert">{trendError}</div>}
            {!trendLoading && !trendError && (!trend || trend.length === 0) && (
              <div className="emptyState">Belum ada riwayat skor untuk staff ini.</div>
            )}
            {!trendLoading && !trendError && trend && trend.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Periode</th>
                      <th style={{ textAlign: 'right' }}>Profile Score</th>
                      <th style={{ textAlign: 'right' }}>Skor Akhir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map((snap) => (
                      <tr key={snap.period_start}>
                        <td>{formatPeriodLabel(snap.period_start.substring(0, 7).replace('-', ''))}</td>
                        <td style={{ textAlign: 'right' }}>{formatScore(snap.profile_score)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <Link href={`/performance/${snap.staff_id}`}>
                            <strong>{snap.score_display}</strong>
                          </Link>
                        </td>
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
