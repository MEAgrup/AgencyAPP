/**
 * Unit tests for the O37 read-path claim envelope (no DB required).
 *
 * `actorClaims` is the bridge between the verified JWT actor and the RLS
 * policies: every policy reads `auth.jwt() -> 'app_metadata' ->> '<key>'`, so a
 * wrong key or a stringified boolean silently turns into "no claim" and RLS
 * default-denies (or, worse for `od`/`director`, fails the `::boolean` cast).
 * These lock the envelope's shape to migration 20260723071013 /
 * `permission.actorFromClaims`.
 */
import { describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { actorClaims } from './db';

const actor = (over: Partial<permission.Role> = {}, employeeId = 'EMP-1'): permission.Actor => ({
  employeeId,
  role: permission.makeRole(over),
});

/** Parses the envelope back into the shape the SQL policies see. */
function appMetadata(a: permission.Actor): Record<string, unknown> {
  const parsed = JSON.parse(actorClaims(a)) as { app_metadata: Record<string, unknown> };
  return parsed.app_metadata;
}

describe('actorClaims', () => {
  it('nests the five CDPS claims under app_metadata (not user_metadata)', () => {
    const parsed = JSON.parse(actorClaims(actor({ division: 'Sales', level: 'staff' })));
    expect(Object.keys(parsed)).toEqual(['app_metadata']);
    expect(Object.keys(parsed.app_metadata).sort()).toEqual(
      ['director', 'division', 'employee_id', 'level', 'od'].sort(),
    );
  });

  it('carries employee_id, division and level verbatim', () => {
    const m = appMetadata(actor({ division: 'Marketing', level: 'lead' }, 'EMP-77'));
    expect(m.employee_id).toBe('EMP-77');
    expect(m.division).toBe('Marketing');
    expect(m.level).toBe('lead');
  });

  it('emits od/director as JSON booleans — jwt_is_od() casts with ::boolean', () => {
    const m = appMetadata(actor({ od: true, director: false }));
    expect(m.od).toBe(true);
    expect(m.director).toBe(false);
    expect(typeof m.od).toBe('boolean');
  });

  it('round-trips through actorFromClaims unchanged (no drift with the API side)', () => {
    const original = actor({ division: 'Finance', level: 'lead', od: true, director: true }, 'EMP-9');
    const back = permission.actorFromClaims(appMetadata(original));
    expect(back).toEqual(original);
  });

  it('keeps an unmapped (empty-division) actor empty rather than inventing scope', () => {
    const m = appMetadata(actor({}, 'EMP-NEW'));
    expect(m.division).toBe('');
    expect(m.level).toBe('');
    expect(m.od).toBe(false);
    expect(m.director).toBe(false);
  });

  // M15-C2: a client-contact Actor emits ONLY client_contact_id/client_id —
  // never the five employee claims — so every employee-keyed RLS predicate
  // evaluates false/null for it (jwt_client_contact_id()/jwt_client_id()
  // resolve instead). Mirrors the vendor Actor round-trip guarantee.
  it('emits ONLY client_contact_id/client_id for a client-contact Actor', () => {
    const contactActor: permission.Actor = {
      employeeId: '11111111-1111-1111-1111-111111111111',
      clientContactId: '11111111-1111-1111-1111-111111111111',
      clientId: 'CLI-202608-0001',
      role: permission.makeRole({}),
    };
    const m = appMetadata(contactActor);
    expect(Object.keys(m).sort()).toEqual(['client_contact_id', 'client_id']);
    expect(m.client_contact_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(m.client_id).toBe('CLI-202608-0001');
  });

  it('round-trips a client-contact Actor through actorFromClientContactClaims unchanged', () => {
    const original: permission.Actor = {
      employeeId: '22222222-2222-2222-2222-222222222222',
      clientContactId: '22222222-2222-2222-2222-222222222222',
      clientId: 'CLI-202608-0002',
      role: permission.makeRole({}),
    };
    const back = permission.actorFromClientContactClaims(appMetadata(original));
    expect(back).toEqual(original);
  });
});
