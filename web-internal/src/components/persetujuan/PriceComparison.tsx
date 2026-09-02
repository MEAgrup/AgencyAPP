'use client';

/**
 * Tabel "harga standar → harga diajukan" untuk kedua antrian uang di
 * `/persetujuan` (negosiasi sales M0 §6, renewal/cross-sell R-03).
 *
 * M0 §6 memang mensyaratkan tampilan ini pada halaman keputusan — "proposed vs.
 * standard values per service" — tetapi selama ini hanya ada di `/sales/[id]`.
 * Di antrian, Superior hanya melihat nama lead dan status, lalu menyetujui
 * potongan harga tanpa pernah melihat potongannya. Itu yang diperbaiki di sini.
 *
 * Angka di sini murni tampilan: total resmi tetap dihitung server saat closing.
 */
import { formatIDR } from '@/lib/money';
import { deltaLabel, formatDeltaPercent, type Comparison } from '@/lib/persetujuan';

function toneOf(direction: string): string {
  if (direction === 'diskon') return 'badge-amber';
  if (direction === 'markup') return 'badge-blue';
  if (direction === 'sama') return 'badge-gray';
  return 'badge-gray';
}

export default function PriceComparison({
  comparison,
  showPaymentTerms = true,
}: {
  comparison: Comparison;
  showPaymentTerms?: boolean;
}) {
  const { lines, totalStandard, totalProposed, totalDelta } = comparison;
  if (lines.length === 0) {
    return <p className="muted" style={{ fontSize: 13 }}>Proposal ini tidak punya baris jasa.</p>;
  }
  const totalCmp = { direction: totalDelta === null ? 'unknown' : totalDelta < 0 ? 'diskon' : totalDelta > 0 ? 'markup' : 'sama' };

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Jasa</th>
            <th>Harga standar</th>
            <th>Harga diajukan</th>
            <th>Selisih</th>
            <th>Komisi</th>
            {showPaymentTerms && <th>Termin</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.masterServiceId}>
              <td>
                {l.name}
                {/* Qty datang sebagai DECIMAL string ("2.00"); bandingkan sebagai
                    angka supaya "1.00" tidak tampil sebagai "× 1.00". */}
                {l.quantity !== '' && Number(l.quantity) !== 1 && (
                  <span className="muted" style={{ fontSize: 12 }}> &times; {Number(l.quantity)}</span>
                )}
              </td>
              <td className="muted">{l.delta.standard === null ? '—' : formatIDR(l.delta.standard)}</td>
              <td style={{ fontWeight: 600 }}>
                {l.delta.proposed === null ? '—' : formatIDR(l.delta.proposed)}
              </td>
              <td>
                {l.delta.delta === null ? (
                  '—'
                ) : (
                  <>
                    <span className={`badge ${toneOf(l.delta.direction)}`}>{deltaLabel(l.delta)}</span>{' '}
                    <span style={{ fontSize: 12 }}>
                      {formatIDR(l.delta.delta)} ({formatDeltaPercent(l.delta)})
                    </span>
                  </>
                )}
              </td>
              <td>{l.commissionRule || '—'}</td>
              {showPaymentTerms && <td>{l.paymentTerms || 'Full payment'}</td>}
            </tr>
          ))}
          <tr>
            <td style={{ fontWeight: 700 }}>Total</td>
            <td className="muted">{totalStandard === null ? '—' : formatIDR(totalStandard)}</td>
            <td style={{ fontWeight: 700 }}>{totalProposed === null ? '—' : formatIDR(totalProposed)}</td>
            <td>
              {totalDelta === null ? (
                '—'
              ) : (
                <>
                  <span className={`badge ${toneOf(totalCmp.direction)}`}>
                    {totalDelta < 0 ? 'Diskon' : totalDelta > 0 ? 'Markup' : 'Harga standar'}
                  </span>{' '}
                  <span style={{ fontSize: 12, fontWeight: 600 }}>
                    {formatIDR(totalDelta)} ({formatDeltaPercent({
                      standard: totalStandard,
                      proposed: totalProposed,
                      delta: totalDelta,
                      percent: comparison.totalPercent,
                      direction: 'unknown',
                    })})
                  </span>
                </>
              )}
            </td>
            <td />
            {showPaymentTerms && <td />}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
