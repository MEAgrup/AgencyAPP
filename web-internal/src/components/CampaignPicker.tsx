'use client';

/**
 * Campaign picker for the lead-intake doors (M1 §9.3 Origin Campaign).
 *
 * Replaces a free-text "Campaign ID" box that asked a salesperson to type
 * `CMP-YYYYMM-NNNN` from memory. Nobody does that, so the field went in empty and
 * the campaign that actually produced the lead scored zero in M2 (Lead-by-
 * Dashboard, CPL, ROAS). Here the campaigns are listed, searchable, and the "this
 * lead is not from a campaign" case is an explicit CHOICE rather than a blank —
 * which is what makes the field enforceable for ad-sourced Sources.
 *
 * A search box over a <select> rather than a custom combobox: it is one native
 * control per job (type to narrow, then pick), keyboard- and screen-reader
 * -correct with no focus management of our own, and the filtering rule is a pure
 * function that is unit-tested (lib/campaign-picker.ts).
 *
 * EVERY campaign is listed, whatever its status (owner decision 2026-08-04),
 * grouped so a Closed or Draft one is never mistaken for live: a campaign missing
 * from this dropdown cannot be attributed at all, and its M2 performance then
 * stays permanently zero — indistinguishable from a campaign that truly failed.
 * The same reasoning puts the derived funnel under the picker: this dropdown is
 * the only campaign surface Sales has, so the salesperson whose choice fills
 * those numbers can see them. They are read-only by construction (house rule 4).
 *
 * Presentational + fully controlled: the owner holds `value` and does the
 * fetching, so the same picker serves any intake form.
 */

import { useMemo, useState } from 'react';
import {
  OUTSIDE_CAMPAIGN,
  campaignLabel,
  filterCampaigns,
  funnelSummary,
  groupCampaigns,
} from '@/lib/campaign-picker';
import type { SelectableCampaign } from '@/lib/marketing';

interface Props {
  /** null while loading / after a failed load. */
  campaigns: SelectableCampaign[] | null;
  loading: boolean;
  /** Verbatim message from a failed load (already BI where the server sent one). */
  error: string | null;
  /** '' (nothing picked) | OUTSIDE_CAMPAIGN | a CMP- id. */
  value: string;
  onChange: (value: string) => void;
  /** True when the chosen Source makes Origin Campaign mandatory (M1 §9.3). */
  required: boolean;
  disabled?: boolean;
  /** id of the <select>, so the caller's own label/tests can target it. */
  id?: string;
}

export default function CampaignPicker({
  campaigns,
  loading,
  error,
  value,
  onChange,
  required,
  disabled,
  id = 'campaign-picker',
}: Props) {
  const [query, setQuery] = useState('');

  // Memoised so the empty-list fallback keeps a stable identity — otherwise the
  // filter below re-runs on every render (and eslint's exhaustive-deps says so).
  const list = useMemo(() => campaigns ?? [], [campaigns]);
  // Keep the picked campaign in the option list even when the query excludes it,
  // or narrowing the search after choosing would silently reselect another one.
  const shown = useMemo(() => filterCampaigns(list, query, value), [list, query, value]);
  const groups = useMemo(() => groupCampaigns(shown), [shown]);
  const picked = value !== '' && value !== OUTSIDE_CAMPAIGN ? list.find((c) => c.id === value) : undefined;

  return (
    <div className="field">
      <label htmlFor={id}>
        Campaign{required ? ' (wajib untuk source ini)' : ' (opsional)'}
      </label>

      {/* Search is a plain filter over the loaded list — no request per keystroke. */}
      <input
        id={`${id}-search`}
        type="search"
        placeholder="Cari campaign — nama, channel, atau ID"
        aria-label="Cari campaign"
        value={query}
        disabled={disabled || loading || list.length === 0}
        onChange={(e) => setQuery(e.target.value)}
      />

      <select
        id={id}
        value={value}
        required={required}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          {loading ? 'Memuat campaign...' : '— pilih campaign —'}
        </option>
        {/* The escape hatch. Explicit, and audited server-side as
            outside_campaign, so "no campaign" is a statement rather than a gap. */}
        <option value={OUTSIDE_CAMPAIGN}>Di luar campaign marketing (lead mandiri)</option>
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.items.map((c) => (
              <option key={c.id} value={c.id}>
                {campaignLabel(c)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {error && (
        <span className="muted" style={{ fontSize: 12 }} role="alert">
          Daftar campaign gagal dimuat: {error}
        </span>
      )}
      {!loading && !error && list.length === 0 && (
        <span className="muted" style={{ fontSize: 12 }}>
          Belum ada campaign dari Marketing. Pilih &ldquo;Di luar campaign marketing&rdquo;, atau minta
          Marketing membuat campaign-nya lebih dulu.
        </span>
      )}
      {!loading && !error && list.length > 0 && query !== '' && shown.length === 0 && (
        <span className="muted" style={{ fontSize: 12 }}>
          Tidak ada campaign yang cocok dengan &ldquo;{query}&rdquo;.
        </span>
      )}
      {/* The funnel of the picked campaign: what this choice has produced so far.
          Derived from the attempt log server-side — Sales fills it by qualifying
          (or not-qualifying) attempts, never by typing here. */}
      {picked && (
        <span className="muted" style={{ fontSize: 12 }} data-testid={`${id}-funnel`}>
          {funnelSummary(picked)}
        </span>
      )}
      {picked && picked.status !== 'Active' && (
        <span className="muted" style={{ fontSize: 12 }}>
          Status campaign ini <strong>{picked.status}</strong> — lead tetap teratribusi ke
          campaign-nya, dan status campaign tidak berubah karena registrasi ini.
        </span>
      )}
      {value === OUTSIDE_CAMPAIGN && (
        <span className="muted" style={{ fontSize: 12 }}>
          Lead dicatat tanpa Origin Campaign (tidak dihitung di performa campaign Marketing).
        </span>
      )}
    </div>
  );
}
