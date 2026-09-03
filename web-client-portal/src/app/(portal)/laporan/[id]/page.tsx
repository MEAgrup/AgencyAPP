'use client';

/**
 * Satu laporan, dirender penuh di dalam portal.
 *
 * ## Kenapa iframe, dan kenapa itu aman di sini
 *
 * The report is a complete HTML document with its own Tailwind build and
 * Chart.js — dropping that markup into this page would let its styles and
 * scripts collide with the portal shell. An iframe gives style and script
 * isolation for free.
 *
 * The security spec (§6) planned this as a CROSS-ORIGIN frame into
 * `mea-client-reporting` and left OQ-8 open: how to hand a separate system a
 * scoped token without giving it the portal's session cookie. The report engine
 * now lives inside CDPS, so the frame is SAME-ORIGIN: the browser sends the
 * portal's own cookie, the server resolves the contact from it, and there is no
 * token to pass anywhere. `frame-src 'self'` in the portal's CSP is therefore
 * enough, and the document itself carries the tighter CSP that allows only the
 * CDN hosts it actually references.
 */
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { getReports, labelPeriode, labelTipe, reportHtmlUrl } from '@/lib/portal-data';
import { type PortalReportRow } from '@/lib/types';

export default function LaporanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const reportId = Number(id);
  const [meta, setMeta] = useState<PortalReportRow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isInteger(reportId) || reportId <= 0) {
      setErr('[laporan tidak ditemukan]');
      return;
    }
    // The heading comes from the list (already scoped to this client), so the
    // page can name the period before the document itself finishes loading.
    getReports()
      .then((rows) => {
        const found = rows.find((r) => r.report_id === reportId);
        if (!found) setErr('[laporan tidak ditemukan]');
        else setMeta(found);
      })
      .catch((e) => setErr(errorMessage(e)));
  }, [reportId]);

  return (
    <div className="stack">
      <div>
        <Link href="/laporan">&larr; Semua laporan</Link>
        <h1 style={{ marginTop: 8 }}>
          {meta ? `${labelTipe(meta.periode_tipe)} — ${meta.platform}` : 'Laporan'}
        </h1>
        {meta && (
          <p className="muted">{labelPeriode(meta.periode_mulai, meta.periode_akhir)}</p>
        )}
      </div>

      {err && <div className="alert alertError">{err}</div>}

      {!err && (
        <>
          <iframe
            title={meta ? `Laporan ${meta.periode_mulai}` : 'Laporan'}
            src={reportHtmlUrl(reportId)}
            style={{
              width: '100%',
              height: 'calc(100vh - 220px)',
              minHeight: 600,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: '#fff',
            }}
          />
          <p className="muted" style={{ fontSize: 12 }}>
            Laporan tidak muncul?{' '}
            <a href={reportHtmlUrl(reportId)} target="_blank" rel="noreferrer">
              Buka di tab baru
            </a>
            .
          </p>
        </>
      )}
    </div>
  );
}
