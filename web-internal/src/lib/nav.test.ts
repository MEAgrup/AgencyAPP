/**
 * Per-role visibility tests for the sidebar gate table (CLAUDE.md DoD
 * "permission tests per role", incl. the layered OD/Director roles).
 *
 * The assertions encode the SERVER gates the table mirrors; if a server gate
 * moves, this file should fail and be updated together with `nav.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { Role } from './types';
import { NAV_SECTIONS, visibleNav } from './nav';

function role(division: string, level: string, extra: Partial<Role> = {}): Role {
  return { division, level, od: false, director: false, ...extra };
}

/** Flat set of hrefs a role may see. */
function hrefs(r: Role | null): string[] {
  return visibleNav(r).flatMap((s) => s.items.map((i) => i.href));
}

const ALL_HREFS = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));

// Items with no gate at all — visible to every authenticated role.
const UNIVERSAL = [
  '/',
  '/demo-tasks',
  '/notifications',
  '/master-services',
  '/board',
  '/performance',
  '/portal',
];

describe('visibleNav — universal items', () => {
  it('shows the ungated items to every division at staff level', () => {
    for (const division of [
      'Sales',
      'Marketing',
      'Finance',
      'Account',
      'Creative',
      'Ads',
      'KOL',
      'Live Stream',
    ]) {
      const seen = hrefs(role(division, 'staff'));
      for (const href of UNIVERSAL) {
        expect(seen, `${division} staff should see ${href}`).toContain(href);
      }
    }
  });

  it('shows only ungated items while /me is still loading (role null)', () => {
    expect(hrefs(null).sort()).toEqual([...UNIVERSAL].sort());
  });
});

describe('visibleNav — Sales', () => {
  it('gives Sales staff its own workspace and hides every other division', () => {
    const seen = hrefs(role('Sales', 'staff'));
    // Own: M0 workspace + closing calculator, M1 Leads (canReadPool), M4 clients.
    expect(seen).toContain('/sales');
    expect(seen).toContain('/sales/kalkulator');
    expect(seen).toContain('/leads');
    expect(seen).toContain('/clients');
    // Not Sales': the QA finding behind PR #58.
    for (const href of [
      '/account',
      '/creative',
      '/ads',
      '/kol',
      '/livestream',
      '/finance',
      '/finance/reminders',
      '/marketing',
      '/marketing/performance',
      '/health',
    ]) {
      expect(seen, `Sales staff must not see ${href}`).not.toContain(href);
    }
  });

  it('does not show Sales staff the Portal Tim / Manajemen / Admin items', () => {
    const seen = hrefs(role('Sales', 'staff'));
    expect(seen).not.toContain('/portal/team');
    expect(seen).not.toContain('/portal/management');
    expect(seen).not.toContain('/admin/employees');
  });

  it('adds Portal Tim for a Sales lead (division lead), still no cross-division menus', () => {
    const seen = hrefs(role('Sales', 'lead'));
    expect(seen).toContain('/portal/team');
    expect(seen).not.toContain('/creative');
    expect(seen).not.toContain('/finance');
  });
});

describe('visibleNav — the delivery divisions (symmetry)', () => {
  const cases: { division: string; own: string; foreign: string[] }[] = [
    { division: 'Creative', own: '/creative', foreign: ['/ads', '/kol', '/livestream'] },
    { division: 'Ads', own: '/ads', foreign: ['/creative', '/kol', '/livestream'] },
    { division: 'KOL', own: '/kol', foreign: ['/creative', '/ads', '/livestream'] },
    { division: 'Live Stream', own: '/livestream', foreign: ['/creative', '/ads', '/kol'] },
  ];

  for (const { division, own, foreign } of cases) {
    it(`${division} staff sees only its own Brief queue`, () => {
      const seen = hrefs(role(division, 'staff'));
      expect(seen).toContain(own);
      for (const href of foreign) {
        expect(seen, `${division} must not see ${href}`).not.toContain(href);
      }
      // M12: execution divisions own Tasks.
      expect(seen).toContain('/tasks');
    });

    it(`${division} staff does not see the Sales / Marketing / Finance menus`, () => {
      const seen = hrefs(role(division, 'staff'));
      for (const href of [
        '/sales',
        '/sales/kalkulator',
        '/leads',
        '/marketing',
        '/marketing/performance',
        '/finance',
        '/clients',
        '/health',
        '/account',
      ]) {
        expect(seen, `${division} must not see ${href}`).not.toContain(href);
      }
    });
  }
});

