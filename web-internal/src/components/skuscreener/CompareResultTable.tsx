'use client';

/**
 * MEA SKU Screener — Modul B result view (R09-R11).
 *
 * One row per SKU matched across the two periods. Matching is R09's job
 * (`Kode Produk`, falling back to the normalized product name), the verdict is
 * R11's (+20% / −10% on the judged metric), and the 20-click floor is R10's —
 * all already in the payload. A SKU present in only one of the two exports is
 * not here at all: it was never a pair.
 *
 * `BELUM CUKUP DATA` is not a failure and is not styled like one: it means the
 * "sesudah" period has fewer clicks than the floor, so no honest verdict exists
 * yet. Rendering it as MEMBURUK would invent a conclusion.
 */
import { fmtDeltaPct, fmtInt, fmtPct, fmtRupiah, verdictTone } from '@/lib/skuscreener-ui';
import type { ComparePayload, ScreeningRunDetail } from '@/lib/skuscreener';

export default function CompareResultTable({
  run,
  payload,
}: {
  run: ScreeningRunDetail;
  payload: ComparePayload;
}) {
  const verdicts = Object.entries(payload.ringkasan).filter(([, n]) => n > 0);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>{run.id}</h3>
        <span className="muted">{run.created_at}</span>
        <span className="pill">Ambang klik &ldquo;sesudah&rdquo;: {fmtInt(payload.minKlikSesudah)}</span>
        <span className="pill">{payload.pairs.length} SKU cocok</span>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {verdicts.map(([label, n]) => (
          <span key={label} className={`badge badge-${verdictTone(label)}`}>{label}: {n}</span>
        ))}
      </div>

      <div className="table-wrap">
        <table className="table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Produk</th>
              <th>CTR sebelum → sesudah</th>
              <th>Δ CTR</th>
              <th>CR sebelum → sesudah</th>
              <th>Δ CR</th>
              <th>Klik sesudah</th>
              <th>Δ Views</th>
              <th>GMV sesudah</th>
              <th>Δ GMV</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {payload.pairs.map((p, i) => (
              <tr key={`${p.kode || p.produk}-${i}`}>
                <td>{p.kode === '' ? <span className="muted">tanpa kode</span> : p.kode}</td>
                <td style={{ maxWidth: 240 }}>{p.produk}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtPct(p.before.ctr)} → {fmtPct(p.after.ctr)}</td>
                <td>{fmtDeltaPct(p.deltaCtrPct)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtPct(p.before.cr)} → {fmtPct(p.after.cr)}</td>
                <td>{fmtDeltaPct(p.deltaCrPct)}</td>
                <td>{fmtInt(p.after.clicks)}</td>
                <td>{fmtDeltaPct(p.deltaViewsPct)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtRupiah(p.after.gmv)}</td>
                <td>{fmtDeltaPct(p.deltaGmvPct)}</td>
                <td>
                  <span className={`badge badge-${verdictTone(p.verdict)}`}>{p.verdict}</span>
                  {p.rekomendasi && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{p.rekomendasi}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
