'use client';

/**
 * TikTok Ads Scanner — one stored scan (AS-05, screen (b)).
 *
 * Read-only by construction. The 5-component score, the 6 buckets, the content
 * gate, the reallocation pool and every median were computed server-side by
 * `@cdps/core` and stored in a frozen payload. Nothing is recomputed here: a
 * second copy of the scoring rules in the browser is exactly the drift
 * `CLAUDE.md` forbids, and the scan would then disagree with itself.
 *
 * ## Why the SKU table is grouped by bucket, not sorted by score
 *
 * The score is an input to the bucket, not the output an advertiser acts on —
 * two SKUs with the same score can need opposite actions (one has content and
 * no spend, the other spend and no content). The buckets ARE the six actions,
 * so they are the grouping, ordered by money at stake (`BUCKET_ORDER`: leaks
 * before opportunities). Within a bucket, spend descending — the biggest
 * exposure first.
 *
 * ## What is shown that the tool did not show
 *
 * The benchmark version and the score breakdown per component. Both exist
 * because the benchmark became a versioned table rather than a mutated JS
 * constant (house rule #4): a reader has to be able to see WHICH calibration a
 * score was computed against, and which components actually contributed —
 * `skor.ts` renormalises over the components whose data exists, so a score of
 * 70 built from 3 of 5 components is a weaker statement than one built from 5.
 */
import {
  byBucketOrder, bucketTone, EMPTY, fmtDec, fmtInt, fmtPct, fmtRoi, fmtRupiah, gateTone, missingSlots, slotLabel, vonisTone,
} from '@/lib/adsscanner-ui';
import type { AdsScanPayload, AdsScanRunDetail, AdsScanSku } from '@/lib/adsscanner';
import { adsScanHtmlUrl, readAdsScanBerkas } from '@/lib/adsscanner';

function kpi(label: string, value: string, sub?: string) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/** The five score components, in the engine's own weight order, for the breakdown cell. */
const SKOR_PARTS: ReadonlyArray<{ key: keyof AdsScanSku['skorRinci']; label: string; weight: string }> = [
  { key: 'konten', label: 'Konten', weight: '35%' },
  { key: 'gmv', label: 'GMV', weight: '25%' },
  { key: 'efisiensi', label: 'ROI', weight: '20%' },
  { key: 'ctr', label: 'CTR', weight: '10%' },
  { key: 'ctor', label: 'CTOR', weight: '10%' },
];