describe('visibleNav — Account', () => {
  it('Account staff (AM) sees its workspace, tasks, health and clients', () => {
    const seen = hrefs(role('Account', 'staff'));
    expect(seen).toContain('/account');
    expect(seen).toContain('/tasks');
    expect(seen).toContain('/health');
    expect(seen).toContain('/clients');
  });

  it('Account STAFF does not see the division Brief queues (listDivisionQueue denies an AM)', () => {
    const seen = hrefs(role('Account', 'staff'));
    for (const href of ['/creative', '/ads', '/kol', '/livestream']) {
      expect(seen, `Account staff must not see ${href}`).not.toContain(href);
    }
  });

  it('Account LEAD sees all four Brief queues (dispatch monitoring)', () => {
    const seen = hrefs(role('Account', 'lead'));
    for (const href of ['/creative', '/ads', '/kol', '/livestream']) {
      expect(seen, `Account lead should see ${href}`).toContain(href);
    }
  });

  it('Account lead still does not get the Sales or Marketing workspaces', () => {
    const seen = hrefs(role('Account', 'lead'));
    expect(seen).not.toContain('/sales');
    expect(seen).not.toContain('/marketing');
    expect(seen).not.toContain('/leads');
  });
});

describe('visibleNav — Marketing & Finance', () => {
  it('Marketing staff sees campaigns + Leads, not the Sales workspace', () => {
    const seen = hrefs(role('Marketing', 'staff'));
    expect(seen).toContain('/marketing');
    expect(seen).toContain('/marketing/performance');
    expect(seen).toContain('/leads'); // leadListScope: Marketing any level
    expect(seen).not.toContain('/sales');
    expect(seen).not.toContain('/sales/kalkulator');
    expect(seen).not.toContain('/finance');
  });

  it('Finance staff sees the payment queue + reminders + clients only', () => {
    const seen = hrefs(role('Finance', 'staff'));
    expect(seen).toContain('/finance');
    expect(seen).toContain('/finance/reminders');
    expect(seen).toContain('/clients');
    expect(seen).not.toContain('/leads');
    expect(seen).not.toContain('/creative');
    expect(seen).not.toContain('/health');
  });
});

describe('visibleNav — layered OD / Director', () => {
  it('Director sees every item', () => {
    const seen = hrefs(role('Sales', 'staff', { director: true }));
    expect(seen.sort()).toEqual([...ALL_HREFS].sort());
  });

  it('OD sees every division item and the read-only admin/management items', () => {
    const seen = hrefs(role('Sales', 'staff', { od: true }));
    for (const href of [
      '/account',
      '/creative',
      '/ads',
      '/kol',
      '/livestream',
      '/finance',
      '/marketing',
      '/health',
      '/leads',
      '/sales',
      '/admin/employees',
      '/portal/management',
    ]) {
      expect(seen, `OD should see ${href}`).toContain(href);
    }
  });

  it('OD does NOT gain Portal Tim (director + division lead only, unchanged)', () => {
    // Guards the one gate that is deliberately not read-everywhere: a layered OD
    // on a staff account must not inherit the team portal.
    expect(hrefs(role('Sales', 'staff', { od: true }))).not.toContain('/portal/team');
    expect(hrefs(role('Sales', 'lead', { od: true }))).toContain('/portal/team');
  });

  it('a staff+OD layered account keeps its own division menus too', () => {
    const seen = hrefs(role('Creative', 'staff', { od: true }));
    expect(seen).toContain('/creative');
    expect(seen).toContain('/tasks');
  });
});

describe('visibleNav — section shape', () => {
  it('never returns a section with zero items (no empty headers render)', () => {
    for (const r of [
      null,
      role('Sales', 'staff'),
      role('Creative', 'staff'),
      role('Finance', 'staff'),
      role('Account', 'lead'),
      role('Sales', 'staff', { od: true }),
    ]) {
      for (const section of visibleNav(r)) {
        expect(section.items.length).toBeGreaterThan(0);
      }
    }
  });

  it('drops the Delivery and Admin sections entirely for Sales staff', () => {
    const titles = visibleNav(role('Sales', 'staff')).map((s) => s.title);
    expect(titles).not.toContain('Delivery');
    expect(titles).not.toContain('Admin');
    expect(titles).toContain('Akuisisi');
  });

  it('keeps division casing tolerant (lowercased HRIS mappings still match)', () => {
    expect(hrefs(role('sales', 'staff'))).toContain('/sales');
    expect(hrefs(role('live stream', 'staff'))).toContain('/livestream');
  });
});
