'use client';

/**
 * Ringkasan akun — the portal's landing page.
 *
 * Three things, in the order a client asks them: is my account okay, what is
 * the team working on, and where is my latest report.
 *
 * The health block is a LABEL and nothing else (M15 Rule 4). The 0–100 score,
 * its seven components and their weights are internal operational detail, and
 * the server never sends them — so there is no number here to accidentally
 * render. A client who learns their own score negotiates against the number
 * instead of about the work.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { usePortalAuth } from '@/lib/portal-auth-context';
import {
  getHealthSummary, getReports, getServiceProgress, labelPeriode, labelTipe, toneBand,
} from '@/lib/portal-data';
import { type PortalHealthSummary, type PortalReportRow, type PortalServiceProgress } from '@/lib/types';

const TONE_CLASS: Record<string, string> = {
  ok: 'alertSuccess',
  warn: 'alertWarning',
  danger: 'alertError',
  none: 'alertInfo',
};

const TONE_NOTE: Record<string, string> = {
  ok: 'Akun Anda berjalan sesuai rencana.',
  warn: 'Ada hal yang sedang kami perhatikan di akun Anda.',
  danger: 'Ada hal yang perlu ditindaklanjuti bersama. Account Manager Anda akan menghubungi Anda.',
  none: 'Ringkasan kesehatan akun belum tersedia — biasanya muncul setelah satu bulan penuh berjalan.',
};

export default function PortalHomePage() {
  const { contact } = usePortalAuth();
  const [health, setHealth] = useState<PortalHealthSummary | null>(null);
  const [reports, setReports] = useState<PortalReportRow[] | null>(null);
  const [services, setServices] = useState<PortalServiceProgress[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Settled independently: one failing surface must not blank the other two.
    // A client landing on an empty page cannot tell "nothing yet" from "broken".
    void Promise.allSettled([getHealthSummary(), getReports(), getServiceProgress()])
      .then(([h, r, s]) => {
        if (h.status === 'fulfilled') setHealth(h.value);
        if (r.status === 'fulfilled') setReports(r.value);
        if (s.status === 'fulfilled') setServices(s.value);
        const gagal = [h, r, s].find((x) => x.status === 'rejected');
        if (gagal && gagal.status === 'rejected') setErr(errorMessage(gagal.reason));
      });
  }, []);

  const tone = toneBand(health?.label ?? null);
  const terbaru = reports?.[0] ?? null;
  const berjalan = services?.length ?? 0;

  return (
    <div className="stack">
      <div>
        <h1>Selamat datang, {contact?.nama}</h1>
        <p className="muted">{contact?.nama_klien}</p>
      </div>

      {err && <div className="alert alertError">{err}</div>}

      <div className={`alert ${TONE_CLASS[tone]}`}>
        <strong>{health?.label ?? 'Belum tersedia'}</strong>
        <div style={{ marginTop: 4, fontSize: 13 }}>{TONE_NOTE[tone]}</div>
        {health?.periode_akhir && (
          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            Berdasarkan penilaian hingga {health.periode_akhir}.
          </div>
        )}
      </div>

      <div className="card">
        <strong>Laporan terbaru</strong>
        {terbaru ? (
          <div style={{ marginTop: 6 }}>
            <div>{labelTipe(terbaru.periode_tipe)} — {terbaru.platform}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {labelPeriode(terbaru.periode_mulai, terbaru.periode_akhir)}
            </div>
            <div style={{ marginTop: 10 }}>
              <Link className="btn btnPrimary" href={`/laporan/${terbaru.report_id}`}>Buka laporan</Link>{' '}
              <Link className="btn btnSecondary" href="/laporan">Semua laporan</Link>
            </div>
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 6 }}>
            Belum ada laporan yang diterbitkan.
          </p>
        )}
      </div>

      <div className="card">
        <strong>Progres layanan</strong>
        <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          {berjalan === 0
            ? 'Belum ada layanan yang berjalan.'
            : `${berjalan} layanan sedang berjalan.`}
        </p>
        <div style={{ marginTop: 10 }}>
          <Link className="btn btnSecondary" href="/progres">Lihat progres</Link>{' '}
          <Link className="btn btnSecondary" href="/komplain">Ajukan komplain</Link>
        </div>
      </div>
    </div>
  );
}
