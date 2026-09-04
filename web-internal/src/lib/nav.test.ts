/**
 * Per-role visibility tests for the sidebar gate table (CLAUDE.md DoD
 * "permission tests per role", incl. the layered OD/Director roles).
 *
 * The assertions encode the SERVER gates the table mirrors; if a server gate
 * moves, this file should fail and be updated together with `nav.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { Role } from './types';
import {
  filterNav, isActiveHref, isSubGroup, NAV_SECTIONS, sectionOfRoute, visibleLinks, visibleNav,
  type NavItem,
} from './nav';
import { EMBEDDED_TOOLS } from './embedded-tools';

function role(division: string, level: string, extra: Partial<Role> = {}): Role {
  return { division, level, od: false, director: false, ...extra };
}

/** Flat set of hrefs a role may see — sub-groups (Papan Divisi) flattened. */
function hrefs(r: Role | null): string[] {
  return visibleLinks(r).map((i) => i.href);
}

/** Every link in the model, sub-groups flattened, before any role filtering. */
const ALL_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) =>
  s.items.flatMap((n) => (isSubGroup(n) ? n.items : [n])),
);
const ALL_HREFS = ALL_ITEMS.map((i) => i.href);

// Items with no gate at all — visible to every authenticated role.
const UNIVERSAL = [
  '/',
  // `/akun/password` dan `/notifications` TIDAK lagi di rail — sejak IA v3
  // keduanya tinggal di header ("Avatar menu", §2), lihat `Header.tsx`.
  // `/akun/password` tetap tanpa gerbang di sana, alasan yang sama (O44(c)):
  // karyawan yang dipaksa ganti password harus bisa menjangkau formnya.
  '/master-services',
  // M11 My Tasks is the universal cross-Client work view; the per-Client Client
  // Board moved into the Client Record (DECISIONS 2026-08-14), so `/board`
  // itself is no longer a nav destination.
  '/board/my-tasks',
  // Penugasan Internal: anyone in any division can be assigned one, and the
  // scope is row-level (RLS + domain gate), not division-level.
  '/penugasan',
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
    expect(seen).toContain('/sales/kinerja');
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

  it('AI Optimizer / Store Operation staff see their own filtered Task Execution link, not the bespoke boards', () => {
    for (const [division, own] of [
      ['AI Optimizer', '/tasks?division=AI+Optimizer'],
      ['Store Operation', '/tasks?division=Store+Operation'],
    ] as const) {
      const seen = hrefs(role(division, 'staff'));
      expect(seen, `${division} staff should see ${own}`).toContain(own);
      expect(seen, `${division} staff should still see /tasks`).toContain('/tasks');
      for (const href of ['/creative', '/ads', '/kol', '/livestream']) {
        expect(seen, `${division} must not see ${href}`).not.toContain(href);
      }
    }
  });

  it('AI Optimizer and Store Operation do not see each other\'s filtered link', () => {
    expect(hrefs(role('AI Optimizer', 'staff'))).not.toContain('/tasks?division=Store+Operation');
    expect(hrefs(role('Store Operation', 'staff'))).not.toContain('/tasks?division=AI+Optimizer');
  });

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
        '/sales/kinerja',
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

describe('visibleNav — Screening SKU (Gelombang 3)', () => {
  it('is on the menu for Ads staff and Ads lead', () => {
    expect(hrefs(role('Ads', 'staff'))).toContain('/ads/screening');
    expect(hrefs(role('Ads', 'lead'))).toContain('/ads/screening');
  });

  it('is NOT on the menu for the other delivery divisions', () => {
    for (const division of ['Creative', 'KOL', 'Live Stream', 'AI Optimizer', 'Store Operation']) {
      expect(hrefs(role(division, 'staff')), `${division} must not see /ads/screening`)
        .not.toContain('/ads/screening');
    }
  });

  it('is NOT on the menu for an Account lead — deliberately unlike /ads itself', () => {
    // `/ads` is a Brief queue, so `divisionQueue` lets an Account lead in for
    // dispatch monitoring. The screener is not a queue: it is the Ads division's
    // own pre-campaign tool, gated by `canUseSkuScreener` (which mirrors the
    // server write gate). This asymmetry is the point, so it is asserted.
    const seen = hrefs(role('Account', 'lead'));
    expect(seen).toContain('/ads');
    expect(seen).not.toContain('/ads/screening');
  });

  it('is on the menu for Director and for a layered OD (read-everywhere oversight)', () => {
    expect(hrefs(role('Sales', 'staff', { director: true }))).toContain('/ads/screening');
    expect(hrefs(role('Sales', 'staff', { od: true }))).toContain('/ads/screening');
  });

  it('is hidden from Sales / Marketing / Finance', () => {
    for (const division of ['Sales', 'Marketing', 'Finance']) {
      expect(hrefs(role(division, 'staff')), `${division} must not see /ads/screening`)
        .not.toContain('/ads/screening');
    }
  });
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

  it('Account LEAD sees Akun Vendor (LT-61 follow-up); staff does not', () => {
    expect(hrefs(role('Account', 'lead'))).toContain('/admin/vendor-accounts');
    expect(hrefs(role('Account', 'staff'))).not.toContain('/admin/vendor-accounts');
  });
});

describe('visibleNav — grup "MEA AI Tools" (daftar alat bantu HTML)', () => {
  // Owner request 2026-09-04: grup alat bantu AM bernama "MEA AI Tools", isinya
  // daftar alat bantu HTML, dan judul grupnya HANYA tampil untuk divisi yang
  // punya akses ke setidaknya satu alat di dalamnya.
  const TITLE = 'MEA AI Tools';

  function toolsSection(r: Role | null) {
    return visibleNav(r).find((s) => s.title === TITLE);
  }

  it('judul grupnya persis "MEA AI Tools" (bukan "Alat"/"AI Tools MEA" yang lama)', () => {
    const titles = NAV_SECTIONS.map((s) => s.title);
    expect(titles).toContain(TITLE);
    expect(titles).not.toContain('Alat');
    expect(titles).not.toContain('AI Tools MEA');
    expect(titles).not.toContain('Alat Bantu AM');
  });

  it('isinya HANYA alat HTML terdaftar di EMBEDDED_TOOLS (satu registry, bukan salinan)', () => {
    const section = NAV_SECTIONS.find((s) => s.title === TITLE);
    expect(section, 'grup MEA AI Tools harus ada di NAV_SECTIONS').toBeDefined();
    expect(section!.items.length).toBeGreaterThan(0);
    // Grup ini datar — tak ada sub-grup di dalamnya, jadi setiap simpul tautan.
    expect(section!.items.every((n) => !isSubGroup(n))).toBe(true);
    for (const item of section!.items as NavItem[]) {
      const slug = item.href.replace('/tools/', '');
      expect(item.href, `${item.href} harus menunjuk /tools/<slug>`).toBe(`/tools/${slug}`);
      expect(
        Object.keys(EMBEDDED_TOOLS),
        `${slug} harus terdaftar di embedded-tools.ts`,
      ).toContain(slug);
      // Menu dan guard halaman WAJIB memakai predikat yang sama — kalau ini
      // berbeda, satu peran bisa melihat menu tapi ditolak halamannya.
      expect(item.access, `${slug} harus memakai predikat EMBEDDED_TOOLS`).toBe(
        EMBEDDED_TOOLS[slug].access,
      );
    }
  });

  it('setiap baris di grup ini bergerbang — tak satu pun boleh universal', () => {
    // Kalau satu baris tak bergerbang, `visibleNav` tak pernah membuang seksinya
    // dan judul "MEA AI Tools" bocor ke divisi yang tidak punya akses sama sekali.
    const section = NAV_SECTIONS.find((s) => s.title === TITLE)!;
    for (const item of section.items as NavItem[]) {
      expect(typeof item.access, `${item.href} harus punya access()`).toBe('function');
    }
  });

  it('judul grup MUNCUL untuk divisi yang punya akses (Account, Creative) dan layer read-all', () => {
    for (const r of [
      role('Account', 'staff'),
      role('Account', 'lead'),
      role('Creative', 'staff'),
      role('Sales', 'staff', { director: true }),
      role('Sales', 'staff', { od: true }),
    ]) {
      expect(toolsSection(r), `${r.division}/${r.level} harus melihat grup ${TITLE}`).toBeDefined();
    }
  });

  it('judul grup HILANG SEPENUHNYA untuk divisi tanpa akses', () => {
    for (const division of [
      'Sales',
      'Marketing',
      'Finance',
      'Ads',
      'KOL',
      'Live Stream',
      'AI Optimizer',
      'Store Operation',
    ]) {
      for (const level of ['staff', 'lead']) {
        expect(
          toolsSection(role(division, level)),
          `${division} ${level} tidak boleh melihat judul grup ${TITLE}`,
        ).toBeUndefined();
      }
    }
  });

  it('judul grup hilang selama peran masih dimuat (/me belum kembali)', () => {
    expect(toolsSection(null)).toBeUndefined();
  });
});

describe('visibleNav — Alat (embedded HTML tools)', () => {
  // "AM - baseline riset" (video-factory). Owner decision 2026-08-21: the tool is
  // for Team Creative & Account Service, PLUS the read-everywhere layer
  // (Director full / OD read-only, Role Matrix §4) who may VIEW every division's
  // pages for oversight/QA.
  const VF = '/tools/video-factory';

  it('Account and Creative staff (its two audiences) see it', () => {
    expect(hrefs(role('Account', 'staff')), 'Account staff should see it').toContain(VF);
    expect(hrefs(role('Creative', 'staff')), 'Creative staff should see it').toContain(VF);
    // Any level of those divisions, not just staff.
    expect(hrefs(role('Account', 'lead'))).toContain(VF);
  });

  it('the other divisions (without read-all) do not get it in their menu', () => {
    for (const division of ['Sales', 'Marketing', 'Finance', 'Ads', 'KOL', 'Live Stream']) {
      expect(hrefs(role(division, 'staff')), `${division} staff must not see it`).not.toContain(VF);
    }
  });

  it('Director and OD (read-everywhere) see it — even outside Creative/Account', () => {
    expect(hrefs(role('Sales', 'staff', { director: true })), 'Director must see it (full access)').toContain(VF);
    expect(hrefs(role('Sales', 'staff', { od: true })), 'OD must see it (read-everywhere)').toContain(VF);
  });

  it('is hidden while the role is still loading (gated, not universal)', () => {
    expect(hrefs(null)).not.toContain(VF);
  });

  // "AM Co-Pilot" (MEA AM Cockpit) — same audience & predicate as video-factory
  // above, so the same three checks apply.
  const CP = '/tools/am-copilot';

  it('AM Co-Pilot: Account and Creative staff see it, other divisions do not', () => {
    expect(hrefs(role('Account', 'staff'))).toContain(CP);
    expect(hrefs(role('Creative', 'staff'))).toContain(CP);
    for (const division of ['Sales', 'Marketing', 'Finance', 'Ads', 'KOL', 'Live Stream']) {
      expect(hrefs(role(division, 'staff')), `${division} staff must not see it`).not.toContain(CP);
    }
  });

  it('AM Co-Pilot: Director and OD see it even outside Creative/Account', () => {
    expect(hrefs(role('Sales', 'staff', { director: true }))).toContain(CP);
    expect(hrefs(role('Sales', 'staff', { od: true }))).toContain(CP);
  });

  it('AM Co-Pilot: hidden while the role is still loading', () => {
    expect(hrefs(null)).not.toContain(CP);
  });
});

describe('visibleNav — Rekap Mingguan (M6D two-party access)', () => {
  it('Account staff and lead see the weekly recap worklist', () => {
    expect(hrefs(role('Account', 'staff'))).toContain('/account/rekap');
    expect(hrefs(role('Account', 'lead'))).toContain('/account/rekap');
  });

  it('a lead of a touching execution division sees it (fills their division note)', () => {
    // AI Optimizer joined this list in M17 (wrr_divisi/wrr_catatan_divisi CHECK,
    // migration 20260831060000) — recap.ts DIVISIONS now includes it.
    for (const division of ['Creative', 'Ads', 'KOL', 'Live Stream', 'AI Optimizer']) {
      expect(hrefs(role(division, 'lead')), `${division} lead should see /account/rekap`).toContain('/account/rekap');
    }
  });

  it('execution-division STAFF do NOT see it (RM-D6 note is lead-scoped)', () => {
    for (const division of ['Creative', 'Ads', 'KOL', 'Live Stream', 'AI Optimizer']) {
      expect(hrefs(role(division, 'staff')), `${division} staff must not see /account/rekap`).not.toContain('/account/rekap');
    }
  });

  it('Store Operation never sees it (no task-quota / wrr_divisi row yet, LT-2 open)', () => {
    expect(hrefs(role('Store Operation', 'lead'))).not.toContain('/account/rekap');
    expect(hrefs(role('Store Operation', 'staff'))).not.toContain('/account/rekap');
  });

  it('Sales / Marketing / Finance leads never see it (not a touching division)', () => {
    for (const division of ['Sales', 'Marketing', 'Finance']) {
      expect(hrefs(role(division, 'lead')), `${division} lead must not see /account/rekap`).not.toContain('/account/rekap');
    }
  });

  it('OD (read-everywhere) sees it', () => {
    expect(hrefs(role('Sales', 'staff', { od: true }))).toContain('/account/rekap');
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
    // Director is full-access (Role Matrix §4): every page of every division,
    // the embedded tool included (owner decision 2026-08-21).
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
      '/admin/vendor-accounts',
      '/portal/management',
      '/tasks?division=AI+Optimizer',
      '/tasks?division=Store+Operation',
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


// ══════════════════════════════════════════════════════════════════════════
describe('Sidebar IA v3 — struktur 9 grup', () => {
  // `docs/CDPS_Sidebar_IA_v3.md` §2. Grup dan LABEL adalah kontraknya; rute,
  // prefix entitas dan nomor modul sengaja tidak disentuh (§7 dokumen itu).
  const GRUP = [
    'Beranda',
    'Akuisisi',
    'Katalog & Penawaran',
    'Klien',
    'Delivery',
    'MEA AI Tools',
    'Keuangan',
    'Tim',
    'Admin',
  ];

  it('sembilan grup, dalam urutan dokumen, semuanya berjudul', () => {
    expect(NAV_SECTIONS.map((s) => s.title)).toEqual(GRUP);
    // Grup "Portal" dibubarkan (v3 §1): tiga dari empat halamannya pindah ke
    // Beranda / Tim / Klien, satu ke Admin.
    expect(NAV_SECTIONS.map((s) => s.title)).not.toContain('Portal');
    expect(NAV_SECTIONS.map((s) => s.title)).not.toContain('Visibilitas');
  });

  it('label v3 dipakai, label lama sudah tidak ada', () => {
    const label = (href: string) => ALL_ITEMS.find((i) => i.href === href)?.label;
    expect(label('/portal')).toBe('Kinerja Saya');           // was "Portal Saya"
    expect(label('/portal/team')).toBe('Kinerja Divisi');    // was "Portal Tim"
    expect(label('/portal/management')).toBe('Pantauan Risiko Klien'); // was "Manajemen"
    expect(label('/admin/client-contacts')).toBe('Akses Portal Klien'); // was "Kontak Klien (Portal)"
    expect(label('/clients')).toBe('Direktori Klien');       // was "Klien"
    expect(label('/persetujuan')).toBe('Persetujuan');       // was "Perlu Persetujuan Saya"
  });

  it('setiap halaman yang dulu ada di menu masih terjangkau — nol regresi', () => {
    // Kalau satu href hilang dari model, sebuah halaman jadi tak punya pintu.
    // `/akun/password` dan `/notifications` PINDAH ke header (Avatar menu, §2),
    // jadi keduanya sengaja tidak ada di sini.
    for (const href of [
      '/', '/portal', '/board/my-tasks', '/persetujuan',
      '/leads', '/sales', '/marketing', '/sales/kinerja', '/marketing/performance',
      '/master-services', '/sales/kalkulator',
      '/clients', '/portal/management', '/health',
      '/tasks', '/account/rekap', '/account', '/ads', '/creative', '/kol', '/livestream',
      '/tasks?division=AI+Optimizer', '/tasks?division=Store+Operation',
      '/ads/screening', '/ads/scanner',
      '/tools/video-factory', '/tools/am-copilot',
      '/finance', '/finance/reminders',
      '/penugasan', '/portal/team', '/performance',
      '/admin/employees', '/admin/role-mappings', '/admin/hari-libur',
      '/admin/vendor-accounts', '/admin/client-contacts',
    ]) {
      expect(ALL_HREFS, `${href} hilang dari model navigasi`).toContain(href);
    }
  });

  it('tidak ada href ganda — satu halaman satu pintu', () => {
    expect(new Set(ALL_HREFS).size).toBe(ALL_HREFS.length);
  });

  describe('sub-grup "Papan Divisi" (kedalaman 2)', () => {
    const papan = () => {
      const delivery = NAV_SECTIONS.find((s) => s.title === 'Delivery')!;
      return delivery.items.find((n) => isSubGroup(n) && n.label === 'Papan Divisi');
    };

    it('ada di Delivery dan memuat tujuh papan divisi', () => {
      const g = papan();
      expect(g, 'sub-grup Papan Divisi harus ada di Delivery').toBeDefined();
      expect(isSubGroup(g!) && g!.items.map((i) => i.label)).toEqual([
        'Account & Service', 'AI Optimizer', 'Ads', 'Creative', 'KOL', 'Live Stream', 'Store Operation',
      ]);
    });

    it('kedalaman berhenti di 2 — tak ada sub-grup di dalam sub-grup', () => {
      for (const s of NAV_SECTIONS) {
        for (const n of s.items) {
          if (!isSubGroup(n)) continue;
          expect(n.items.every((i) => !isSubGroup(i)), `${n.label} memuat sub-grup bersarang`).toBe(true);
        }
      }
    });

    it('auto-scope (§5.6): eksekutor kanal hanya melihat papan divisinya sendiri', () => {
      const papanOf = (r: Role) => {
        const delivery = visibleNav(r).find((s) => s.title === 'Delivery');
        const g = delivery?.items.find((n) => isSubGroup(n));
        return g && isSubGroup(g) ? g.items.map((i) => i.label) : [];
      };
      expect(papanOf(role('Creative', 'staff'))).toEqual(['Creative']);
      expect(papanOf(role('KOL', 'staff'))).toEqual(['KOL']);
      expect(papanOf(role('Live Stream', 'lead'))).toEqual(['Live Stream']);
    });

    it('auto-scope (§5.6): Direktur/OD melihat ketujuhnya', () => {
      const papanOf = (r: Role) => {
        const delivery = visibleNav(r).find((s) => s.title === 'Delivery');
        const g = delivery?.items.find((n) => isSubGroup(n));
        return g && isSubGroup(g) ? g.items.length : 0;
      };
      expect(papanOf(role('Management', 'staff', { director: true }))).toBe(7);
      expect(papanOf(role('Management', 'staff', { od: true }))).toBe(7);
    });

    it('sub-grup yang jadi kosong ikut hilang, tidak menyisakan judul menggantung', () => {
      // Sales tidak punya satu pun papan divisi — dan memang tidak melihat
      // grup Delivery sama sekali.
      const delivery = visibleNav(role('Sales', 'staff')).find((s) => s.title === 'Delivery');
      expect(delivery).toBeUndefined();
      // Finance juga bukan pemilik task mana pun.
      expect(visibleNav(role('Finance', 'staff')).find((s) => s.title === 'Delivery')).toBeUndefined();
    });
  });

  it('tiga pasang "mungkin duplikat" (§4) SEMUANYA dipertahankan — keputusan pemilik 2026-09-04', () => {
    // Ketiganya beda kemampuan, bukan cuma beda scope: Tugas Saya punya filter
    // divisi + "Lihat Tugas Staff Lain"; Team Performance universal + halaman
    // Konfigurasi bobot; Client Health punya trigger Pemindaian Skor.
    for (const href of ['/portal', '/board/my-tasks', '/portal/team', '/performance', '/portal/management', '/health']) {
      expect(ALL_HREFS, `${href} tidak boleh dihapus`).toContain(href);
    }
  });
});


// ══════════════════════════════════════════════════════════════════════════
describe('perilaku rail (Sidebar IA v3 §5)', () => {
  // Bagian MURNI dari `Sidebar.tsx` — accordion & pencarian. Ini yang bisa
  // diam-diam rusak tanpa ada tes yang menjerit.
  const sections = visibleNav(role('Management', 'staff', { director: true }));

  describe('isActiveHref', () => {
    it('mencocokkan rute persis dan anaknya', () => {
      expect(isActiveHref('/clients', '/clients')).toBe(true);
      expect(isActiveHref('/clients/CLI-1', '/clients')).toBe(true);
      expect(isActiveHref('/clientsX', '/clients')).toBe(false);
    });

    it('Dashboard hanya aktif di "/" persis — bukan di setiap halaman', () => {
      expect(isActiveHref('/', '/')).toBe(true);
      expect(isActiveHref('/clients', '/')).toBe(false);
    });

    it('item ber-query string tidak pernah ditandai aktif (batasan yang disengaja)', () => {
      expect(isActiveHref('/tasks', '/tasks?division=AI+Optimizer')).toBe(false);
    });
  });

  describe('sectionOfRoute — grup mana yang terbuka saat halaman dimuat (§5.1)', () => {
    it('menemukan grup dari tautan biasa', () => {
      expect(sectionOfRoute(sections, '/finance/reminders')).toBe('Keuangan');
      expect(sectionOfRoute(sections, '/admin/employees')).toBe('Admin');
    });

    it('menemukan grup dari tautan DI DALAM sub-grup (Papan Divisi)', () => {
      expect(sectionOfRoute(sections, '/creative')).toBe('Delivery');
      expect(sectionOfRoute(sections, '/kol/briefs/BRF-1')).toBe('Delivery');
    });

    it('null untuk rute yang tidak ada di menu (mis. halaman detail lepas)', () => {
      expect(sectionOfRoute(sections, '/demo-tasks')).toBeNull();
    });
  });

  describe('filterNav — kotak cari (§5.3)', () => {
    const titles = (q: string) => filterNav(sections, q).map((s) => s.title);
    const labels = (q: string) =>
      filterNav(sections, q).flatMap((s) => s.items.flatMap((n) => (isSubGroup(n) ? n.items : [n]))).map((i) => i.label);

    it('kueri kosong mengembalikan model apa adanya', () => {
      expect(filterNav(sections, '')).toBe(sections);
      expect(filterNav(sections, '   ')).toBe(sections);
    });

    it('menyaring per label item dan membuang grup yang tak menyisakan apa pun', () => {
      expect(labels('reminder')).toEqual(['Reminder Pembayaran']);
      expect(titles('reminder')).toEqual(['Keuangan']);
    });

    it('judul grup yang cocok mempertahankan SELURUH isinya', () => {
      // Mencari nama grup harus memperlihatkan isinya, bukan grup kosong.
      expect(titles('keuangan')).toEqual(['Keuangan']);
      expect(labels('keuangan')).toEqual(['Finance', 'Reminder Pembayaran']);
    });

    it('mencari ke DALAM sub-grup, dan judul sub-grup yang cocok membawa seluruh papannya', () => {
      expect(labels('creative')).toContain('Creative');
      expect(labels('papan')).toEqual([
        'Account & Service', 'AI Optimizer', 'Ads', 'Creative', 'KOL', 'Live Stream', 'Store Operation',
      ]);
    });

    it('tidak peduli huruf besar-kecil dan spasi di ujung', () => {
      expect(labels('  KARYAWAN ')).toEqual(['Karyawan']);
    });

    it('kueri tanpa hasil mengembalikan daftar kosong, bukan seluruh menu', () => {
      expect(filterNav(sections, 'zzz-tidak-ada')).toEqual([]);
    });
  });
});
