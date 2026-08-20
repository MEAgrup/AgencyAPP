// RAB-19 "warisi yang bersumber saja" — the pure seeding rule shared by the
// Strategi page and its test. It fills the Section B fields Riset Awal is
// authoritative for (B-0.6 provenance, B-0.7 window, B-1 per-month GMV + orders)
// from the baseline prefill, so the AM confirms them instead of re-typing.
//
// Two invariants that keep it safe on the money/gate path:
//   1. Only EMPTY fields are filled — a value the AM already saved is never
//      clobbered (a later correction goes back to Riset Awal, the single source).
//   2. It writes into the ordinary draft, so the normal Section B save persists
//      the values and the DB gate (`ck_strch_eksisting`, the B-1 count) stays met.
// Everything Riset Awal has no source for (persen batal, ad spend, ROAS, ACOS,
// and all of B-2…B-9) is left untouched here and stays manual.

import type { BaselineMonthDraft, ChannelDraft } from '@/components/strategi/SectionB';
import type { StrategiBaselinePrefill } from '@/lib/strategi';

function suggFor(prefill: StrategiBaselinePrefill, c: ChannelDraft) {
  return prefill.channels.find(
    (x) =>
      x.channel === c.channel &&
      (c.channel !== 'Lainnya' || (x.channel_lain ?? '') === (c.channel_lain ?? '')),
  );
}

export function mergeBaselinePrefill(
  channels: ChannelDraft[],
  prefill: StrategiBaselinePrefill,
): ChannelDraft[] {
  return channels.map((c) => {
    const s = suggFor(prefill, c);
    if (!s) return c;
    const next: ChannelDraft = { ...c };
    if (!next.sumber_data.trim() && s.sumber_data) next.sumber_data = s.sumber_data;
    if (!next.tanggal_ambil_data.trim() && s.tanggal_ambil_data)
      next.tanggal_ambil_data = s.tanggal_ambil_data;
    if (!next.lampiran.trim() && s.lampiran) next.lampiran = s.lampiran;
    if (!next.periode_baseline_bulan.trim() && s.periode_baseline_bulan != null)
      next.periode_baseline_bulan = String(s.periode_baseline_bulan);
    if (s.baseline_bulan.length > 0) {
      const nMonths = next.periode_baseline_bulan.trim()
        ? Math.max(1, Math.min(12, Math.round(Number(next.periode_baseline_bulan))))
        : 0;
      next.baseline = Array.from({ length: nMonths }, (_, i): BaselineMonthDraft => {
        const existing = next.baseline.find((m) => m.month_index === i) ?? {
          month_index: i,
          gmv: '',
          jumlah_pesanan: '',
          persen_batal: '',
          ad_spend: '',
          roas: '',
          acos: '',
        };
        const sm = s.baseline_bulan.find((m) => m.month_index === i);
        return {
          ...existing,
          gmv: existing.gmv.trim() ? existing.gmv : (sm?.gmv ?? ''),
          jumlah_pesanan: existing.jumlah_pesanan.trim()
            ? existing.jumlah_pesanan
            : sm?.jumlah_pesanan != null
              ? String(sm.jumlah_pesanan)
              : '',
        };
      });
    }
    return next;
  });
}
