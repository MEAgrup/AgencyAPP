import { describe, expect, it } from 'vitest';
import { badgeTone } from './status';

describe('badgeTone', () => {
  it('[Unrespon] (L1/L4) reads amber, not gray — the substring heuristic below cannot catch it', () => {
    // "unrespon" matches none of the heuristic substrings (progress/review/
    // submit/approve/pass/block/fail/escalat/revision/cancel/void/drop), so
    // without the explicit EXACT_MAP entry this would fall through to 'gray'
    // — indistinguishable from a fresh, untouched [To Do].
    expect(badgeTone('[Unrespon]')).toBe('amber');
  });

  it('falls back to gray for an unrecognized status', () => {
    expect(badgeTone('[Some New Status]')).toBe('gray');
  });
});
