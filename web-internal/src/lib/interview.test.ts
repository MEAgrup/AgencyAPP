/**
 * Riset Awal (langkah 1 "Kelola Klien") — the FE display helpers.
 *
 * The duration itself is derived server-side; what these own is how it READS.
 * The rule worth pinning is the `—` one: a step still running has no duration,
 * and rendering "0 menit" would report finished work that has not finished.
 */
import { describe, expect, it } from 'vitest';
import {
  RISET_AWAL_STATUS,
  SLA_STATUS,
  SLA_STATUS_LABEL,
  formatAmbang,
  formatDurasiMenit,
  formatHariKerja,
  menitBerjalanSejak,
  risetAwalStatusTone,
  slaStatusTone,
} from './interview';

describe('formatDurasiMenit', () => {
  it('renders minutes below an hour', () => {
    expect(formatDurasiMenit(0)).toBe('0 menit');
    expect(formatDurasiMenit(1)).toBe('1 menit');
    expect(formatDurasiMenit(59)).toBe('59 menit');
  });

  it('renders hours (+ minutes) below a day', () => {
    expect(formatDurasiMenit(60)).toBe('1 jam');
    expect(formatDurasiMenit(95)).toBe('1 jam 35 menit');
    expect(formatDurasiMenit(1439)).toBe('23 jam 59 menit');
  });

  it('renders days (+ hours) above a day — research often spans days', () => {
    expect(formatDurasiMenit(1440)).toBe('1 hari');
    expect(formatDurasiMenit(2880)).toBe('2 hari');
    expect(formatDurasiMenit(1440 + 150)).toBe('1 hari 2 jam');
  });

  it('renders — for an unknown duration, never a fabricated zero', () => {
    expect(formatDurasiMenit(null)).toBe('—');
    expect(formatDurasiMenit(undefined)).toBe('—');
    expect(formatDurasiMenit(-5)).toBe('—');
    expect(formatDurasiMenit(Number.NaN)).toBe('—');
  });
});

describe('menitBerjalanSejak', () => {
  const mulai = '2026-08-12T01:00:00.000Z';

  it('floors the elapsed minutes against the supplied clock', () => {
    expect(menitBerjalanSejak(mulai, new Date('2026-08-12T01:00:59.000Z'))).toBe(0);
    expect(menitBerjalanSejak(mulai, new Date('2026-08-12T02:30:00.000Z'))).toBe(90);
  });

  it('is null for a missing/unparseable start or a clock behind it', () => {
    expect(menitBerjalanSejak(null)).toBeNull();
    expect(menitBerjalanSejak('bukan tanggal', new Date('2026-08-12T02:00:00.000Z'))).toBeNull();
    expect(menitBerjalanSejak(mulai, new Date('2026-08-12T00:00:00.000Z'))).toBeNull();
  });
});

describe('risetAwalStatusTone', () => {
  it('mirrors the two machine states, and stays neutral for anything else', () => {
    expect(risetAwalStatusTone(RISET_AWAL_STATUS.Berjalan)).toBe('blue');
    expect(risetAwalStatusTone(RISET_AWAL_STATUS.Selesai)).toBe('green');
    expect(risetAwalStatusTone(null)).toBe('gray');
  });
});

describe('timeline SLA display', () => {
  it('renders a range, and collapses it when target equals the limit', () => {
    expect(formatAmbang(2, 3)).toBe('2–3 hari kerja');
    expect(formatAmbang(5, 7)).toBe('5–7 hari kerja');
    expect(formatAmbang(1, 1)).toBe('1 hari kerja');
  });

  it('renders elapsed working days, and — when the step has not started', () => {
    expect(formatHariKerja(0)).toBe('0 hari kerja');
    expect(formatHariKerja(4)).toBe('4 hari kerja');
    expect(formatHariKerja(null)).toBe('—');
    expect(formatHariKerja(undefined)).toBe('—');
  });

  it('tones only the three decided statuses; unstarted and N/A stay neutral', () => {
    expect(slaStatusTone(SLA_STATUS.TepatWaktu)).toBe('green');
    expect(slaStatusTone(SLA_STATUS.MendekatiBatas)).toBe('amber');
    expect(slaStatusTone(SLA_STATUS.Terlambat)).toBe('red');
    expect(slaStatusTone(SLA_STATUS.BelumMulai)).toBe('gray');
    expect(slaStatusTone(SLA_STATUS.TidakBerlaku)).toBe('gray');
  });

  it('labels every status the server can send — no raw enum reaches the screen', () => {
    for (const status of Object.values(SLA_STATUS)) {
      expect(SLA_STATUS_LABEL[status]).toBeTruthy();
    }
  });
});
