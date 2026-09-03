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
/**
 * The SECOND front-end app. `web-client-portal` is a separate Next project with
 * its own `lib/`, and until the M15-C2 read-model shipped it had no response
 * shapes at all — so this guard only ever watched `web-internal`. Its DTOs are
 * the narrowest in the system (the §4.2 allow-list is a list of FIELDS), which
 * makes them the ones most worth watching: a field added to a portal wire type
 * without the FE declaring it is a field a client receives that nobody designed.
 * Keyed `klien/types.ts::X` so the existing `file::Type` splitting is untouched.
 */
const FE_LIB_PORTAL = join(REPO_ROOT, 'web-client-portal/src/lib');
const PORTAL_PREFIX = 'klien/';

/** Resolve a file key to its absolute path — one place, two apps. */
function feSourcePath(file: string): string {
  return file.startsWith(PORTAL_PREFIX)
    ? join(FE_LIB_PORTAL, file.slice(PORTAL_PREFIX.length))
    : join(FE_LIB, file);
}

/** One parsed `export interface` — its own keys plus whatever it extends. */
interface Parsed {
  keys: string[];
  /** key → the type text it is declared with, e.g. `LeadAttemptWire[]`. Drives
   *  the nested descent: a key whose type names an interface is followed. */
  types: Map<string, string>;
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
    const declared = [...m[3].matchAll(/^ {2}([A-Za-z_][A-Za-z_0-9]*)\??:\s*(.*?)\s*$/gm)];
    const types = new Map<string, string>();
    // Strip the trailing `//` note before the `;`, or a type reads as
    // `Component[]; // array of 7 items` and resolves to nothing — a nested
    // reference silently not followed, which is the exact failure this file is
    // supposed to make impossible.
    for (const d of declared) types.set(d[1], d[2].replace(/\/\/.*$/, '').replace(/;\s*$/, '').trim());
    out.set(m[1], { keys: declared.map((d) => d[1]), types, extends: (m[2] ?? '').trim(), body: m[3] });
  }
  return out;
}

/** A key's type resolved to the interface it names, with any `Omit<>` applied. */
interface Ref {
  name: string;
  dropped: Set<string>;
}

/**
 * The interface a key's type refers to, or `null` for scalars/inline objects.
 *
 * Unwraps exactly the four wrappers the two data layers actually use — nullable
 * union, array, `Omit<>`, and the bare name. Anything else (`unknown`, string
 * literal unions, an inline `{`) yields `null`, and the pairing test below turns
 * a one-sided `null` into a failure rather than a silent stop.
 */
