// Client-side rules for the lead-intake campaign picker (M1 §9.3 Origin
// Campaign). Pure — no fetching, no runtime imports: the list itself comes from
// `marketing.listSelectableCampaigns()`, and this module only decides which
// sources REQUIRE a campaign, how the list is searched, and how a row is
// labelled. All three are unit-tested (campaign-picker.test.ts), because the
// search box is the whole point of the feature: a salesperson who cannot FIND
// the campaign skips the field, which is what left `origin_campaign_id` empty on
// nearly every Sales-registered lead.
//
// Dependency-free ON PURPOSE (the lead-progress.ts precedent): `lib/leads.ts`
// imports `lib/api`, and the `@/` path alias is a Next/tsconfig feature vitest
// does not resolve — so anything that must be testable cannot live there.

import type { SelectableCampaign } from '@/lib/marketing';

// Sources whose lead MUST carry an Origin Campaign (M1 §9.3 field spec:
// "mandatory when Source ∈ {Leads-Iklan, Broadcast, Event, Kulwa}"). Mirrors
// packages/domain `leads.CAMPAIGN_REQUIRED_SOURCES` verbatim — the server is the
// authority (it answers [data tidak lengkap, silahkan lengkapi semua pertanyaan
// wajib!]); this copy only lets the form mark the field required instead of
// making the user wait for a round-trip to find out.
export const CAMPAIGN_REQUIRED_SOURCES = [
  'Leads - Iklan',
  'Broadcast',
  'Event',
  'Kulwa',
] as const;

export function campaignRequiredForSource(source: string): boolean {
  return (CAMPAIGN_REQUIRED_SOURCES as readonly string[]).includes(source.trim());
}

// Sentinel for the picker's "di luar campaign marketing" option. NOT a wire
// value: it never leaves the form — the page translates it into
// `outside_campaign: true` with no `campaign_id`. Deliberately outside the CMP-
// namespace so it can never be mistaken for (or stored as) a campaign id.
export const OUTSIDE_CAMPAIGN = '__outside__';

// One dropdown line: name first (what sales actually remembers), then the
// channel and the CMP- id that disambiguate two similarly-named campaigns, then
// the status for anything not currently live. Statuses are stored unbracketed
// (M3), so no `[...]` here — the square brackets are reserved for BI validation
// messages (house rule #5).
export function campaignLabel(c: SelectableCampaign): string {
  const mark = c.status === 'Active' ? '' : ` · ${c.status}`;
  return `${c.name} · ${c.channel} · ${c.id}${mark}`;
}

// The dropdown's three groups, in the order the server already sorts by. Grouping
// exists so a Closed or Draft campaign is never mistaken for a live one at the
// moment of picking — the whole list is offered (a lead from a campaign that is
// missing from the list cannot be attributed at all), but not flattened into a
// single undifferentiated column.
export const CAMPAIGN_GROUPS = [
  { label: 'Sedang jalan', statuses: ['Active', 'Paused'] },
  { label: 'Sudah selesai', statuses: ['Closed', 'Archived'] },
  { label: 'Belum jalan', statuses: ['Draft'] },
] as const;

export interface CampaignGroup {
  label: string;
  items: SelectableCampaign[];
}

// Splits an already-ordered list into the groups above, dropping empty ones and
// PRESERVING the server's order within each. A status the FE does not know about
// still reaches the user, under the last group, rather than vanishing from the
// dropdown — an unpickable campaign is the failure mode this whole feature exists
// to remove.
export function groupCampaigns(list: SelectableCampaign[]): CampaignGroup[] {
  const known = new Set<string>(CAMPAIGN_GROUPS.flatMap((g) => [...g.statuses]));
  return CAMPAIGN_GROUPS.map((g, i) => ({
    label: g.label,
    items: list.filter(
      (c) =>
        (g.statuses as readonly string[]).includes(c.status) ||
        (i === CAMPAIGN_GROUPS.length - 1 && !known.has(c.status)),
    ),
  })).filter((g) => g.items.length > 0);
}

// Lead-Quality Rate (M2 §4 r3) = real ÷ generated, and `—` when the divisor is
// zero (house rule #7 — never an error, never "0%", which would read as a real
// measurement of a campaign nobody has worked yet).
//
// Integer arithmetic mirroring `marketing.ts percentRound` (round-half-up on
// num*100/den) EXACTLY rather than `Math.round(a/b*100)`, so the rate Sales reads
// here can never differ by a percentage point from Marketing's dashboard.
export function qualityRateLabel(real: number, generated: number): string {
  if (generated <= 0) return '—';
  return `${Math.floor((real * 100 + Math.floor(generated / 2)) / generated)}%`;
}

// The one-line funnel Sales reads under the picker: what this campaign has
// produced so far. Every number is derived server-side from the attempt log —
// this only formats them.
export function funnelSummary(c: SelectableCampaign): string {
  return (
    `${c.lead_by_dashboard} lead masuk · ` +
    `${c.lead_real_by_sales} lead asli (≥ Qualified) · ` +
    `${c.lead_not_qualified} not qualified · ` +
    `quality rate ${qualityRateLabel(c.lead_real_by_sales, c.lead_by_dashboard)}`
  );
}

// Substring search over name + channel + id, ALL whitespace-separated tokens
// required. Token-wise rather than one substring so "promo tiktok" finds "Promo
// Skilskul Maret · TikTok Ads" — the order a person types two remembered words is
// not the order they appear in the label.
//
// `keepId` is load-bearing, not a convenience: the picker is a <select> whose
// value must survive typing in the search box. Without it, refining the query
// after choosing a campaign drops the selected <option> from the DOM and the
// browser silently falls back to the first remaining one — a different campaign
// than the one on screen a moment earlier.
export function filterCampaigns(
  list: SelectableCampaign[],
  query: string,
  keepId?: string,
): SelectableCampaign[] {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t !== '');
  if (tokens.length === 0) return list;
  return list.filter((c) => {
    if (keepId && c.id === keepId) return true;
    const haystack = `${c.name} ${c.channel} ${c.id}`.toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  });
}
