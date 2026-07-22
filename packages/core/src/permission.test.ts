// Ported 1:1 from backend/internal/core/permission/permission_test.go.
import { describe, expect, it } from 'vitest';
import {
  type Actor,
  canManageAdmin,
  canReadAll,
  canReadDivision,
  canWrite,
  isLead,
  makeRole,
} from './permission.js';

const actor = (employeeId: string, role: Parameters<typeof makeRole>[0]): Actor => ({
  employeeId,
  role: makeRole(role),
});

describe('role matrix', () => {
  const staff = actor('S', { division: 'Creative', level: 'staff' });
  const lead = actor('L', { division: 'Creative', level: 'lead' });
  const od = actor('O', { od: true });
  const director = actor('D', { director: true });
  // Layered case: one employee is Creative Staff AND OD.
  const staffOD = actor('SO', { division: 'Creative', level: 'staff', od: true });

  const cases: Array<{
    name: string;
    a: Actor;
    canWrite: boolean;
    admin: boolean;
    readAll: boolean;
    lead: boolean;
    readOwnDiv: boolean;
    readOtherDiv: boolean;
  }> = [
    { name: 'staff', a: staff, canWrite: true, admin: false, readAll: false, lead: false, readOwnDiv: false, readOtherDiv: false },
    { name: 'lead', a: lead, canWrite: true, admin: false, readAll: false, lead: true, readOwnDiv: true, readOtherDiv: false },
    { name: 'od', a: od, canWrite: false, admin: false, readAll: true, lead: false, readOwnDiv: true, readOtherDiv: true },
    { name: 'director', a: director, canWrite: true, admin: true, readAll: true, lead: true, readOwnDiv: true, readOtherDiv: true },
    { name: 'staff+od', a: staffOD, canWrite: true, admin: false, readAll: true, lead: false, readOwnDiv: true, readOtherDiv: true },
  ];

  it.each(cases)('$name', (c) => {
    expect(canWrite(c.a)).toBe(c.canWrite);
    expect(canManageAdmin(c.a)).toBe(c.admin);
    expect(canReadAll(c.a)).toBe(c.readAll);
    expect(isLead(c.a, 'Creative')).toBe(c.lead);
    expect(canReadDivision(c.a, 'Creative')).toBe(c.readOwnDiv);
    expect(canReadDivision(c.a, 'Ads')).toBe(c.readOtherDiv);
  });
});

// The layered OD scope must never confer write; only the underlying division
// scope does. A pure OD (no division) cannot write.
describe('layered OD never writes from OD scope', () => {
  it('pure OD is read-only', () => {
    const pureOD = actor('O', { od: true });
    expect(canWrite(pureOD)).toBe(false);
  });

  it('Staff+OD writes from staff scope but is not a lead', () => {
    const staffOD = actor('SO', { division: 'Creative', level: 'staff', od: true });
    expect(canWrite(staffOD)).toBe(true);
    expect(isLead(staffOD, 'Creative')).toBe(false);
  });
});