function refOf(type: string): Ref | null {
  const t = type
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s !== 'null' && s !== 'undefined')
    .join('|')
    .replace(/\[\]$/, '')
    .trim();
  const omit = /^Omit<(\w+),\s*(.+)>$/.exec(t);
  if (omit) {
    return {
      name: omit[1],
      dropped: new Set(omit[2].split('|').map((s) => s.trim().replace(/['"]/g, ''))),
    };
  }
  return /^\w+$/.test(t) ? { name: t, dropped: new Set() } : null;
}

/**
 * Interfaces whose shape includes an INLINE nested object literal, e.g.
 * `attempts: { id: string; … }[]`. Key extraction is top-level-only (2-space
 * indent), so an inline block's inner keys are invisible to this test.
 *
 * **Now empty, and that is the point.** It used to hold three wire interfaces
 * (`LeadDetailWire`, `ProposalWire`, `AttemptDetailWire`) plus — unstated, on the
 * FE side — `AttemptDetail` and `DemoTaskDetail`. Every inline block became a
 * named interface, so all of them are compared. Like `route-parity`'s
 * `KNOWN_GAPS`, this list may only ever SHRINK: it is at zero, so a new entry
 * means re-opening a blind spot that is already closed, and needs a
 * `DECISIONS.md` line rather than a line here.
 */
const NESTED_INLINE_UNCHECKED: string[] = [];

/**
 * Flatten an interface to the `key → type` map it actually declares, following
 * `extends`. `Omit<X, 'a' | 'b'>` is resolved rather than skipped because
 * `LeadDetailWire` is built out of one (`Omit<LeadRowWire, 'open_attempt_count'>`)
 * — treating it as opaque would silently exempt the biggest lead payload.
 */
function flattenTypes(
  all: Map<string, Parsed>,
  name: string,
  seen = new Set<string>(),
): Map<string, string> {
  const out = new Map<string, string>();
  const node = all.get(name);
  if (!node || seen.has(name)) return out;
  seen.add(name);
  for (const raw of node.extends.split(/[,&]/)) {
    const part = raw.trim();
    if (part === '') continue;
    const ref = refOf(part);
    if (!ref) continue;
    for (const [k, t] of flattenTypes(all, ref.name, seen)) {
      if (!ref.dropped.has(k)) out.set(k, t);
    }
  }
  for (const [k, t] of node.types) out.set(k, t);
  return out;
}

function flatten(all: Map<string, Parsed>, name: string): string[] {
  return [...flattenTypes(all, name).keys()];
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
const FE_FILES = [
  'account.ts', 'ads.ts', 'ads-weekly.ts', 'block-requests.ts', 'board.ts', 'clients.ts', 'contract.ts', 'creative.ts',
  'finance.ts', 'health.ts', 'interview.ts', 'kol.ts', 'leads.ts', 'marketing.ts', 'milestone.ts',
  'livestream.ts', 'penugasan.ts', 'permintaan.ts', 'plan.ts',
  'performance.ts', 'portal.ts', 'recap.ts', 'renewal.ts', 'report.ts', 'riset-awal.ts', 'sales.ts', 'salesperf.ts', 'stage.ts', 'strategi.ts', 'tasks.ts', 'types.ts',
  // web-client-portal (M15-C2) — the external realm's own app, see FE_LIB_PORTAL.
  'klien/types.ts',
];

const fe = new Map<string, Parsed>();
for (const file of FE_FILES) {
  for (const [name, parsed] of parseInterfaces(readFileSync(feSourcePath(file), 'utf8'))) {
    fe.set(`${file}::${name}`, parsed);
  }
}

/** `extends` inside the FE tree is same-file, so qualify before recursing. */
function feScope(file: string): Map<string, Parsed> {
  const scoped = new Map<string, Parsed>();
  for (const [key, parsed] of fe) {
    if (key.startsWith(`${file}::`)) scoped.set(key.slice(file.length + 2), parsed);
  }
  return scoped;
}

function flattenTypesFe(qualified: string): Map<string, string> {
  const [file] = qualified.split('::');
  return flattenTypes(feScope(file), qualified.slice(file.length + 2));
}

function flattenFe(qualified: string): string[] {
  return [...flattenTypesFe(qualified).keys()];
}

/**
 * `file.ts` → (imported type name → the lib file it comes from).
 *
 * `portal.ts` is the reason this exists: it is a pure read-model that reuses
 * `Card` from `board.ts`, `Snapshot` from `performance.ts` and
 * `PendingBlockRequest` from `tasks.ts` — and all three of those names ALSO exist
 * in other lib files. The import statement is the file's own answer to "which
 * one", so it is read instead of guessed.
 */
const feImports = new Map<string, Map<string, string>>();
for (const file of FE_FILES) {
  const source = readFileSync(feSourcePath(file), 'utf8');
  const map = new Map<string, string>();
  const re = /import\s+type\s*\{([^}]+)\}\s*from\s*'@\/lib\/(\w[\w-]*)'/g;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name !== '') map.set(name, `${m[2]}.ts`);
    }
  }
  feImports.set(file, map);
}

/**
 * Qualify a bare FE type name seen inside `file`: same file, then its imports.
 *
 * Returns `'AMBIGUOUS'` instead of guessing when a bare name exists in several
 * files and the referring file neither declares nor imports it — guessing is
 * exactly the mistake the file-qualified registry exists to prevent
 * (`PendingBlockRequest`).
 */
function qualifyFe(file: string, name: string): string | 'AMBIGUOUS' | null {
  if (fe.has(`${file}::${name}`)) return `${file}::${name}`;
  const imported = feImports.get(file)?.get(name);
  if (imported !== undefined && fe.has(`${imported}::${name}`)) return `${imported}::${name}`;
  const elsewhere = [...fe.keys()].filter((k) => k.endsWith(`::${name}`));
  if (elsewhere.length === 1) return elsewhere[0];
  return elsewhere.length > 1 ? 'AMBIGUOUS' : null;
}

/**
 * One wire↔FE shape to compare: the two interfaces plus the keys an enclosing
 * `Omit<>` removed on either side.
 */
interface Pair {
  wire: string;
  fe: string;
  /** How this pair was reached — the registry, or `Parent.key` that referenced it. */
  via: string;
  wireDropped: Set<string>;
  feDropped: Set<string>;
}

/** Reason a nested reference could not be followed on both sides at once. */
interface Unfollowed {
  where: string;
  detail: string;
}

