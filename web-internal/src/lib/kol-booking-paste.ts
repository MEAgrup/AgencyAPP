/**
 * Tempel/unggah Excel ke grid "Buat Booking Baru" KOL (M9 §4; keputusan
 * `docs/decisions/2026-10-20-kol-booking-tempel-excel.md`).
 *
 * Modul ini MURNI sisi browser: ia hanya mengubah teks tempelan (TSV dari
 * Excel/Sheets, atau CSV) dan berkas `.xlsx`/`.csv` menjadi baris grid yang
 * sama persis dengan yang diketik manual. Tidak ada endpoint baru — halaman
 * tetap mengirim satu `createBooking` per baris, dan validasi wajib tetap
 * milik domain (`packages/domain/src/kol.ts` `createBooking`). Validasi di
 * sini (`validateRow`) adalah pra-cek klien yang SAMA yang dipakai tombol
 * "Buat Booking", jadi baris yang lolos tempel juga lolos pra-cek submit.
 *
 * Platform, Source Pool, dan Coordinator sengaja TIDAK dibaca dari berkas:
 * satu brief = satu nilai untuk ketiganya (M9 §4).
 */

/** Batas baris per submit — dinaikkan 20 → 50 (keputusan Yohan, 2026-10-20). */
export const BATCH_MAX = 50;

/** Field per-creator di grid (tanpa `key` React). Semua string mentah. */
export interface CreatorRowInput {
  creator_name: string;
  creator_handle: string;
  niche: string;
  agreed_rate: string; // decimal string
  qty_video: string; // integer string ("" => 0)
  qty_live: string; // integer string ("" => 0)
}

export interface CreatorRow extends CreatorRowInput {
  key: number;
}

export function emptyRow(key: number): CreatorRow {
  return { key, creator_name: '', creator_handle: '', niche: '', agreed_rate: '', qty_video: '', qty_live: '' };
}

/** A row with nothing typed is skipped silently at submit (not an error). */
export function isRowBlank(r: CreatorRowInput): boolean {
  return (
    r.creator_name.trim() === '' &&
    r.creator_handle.trim() === '' &&
    r.niche.trim() === '' &&
    r.agreed_rate.trim() === '' &&
    r.qty_video.trim() === '' &&
    r.qty_live.trim() === ''
  );
}

/** Client-side validation of one intended row; returns a BI-style message or null. */
export function validateRow(r: CreatorRowInput): string | null {
  if (r.creator_name.trim() === '') return '[nama creator wajib diisi]';
  const rate = Number(r.agreed_rate);
  // 0 sah: creator barter (dibayar produk) — DECISIONS 2026-10-23.
  if (r.agreed_rate.trim() === '' || !Number.isFinite(rate) || rate < 0) return '[agreed rate wajib diisi & tidak boleh negatif]';
  for (const q of [r.qty_video, r.qty_live]) {
    if (q.trim() === '') continue;
    const n = Number(q);
    if (!Number.isInteger(n) || n < 0) return '[jumlah video/live harus bilangan bulat tidak negatif]';
  }
  return null;
}

/** Urutan kolom template — juga urutan default bila tempelan tanpa header. */
export const BOOKING_COLUMNS = ['Nama Creator', 'Handle', 'Niche', 'Agreed Rate', 'Qty Video', 'Qty Live'] as const;

const FIELD_ORDER: (keyof CreatorRowInput)[] = [
  'creator_name',
  'creator_handle',
  'niche',
  'agreed_rate',
  'qty_video',
  'qty_live',
];

/** CSV template "Unduh template" — header saja, dibuat di klien. */
export const BOOKING_TEMPLATE_CSV = `${BOOKING_COLUMNS.join(',')}\r\n`;

/**
 * "Nama Creator *" / "agreed rate (Rp)" / "QTY_VIDEO" → kunci yang sama: huruf
 * kecil, hanya a-z0-9, akhiran "rp" dibuang (header grid berbunyi
 * "Agreed Rate (Rp) *", jadi menyalin header dari grid pun tetap cocok).
 */
function normHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/rp$/, '');
}

const HEADER_INDEX = new Map<string, number>(BOOKING_COLUMNS.map((c, i) => [normHeader(c), i]));

/**
 * Rate dari spreadsheet → string desimal yang diterima `money.parse` domain
 * (titik sebagai pemisah desimal, maks 2 digit pecahan, tanpa pemisah ribuan).
 *
 * `Rp 1.500.000` / `1.500.000` / `1500000` / `1.500.000,00` / `1,500,000.00`
 * → `1500000`. Bila ada titik DAN koma, yang terakhir adalah pemisah desimal.
 * Bila hanya satu jenis dan polanya kelompok-tiga-digit, ia pemisah ribuan
 * (rate Rp 1,5 tidak masuk akal). Teks yang tidak dikenali dikembalikan apa
 * adanya supaya `validateRow` yang menolaknya dengan pesan baku.
 */
