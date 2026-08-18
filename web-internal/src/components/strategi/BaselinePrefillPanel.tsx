'use client';

/**
 * RAB-11 / RAB-12 — the Section B baseline the client's riset awal produced.
 *
 * Suggestion-only, exactly like the Interview→Strategi handoff (RAB-09): this
 * surfaces per-channel baseline numbers + Rule 5 provenance that the AM copies
 * into the Section B editor and confirms. It writes nothing — acceptance is the
 * normal `saveChannels`/`saveBaseline` on the Draft, gated by the existing
 * submit → approve gate (machine #15, RAB-13); no second gate.
 *
 * `gmv_mix` (RAB-12) is shown as a rincian INSIDE the TikTok Shop channel card,
 * never as its own channel — it is attribution within that platform, not a
 * per-marketplace channel.
 *
 * Rendered only when the client has a scored interview whose riset awal produced
 * analysis rows; otherwise the parent passes `null` and this is not shown.
 */

import Link from 'next/link';
import type { StrategiBaselinePrefill, StrategiChannelBaselineSuggestion } from '@/lib/strategi';

const METODE_LABEL: Record<string, string> = {
  analisa_penuh: 'analisa penuh',
  analisa_tipis: 'analisa tipis',
  manual: 'entri manual',
};

function ChannelCard({ c }: { c: StrategiChannelBaselineSuggestion }) {
  const label = c.channel === 'Lainnya' && c.channel_lain ? c.channel_lain : c.channel;
  return (
    <div
      style={{
        marginTop: 8,
        padding: 8,
        border: '1px solid var(--color-border)',
        borderRadius: 6,
      }}
    >
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>{label}</strong>
        <span className="badge badge-gray" style={{ fontWeight: 400 }}>
          {METODE_LABEL[c.metode_baseline] ?? c.metode_baseline}
        </span>
        {c.periode_baseline_bulan != null && (
          <span className="badge badge-gray" style={{ fontWeight: 400 }}>
            {c.periode_baseline_bulan} bln{c.cakupan_riwayat ? ` · ${c.cakupan_riwayat}` : ''}
          </span>
        )}
        {c.alasan_periode_pendek_wajib && (
          <span className="badge badge-amber" style={{ fontWeight: 400 }}>
            &lt;3 bln — alasan periode pendek wajib
          </span>
        )}
      </div>

      <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
        Sumber: {c.sumber_data ?? '—'}
        {c.tanggal_ambil_data ? ` · diambil ${c.tanggal_ambil_data}` : ''}
      </p>

      {c.baseline_bulan.length > 0 && (
        <table className="table" style={{ marginTop: 4, fontSize: 12, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Bulan</th>
              <th style={{ textAlign: 'right' }}>GMV</th>
              <th style={{ textAlign: 'right' }}>Pesanan</th>
            </tr>
          </thead>
          <tbody>
            {c.baseline_bulan.map((m) => (
              <tr key={m.month_index}>
                <td>{m.label ?? `M-${m.month_index}`}</td>
                <td style={{ textAlign: 'right' }}>{m.gmv ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>{m.jumlah_pesanan ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
        ROAS: {c.roas ?? '—'} · Belanja iklan: {c.ad_spend ?? '—'} · AOV: {c.aov ?? '—'}
      </p>

      {c.gmv_mix && (
        <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          Rincian GMV (dalam platform, bukan kanal): video afiliasi {c.gmv_mix.video_afiliasi ?? '—'} · LIVE
          afiliasi {c.gmv_mix.live_afiliasi ?? '—'} · video toko {c.gmv_mix.video_toko ?? '—'} · LIVE toko{' '}
          {c.gmv_mix.live_toko ?? '—'} · kartu produk &amp; lain {c.gmv_mix.kartu_produk_dan_lain ?? '—'}
        </p>
      )}
    </div>
  );
}

export default function BaselinePrefillPanel({ prefill }: { prefill: StrategiBaselinePrefill }) {
  return (
    <section
      className="card"
      style={{
        marginBottom: 16,
        padding: 12,
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        background: 'var(--color-surface-muted, transparent)',
      }}
    >
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>Dari Riset Awal</strong>
        <span style={{ flex: 1 }} />
        <Link href={`/account/interview/${prefill.interview_id}`} className="btn btnGhost btnSm">
          Buka Riset Awal
        </Link>
      </div>
      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        Usulan baseline per kanal — salin ke field terkait lalu konfirmasi. Bukan pengisian otomatis.
      </p>
      {prefill.channels.map((c) => (
        <ChannelCard key={c.client_platform_id} c={c} />
      ))}
    </section>
  );
}