/**
 * Walk the registry pairs AND every nested reference reachable from them.
 *
 * This is what makes the guard depth-independent. Comparing only the registry's
 * top-level pairs left whole payload blocks unchecked — and not hypothetically:
 * `DemoTaskDetail.task` reads `description`, which the list type `DemoTask` does
 * not declare, so `description` sat in `ALLOWED_EXTRA` and deleting it from the
 * wire would have kept CI green while blanking the detail page.
 *
 * A reference is followed only when BOTH sides resolve to a named interface. The
 * one-sided cases are collected as `unfollowed` and asserted to be empty, so the
 * descent can never stop quietly.
 */
function walkPairs(): { pairs: Pair[]; unfollowed: Unfollowed[] } {
  const pairs: Pair[] = [];
  const unfollowed: Unfollowed[] = [];
  const seen = new Set<string>();
  const queue: Pair[] = Object.entries(WIRE_TO_FE).map(([w, f]) => ({
    wire: w,
    fe: f,
    via: 'WIRE_TO_FE',
    wireDropped: new Set<string>(),
    feDropped: new Set<string>(),
  }));

  for (let pair = queue.shift(); pair !== undefined; pair = queue.shift()) {
    const id = `${pair.wire}|${pair.fe}`;
    if (seen.has(id) || !fe.has(pair.fe)) continue;
    seen.add(id);
    pairs.push(pair);

    const wireTypes = flattenTypes(wire, pair.wire);
    const feTypes = flattenTypesFe(pair.fe);
    const [file] = pair.fe.split('::');
    for (const [key, wireType] of wireTypes) {
      if (pair.wireDropped.has(key) || pair.feDropped.has(key)) continue;
      const feType = feTypes.get(key);
      if (feType === undefined) continue; // key mismatch — reported by the diff tests
      const wireRef = refOf(wireType);
      const feRef = refOf(feType);
      const wireNested = wireRef !== null && wire.has(wireRef.name);
      const feQualified = feRef === null ? null : qualifyFe(file, feRef.name);
      const feNested = feQualified !== null && feQualified !== 'AMBIGUOUS';
      const where = `${pair.wire}.${key}`;
      if (feQualified === 'AMBIGUOUS') {
        unfollowed.push({ where, detail: `FE type '${feRef?.name}' exists in several lib files — qualify it` });
      } else if (wireNested && !feNested) {
        unfollowed.push({ where, detail: `wire nests '${wireRef?.name}' but FE declares '${feType}' (inline object? extract a named interface)` });
      } else if (!wireNested && feNested) {
        unfollowed.push({ where, detail: `FE nests '${feQualified}' but wire declares '${wireType}' (inline object? extract a named interface)` });
      } else if (wireNested && feNested && wireRef !== null && feQualified !== null) {
        queue.push({
          wire: wireRef.name,
          fe: feQualified,
          via: where,
          wireDropped: wireRef.dropped,
          feDropped: feRef?.dropped ?? new Set<string>(),
        });
      }
    }
  }
  return { pairs, unfollowed };
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
  // Kinerja Sales (M0 §7.1) — salesperf.ts
  SalesPerfRowWire: 'salesperf.ts::SalesPerfRow',
  SalesPerfMonthRowWire: 'salesperf.ts::SalesPerfMonthRow',
  LeadSourceRowWire: 'salesperf.ts::LeadSourceRow',
  SalesTargetWire: 'salesperf.ts::SalesTarget',
  // M0 sales — quote preview, attempt list/detail
  LineQuoteWire: 'sales.ts::LineQuote',
  QuoteWire: 'sales.ts::Quote',
  AttemptRowWire: 'sales.ts::AttemptRow',
  QualifiedFormServiceWire: 'sales.ts::QualifiedFormServiceRow',
  QualifiedFormWire: 'sales.ts::QualifiedFormSnapshot',
  ProposalWire: 'sales.ts::NegotiationProposalRow',
  ProposalLineWire: 'sales.ts::ProposalLineRow',
  AttemptDetailWire: 'sales.ts::AttemptDetail',
  AttemptDetailAttemptWire: 'sales.ts::AttemptDetailAttempt',
  AttemptDetailLeadWire: 'sales.ts::AttemptDetailLead',
  // R-03/R-04 (Kinerja Sales) — renewal/cross-sell (RNW-) on an existing client.
  RenewalWire: 'renewal.ts::Renewal',
  RenewalLineWire: 'renewal.ts::RenewalLine',
  RenewalDetailWire: 'renewal.ts::RenewalDetail',
  RenewalListRowWire: 'renewal.ts::RenewalListRow',
  // A REQUEST body, not a response — the only one in `wire.ts` with a named
  // interface, because three routes share its mapper (`toProposalLines`). It is
  // registered rather than exempted: the mechanical check is exactly the right one
  // for a body too. `no_nego` (body-parity's first live bug) was a route reading a
  // key by a different name than the FE sends, and a body whose keys are compared
  // to the FE's `ProposalLineInput` cannot drift that way. Direction reverses
  // (the FE emits, the route reads) but key-set equality is the same assertion.
  ProposalLineBody: 'sales.ts::ProposalLineInput',
  // M1 leads
  LeadStubWire: 'leads.ts::LeadStub',
  AttemptStubWire: 'leads.ts::AttemptStub',
  PoolRowWire: 'leads.ts::PoolRow',
  LeadRowWire: 'leads.ts::LeadRow',
  LeadDetailWire: 'leads.ts::LeadDetail',
  LeadAttemptWire: 'leads.ts::LeadAttemptRow',
  DeleteRequestWire: 'leads.ts::DeleteRequest',
  DeleteRequestQueueRowWire: 'leads.ts::DeleteRequestQueueRow',
  BulkRowResultWire: 'leads.ts::BulkRowResult',
  BulkReportWire: 'leads.ts::BulkReport',
  BatchRegisterRowResultWire: 'leads.ts::BatchRegisterRowResult',
  BatchRegisterReportWire: 'leads.ts::BatchRegisterReport',
  // Log aktivitas prospek (ACT-) — dibaca halaman /sales/{id} dan /leads/{id}.
  ActivityWire: 'leads.ts::ActivityRow',
  EffortSummaryWire: 'leads.ts::EffortSummary',
  // M2 marketing / M3 campaign
  PerformanceRecordWire: 'marketing.ts::Record',
  MarketingMetricsWire: 'marketing.ts::Metrics',
  JunkReasonWire: 'marketing.ts::JunkReason',
  MarketingCampaignWire: 'marketing.ts::Campaign',
  SelectableCampaignWire: 'marketing.ts::SelectableCampaign',
  CampaignRollupWire: 'marketing.ts::Rollup',
  CampaignClientWire: 'marketing.ts::CampaignClient',
  CampaignClientServiceWire: 'marketing.ts::CampaignClientService',
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
  SchemeChangeScheduleItemWire: 'finance.ts::SchemeChangeScheduleItem',
  SchemeChangeRequestWire: 'finance.ts::SchemeChangeRequest',
  // M6 account & service
  IntakeClientWire: 'account.ts::IntakeClient',
  AMWorkloadWire: 'account.ts::AMWorkload',
  AssignmentWire: 'account.ts::Assignment',
  StrategyWire: 'account.ts::Strategy',
  DivisionTaskWire: 'account.ts::DivisionTask',
  StrategyRequirementWire: 'account.ts::StrategyRequirement',
  ServiceQueueRowWire: 'account.ts::ServiceQueueRow',
  // M6C plan gate
  PlanGateWire: 'account.ts::PlanGate',
  PlanGateTriggerWire: 'account.ts::GateTrigger',
  PlanGateAssignmentSummaryWire: 'account.ts::AssignmentSummary',
  PlanGateConfigWire: 'account.ts::PlanGateConfig',
  PlanGateContextWire: 'account.ts::PlanGateContext',
  PlanGateRecommendationWire: 'account.ts::GateRecommendation',
  // M6B plan (PLAN-) route surface — RAB-14/15.
  PlanWire: 'plan.ts::Plan',
  PlanTargetWire: 'plan.ts::PlanTarget',
  PlanRowWire: 'plan.ts::PlanRow',
  PlanRowWeekWire: 'plan.ts::PlanRowWeek',
  PlanActualWire: 'plan.ts::PlanActual',
  // Read surface — the period bundle a Plan page loads (P-A…P-G) + its children.
  PlanReviewWire: 'plan.ts::PlanReview',
  PlanFlagWire: 'plan.ts::PlanFlag',
  PlanDetailWire: 'plan.ts::PlanDetail',
  PlanRowBriefWire: 'plan.ts::PlanRowBrief',
  // RAB-16 — one-click Brief inheritance result (created Briefs + skipped rows).
  BriefInheritResultWire: 'plan.ts::BriefInheritResult',
  BriefInheritSkipWire: 'plan.ts::BriefInheritSkip',
  // M6A — Vendor (VND-) and Strategi (STRG-). The Section A→J form is backlog
  // A-05…A-09; the FE types exist now because a converter with no declared FE
  // type is a converter this guard cannot check.
  // O57 — the Contract (CTR-) the Strategi hangs off.
  ContractWire: 'contract.ts::Contract',
  VendorWire: 'strategi.ts::Vendor',
  VendorDocumentWire: 'strategi.ts::VendorDocument',
  StrategiWire: 'strategi.ts::Strategi',
  StrategiQueueRowWire: 'strategi.ts::StrategiQueueRow',
  StrategiDetailWire: 'strategi.ts::StrategiDetail',
  StrategiChannelWire: 'strategi.ts::StrategiChannel',
  StrategiBaselineMonthWire: 'strategi.ts::StrategiBaselineMonth',
  StrategiTargetWire: 'strategi.ts::StrategiTarget',
  StrategiKomposisiWire: 'strategi.ts::StrategiKomposisi',
  StrategiAssumptionWire: 'strategi.ts::StrategiAssumption',
  StrategiPillarWire: 'strategi.ts::StrategiPillar',
  StrategiResourceWire: 'strategi.ts::StrategiResource',
  StrategiRiskWire: 'strategi.ts::StrategiRisk',
  StrategiEventWire: 'strategi.ts::StrategiEvent',
  StrategiKekuranganWire: 'strategi.ts::StrategiKekurangan',
  // RAB-09 — Interview → Strategi prefill (Blok D handoff + suggestions).
  StrategiPrefillWire: 'strategi.ts::StrategiPrefill',
  StrategiPrefillItemWire: 'strategi.ts::StrategiPrefillItem',
  // RAB-11/RAB-12 — riset awal baseline → Section B channel prefill.
  StrategiBaselinePrefillWire: 'strategi.ts::StrategiBaselinePrefill',
  StrategiChannelBaselineSuggestionWire: 'strategi.ts::StrategiChannelBaselineSuggestion',
  StrategiBaselineMonthSuggestionWire: 'strategi.ts::StrategiBaselineMonthSuggestion',
  StrategiGmvMixRincianWire: 'strategi.ts::StrategiGmvMixRincian',
  // A-05 Section A + A-15/A-16, and the repeatable structs A-06 stores as jsonb.
  // They are named interfaces rather than anonymous bags precisely so this guard
  // descends into them — a struct typed `Record<string, unknown>[]` is a shape
  // nothing compares.
  StrategiDecisionMakerWire: 'strategi.ts::StrategiDecisionMaker',
  StrategiAksesWire: 'strategi.ts::StrategiAkses',
  StrategiTopSkuWire: 'strategi.ts::StrategiTopSku',
  StrategiTopKeywordWire: 'strategi.ts::StrategiTopKeyword',
  StrategiKampanyeBoncosWire: 'strategi.ts::StrategiKampanyeBoncos',
  StrategiTopKreatorWire: 'strategi.ts::StrategiTopKreator',
  StrategiVoucherWire: 'strategi.ts::StrategiVoucher',
  StrategiKompetitorWire: 'strategi.ts::StrategiKompetitor',
  // A-07 Section C
  StrategiDiagnosaWire: 'strategi.ts::StrategiDiagnosa',
  StrategiQuickWinWire: 'strategi.ts::StrategiQuickWin',
  StrategiRisikoStrukturalWire: 'strategi.ts::StrategiRisikoStruktural',
  StrategiPrasyaratKlienWire: 'strategi.ts::StrategiPrasyaratKlien',
  // A-09b — Section E-12 / G-1 / G-2 / H-2 / I-2+I-4.
  StrategiKetergantunganWire: 'strategi.ts::StrategiKetergantungan',
  StrategiFaseWire: 'strategi.ts::StrategiFase',
  StrategiTanggalBesarWire: 'strategi.ts::StrategiTanggalBesar',
  StrategiTriggerRevisiWire: 'strategi.ts::StrategiTriggerRevisi',
  StrategiDispatchWire: 'strategi.ts::StrategiDispatch',
  StrategiFieldVisibilityWire: 'strategi.ts::StrategiFieldVisibility',
  // A-11 — the client share link `/s/{token}`.
  ShareLinkStatusWire: 'strategi.ts::ShareLinkStatus',
  ShareTokenCreatedWire: 'strategi.ts::ShareTokenCreated',
  // J-4 — auto-diff vs the previous version.
  StrategiDiffWire: 'strategi.ts::StrategiDiff',
  StrategiDiffEntryWire: 'strategi.ts::StrategiDiffEntry',
  // Modul Interview ("Kelola Klien" tab 1) — langkah 6.
  InterviewWire: 'interview.ts::Interview',
  InterviewRisetAwalWire: 'interview.ts::InterviewRisetAwal',
  TimelineStepWire: 'interview.ts::TimelineStep',
  KelolaKlienTimelineWire: 'interview.ts::KelolaKlienTimeline',
  HariLiburWire: 'types.ts::HariLibur',
  InterviewJadwalWire: 'interview.ts::InterviewJadwal',
  InterviewKualifikasiWire: 'interview.ts::InterviewKualifikasi',
  InterviewAnswerWire: 'interview.ts::InterviewAnswer',
  InterviewDetailWire: 'interview.ts::InterviewDetail',
  InterviewVerdictWire: 'interview.ts::InterviewVerdict',
  InterviewListRowWire: 'interview.ts::InterviewListRow',
  // Riset Awal Baseline (RAB-04/RAB-05) — the per-platform baseline read-model.
  RisetAwalBaselineWire: 'riset-awal.ts::RisetAwalBaseline',
  RisetAwalPlatformWire: 'riset-awal.ts::RisetAwalPlatform',
  RisetAwalAnalisaWire: 'riset-awal.ts::RisetAwalAnalisa',
  RisetAwalIsianWire: 'riset-awal.ts::RisetAwalIsian',
  // C1 — Mesin Laporan Klien: the report read-models.
  ClientReportSummaryWire: 'report.ts::ClientReportSummary',
  ClientReportBerkasWire: 'report.ts::ClientReportBerkas',
  ClientReportDetailWire: 'report.ts::ClientReportDetail',
  // Insight editable + gerbang publikasi (migrasi 20260908010000).
  ReportInsightWire: 'report.ts::ReportInsight',
  ReportRekomendasiWire: 'report.ts::Rekomendasi',
  ReportIndikatorWire: 'report.ts::Indikator',
  ReportInsightRevisiWire: 'report.ts::ReportInsightRevisi',
  ReportPublikasiWire: 'report.ts::ReportPublikasi',
  ReportInsightBundleWire: 'report.ts::ReportInsightBundle',
  // A REQUEST body (same reasoning as ProposalLineBody above): the insight the
  // editor PUTs. Paired with the FE's `ReportInsight` — the same six fields the
  // engine emits and the renderer consumes, so the editor cannot send a seventh
  // field or rename one without this failing.
  InsightDraftBody: 'report.ts::ReportInsight',
  // Client Portal (M15-C2) — paired against `web-client-portal`'s own lib, the
  // second FE app this guard now covers (see FE_LIB_PORTAL).
  PortalReportRowWire: 'klien/types.ts::PortalReportRow',
  PortalServiceProgressWire: 'klien/types.ts::PortalServiceProgress',
  PortalHealthWire: 'klien/types.ts::PortalHealthSummary',
  PortalComplaintAckWire: 'klien/types.ts::PortalComplaintAck',

  BriefWire: 'account.ts::Brief',
  ComplaintWire: 'account.ts::Complaint',
  // M6D rekap hasil mingguan (WRR-) — D-09b
  RecapWire: 'recap.ts::Recap',
  RecapDivisiWire: 'recap.ts::RecapDivisi',
  RecapMetrikWire: 'recap.ts::RecapMetrik',
  RecapCatatanWire: 'recap.ts::RecapCatatan',
  RecapCatatanDivisiWire: 'recap.ts::RecapCatatanDivisi',
  RecapDetailWire: 'recap.ts::RecapDetail',
  RecapServiceAktifWire: 'recap.ts::RecapServiceAktif',
  RecapKeluhanTerkaitWire: 'recap.ts::RecapKeluhanTerkait',
  // M7 creative
  AssetWire: 'creative.ts::Asset',
  MyAssetQueueItemWire: 'creative.ts::MyAssetQueueItem',
  // A REQUEST body (same reasoning as ProposalLineBody above): the fan-out batch
  // line the FE sends per PIC, mapped by `toAssetAssignments`.
  AssetAssignmentWire: 'creative.ts::AssetAssignmentInput',
  OutputEntryWire: 'creative.ts::DailyOutputEntry',
  DailyOutputDayWire: 'creative.ts::DailyOutputDay',
  ScanHoursReminderResultWire: 'creative.ts::ReminderScanResult',
  // M8 ads
  CampaignWire: 'ads.ts::Campaign',
  MetricEntryWire: 'ads.ts::MetricEntry',
  OptimizationWire: 'ads.ts::Optimization',
  // M8 laporan mingguan Advertiser (follow-up PR #172, pemilik 2026-08-19)
  AdsWeeklyMetricWire: 'ads-weekly.ts::AdsWeeklyMetric',
  AdsWeeklyReportWire: 'ads-weekly.ts::AdsWeeklyReport',
  AdsWeeklyReportViewWire: 'ads-weekly.ts::AdsWeeklyReportView',
  // M16 §4.2 Ads Management Date (LT-42)
  AdsManagementDateWire: 'ads.ts::AdsManagementDate',
  // M16 §5.5 Permintaan (REQ-)
  PermintaanWire: 'permintaan.ts::Permintaan',
  // M9 KOL
  BookingWire: 'kol.ts::Booking',
  MonthlyKolReportWire: 'kol.ts::MonthlyKolReport',
  PaymentRequestWire: 'kol.ts::PaymentRequest',
  BookingMetricsWire: 'kol.ts::BookingMetrics',
  CreatorListWire: 'kol.ts::CreatorList',
  // M10 live stream
  SessionWire: 'livestream.ts::Session',
  // LT-61 FE — vendor's own Brief-discovery list (§3.2 gap)
  VendorBriefWire: 'livestream.ts::VendorBrief',
  // M11 board
  DependencyWire: 'board.ts::Dependency',
  CardWire: 'board.ts::Card',
  // M12 task execution
  MetricsWire: 'tasks.ts::Metrics',
  BlockRequestWire: 'tasks.ts::BlockRequest',
  PendingBlockRequestWire: 'tasks.ts::PendingBlockRequest',
  // "Perlu Persetujuan Saya" (2026-08-31) — combined approval inbox queues.
  PendingHoldRequestWire: 'clients.ts::PendingHoldRequest',
  PendingEscalationWire: 'kol.ts::PendingEscalation',
  PendingStrategyReviewWire: 'account.ts::PendingStrategyReview',
  // M13 client health
  HealthComponentWire: 'health.ts::Component',
  HealthSnapshotWire: 'health.ts::Snapshot',
  RoasToggleWire: 'health.ts::ROASToggle',
  HealthScanResultWire: 'health.ts::ScanResult',
  HealthPortfolioRowWire: 'health.ts::HealthPortfolioRow',
  // T-4c client milestones
  MilestoneWire: 'milestone.ts::Milestone',
  // Penugasan Internal (TSK-)
  InternalTaskWire: 'penugasan.ts::Penugasan',
  DisciplineRowWire: 'penugasan.ts::RekapDisiplin',
  // M14 team performance
  PerfComponentWire: 'performance.ts::SnapshotComponent',
  PerfModifierWire: 'performance.ts::PerformanceModifier',
  PerfSnapshotWire: 'performance.ts::Snapshot',
  PerfTeamRollupWire: 'performance.ts::TeamRollup',
  PerfTeamMemberWire: 'performance.ts::TeamMember',
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
  VendorAccountWire: 'types.ts::VendorAccount',
  ClientContactAccountWire: 'types.ts::ClientContactAccount',
  AssignableEmployeeWire: 'types.ts::AssignableEmployee',
  RoleMappingWire: 'types.ts::RoleMapping',
  LayeredRoleWire: 'types.ts::LayeredRole',
  CredentialInfoWire: 'types.ts::CredentialInfo',
  AuditEntryWire: 'types.ts::AuditEntry',
  DemoTaskWire: 'types.ts::DemoTask',
  DemoTaskDetailWire: 'types.ts::DemoTaskDetail',
  // M16 — Tahapan Produksi Brief (lead time per divisi)
  StageDefWire: 'stage.ts::StageDef',
  StageLeadTimeRowWire: 'stage.ts::StageLeadTimeRow',
  StageReviewWire: 'stage.ts::StageReview',
  StageIntakeWire: 'stage.ts::StageIntake',
  StageOverviewWire: 'stage.ts::StageOverview',
  NextStageWire: 'stage.ts::NextStage', // LT-60
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
  // (`MasterServiceWire` used to allow `requires_strategy_plan` as an extra —
  // the MSL list did not surface the M6-OA-1 pin. O54 made the tier a Sales-Head
  // setting on this very page, so both `requires_strategy_plan` and `plan_tier`
  // are now declared FE-side and the allowance is gone. Do not re-add it: an
  // entry here means the admin page cannot see a field it is meant to edit.)
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
      // 'payment_status' (added 2026-09-02 for the Client Record's Payment
      // Intent lock) is the same narrow-roster story as the rest of this
      // list — the roster page never reads it, only GET /clients/{id} does.
      'payment_status',
    ],
    decision: 'DECISIONS O43 (a), owner 2026-07-29',
  },
};

