'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/api';
import { getTriggerScan, type ScanResult } from '@/lib/health';

export default function HealthPage() {
  const { role } = useAuth();
  const [scanSubmitting, setScanSubmitting] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  // Visibility: role must be Account staff/lead or Director. OD is read-only (no scan).
  const isAccount = role && (role.level === 'staff' || role.level === 'lead');
  const canScan = (isAccount || role?.director) && !role?.od;

  async function handleScan() {
    if (!window.confirm('Jalankan pemindaian skor kesehatan klien untuk bulan tertutup terakhir?')) {
      return;
    }
    setScanError(null);
    setScanResult(null);
    setScanSubmitting(true);
    try {
      const res = await getTriggerScan();
      setScanResult(res);
    } catch (err) {
      setScanError(errorMessage(err));
    } finally {
      setScanSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Client Health</h1>
        <p className="muted">Laporan kesehatan klien — skor bulanan, band, dan breakdown komponen (M13).</p>
      </div>

      {canScan && (
        <section className="card">
          <div className="cardHeader">
            <h2>Pemindaian Skor</h2>
          </div>
          {scanError && <div className="alert alertError" role="alert">{scanError}</div>}
          {scanResult && (
            <div className="alert alertSuccess" role="status">
              Pemindaian bulan {scanResult.period} selesai: {scanResult.snapshots_made} klien, {scanResult.band_drops_flagged} band-drop ditandai.
            </div>
          )}
          <button
            className="btn btnPrimary"
            onClick={handleScan}
            disabled={scanSubmitting}
            type="button"
          >
            {scanSubmitting ? 'Memproses...' : 'Jalankan Pemindaian'}
          </button>
          <p className="muted" style={{ marginTop: '12px', fontSize: '12px' }}>
            Operasi batch: menghitung ulang skor kesehatan untuk semua klien pada bulan tertutup terakhir. Hanya untuk Account/Direktur.
          </p>
        </section>
      )}

      <section className="card">
        <h2>Lihat Laporan Klien</h2>
        <p className="muted">Pilih klien untuk melihat skor kesehatan, breakdown komponen, trend, dan kontrol toggle ROAS.</p>
        <Link href="/clients" className="btn btnSecondary">
          Daftar Klien →
        </Link>
      </section>
    </div>
  );
}
