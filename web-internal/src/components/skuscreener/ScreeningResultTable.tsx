'use client';

/**
 * MEA SKU Screener — Modul A result view (R01-R06).
 *
 * Read-only by construction. Every number here was computed server-side and
 * stored in the run payload: the store's own medians (R04, with the iterative
 * threshold relaxation and the absolute floors), the route per SKU (R05), the
 * CPC maximum and the two overrides that can beat a route (R06). Nothing is
 * recomputed in the browser — a second copy of R04-R06 here is exactly the
 * drift CLAUDE.md forbids, and the run would then disagree with itself.
 *
 * The medians block is shown, not hidden: R04 relaxes its own sampling
 * threshold by 50% until it has ≥5 SKUs, and can end up clamped at the absolute
 * floor. A route computed against a floor-clamped median is a much weaker
 * statement than one computed against a real store median, and the advertiser
 * has to be able to see which they are looking at.
 */
import { fmtDec, fmtInt, fmtPct, fmtRupiah, routeTone, suggestsTracker } from '@/lib/skuscreener-ui';
import type { ScreeningPayload, ScreeningRunDetail, ScreeningSku } from '@/lib/skuscreener';

export default function ScreeningResultTable({
  run,
  payload,
  onTrackSku,
  onLogDecision,
}: {
  run: ScreeningRunDetail;
  payload: ScreeningPayload;
  /** Modul D hand-off — omitted for a reader who cannot write. */
  onTrackSku?: (sku: ScreeningSku) => void;
  /** Modul C hand-off — omitted for a reader who cannot write. */
  onLogDecision?: (sku: ScreeningSku) => void;
}) {
  const m = payload.medians;
  const routes = Object.entries(payload.ringkasan).filter(([, n]) => n > 0);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>{run.id}</h3>
        <span className="muted">{run.created_at}</span>
        <span className="pill">Target ROAS {fmtDec(payload.targetRoas)}</span>
        <span className="pill">Faktor CR iklan {fmtDec(payload.faktorCrIklan)}</span>
        <span className="pill">
          CPC pasar {payload.cpcPasarKategori == null ? 'tidak diisi' : fmtRupiah(payload.cpcPasarKategori)}
        </span>
        <span className="pill">
          CPC aktual {payload.cpcAktual == null ? 'tanpa file iklan' : fmtRupiah(payload.cpcAktual)}
        </span>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {routes.map(([label, n]) => (
          <span key={label} className={`badge badge-${routeTone(label)}`}>
            {label}: {n}
          </span>
        ))}
      </div>

      <div className="table-wrap">
        <table className="table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Median toko (R04)</th>
              <th>Dipakai</th>
              <th>Median mentah</th>
              <th>Ambang sampel</th>
              <th>Jumlah sampel</th>
              <th>Kena floor absolut?</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>CTR</td>
              <td><b>{fmtPct(m.ctr)}</b></td>
              <td>{fmtPct(m.ctrRaw)}</td>
              <td>Views ≥ {fmtInt(m.ctrThreshold)}</td>
              <td>{fmtInt(m.ctrSampleSize)} SKU</td>
              <td>
                {m.ctrReachedFloor
                  ? <span className="badge badge-amber">ya — floor Views 50</span>
                  : <span className="muted">tidak</span>}
              </td>
            </tr>
            <tr>
              <td>CR</td>
              <td><b>{fmtPct(m.cr)}</b></td>
              <td>{fmtPct(m.crRaw)}</td>
              <td>Klik ≥ {fmtInt(m.crThreshold)}</td>
              <td>{fmtInt(m.crSampleSize)} SKU</td>
              <td>
                {m.crReachedFloor
                  ? <span className="badge badge-amber">ya — floor Klik 5</span>
                  : <span className="muted">tidak</span>}
              </td>
            </tr>
            <tr>
              <td>Views</td>
              <td><b>{fmtInt(m.views)}</b></td>
              <td colSpan={4} className="muted">median Views seluruh SKU induk</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="table-wrap">
        <table className="table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Produk</th>
              <th>Views</th>
              <th>Klik</th>
              <th>CTR</th>
              <th>CR</th>
              <th>Pesanan</th>
              <th>GMV</th>
              <th>AOV</th>
              <th>Rute</th>
              <th>CPC maks</th>
              <th>vs CPC pasar</th>
              {(onTrackSku || onLogDecision) && <th />}
            </tr>
          </thead>
          <tbody>
            {payload.skus.map((s, i) => (
              <tr key={`${s.kode || s.produk}-${i}`}>
                <td>{s.kode === '' ? <span className="muted">tanpa kode</span> : s.kode}</td>
                <td style={{ maxWidth: 260 }}>{s.produk}</td>
                <td>{fmtInt(s.views)}</td>
                <td>{fmtInt(s.clicks)}</td>
                <td>{fmtPct(s.ctr)}</td>
                <td>{fmtPct(s.cr)}</td>
                <td>{fmtInt(s.orders)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtRupiah(s.gmv)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtRupiah(s.aov)}</td>
                <td>
                  <span className={`badge badge-${routeTone(s.label)}`}>{s.baseRoute}</span>
                  {/* The override labels carry their own advice sentence; showing
                      only the base route would hide the reason the route is
                      being overruled. */}
                  {(s.isAntiRule || s.isTahanCpcRendah) && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{s.label}</div>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtRupiah(s.cpcMax)}</td>
                <td>
                  {s.marketCpcVerdict ?? '—'}
                  {s.marketCpcRatio != null && (
                    <div className="muted" style={{ fontSize: 12 }}>rasio {fmtDec(s.marketCpcRatio)}×</div>
                  )}
                </td>
                {(onTrackSku || onLogDecision) && (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {onLogDecision && (
                      <button type="button" className="btn btnGhost btnSm" onClick={() => onLogDecision(s)}>
                        keputusan
                      </button>
                    )}{' '}
                    {onTrackSku && (
                      <button
                        type="button"
                        className={`btn btnSm ${suggestsTracker(s.label) ? 'btnSecondary' : 'btnGhost'}`}
                        title={
                          suggestsTracker(s.label)
                            ? 'Rute OPTIMASI — langkah berikutnya memang "ubah lalu ukur"'
                            : 'Boleh, tapi rute ini bukan rute optimasi'
                        }
                        onClick={() => onTrackSku(s)}
                      >
                        tracker
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
