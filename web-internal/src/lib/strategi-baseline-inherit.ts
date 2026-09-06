// RAB-19 "warisi yang bersumber saja" — the pure seeding rule shared by the
// Strategi page and its test. It fills the Section B fields Riset Awal is
// authoritative for (B-0.6 provenance, B-0.7 window, B-1 per-month GMV + orders)
// from the baseline prefill, so the AM confirms them instead of re-typing.
//
// Two invariants that keep it safe on the money/gate path:
//   1. Only EMPTY fields are filled — a value the AM already saved is never
//      clobbered (a later correction goes back to Riset Awal, the single source).
//   2. It writes into the ordinary draft, so the normal Section B save persists
//      the values and the submit gate (`checkCompleteness`: B-0.6 provenance +
//      the B-1 count) stays met once the AM confirms them.
//
// B3 (handoff Gelombang B §4.3/§4.4) widened WHAT is sourced, not the rule. The
// payload always carried ~15 more Section B figures (B-2 traffic, B-3 SKU, B-5
// campaigns, B-6 affiliate, B-7 content & live); they were read on the server
// and thrown away here. Now they seed the same way: only into an EMPTY field,
// and a list only when the destination list is empty — re-opening the page after
// the AM corrected a figure must never undo the correction.
//
// What is still NOT seeded, on purpose:
//   - B-4 rating, jumlah ulasan, % pesanan terlambat — no export carries them on
//     EITHER platform. (The other three B-4 fields DO get seeded on Shopee: the
//     owner decided 2026-09-06 that Shopee's Layanan/Chat + Kesehatan Toko export
//     fills chat response rate, response time and penalty points, while TikTok
//     stays fully manual because it exports none of it. Two platforms, two data
//     availabilities — not an inconsistency.)
//   - per-month ad spend / ROAS / ACOS — the payload figure is a PERIOD aggregate;
//     spreading it across months invents numbers the export never carried.
//   - B-8, B-9, host/studio, and the sampling programme's payer — no source.
// Those stay empty, stay in the Kekurangan panel, and keep gating submit. That is
// the acceptance criterion, not a gap.

import type { BaselineMonthDraft, ChannelDraft } from '@/components/strategi/SectionB';
import type {
  StrategiBaselinePrefill,
  StrategiChannelBaselineSuggestion,
} from '@/lib/strategi';

/** A number the server proposed → the draft's text form. `null` stays ''. */
function txt(v: number | string | null | undefined): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Fill `cur` only when the AM has typed nothing there yet. */
function isi(cur: string, usul: number | string | null | undefined): string {
  return cur.trim() !== '' ? cur : txt(usul);
}

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
    // B-0.6 lampiran is NO LONGER inherited from the Riset Awal export filenames
    // (owner QA 2026-08-24): it autofills from the client's Link Toko instead,
    // filled server-side in loadDetail/saveChannels. The export filenames stay in
    // `sumber_data`, which is where "sumber data baseline" belongs.
    if (!next.periode_baseline_bulan.trim() && s.periode_baseline_bulan != null)
      next.periode_baseline_bulan = String(s.periode_baseline_bulan);
    if (s.baseline_bulan.length > 0) {
      // PRD B-0.7 window is 1–6 months (DB CHECK BETWEEN 1 AND 6).
      const nMonths = next.periode_baseline_bulan.trim()
        ? Math.max(1, Math.min(6, Math.round(Number(next.periode_baseline_bulan))))
        : 0;
      next.baseline = Array.from({ length: nMonths }, (_, i): BaselineMonthDraft => {
        // month_index is 1-based end to end — the DB CHECK is `BETWEEN 1 AND 6`,
        // `normalizeBaseline` refuses `< 1`, and the server prefill emits `i + 1`
        // (see strategi.ts getBaselinePrefill). Row `i` of the window is month
        // `i + 1`; a 0-based value here would be rejected on save with
        // `[data tidak lengkap …]` and would also miss its own prefill cell.
        const monthIndex = i + 1;
        const existing = next.baseline.find((m) => m.month_index === monthIndex) ?? {
          month_index: monthIndex,
          gmv: '',
          jumlah_pesanan: '',
          persen_batal: '',
          ad_spend: '',
          roas: '',
          acos: '',
        };
        const sm = s.baseline_bulan.find((m) => m.month_index === monthIndex);
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
      // B-1.4 (% batal) is a PERIOD aggregate in the payload, not a per-month
      // figure. It is seeded into exactly one row — the month whose label is the
      // payload's own reference period — and only when that month exists and is
      // still empty. Spreading it evenly across the window would be inventing a
      // number for five months the export never described.
      const bulanPeriode = s.periode_referensi
        ? (s.baseline_bulan.find((m) => m.label === s.periode_referensi)?.month_index ?? null)
        : null;
      if (bulanPeriode !== null && s.refund_rate_persen != null) {
        next.baseline = next.baseline.map((m) =>
          m.month_index === bulanPeriode
            ? { ...m, persen_batal: isi(m.persen_batal, s.refund_rate_persen) }
            : m,
        );
      }
    }
    return mergeSectionBFigures(next, s);
  });
}

