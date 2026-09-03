'use client';

/**
 * TikTok Ads Scanner — the cross-client portfolio (AS-05, screen (c)).
 *
 * This is the screen that justified `adsscanner_run` being a table of its own
 * (O69) rather than rows in `client_reports`: one advertiser holds many shops,
 * and the Monday question is "which of my clients needs attention this week",
 * not "show me one client's history". So it is a top-level view, deliberately
 * NOT a tab inside a single-client page.
 *
 * Every figure here comes from the server's projection of the FROZEN payload
 * (`adsScanPortfolio`) — nothing is recomputed in the browser. A rollup this
 * page derived itself could disagree with the scan it claims to summarise, and
 * then neither would be the record.
 *
 * Rows are ordered by the money at stake (reallocation pool, descending), not
 * by client name or recency: the pool IS the amount currently going to SKUs
 * that should not have it, so it is the closest thing the list has to
 * "urgency". Ties keep the server's order.
 */
import { fmtInt, fmtRoi, fmtRupiah, vonisTone } from '@/lib/adsscanner-ui';
import type { AdsScanPortfolioRow } from '@/lib/adsscanner';

export default function PortfolioTable({
  rows,
  onOpenRun,
  onScanClient,
}: {
  rows: AdsScanPortfolioRow[];
  onOpenRun: (id: string) => void;
  /** Omitted for a reader who cannot run a scan (OD). */
  onScanClient?: (clientId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="emptyState">
        Belum ada scan Ads Scanner untuk klien yang Anda pegang. Jalankan scan pertama di tab &ldquo;Scan baru&rdquo;.
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => (b.pool_realokasi ?? 0) - (a.pool_realokasi ?? 0));
  const totalPool = sorted.reduce((n, r) => n + (r.pool_realokasi ?? 0), 0);
  const totalSpend = sorted.reduce((n, r) => n + (r.total_spend ?? 0), 0);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="pill">{sorted.length} klien</span>
        <span className="pill">Total belanja iklan {fmtRupiah(totalSpend)}</span>
        <span className="pill">Total pool realokasi {fmtRupiah(totalPool)}</span>
      </div>

      <div className="table-wrap">
        <table className="table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Klien</th>
              <th>Kategori</th>
              <th>Minggu</th>
              <th>Vonis</th>
              <th style={{ textAlign: 'right' }}>SKU</th>
              <th style={{ textAlign: 'right' }}>GMV</th>
              <th style={{ textAlign: 'right' }}>Belanja</th>
              <th style={{ textAlign: 'right' }}>ROI blended</th>
              <th style={{ textAlign: 'right' }}>Pool realokasi</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{r.client_toko ?? r.client_id}</div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {r.client_nama_pic ?? '—'} · {r.client_id}
                  </div>
                </td>
                <td>{r.kategori}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.minggu_mulai ?? '—'}
                  {r.mode === 'newclient' && <> <span className="badge badge-purple">audit</span></>}
                </td>
                <td>
                  {r.vonis ? <span className={`badge badge-${vonisTone(r.vonis)}`}>{r.vonis}</span> : '—'}
                </td>
                <td style={{ textAlign: 'right' }}>{fmtInt(r.sku_total)}</td>
                <td style={{ textAlign: 'right' }}>{fmtRupiah(r.total_gmv)}</td>
                <td style={{ textAlign: 'right' }}>{fmtRupiah(r.total_spend)}</td>
                {/* null = zero ad spend, so no ROI to blend — `—`, never `0×`. */}
                <td style={{ textAlign: 'right' }}>{fmtRoi(r.blended_roi)}</td>
                <td style={{ textAlign: 'right' }}>{fmtRupiah(r.pool_realokasi)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn btnGhost btnSm" onClick={() => onOpenRun(r.id)}>
                    buka
                  </button>{' '}
                  {onScanClient && (
                    <button type="button" className="btn btnGhost btnSm" onClick={() => onScanClient(r.client_id)}>
                      scan baru
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <span className="muted" style={{ fontSize: 12 }}>
        Satu baris = scan TERAKHIR tiap klien. Diurutkan dari pool realokasi terbesar — itu jumlah budget yang
        sekarang jatuh ke SKU yang tidak layak menerimanya. Angka dibaca dari payload scan yang sudah beku, bukan
        dihitung ulang di halaman ini.
      </span>
    </div>
  );
}
