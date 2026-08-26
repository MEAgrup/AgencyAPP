import { describe, expect, it } from 'vitest';
import { diagnosaDraftToPayload, type DiagnosaDraftAll } from './SectionC';

// Regression for the STRTG "internal server error" bug reported after applying
// MEA AM Cockpit data (owner QA 2026-08-26): `applyCockpitToDiagnosa`
// (strategi-cockpit-import.ts) fills a quick_win row with `dampak_diharapkan:
// ''` and a prasyarat_klien row with `pic_klien: ''` — the Cockpit tool has no
// data for either field, so it leaves them for the AM to type. The old
// converter only checked the FIRST field of each row (`aksi`/`item`), so these
// half-filled rows reached `PUT /strategi/{id}/diagnosa` and hit
// `ck_strqw_isi` / `ck_strpreq_isi` (every text column on those tables is
// NOT NULL + non-empty) — a raw Postgres CHECK violation, not a domain
// ValidationError, so `apps/api/src/lib/http.ts#mapError` fell through to the
// unmapped-error branch and returned the opaque "internal server error" the
// AM saw, instead of leaving the row unsaved like every other partial-save
// path in this form (Section B baseline months, Section D GMV cells).
const blank = (): DiagnosaDraftAll => ({
  diagnosa: [],
  quick_wins: [],
  risiko_struktural: [],
  prasyarat_klien: [],
});

describe('diagnosaDraftToPayload (partial rows never reach the CHECK-constrained tables)', () => {
  it('drops a quick win missing dampak_diharapkan (Cockpit import leaves it blank)', () => {
    const draft = blank();
    draft.quick_wins = [
      { aksi: 'A2 Aktivasi kreator terdaftar', channel: 'TikTok Shop', pic_divisi: 'KOL', dampak_diharapkan: '' },
    ];
    expect(diagnosaDraftToPayload(draft).quick_wins).toEqual([]);
  });

  it('drops a prasyarat klien missing pic_klien (Cockpit import leaves it blank)', () => {
    const draft = blank();
    draft.prasyarat_klien = [
      { item: 'Konfirmasi margin bersih riil per SKU', pic_klien: '', deadline: '' },
    ];
    expect(diagnosaDraftToPayload(draft).prasyarat_klien).toEqual([]);
  });

  it('keeps a quick win once every required field is filled', () => {
    const draft = blank();
    draft.quick_wins = [
      { aksi: 'A2 Aktivasi kreator terdaftar', channel: 'TikTok Shop', pic_divisi: 'KOL', dampak_diharapkan: '+5 kreator posting/minggu' },
    ];
    expect(diagnosaDraftToPayload(draft).quick_wins).toHaveLength(1);
  });

  it('keeps a prasyarat klien once pic_klien is filled', () => {
    const draft = blank();
    draft.prasyarat_klien = [
      { item: 'Konfirmasi margin bersih riil per SKU', pic_klien: 'Owner klien', deadline: '' },
    ];
    expect(diagnosaDraftToPayload(draft).prasyarat_klien).toHaveLength(1);
  });
});
