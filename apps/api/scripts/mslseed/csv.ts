/**
 * CSV parsing for the MSL v2 calculator canonical seed
 * (`supabase/seed/msl_kalkulator.csv`, worksheet
 * `docs/handoff/MSL_KALKULATOR_VALIDASI.md`).
 *
 * Port of `archive/backend-go/cmd/mslseed/csv.go`. Pure file-level parsing only: no DB, no
 * validation of field values (that is `rowToServiceInput` in validate.ts).
 *
 * Go got RFC 4180 handling from `encoding/csv`; JS has no stdlib CSV reader, so
 * `parseRecords` implements the same subset by hand. It MUST support quoted
 * fields with embedded newlines — the seed's `description` column holds
 * multi-line verbatim text from the source sheet, so a naive line-split parser
 * silently shreds the file.
 */

/** The exact column order the seed CSV must have. */
export const WANT_HEADER = [
  'service_key', 'name', 'category', 'unit', 'min_qty', 'unit_price',
  'pricing_mode', 'apply_ppn', 'frequency', 'price_note', 'commission_rule',
  'effective_from', 'active', 'description', 'source_row',
] as const;

/**
 * One raw CSV data row (untrimmed, unvalidated field strings) plus its record
 * ordinal for error reporting.
 *
 * `line` counts RECORDS, not physical file lines (header = 1, first data row =
 * 2) — exactly what Go's counter produced, and the only stable addressing when
 * `description` fields span many physical lines.
 */
export interface Row {
  line: number;
  serviceKey: string;
  name: string;
  category: string;
  unit: string;
  minQty: string;
  unitPrice: string;
  pricingMode: string;
  applyPPN: string;
  frequency: string;
  priceNote: string;
  commissionRule: string;
  effectiveFrom: string;
  active: string;
  description: string;
  sourceRow: string;
}

/**
 * parseRecords splits RFC 4180 CSV text into records of raw fields.
 *
 * Supported (the subset the seed file uses, matching `encoding/csv` defaults):
 * comma separator, `"`-quoted fields, `""` as an escaped quote inside a quoted
 * field, embedded newlines inside quoted fields, and CRLF or LF record
 * separators. As in Go, a CRLF *inside* a quoted field is normalized to LF so
 * the stored text does not depend on the checkout's line endings. A trailing
 * newline does not produce a final empty record.
 */
export function parseRecords(text: string): string[][] {
  // Strip a UTF-8 BOM: a spreadsheet export can carry one, and it would
  // otherwise become part of the first header cell ("﻿service_key").
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = (): void => {
    record.push(field);
    field = '';
  };
  const endRecord = (): void => {
    endField();
    records.push(record);
    record = [];
  };

  while (i < text.length) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { // "" -> literal quote
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      if (c === '\r' && text[i + 1] === '\n') { // normalize CRLF inside quotes
        field += '\n';
        i += 2;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"' && field === '') { // a quote only opens a field at its start
      quoted = true;
      i++;
      continue;
    }
    if (c === ',') {
      endField();
      i++;
      continue;
    }
    if (c === '\n') {
      endRecord();
      i++;
      continue;
    }
    if (c === '\r' && text[i + 1] === '\n') {
      endRecord();
      i += 2;
      continue;
    }
    field += c;
    i++;
  }

  // Flush the last record unless the file ended exactly on a record separator.
  if (quoted) {
    throw new Error('parse csv: tanda kutip tidak ditutup di akhir berkas');
  }
  if (field !== '' || record.length > 0) {
    endRecord();
  }
  return records;
}

/**
 * parseCsv reads the seed CSV text, checking the header matches WANT_HEADER
 * exactly and every data row has all 15 columns. It does NOT validate field
 * values. Blank records (a stray empty line) are skipped rather than reported
 * as a column-count error, mirroring `encoding/csv`.
 */
export function parseCsv(text: string): Row[] {
  const records = parseRecords(text);
  if (records.length === 0) {
    throw new Error('baca header: berkas kosong');
  }
  const header = records[0];
  if (header.length !== WANT_HEADER.length) {
    throw new Error(`header: ${header.length} kolom, ingin ${WANT_HEADER.length} (${WANT_HEADER.join(',')})`);
  }
  header.forEach((h, idx) => {
    if (h !== WANT_HEADER[idx]) {
      throw new Error(`header kolom ${idx + 1}: ${JSON.stringify(h)}, ingin ${JSON.stringify(WANT_HEADER[idx])}`);
    }
  });

  const rows: Row[] = [];
  let line = 1; // header consumed above
  for (const rec of records.slice(1)) {
    line++;
    if (rec.length === 1 && rec[0] === '') {
      continue; // blank line
    }
    if (rec.length !== WANT_HEADER.length) {
      throw new Error(`baris ${line}: ${rec.length} kolom, ingin ${WANT_HEADER.length}`);
    }
    rows.push({
      line,
      serviceKey: rec[0],
      name: rec[1],
      category: rec[2],
      unit: rec[3],
      minQty: rec[4],
      unitPrice: rec[5],
      pricingMode: rec[6],
      applyPPN: rec[7],
      frequency: rec[8],
      priceNote: rec[9],
      commissionRule: rec[10],
      effectiveFrom: rec[11],
      active: rec[12],
      description: rec[13],
      sourceRow: rec[14],
    });
  }
  return rows;
}
