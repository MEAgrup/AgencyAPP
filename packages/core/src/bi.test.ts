import { describe, expect, it } from 'vitest';
import {
  INCOMPLETE_DATA,
  TRANSITION_NOT_ALLOWED,
  TRANSITION_ROLE_DENIED,
  bracket,
  isBracketed,
} from './bi';

describe('house-wide BI constants (exact strings)', () => {
  it('INCOMPLETE_DATA matches CLAUDE.md #5 default verbatim', () => {
    expect(INCOMPLETE_DATA).toBe('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
  });

  it('TRANSITION_NOT_ALLOWED ports statemachine.DefaultBlockMessage verbatim', () => {
    expect(TRANSITION_NOT_ALLOWED).toBe('[transisi status tidak diizinkan]');
  });

  it('TRANSITION_ROLE_DENIED ports statemachine.RoleDeniedMessage verbatim', () => {
    expect(TRANSITION_ROLE_DENIED).toBe('[anda tidak memiliki akses untuk melakukan transisi ini]');
  });

  it('all core constants satisfy the [...] house shape', () => {
    for (const m of [INCOMPLETE_DATA, TRANSITION_NOT_ALLOWED, TRANSITION_ROLE_DENIED]) {
      expect(isBracketed(m)).toBe(true);
    }
  });
});

describe('isBracketed', () => {
  it.each([
    ['[ok]', true],
    ['[data tidak lengkap]', true],
    ['bare message', false],
    ['[]', false], // empty content is not a valid house message
    ['[unclosed', false],
    ['unopened]', false],
    ['', false],
  ])('isBracketed(%j) = %s', (input, expected) => {
    expect(isBracketed(input)).toBe(expected);
  });
});

describe('bracket', () => {
  it('wraps a bare message', () => {
    expect(bracket('data tidak lengkap')).toBe('[data tidak lengkap]');
  });

  it('is idempotent on already-bracketed input', () => {
    expect(bracket('[data tidak lengkap]')).toBe('[data tidak lengkap]');
    expect(bracket(INCOMPLETE_DATA)).toBe(INCOMPLETE_DATA);
  });
});
