/**
 * FE↔API response-SHAPE parity guard — DECISIONS **O43 butir (c)**.
 *
 * `route-parity.test.ts` diffs which PATHS exist. It cannot see the other half of
 * the boundary: a route can exist, answer 200, and still blank its page because
 * the body's keys are not the keys the page reads. That class has now bitten
 * four separate times, and every single time CI was green:
 *
 *   - C03-F2  `POST /sales/quote-preview` returned a raw domain object → 500.
 *   - O43 #1  `GET /clients/{id}` returned camelCase → every field `undefined`.
 *   - O41     the whole M5 wire layer was missing → `[Bermasalah]` unusable
 *             in production (the FE posts `reason`, the route read `note`).
 *   - O43 F2  nine more endpoints, all answering 200 with the wrong envelope.
 *
 * Each of those was found by a human reading two files side by side. That does
 * not scale to 80+ converters, and — the part that actually forces the issue —
 * it stops being possible at all once C-05 archives `backend/`, because the Go
 * struct tags are the oracle those readings were checked against.
 *
 * So this test asserts the pair mechanically, against the source of truth that
 * SURVIVES the retirement: the `interface`s in `web-internal/src/lib/*.ts`. The
 * page cannot read a key the interface does not declare, and it cannot render a
 * key the wire does not emit — so declared-but-not-emitted is a defect by
 * construction, no oracle required.
 *
 * Deliberately NOT a Go diff: Go is frozen and about to be archived, and two
 * endpoints (`/transactions/{id}/commission`, `/payment`) have no Go handler at
 * all. Anchoring to Go would make this test die with `backend/`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WIRE_TS = join(REPO_ROOT, 'apps/api/src/lib/wire.ts');
const FE_LIB = join(REPO_ROOT, 'web-internal/src/lib');

/** One parsed `export interface` — its own keys plus whatever it extends. */
interface Parsed {
  keys: string[];
  extends: string;
  /** Raw body, kept so the nested-inline blind spot can be asserted, not assumed. */
  body: string;
}

/**
 * Extract every `export interface` in a source file.
 *
 * Regex rather than a TS parser, for the same reason `route-parity` walks the
 * filesystem instead of booting Next: the input is our own hand-written source
 * in a house style, and a parser dependency would be a heavier thing to keep
 * honest than the assertions it feeds. The `finds both sides` test below fails
 * loudly if extraction ever silently returns nothing.
 */
function parseInterfaces(source: string): Map<string, Parsed> {
  const out = new Map<string, Parsed>();
  const re = /export interface (\w+)(?:\s+extends\s+([^{]+))?\s*\{([\s\S]*?)\n\}/g;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    // `[A-Za-z_]`, NOT `[a-z_]`. Restricting the character class to lowercase
    // made the camelCase assertion below VACUOUS — a leaked `totalHarga` simply
    // never matched, so it was never extracted, so nothing could flag it. Caught
    // by injecting exactly that key and watching the suite stay green.
    const keys = [...m[3].matchAll(/^ {2}([A-Za-z_][A-Za-z_0-9]*)\??:/gm)].map((k) => k[1]);
    out.set(m[1], { keys, extends: (m[2] ?? '').trim(), body: m[3] });
  }
  return out;
}

/**
 * Interfaces whose shape includes an INLINE nested object literal, e.g.
 * `attempts: { id: string; … }[]`. Extraction is top-level-only (2-space
 * indent), so those inner keys are NOT compared by this test — stated here
 * rather than left for a reader to infer from green CI.
 *
 * Three today. Extracting a named interface for each would bring them under the
 * guard; that is a `wire.ts` refactor, and refactoring shared converter blocks
 * while a parallel session edits the same file is how merge conflicts are made.
 * Left as a follow-up, deliberately.
 */
const NESTED_INLINE_UNCHECKED = ['LeadDetailWire', 'ProposalWire', 'AttemptDetailWire'];

/**
 * Flatten an interface to the key set it actually declares, following `extends`.
 * `Omit<X, 'a' | 'b'>` is resolved rather than skipped because `LeadDetailWire`
 * is built out of one (`Omit<LeadRowWire, 'open_attempt_count'>`) — treating it
 * as opaque would silently exempt the biggest lead payload from this test.
 */