/**
 * The B3 half: the B-2…B-7 figures the payload carries. Split out from the
 * function above so the two rules stay legible — that one owns B-0/B-1 (window
 * + provenance + months), this one owns everything the analysis engine measured.
 *
 * Every assignment goes through `isi` (scalars) or an explicit emptiness test
 * (lists). A field the payload has no source for arrives `null` and therefore
 * writes '' — which is the same as not writing at all, and keeps the field in
 * the Kekurangan panel where it belongs.
 */
function mergeSectionBFigures(
  c: ChannelDraft,
  s: StrategiChannelBaselineSuggestion,
): ChannelDraft {
  const next: ChannelDraft = { ...c };

  // B-2 Trafik & Konversi. B-2.3 organik + affiliate are deliberately absent
  // from the wire (always null): organik-as-residual is a fabricated number, and
  // affiliate GMV is already counted inside the video and LIVE buckets.
  next.pengunjung_per_bulan = isi(next.pengunjung_per_bulan, s.pengunjung_per_bulan);
  next.conversion_rate_persen = isi(next.conversion_rate_persen, s.conversion_rate_persen);
  next.trafik_iklan_persen = isi(next.trafik_iklan_persen, s.trafik_iklan_persen);
  next.trafik_live_persen = isi(next.trafik_live_persen, s.trafik_live_persen);
  next.trafik_video_persen = isi(next.trafik_video_persen, s.trafik_video_persen);
  next.trafik_luar_persen = isi(next.trafik_luar_persen, s.trafik_luar_persen);

  // B-4 Kesehatan Toko — Shopee only; on TikTok all three arrive null and the
  // fields stay empty, still listed in the Kekurangan panel, still gating submit.
  next.chat_response_rate_persen = isi(next.chat_response_rate_persen, s.chat_response_rate_persen);
  next.chat_response_menit = isi(next.chat_response_menit, s.chat_response_menit);
  next.poin_penalti = isi(next.poin_penalti, s.poin_penalti);

  // B-3 SKU.
  next.sku_listed = isi(next.sku_listed, s.sku_listed);
  next.sku_aktif = isi(next.sku_aktif, s.sku_aktif);
  next.sku_pareto_80 = isi(next.sku_pareto_80, s.sku_pareto_80);
  next.sku_slow_moving = isi(next.sku_slow_moving, s.sku_slow_moving);
  // B-3.3 hero SKU: seeded only into an EMPTY list. `unit_terjual`, `harga_jual`
  // and `margin_persen` stay blank — no export carries them, and they are what
  // the margin math needs, so a zero there would be worse than an empty cell.
  if (next.top_sku.length === 0 && s.top_sku.length > 0) {
    next.top_sku = s.top_sku.map((t) => ({
      nama: t.nama,
      gmv: txt(t.gmv),
      unit_terjual: '',
      harga_jual: '',
      margin_persen: '',
    }));
  }

  // B-5 Iklan (per-month spend/ROAS stay manual — see the module note).
  next.jumlah_kampanye_aktif = isi(next.jumlah_kampanye_aktif, s.jumlah_kampanye_aktif);
  if (next.tipe_kampanye.length === 0 && s.tipe_kampanye.length > 0) {
    next.tipe_kampanye = [...s.tipe_kampanye];
  }

  // B-6 Affiliate / KOL.
  next.affiliate_aktif_30hari = isi(next.affiliate_aktif_30hari, s.affiliate_aktif_30hari);
  next.gmv_affiliate = isi(next.gmv_affiliate, s.gmv_affiliate);
  next.gmv_affiliate_persen = isi(next.gmv_affiliate_persen, s.gmv_affiliate_persen);
  if (next.top_kreator.length === 0 && s.top_kreator.length > 0) {
    next.top_kreator = s.top_kreator.map((k) => ({ nama: k.nama, gmv: txt(k.gmv) }));
  }
  // B-6.5: the export carries HOW MANY samples went out, never WHO paid for the
  // programme — so the `program_sampel` enum stays manual (and keeps gating), and
  // only the count is offered, as a note, through a fixed template so a recompute
  // is byte-identical.
  if (!next.program_sampel_catatan.trim() && s.sampel_terkirim != null) {
    next.program_sampel_catatan = `${s.sampel_terkirim} sampel terkirim (dari Riset Awal)`;
  }

  // B-7 Konten & Live. GMV per jam live is DERIVED server-side (house rule #4) —
  // never seeded here.
  next.jumlah_video_per_bulan = isi(next.jumlah_video_per_bulan, s.jumlah_video_per_bulan);
  next.total_views = isi(next.total_views, s.total_views);
  next.gmv_video = isi(next.gmv_video, s.gmv_video);
  next.jam_live_per_bulan = isi(next.jam_live_per_bulan, s.jam_live_per_bulan);
  next.gmv_live = isi(next.gmv_live, s.gmv_live);

  return next;
}

