import { describe, expect, it } from 'vitest';
import {
  CHANNEL_RISK_SUGGESTIONS,
  GENERIC_RISK_SUGGESTIONS,
  getRiskSuggestions,
} from './strategi-risk-suggestions';

describe('getRiskSuggestions', () => {
  it('returns just the generic six for a Strategi with no channels yet', () => {
    const out = getRiskSuggestions([], []);
    expect(out).toHaveLength(GENERIC_RISK_SUGGESTIONS.length);
    expect(out.map((s) => s.risiko)).toEqual(GENERIC_RISK_SUGGESTIONS.map((s) => s.risiko));
  });

  it('an unrecognized channel string contributes nothing beyond the generic six', () => {
    const out = getRiskSuggestions(['Not A Real Channel'], []);
    expect(out).toHaveLength(GENERIC_RISK_SUGGESTIONS.length);
  });

  it('adds channel-specific suggestions for a contracted channel', () => {
    const out = getRiskSuggestions(['Shopee'], []);
    const risikoTexts = out.map((s) => s.risiko);
    for (const s of CHANNEL_RISK_SUGGESTIONS.Shopee) {
      expect(risikoTexts).toContain(s.risiko);
    }
    for (const s of GENERIC_RISK_SUGGESTIONS) {
      expect(risikoTexts).toContain(s.risiko);
    }
  });

  it('never suggests more than one channel set per channel not contracted', () => {
    const out = getRiskSuggestions(['Shopee'], []);
    for (const s of CHANNEL_RISK_SUGGESTIONS['TikTok Shop']) {
      expect(out.map((x) => x.risiko)).not.toContain(s.risiko);
    }
  });

  it('drops a suggestion already present in the draft (case/whitespace-insensitive)', () => {
    const out = getRiskSuggestions(['Shopee'], [
      { risiko: '  stok kosong pada sku utama  ' },
    ]);
    expect(out.map((s) => s.risiko)).not.toContain('Stok kosong pada SKU utama');
  });

  it('deduplicates when two contracted channels share no overlapping text (sanity: no duplicate risiko across the result)', () => {
    const out = getRiskSuggestions(['Shopee', 'TikTok Shop', 'Tokopedia', 'Lazada', 'Website'], []);
    const texts = out.map((s) => normalize(s.risiko));
    expect(new Set(texts).size).toBe(texts.length);
  });
});

function normalize(s: string) {
  return s.trim().toLowerCase();
}