function flatten(all: Map<string, Parsed>, name: string, seen = new Set<string>()): string[] {
  const node = all.get(name);
  if (!node || seen.has(name)) return [];
  seen.add(name);
  const inherited: string[] = [];
  for (const raw of node.extends.split(/[,&]/)) {
    const part = raw.trim();
    if (part === '') continue;
    const omit = /^Omit<(\w+),\s*(.+)>$/.exec(part);
    if (omit) {
      const dropped = new Set(omit[2].split('|').map((s) => s.trim().replace(/['"]/g, '')));
      inherited.push(...flatten(all, omit[1], seen).filter((k) => !dropped.has(k)));
    } else if (/^\w+$/.test(part)) {
      inherited.push(...flatten(all, part, seen));
    }
  }
  return [...inherited, ...node.keys];
}

const wire = parseInterfaces(readFileSync(WIRE_TS, 'utf8'));

/**
 * The FE data layer, keyed `file.ts::Interface`.
 *
 * File-qualified ON PURPOSE. Six names are reused across files — `Brief` lives
 * in `account.ts`, `kol.ts` AND `creative.ts`; `Metrics` in `tasks.ts`,
 * `creative.ts` AND `marketing.ts`; also `Campaign`, `Card`, `Snapshot`,
 * `ScanResult`, `PendingBlockRequest`. Pairing by bare name picks whichever file
 * sorts first, which means comparing a converter against an unrelated type and
 * calling the result parity. `PendingBlockRequest` is the live example: the real
 * wire shape is `tasks.ts`'s 8-key row, while `block-requests.ts` declares a
 * 3-key CLIENT-SIDE type derived from the audit trail (camelCase, never sent by
 * any route).
 */
const fe = new Map<string, Parsed>();
for (const file of [
  'account.ts', 'ads.ts', 'block-requests.ts', 'board.ts', 'clients.ts', 'creative.ts',
  'finance.ts', 'health.ts', 'kol.ts', 'leads.ts', 'livestream.ts', 'marketing.ts',
  'performance.ts', 'portal.ts', 'sales.ts', 'tasks.ts', 'types.ts',
]) {
  for (const [name, parsed] of parseInterfaces(readFileSync(join(FE_LIB, file), 'utf8'))) {
    fe.set(`${file}::${name}`, parsed);
  }
}

/** `extends` inside the FE tree is same-file, so qualify before recursing. */
function flattenFe(qualified: string): string[] {
  const [file] = qualified.split('::');
  const scoped = new Map<string, Parsed>();
  for (const [key, parsed] of fe) {
    if (key.startsWith(`${file}::`)) scoped.set(key.slice(file.length + 2), parsed);
  }
  return flatten(scoped, qualified.slice(file.length + 2));
}

/**
 * Every `*Wire` interface → the FE interface it serves. Taken from each
 * converter's own doc comment, which names its counterpart.
 *
 * This registry is the point of the test as much as the assertions are: adding
 * a converter without a line here fails `covers every wire interface`, so the
 * next endpoint cannot quietly ship an unchecked shape.
 */
const WIRE_TO_FE: Record<string, string> = {
  // M0 sales — quote preview, attempt list/detail
  LineQuoteWire: 'sales.ts::LineQuote',
  QuoteWire: 'sales.ts::Quote',
  AttemptRowWire: 'sales.ts::AttemptRow',
  QualifiedFormServiceWire: 'sales.ts::QualifiedFormServiceRow',
  QualifiedFormWire: 'sales.ts::QualifiedFormSnapshot',
  ProposalWire: 'sales.ts::NegotiationProposalRow',
  AttemptDetailWire: 'sales.ts::AttemptDetail',
  // M1 leads
  LeadStubWire: 'leads.ts::LeadStub',
  AttemptStubWire: 'leads.ts::AttemptStub',
  PoolRowWire: 'leads.ts::PoolRow',
  LeadRowWire: 'leads.ts::LeadRow',
  LeadDetailWire: 'leads.ts::LeadDetail',
  DeleteRequestWire: 'leads.ts::DeleteRequest',
  DeleteRequestQueueRowWire: 'leads.ts::DeleteRequestQueueRow',
  BulkRowResultWire: 'leads.ts::BulkRowResult',
  BulkReportWire: 'leads.ts::BulkReport',
  // M2 marketing / M3 campaign
  PerformanceRecordWire: 'marketing.ts::Record',
  MarketingMetricsWire: 'marketing.ts::Metrics',
  MarketingCampaignWire: 'marketing.ts::Campaign',
  CampaignRollupWire: 'marketing.ts::Rollup',
  // M4 client record
  ServiceLineWire: 'clients.ts::ServiceLine',
  PlatformWire: 'clients.ts::Platform',
  AllocationWire: 'clients.ts::Allocation',
  ClientDetailWire: 'clients.ts::Client',
  ClientListRowWire: 'clients.ts::Client',
  VoidResultWire: 'clients.ts::VoidResult',
  // M5 finance
  InstallmentWire: 'finance.ts::Installment',
  TransactionWire: 'finance.ts::Transaction',
  BermasalahVoteWire: 'finance.ts::BermasalahVote',
  BermasalahStatusWire: 'finance.ts::BermasalahStatus',
  ReminderRowWire: 'finance.ts::ReminderRow',
  OutstandingRowWire: 'finance.ts::OutstandingRow',
  RemindersWire: 'finance.ts::RemindersResponse',
  FinanceScanResultWire: 'finance.ts::ScanResult',
  // M6 account & service
  IntakeClientWire: 'account.ts::IntakeClient',
  AMWorkloadWire: 'account.ts::AMWorkload',
  AssignmentWire: 'account.ts::Assignment',
  StrategyWire: 'account.ts::Strategy',
  StrategyRequirementWire: 'account.ts::StrategyRequirement',
  BriefWire: 'account.ts::Brief',
  ComplaintWire: 'account.ts::Complaint',
  // M7 creative
  AssetWire: 'creative.ts::Asset',
  OutputEntryWire: 'creative.ts::DailyOutputEntry',
  DailyOutputDayWire: 'creative.ts::DailyOutputDay',
  ScanHoursReminderResultWire: 'creative.ts::ReminderScanResult',
  // M8 ads
  CampaignWire: 'ads.ts::Campaign',
  MetricEntryWire: 'ads.ts::MetricEntry',
  OptimizationWire: 'ads.ts::Optimization',
  // M9 KOL
  BookingWire: 'kol.ts::Booking',
  PaymentRequestWire: 'kol.ts::PaymentRequest',
  BookingMetricsWire: 'kol.ts::BookingMetrics',
  CreatorListWire: 'kol.ts::CreatorList',
  // M10 live stream
  SessionWire: 'livestream.ts::Session',
  // M11 board
  DependencyWire: 'board.ts::Dependency',
  CardWire: 'board.ts::Card',
  // M12 task execution
  MetricsWire: 'tasks.ts::Metrics',
  BlockRequestWire: 'tasks.ts::BlockRequest',
  PendingBlockRequestWire: 'tasks.ts::PendingBlockRequest',
  // M13 client health
  HealthComponentWire: 'health.ts::Component',
  HealthSnapshotWire: 'health.ts::Snapshot',
  RoasToggleWire: 'health.ts::ROASToggle',
  HealthScanResultWire: 'health.ts::ScanResult',
  // M14 team performance
  PerfComponentWire: 'performance.ts::SnapshotComponent',
  PerfModifierWire: 'performance.ts::PerformanceModifier',
  PerfSnapshotWire: 'performance.ts::Snapshot',
  PerfTeamRollupWire: 'performance.ts::TeamRollup',
  PerfWeightWire: 'performance.ts::KPIWeight',
  PerfTargetWire: 'performance.ts::PeriodTarget',
  // M15 team portal
  StaffLandingWire: 'portal.ts::StaffLanding',
  ClientShortcutWire: 'portal.ts::ClientShortcut',
  TeamPortalWire: 'portal.ts::TeamPortalFull',
  MgmtRowWire: 'portal.ts::MgmtRow',
  ManagementDashboardWire: 'portal.ts::ManagementDashboard',
  // Cross-module surfaces
  MasterServiceWire: 'types.ts::MasterService',
  NotificationWire: 'types.ts::NotificationItem',
  NotificationsResponseWire: 'types.ts::NotificationsResponse',
  AdminEmployeeWire: 'types.ts::AdminEmployee',
  RoleMappingWire: 'types.ts::RoleMapping',
  LayeredRoleWire: 'types.ts::LayeredRole',
  CredentialInfoWire: 'types.ts::CredentialInfo',
  AuditEntryWire: 'types.ts::AuditEntry',
  DemoTaskWire: 'types.ts::DemoTask',
  DemoTaskDetailWire: 'types.ts::DemoTaskDetail',
};

/**
 * Keys a converter emits that its FE interface does not declare.
 *
 * Extra keys cannot blank a page, so they are not defects — but they are how
 * INVENTED contracts get in (SESI14: "no oracle AND no consumer ⇒ naming a wire
 * key is inventing a contract"). Listing them makes each one a deliberate,
 * reviewable choice instead of drift. Every entry below is carried by the Go
 * struct the converter mirrors, i.e. inherited from the oracle, not made up.
 */
const ALLOWED_EXTRA: Record<string, string[]> = {
  // Go `EmployeeRow.synced_at` — the HRIS-sync timestamp; kept so the admin
  // roster can show staleness without a second endpoint.
  AdminEmployeeWire: ['synced_at'],
  // Go `audit.Entry` carries the subject; the FE renders one entity's trail at
  // a time so it does not re-read them.
  AuditEntryWire: ['entity_type', 'entity_id'],
  // Go `demo.Task`.
  DemoTaskWire: ['description', 'division'],
  // Go `admin.LayeredRole`.
  LayeredRoleWire: ['id', 'created_at'],
  RoleMappingWire: ['created_at'],
  // Go `admin.ServiceView` — the M6-OA-1 pin. Read from the Strategy surface,
  // not from the MSL list, so `MasterService` does not declare it.
  MasterServiceWire: ['requires_strategy_plan'],
  // Go `module14_performance.Snapshot.ID`.
  PerfSnapshotWire: ['id'],
  // The narrow roster projection — see DIVERGENCE below, same decision.
  ClientListRowWire: ['sales_pic_nama', 'assigned_am_id', 'created_at'],
};

/**
 * FE-declared keys a converter deliberately does NOT emit.
 *
 * This is the ledger, and it works like `route-parity`'s `KNOWN_GAPS`: it must
 * only ever SHRINK, and an addition means admitting a page reads a key nobody
 * sends — which needs a `DECISIONS.md` entry, not a line here.
 */
const APPROVED_DIVERGENCE: Record<string, { keys: string[]; decision: string }> = {
  /**
   * `GET /clients` serves a deliberately DIFFERENT projection from
   * `GET /clients/{id}`, even though both are typed `Client` on the FE.
   * Widening it would mean an N+1 over platforms/allocations/services for
   * columns the roster page never reads (it renders 7 keys, all emitted).
   * Owner-decided 2026-07-29 — DECISIONS O43 (a), "proyeksi sempit
   * DIPERTAHANKAN". Re-deciding this is an owner call, not a cleanup.
   */
  ClientListRowWire: {
    keys: [
      'link_toko', 'gmv_baseline', 'target_gmv', 'total_sales', 'marketing_budget',
      'origin_campaign_id', 'commission_payment_pic_id', 'transaction_id',
      'platforms', 'sales_allocation', 'services',
    ],
    decision: 'DECISIONS O43 (a), owner 2026-07-29',
  },
};

describe('FE↔API response-shape parity (O43 c)', () => {
  it('finds both sides (guards against the extraction silently breaking)', () => {
    // Without this, every assertion below passes vacuously the day the regex
    // stops matching — the failure mode that makes green CI meaningless.
    expect(wire.size).toBeGreaterThan(75);
    expect(fe.size).toBeGreaterThan(100);
    expect([...wire.keys()]).toContain('ClientDetailWire');
    expect(flatten(wire, 'ClientDetailWire')).toContain('total_sales');
    expect(flattenFe('clients.ts::Client')).toContain('total_sales');
    // Omit<> resolution really resolves (LeadDetailWire is built on one).
    expect(flatten(wire, 'DeleteRequestQueueRowWire')).toContain('lead_name');
  });

  it('covers every wire interface — a new converter must register its FE type', () => {
    const unregistered = [...wire.keys()].filter((name) => !(name in WIRE_TO_FE));
    expect(
      unregistered,
      `unregistered wire interfaces — add each to WIRE_TO_FE so its shape is checked:\n${unregistered.join('\n')}`,
    ).toEqual([]);
  });

  it('points every registry entry at an FE interface that exists', () => {
    const dangling = Object.entries(WIRE_TO_FE)
      .filter(([, feName]) => !fe.has(feName))
      .map(([w, f]) => `${w} → ${f}`);
    expect(dangling, `registry points at missing FE types:\n${dangling.join('\n')}`).toEqual([]);
  });

  it('emits every key the FE declares, except the documented divergences', () => {
    const broken: string[] = [];
    for (const [wireName, feName] of Object.entries(WIRE_TO_FE)) {
      const emitted = new Set(flatten(wire, wireName));
      const exempt = new Set(APPROVED_DIVERGENCE[wireName]?.keys ?? []);
      const missing = flattenFe(feName).filter((k) => !emitted.has(k) && !exempt.has(k));
      if (missing.length > 0) {
        broken.push(`${wireName} (serves ${feName}) never emits: ${missing.join(', ')}`);
      }
    }
    // Each line is a page reading `undefined` for a field it renders — the
    // O43/O41 failure mode, which answers 200 and leaves no error trace.
    expect(broken, `response shapes the FE cannot render:\n${broken.join('\n')}`).toEqual([]);
  });

  it('emits no key outside the FE contract unless allow-listed', () => {
    const undeclared: string[] = [];
    for (const [wireName, feName] of Object.entries(WIRE_TO_FE)) {
      const declared = new Set(flattenFe(feName));
      const allowed = new Set(ALLOWED_EXTRA[wireName] ?? []);
      const extra = flatten(wire, wireName).filter((k) => !declared.has(k) && !allowed.has(k));
      if (extra.length > 0) {
        undeclared.push(`${wireName}: ${extra.join(', ')}`);
      }
    }
    expect(
      undeclared,
      `wire keys no FE type declares — inherited from Go, or invented?\n${undeclared.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps both ledgers honest — no entry may describe a state that is gone', () => {
    // The failure mode this catches: a converter gets fixed, and its exemption
    // stays behind as documentation of a defect that no longer exists. Then the
    // next reader trusts the ledger instead of the code.
    const stale: string[] = [];
    for (const [wireName, { keys, decision }] of Object.entries(APPROVED_DIVERGENCE)) {
      const emitted = new Set(flatten(wire, wireName));
      const nowEmitted = keys.filter((k) => emitted.has(k));
      if (nowEmitted.length > 0) {
        stale.push(`${wireName} now emits ${nowEmitted.join(', ')} — delete from APPROVED_DIVERGENCE (${decision})`);
      }
    }
    for (const [wireName, keys] of Object.entries(ALLOWED_EXTRA)) {
      const declared = new Set(flattenFe(WIRE_TO_FE[wireName]));
      const nowDeclared = keys.filter((k) => declared.has(k));
      if (nowDeclared.length > 0) {
        stale.push(`${wireName}: FE now declares ${nowDeclared.join(', ')} — delete from ALLOWED_EXTRA`);
      }
    }
    expect(stale, stale.join('\n')).toEqual([]);
  });

  it('emits snake_case only — never a camelCase key', () => {
    // The C03-F2 / O43 #1 signature: a raw domain object reaching the boundary.
    // Cheap to assert, and it fails on the very first leaked field.
    const camel: string[] = [];
    for (const name of wire.keys()) {
      const bad = flatten(wire, name).filter((k) => /[A-Z]/.test(k));
      if (bad.length > 0) camel.push(`${name}: ${bad.join(', ')}`);
    }
    expect(camel, `camelCase keys crossing the wire:\n${camel.join('\n')}`).toEqual([]);
  });

  it('states its own blind spot — the inline-nested list stays accurate', () => {
    // A limit nobody can see is worse than no limit: green CI would read as full
    // coverage. So the list is asserted against the file, not just written down.
    const found = [...wire].filter(([, p]) => /^ {4}\w+\??:/m.test(p.body)).map(([name]) => name);
    expect(found.sort()).toEqual([...NESTED_INLINE_UNCHECKED].sort());
  });

  it('keeps the M5 money path exactly as the FE reads it (O41 regression)', () => {
    // Positive assertions, not just absence from a diff: this is the shape whose
    // absence made the [Bermasalah] button unusable in production.
    expect(flatten(wire, 'BermasalahStatusWire')).toContain('escalated');
    expect(flatten(wire, 'InstallmentWire')).toContain('proof_of_payment');
    expect(flatten(wire, 'RemindersWire')).toContain('outstanding_no_due_date');
  });
});
