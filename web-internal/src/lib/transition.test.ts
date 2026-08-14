/**
 * Tests for the transition-result reader.
 *
 * The regression guarded here is the one that shipped: the API answers
 * `{ok, from, to}` (apps/api http.ts transitionResponse) while the pages read
 * `res.To`, so a perfectly successful "Mulai" reported "Status berpindah ke
 * undefined." The reader must take the lowercase contract, tolerate the retired
 * Go casing, and — crucially — never render the string "undefined".
 */
import { describe, expect, it } from 'vitest';
import { transitionFrom, transitionLabel, transitionTo } from './transition';

const WIRE = { ok: true, from: '[To Do]', to: '[In Progress]' };
const LEGACY = { From: '[To Do]', To: '[In Progress]' };

describe('transition reader', () => {
  it('reads the apps/api contract', () => {
    expect(transitionFrom(WIRE)).toBe('[To Do]');
    expect(transitionTo(WIRE)).toBe('[In Progress]');
    expect(transitionLabel(WIRE)).toBe('[To Do] → [In Progress]');
  });

  it('still reads the retired Go casing', () => {
    expect(transitionLabel(LEGACY)).toBe('[To Do] → [In Progress]');
  });

  it('renders an em dash, never "undefined", for a body missing both casings', () => {
    for (const body of [{}, null, undefined, { ok: true }]) {
      expect(transitionLabel(body)).toBe('— → —');
      expect(transitionLabel(body)).not.toContain('undefined');
    }
  });
});