export function normalizeRate(raw: string): string {
  let s = raw.trim().replace(/^(rp\.?|idr)/i, '').replace(/[\s ]/g, '');
  if (s === '') return '';
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const grouped = new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`);
    if (grouped.test(s)) s = s.split(sep).join('');
    else if (sep === ',') s = s.replace(',', '.');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return raw.trim();
  // Buang nol pecahan ("1500000.00" → "1500000"); sisakan maks 2 digit.
  const [intPart, frac = ''] = s.split('.');
  const f = frac.replace(/0+$/, '');
  if (f.length > 2) return raw.trim();
  const i = intPart.replace(/^0+(?=\d)/, '');
  return f === '' ? i : `${i}.${f}`;
}

/** Pemecah CSV/TSV kecil yang paham tanda kutip ("a,b", "" sebagai kutip). */
function splitDelimited(text: string, delim: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

/** Tab = tempelan Excel/Sheets; selain itu CSV (`;` untuk Excel berlokal Indonesia). */
function detectDelimiter(text: string): string {
  if (text.includes('\t')) return '\t';
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const outside = first.replace(/"[^"]*"/g, '');
  const semis = (outside.match(/;/g) ?? []).length;
  const commas = (outside.match(/,/g) ?? []).length;
  return semis > commas ? ';' : ',';
}

export interface ParseError {
  /** Nomor baris DATA (1 = baris pertama sesudah header), sama seperti di spreadsheet tanpa header. */
  baris: number;
  pesan: string;
  /** Isi baris yang gagal — halaman tetap memasukkannya ke grid supaya bisa diperbaiki di tempat. */
  row?: CreatorRowInput;
}

export interface ParseResult {
  rows: CreatorRowInput[];
  errors: ParseError[];
}

/**
 * Inti parse atas tabel sel (dipakai teks tempelan DAN `.xlsx`).
 *
 * `maxRows` = sisa kapasitas grid; baris tidak kosong (valid maupun tidak)
 * memakan kapasitas karena keduanya masuk ke grid. Kelebihannya ditolak
 * dengan SATU error "melebihi batas" pada baris pertama yang terbuang.
 */
export function parseBookingTable(table: unknown[][], maxRows: number = BATCH_MAX): ParseResult {
  const cells = table.map((r) => r.map((c) => (c == null ? '' : String(c)).trim()));
  const firstIdx = cells.findIndex((r) => r.some((c) => c !== ''));
  if (firstIdx < 0) return { rows: [], errors: [] };

  // Header opsional: dikenali bila ada SATU saja sel yang cocok dengan nama kolom.
  let colMap: (number | undefined)[] = FIELD_ORDER.map((_, i) => i);
  let dataStart = firstIdx;
  const head = cells[firstIdx].map(normHeader);
  if (head.some((h) => HEADER_INDEX.has(h))) {
    colMap = FIELD_ORDER.map((_, field) => {
      const at = head.findIndex((h) => HEADER_INDEX.get(h) === field);
      return at >= 0 ? at : undefined;
    });
    dataStart = firstIdx + 1;
  }

  const rows: CreatorRowInput[] = [];
  const errors: ParseError[] = [];
  let used = 0;
  let overflowFrom = 0;
  let overflowCount = 0;
  for (let i = dataStart; i < cells.length; i++) {
    const baris = i - dataStart + 1;
    const src = cells[i];
    const row = {} as CreatorRowInput;
    FIELD_ORDER.forEach((field, f) => {
      const at = colMap[f];
      row[field] = at === undefined ? '' : (src[at] ?? '');
    });
    if (isRowBlank(row)) continue;
    row.agreed_rate = normalizeRate(row.agreed_rate);
    if (used >= maxRows) {
      if (overflowCount === 0) overflowFrom = baris;
      overflowCount++;
      continue;
    }
    used++;
    const msg = validateRow(row);
    if (msg) errors.push({ baris, pesan: msg, row });
    else rows.push(row);
  }
  if (overflowCount > 0) {
    errors.push({
      baris: overflowFrom,
      pesan: `[melebihi batas ${BATCH_MAX} baris per simpan — ${overflowCount} baris mulai baris ${overflowFrom} tidak dimasukkan]`,
    });
  }
  return { rows, errors };
}

/** Teks tempelan (TSV dari Excel/Sheets) atau isi CSV → baris grid + error per baris. */
export function parseBookingRows(text: string, maxRows: number = BATCH_MAX): ParseResult {
  const clean = text.replace(/^﻿/, '');
  return parseBookingTable(splitDelimited(clean, detectDelimiter(clean)), maxRows);
}

/**
 * Berkas `.csv` dibaca sebagai teks; `.xlsx`/`.xls` lewat `xlsx` (sheet
 * PERTAMA saja, sel sebagai teks tampilan — sama seperti `adsscanner.ts`).
 */
export async function readBookingFile(file: File, maxRows: number = BATCH_MAX): Promise<ParseResult> {
  if (/\.csv$/i.test(file.name)) {
    return parseBookingRows(await file.text(), maxRows);
  }
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const first = wb.SheetNames[0];
  if (!first) return { rows: [], errors: [] };
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[first], { header: 1, raw: false, defval: '' });
  return parseBookingTable(aoa, maxRows);
}