export default function ScanResultView({ run, payload }: { run: AdsScanRunDetail; payload: AdsScanPayload }) {
  const r = payload.ringkasan;
  const berkas = readAdsScanBerkas(run.sumber_berkas);
  const missing = missingSlots(payload.kelengkapan_file);

  const buckets = new Map<string, AdsScanSku[]>();
  for (const s of payload.sku) {
    const list = buckets.get(s.bucket) ?? [];
    list.push(s);
    buckets.set(s.bucket, list);
  }
  const orderedBuckets = [...buckets.keys()].sort(byBucketOrder);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>{run.id}</h3>
        <span className={`badge badge-${vonisTone(payload.vonis.label)}`}>{payload.vonis.label}</span>
        <span className="pill">{payload.klien.kategori}</span>
        <span className="pill">{payload.klien.periode_minggu ?? 'periode tidak diisi'}</span>
        {run.mode === 'newclient' && <span className="badge badge-purple">mode audit klien baru</span>}
        <span className="pill">benchmark v{payload.benchmark_versi ?? EMPTY}</span>
        <a className="btn btnGhost btnSm" href={adsScanHtmlUrl(run.id)} target="_blank" rel="noreferrer">
          buka HTML
        </a>
      </div>

      {payload.flags.length > 0 && (
        <div className="alert alertWarn" style={{ fontSize: 13 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {payload.flags.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </div>
      )}

      {missing.length > 0 && (
        <div className="alert alertInfo" style={{ fontSize: 13 }}>
          Scan ini jalan tanpa berkas: {missing.map(slotLabel).join(', ')}. Angka yang bergantung padanya kosong,
          bukan nol.
        </div>
      )}

      <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        {kpi('GMV total', fmtRupiah(r.totalGmv), `${fmtInt(r.skuAktifGmv)} dari ${fmtInt(r.skuTotal)} SKU ber-GMV`)}
        {kpi('Belanja iklan', fmtRupiah(r.totalSpend), `omzet iklan ${fmtRupiah(r.totalRev)}`)}
        {/* null = no ad spend ⇒ no ROI to blend. Benchmark shown alongside so the
            number is judged against the category, not in the abstract. */}
        {kpi('ROI blended', fmtRoi(r.blendedRoi), `benchmark kategori ${fmtRoi(r.benchmark.roi)}`)}
        {kpi('Pool realokasi', fmtRupiah(r.poolRealokasi), 'dari SKU tak layak')}
        {kpi('Belanja ke SKU kering', fmtPct(r.pctSpendKering), `${fmtInt(r.skuKering)} SKU konten kering`)}
        {kpi('SKU siap iklan', fmtInt(r.skuSiap), `gerbang konten lolos`)}
        {kpi('Konten', `${fmtInt(r.kontenKreator)} + ${fmtInt(r.kontenToko)}`, `kreator + toko · ${fmtInt(r.kreatorUnik)} kreator unik`)}
        {kpi('SKU mati', fmtRupiah(r.orphanSpend), `${fmtInt(r.orphanSku)} SKU di luar Analitik Produk`)}
      </div>

      {/* Reallocation first: it is the one table that says "move this money today". */}
      {payload.realokasi.rows.length > 0 && (
        <section className="card">
          <div className="cardHeader">
            <h2>Realokasi budget — {fmtRupiah(payload.realokasi.pool)}</h2>
          </div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>SKU tujuan</th>
                  <th>Bucket</th>
                  <th style={{ textAlign: 'right' }}>Skor</th>
                  <th style={{ textAlign: 'right' }}>Tambahan</th>
                </tr>
              </thead>
              <tbody>
                {payload.realokasi.rows.map((row) => (
                  <tr key={row.pid}>
                    <td>{row.nama}</td>
                    <td><span className={`badge badge-${bucketTone(row.bucket)}`}>{row.bucket}</span></td>
                    <td style={{ textAlign: 'right' }}>{fmtDec(row.skor, 1)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtRupiah(row.tambahan)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {orderedBuckets.map((bucket) => {
        const list = [...(buckets.get(bucket) ?? [])].sort((a, b) => b.adCost - a.adCost);
        return (
          <section className="card" key={bucket}>
            <div className="cardHeader">
              <h2>
                <span className={`badge badge-${bucketTone(bucket)}`}>{bucket}</span> — {list.length} SKU
              </h2>
            </div>
            <div className="table-wrap">
              <table className="table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th style={{ textAlign: 'right' }}>Skor</th>
                    <th>Rincian skor</th>
                    <th>Gerbang</th>
                    <th style={{ textAlign: 'right' }}>Konten</th>
                    <th style={{ textAlign: 'right' }}>GMV</th>
                    <th style={{ textAlign: 'right' }}>Belanja</th>
                    <th style={{ textAlign: 'right' }}>ROI</th>
                    <th style={{ textAlign: 'right' }}>CTR</th>
                    <th style={{ textAlign: 'right' }}>CTOR</th>
                    <th style={{ textAlign: 'right' }}>Budget/hari</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.pid}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{s.nama || s.pid}</div>
                        <div className="muted" style={{ fontSize: 11, fontFamily: 'monospace' }}>{s.pidFull || s.pid}</div>
                        {s.blockers.length > 0 && (
                          <div style={{ marginTop: 2 }}>
                            {s.blockers.map((b) => <span key={b} className="badge badge-darkgray">{b}</span>)}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtDec(s.skor, 1)}</td>
                      <td className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                        {SKOR_PARTS.map((p) => (
                          <span key={p.key} style={{ marginRight: 6 }} title={`${p.label} — bobot ${p.weight}`}>
                            {p.label} {fmtDec(s.skorRinci[p.key], 0)}
                          </span>
                        ))}
                      </td>
                      <td><span className={`badge badge-${gateTone(s.gate)}`}>{s.gate}</span></td>
                      <td style={{ textAlign: 'right' }}>{fmtInt(s.konten)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtRupiah(s.gmv)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtRupiah(s.adCost)}</td>
                      {/* The four null-bearing metrics. Each null is a deliberate
                          "no basis" from the engine (no spend / no impressions /
                          no clicks), so each renders `—` rather than a 0 that
                          would read as "measured, and terrible". */}
                      <td style={{ textAlign: 'right' }}>{fmtRoi(s.roi)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtPct(s.ctr)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtPct(s.ctor)}</td>
                      <td style={{ textAlign: 'right' }}>{s.budgetHarian > 0 ? fmtRupiah(s.budgetHarian) : EMPTY}</td>
                      <td style={{ maxWidth: 280 }}>
                        <div>{s.aksi}</div>
                        {s.diagnosa && <div className="muted" style={{ fontSize: 11 }}>{s.diagnosa}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {payload.orphan.length > 0 && (
        <section className="card">
          <div className="cardHeader">
            <h2>SKU mati — belanja tanpa Analitik Produk</h2>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
            Belanja iklan mendarat di ID produk yang tidak ada di export Analitik Produk. Biasanya produk sudah
            dihapus/dinonaktifkan tapi kampanyenya masih jalan.
          </p>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>ID produk</th>
                  <th style={{ textAlign: 'right' }}>Belanja</th>
                  <th style={{ textAlign: 'right' }}>Omzet</th>
                  <th style={{ textAlign: 'right' }}>Kreatif</th>
                  <th>Kampanye</th>
                </tr>
              </thead>
              <tbody>
                {payload.orphan.map((o) => (
                  <tr key={o.pid}>
                    <td style={{ fontFamily: 'monospace' }}>{o.pid}</td>
                    <td style={{ textAlign: 'right' }}>{fmtRupiah(o.cost)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtRupiah(o.rev)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtInt(o.creatives)}</td>
                    <td>{o.kampanye.join(', ') || EMPTY}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(['kreator', 'toko'] as const).map((kind) => {
        const rowsA = payload.angles[kind];
        if (!rowsA || rowsA.length === 0) return null;
        return (
          <section className="card" key={kind}>
            <div className="cardHeader">
              <h2>Angle konten — {kind === 'kreator' ? 'kreator / affiliate' : 'konten toko'}</h2>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
              Video dihitung menang bila GMV &gt; 0 dan GPM ≥ {fmtRupiah(payload.gpm_benchmark_rupiah)} per 1.000
              views (benchmark {payload.klien.kategori}).
            </p>
            <div className="table-wrap">
              <table className="table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Angle</th>
                    <th style={{ textAlign: 'right' }}>Video</th>
                    <th style={{ textAlign: 'right' }}>Menang</th>
                    <th style={{ textAlign: 'right' }}>Tingkat menang</th>
                    <th style={{ textAlign: 'right' }}>GPM median</th>
                    <th style={{ textAlign: 'right' }}>GMV</th>
                    <th style={{ textAlign: 'right' }}>Views</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsA.map((a) => (
                    <tr key={a.angle}>
                      <td>
                        {a.angle}
                        {a.lolosBenchmark && <> <span className="badge badge-green">lolos benchmark</span></>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{fmtInt(a.jumlah)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtInt(a.menang)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtPct(a.winRate)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtRupiah(a.gpmMedian)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtRupiah(a.gmv)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtInt(a.vv)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <section className="card">
        <div className="cardHeader">
          <h2>Berkas sumber</h2>
        </div>
        <div className="table-wrap">
          <table className="table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Berkas</th>
                <th>Slot terdeteksi</th>
                <th style={{ textAlign: 'right' }}>Baris</th>
                <th style={{ textAlign: 'right' }}>Ukuran</th>
                <th>sha256</th>
              </tr>
            </thead>
            <tbody>
              {berkas.map((b, i) => (
                <tr key={`${b.sha256}-${i}`}>
                  <td>{b.nama_berkas}</td>
                  <td>
                    {slotLabel(b.peran)}
                    {b.video_kind && <> · <span className="badge badge-blue">{b.video_kind}</span></>}
                    {b.video_kind_ambigu && <> <span className="badge badge-amber">ditebak</span></>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmtInt(b.baris)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInt(Math.round(b.ukuran_bytes / 1024))} KB</td>
                  <td style={{ fontFamily: 'monospace' }}>{b.sha256.slice(0, 12)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span className="muted" style={{ fontSize: 11 }}>
          Dijalankan {payload.generated_at} oleh {payload.klien.account_manager ?? EMPTY} · jam server (WIB), bukan
          jam browser.
        </span>
      </section>
    </div>
  );
}
