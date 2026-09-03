/**
 * The two pure decisions the insight editor makes in the browser.
 *
 * `canPublishReportUi` is the one worth a test: it is deliberately NOT a full
 * copy of the server's `report.canWriteReport`, because this page does not know
 * who the client's owning AM is. What it must get right is the part it CAN know
 * — OD never writes, and a division outside Account never writes a client
 * report — while still showing the controls to the Account staffer they exist
 * for, and letting the server refuse if the client is not theirs.
 */
import { describe, expect, it } from 'vitest';
import {
  canPublishReportUi, labelStatusPublikasi, STATUS_DICABUT, STATUS_DRAF, STATUS_TERBIT,
} from './report';
import { type Role } from './types';

const role = (p: Partial<Role>): Role => ({
  division: p.division ?? '', level: p.level ?? 'staff', od: p.od ?? false, director: p.director ?? false,
});

describe('canPublishReportUi', () => {
  it('lets Account staff and leads see the controls', () => {
    expect(canPublishReportUi(role({ division: 'Account', level: 'staff' }))).toBe(true);
    expect(canPublishReportUi(role({ division: 'Account', level: 'lead' }))).toBe(true);
  });

  it('lets a Director through from any division', () => {
    expect(canPublishReportUi(role({ division: 'Creative', director: true }))).toBe(true);
  });

  it('never lets OD write — it reads everywhere and writes nowhere', () => {
    // The layered OD role sits on a normal account, so it can carry an Account
    // division too. The od flag must win over that.
    expect(canPublishReportUi(role({ division: 'Account', level: 'lead', od: true }))).toBe(false);
  });

  it('keeps other divisions out', () => {
    expect(canPublishReportUi(role({ division: 'Creative', level: 'lead' }))).toBe(false);
    expect(canPublishReportUi(role({ division: 'Ads', level: 'staff' }))).toBe(false);
    expect(canPublishReportUi(role({ division: '', level: '' }))).toBe(false);
  });

  it('refuses while the role is still loading (null), never defaults to allowed', () => {
    expect(canPublishReportUi(null)).toBe(false);
  });
});

describe('labelStatusPublikasi', () => {
  it('says plainly whether the client can see it', () => {
    expect(labelStatusPublikasi(STATUS_TERBIT)).toBe('Terbit ke klien');
    expect(labelStatusPublikasi(STATUS_DICABUT)).toBe('Dicabut');
    expect(labelStatusPublikasi(STATUS_DRAF)).toBe('Draf — belum dilihat klien');
  });

  it('treats an unknown or not-yet-loaded status as a draft', () => {
    // The list badge renders before the per-report status arrives. Reading
    // "Draf" a moment early is harmless; reading "Terbit" early would tell the
    // AM the client already has it.
    expect(labelStatusPublikasi('')).toBe('Draf — belum dilihat klien');
    expect(labelStatusPublikasi('[Sesuatu Yang Lain]')).toBe('Draf — belum dilihat klien');
  });
});