const { pairs, unfollowed } = walkPairs();

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

  it('reaches the nested blocks too — every reference is followed on both sides', () => {
    // The descent is only as good as its ability to say "I stopped here". A
    // one-sided reference (named on one side, inline object or ambiguous on the
    // other) means a whole block goes uncompared while CI stays green.
    const lines = unfollowed.map((u) => `${u.where}: ${u.detail}`);
    expect(lines, `nested references the guard could not follow:\n${lines.join('\n')}`).toEqual([]);
    // And it really descends: pairs found by recursion, not just the registry.
    const nested = pairs.filter((p) => p.via !== 'WIRE_TO_FE');
    expect(nested.length).toBeGreaterThan(0);
    expect(pairs.map((p) => `${p.wire}|${p.fe}`)).toContain('DemoTaskWire|types.ts::DemoTaskDetailTask');
  });

  it('emits every key the FE declares, except the documented divergences', () => {
    const broken: string[] = [];
    for (const pair of pairs) {
      const emitted = new Set(flatten(wire, pair.wire));
      const exempt = new Set(APPROVED_DIVERGENCE[pair.wire]?.keys ?? []);
      const missing = flattenFe(pair.fe).filter(
        (k) => !emitted.has(k) && !exempt.has(k) && !pair.feDropped.has(k) && !pair.wireDropped.has(k),
      );
      if (missing.length > 0) {
        broken.push(`${pair.wire} (serves ${pair.fe}, via ${pair.via}) never emits: ${missing.join(', ')}`);
      }
    }
    // Each line is a page reading `undefined` for a field it renders — the
    // O43/O41 failure mode, which answers 200 and leaves no error trace.
    expect(broken, `response shapes the FE cannot render:\n${broken.join('\n')}`).toEqual([]);
  });

  it('emits no key outside the FE contract unless allow-listed', () => {
    const undeclared: string[] = [];
    for (const pair of pairs) {
      const declared = new Set(flattenFe(pair.fe));
      const allowed = new Set(ALLOWED_EXTRA[pair.wire] ?? []);
      const extra = flatten(wire, pair.wire).filter(
        (k) => !declared.has(k) && !allowed.has(k) && !pair.wireDropped.has(k),
      );
      if (extra.length > 0) {
        undeclared.push(`${pair.wire} (serves ${pair.fe}): ${extra.join(', ')}`);
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

  it('has no inline-nested blind spot left — on EITHER side of the boundary', () => {
    // A limit nobody can see is worse than no limit: green CI would read as full
    // coverage. So the list is asserted against the files, not just written down.
    // It is now empty, which is a stronger statement than "accurate": every
    // nested block on both sides is a named interface, so all of it is compared.
    const inline = (source: Map<string, Parsed>, label: string) =>
      [...source]
        .filter(([, p]) => /^ {4}[A-Za-z_]\w*\??:/m.test(p.body))
        .map(([name]) => `${label}${name}`);
    const reachableFe = new Set(pairs.map((p) => p.fe));
    const found = [
      ...inline(wire, ''),
      // FE side, limited to types this guard actually pairs against: an inline
      // block there is the same blind spot seen from the other end, and it was
      // never even stated before (`AttemptDetail`, `DemoTaskDetail`).
      ...inline(new Map([...fe].filter(([k]) => reachableFe.has(k))), 'FE '),
    ];
    expect(found.sort()).toEqual([...NESTED_INLINE_UNCHECKED].sort());
  });

  it('locks the four blocks that used to be inline (positive assertions)', () => {
    // Absence from a diff is not evidence when the diff never looked. These are
    // the inner keys that were invisible until the blocks were named.
    expect(flatten(wire, 'LeadAttemptWire')).toContain('owner_nama');
    expect(flatten(wire, 'ProposalLineWire')).toContain('payment_terms');
    expect(flatten(wire, 'AttemptDetailAttemptWire')).toContain('owner_employee_id');
    expect(flatten(wire, 'AttemptDetailLeadWire')).toContain('winning_attempt_id');
    // The narrow lead block must stay narrow — it is not `LeadRowWire`.
    expect(flatten(wire, 'AttemptDetailLeadWire')).not.toContain('origin_division');
    // The detail surface reads `description`; the list type does not declare it.
    expect(flatten(wire, 'DemoTaskWire')).toContain('description');
    expect(flattenFe('types.ts::DemoTaskDetailTask')).toContain('description');
    expect(flattenFe('types.ts::DemoTask')).not.toContain('description');
  });

  it('keeps the M5 money path exactly as the FE reads it (O41 regression)', () => {
    // Positive assertions, not just absence from a diff: this is the shape whose
    // absence made the [Bermasalah] button unusable in production.
    expect(flatten(wire, 'BermasalahStatusWire')).toContain('escalated');
    expect(flatten(wire, 'InstallmentWire')).toContain('proof_of_payment');
    expect(flatten(wire, 'RemindersWire')).toContain('outstanding_no_due_date');
  });
});