// ---------------------------------------------------------------------------
// Ringkasan otomatis vs manual (B3 — "yang manual tetap terlihat manual")
// ---------------------------------------------------------------------------

/**
 * The Section B figures a baseline payload CAN carry, with the label the AM
 * reads in the form. Order follows the form, so the summary reads top-to-bottom.
 */
const FIELD_BERSUMBER: readonly [
  keyof StrategiChannelBaselineSuggestion,
  string,
][] = [
  ['pengunjung_per_bulan', 'Pengunjung per bulan (B-2.1)'],
  ['conversion_rate_persen', 'Conversion rate % (B-2.2)'],
  ['trafik_video_persen', 'Komposisi video (B-2.3)'],
  ['trafik_live_persen', 'Komposisi live (B-2.3)'],
  ['trafik_luar_persen', 'Komposisi kartu produk & lain (B-2.3)'],
  ['trafik_iklan_persen', 'Komposisi iklan (B-2.3)'],
  ['sku_listed', 'SKU terdaftar (B-3.1)'],
  ['sku_aktif', 'SKU aktif'],
  ['sku_pareto_80', 'SKU penyumbang 80% GMV (B-3.2)'],
  ['sku_slow_moving', 'SKU slow moving'],
  ['jumlah_kampanye_aktif', 'Jumlah kampanye aktif (B-5.3)'],
  ['affiliate_aktif_30hari', 'Affiliate aktif 30 hari (B-6.1)'],
  ['gmv_affiliate', 'GMV dari affiliate'],
  ['gmv_affiliate_persen', '% GMV dari affiliate (B-6.2)'],
  ['sampel_terkirim', 'Sampel terkirim (B-6.5)'],
  ['jumlah_video_per_bulan', 'Video per bulan (B-7.1)'],
  ['total_views', 'Total views'],
  ['gmv_video', 'GMV dari video'],
  ['jam_live_per_bulan', 'Jam live per bulan (B-7.2)'],
  ['gmv_live', 'GMV dari live'],
  ['refund_rate_persen', '% batal (B-1.4)'],
  ['chat_response_rate_persen', 'Chat response rate % (B-4.2)'],
  ['chat_response_menit', 'Response time menit (B-4.2)'],
  ['poin_penalti', 'Poin penalti (B-4.4)'],
];

/**
 * Fields NO export carries, for EITHER platform — they are manual by nature, not
 * because a payload is old. Naming them is the point: the acceptance criterion
 * for B3 is "yang manual tetap terlihat manual", and an AM who cannot tell the
 * two apart will wait for an auto-fill that is never coming.
 */
export const SELALU_MANUAL: readonly string[] = [
  'B-4.1/B-4.3 rating, jumlah ulasan, % pesanan terlambat (tidak ada export-nya di platform mana pun)',
  'B-5.1/B-5.2 belanja iklan & ROAS per bulan (payload hanya punya agregat periode)',
  'B-6.3 komisi open & target',
  'B-6.5 siapa yang menanggung program sampel',
  'B-7.3/B-7.4 host & studio live',
  'B-8 promo & program platform',
  'B-9 kompetitor',
];

export interface RingkasBaseline {
  /** Labels this payload proposes a value for. */
  otomatis: string[];
  /** Labels this payload COULD carry but does not — still manual, still gating. */
  belumTersedia: string[];
  /** The payload has no readable blocks: an old payload, or a manual baseline. */
  payloadLama: boolean;
}

/**
 * Split the sourceable Section B fields into "the upload answered this" and "you
 * still have to type this". Pure, so the panel and its test read one rule.
 */
export function ringkasBaseline(
  s: StrategiChannelBaselineSuggestion | null | undefined,
): RingkasBaseline {
  if (!s) return { otomatis: [], belumTersedia: [], payloadLama: true };
  const otomatis: string[] = [];
  const belumTersedia: string[] = [];
  for (const [key, label] of FIELD_BERSUMBER) {
    (s[key] === null || s[key] === undefined ? belumTersedia : otomatis).push(label);
  }
  // Lists are their own questions — a payload with no hero SKU has not answered
  // B-3.3, even though B-3.1 came through.
  (s.top_sku.length > 0 ? otomatis : belumTersedia).push('Top SKU (B-3.3)');
  (s.top_kreator.length > 0 ? otomatis : belumTersedia).push('Top kreator (B-6.4)');
  (s.tipe_kampanye.length > 0 ? otomatis : belumTersedia).push('Tipe kampanye (B-5.3)');
  return { otomatis, belumTersedia, payloadLama: !s.payload_terbaca };
}
