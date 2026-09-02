/**
 * `isHttpUrl` guards the Brief detail pages' "Referensi / Lampiran" link
 * (creative/briefs/[id], account/briefs/[id]) — before this, any non-URL
 * value (e.g. an AM typing "text" into that field) still rendered as a
 * clickable "Lihat" anchor, which navigated to a broken relative path
 * (`/creative/briefs/text`, 404) instead of doing nothing useful.
 */
import { describe, expect, it } from 'vitest';
import { isHttpUrl } from './url';

describe('isHttpUrl', () => {
  it('accepts http(s) URLs', () => {
    expect(isHttpUrl('https://drive.google.com/drive/folders/abc')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('  https://example.com  ')).toBe(true);
  });

  it('rejects plain text — the exact production bug (reference_attachments = "text")', () => {
    expect(isHttpUrl('text')).toBe(false);
    expect(isHttpUrl('tes')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });

  it('rejects a scheme-less or non-http(s) value', () => {
    expect(isHttpUrl('www.example.com')).toBe(false);
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
  });
});
