import { describe, expect, it } from 'vitest';
import { CSV_BOM, CSV_DELIMITER, csvEscape, toCsv } from './csv';

describe('csvEscape', () => {
  it('quotes a field containing the delimiter (;)', () => {
    expect(csvEscape('a;b')).toBe('"a;b"');
  });

  it('still quotes a comma too — extends the web-internal regex, does not replace it', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes a field containing a newline', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('leaves a plain field untouched', () => {
    expect(csvEscape('Toko Sederhana')).toBe('Toko Sederhana');
  });
});

describe('toCsv', () => {
  it('renders BOM + header + rows, ;-delimited, CRLF-terminated', () => {
    const out = toCsv(['id', 'nama'], [['LD-1', 'Toko A'], ['LD-2', 'Toko; B']]);
    expect(out).toBe(
      `${CSV_BOM}id${CSV_DELIMITER}nama\r\nLD-1${CSV_DELIMITER}Toko A\r\nLD-2${CSV_DELIMITER}"Toko; B"\r\n`,
    );
  });

  it('never emits a sep=; directive line', () => {
    const out = toCsv(['a'], [['1']]);
    expect(out.split('\r\n')[0]).not.toMatch(/^sep=/);
  });
});
