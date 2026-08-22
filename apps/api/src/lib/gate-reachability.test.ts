/**
 * Submit-gate reachability guard — the third parity check, and the one that
 * would have caught A-13b.
 *
 * ## What the existing two cannot see
 *
 * `route-parity` compares the paths the frontend CALLS against the paths
 * `apps/api` serves. `body-parity` compares the keys inside those requests. Both
 * start from a call the frontend already makes, so neither can see a path that
 * **nobody calls at all** — and a required field whose only endpoint has no
 * caller is invisible to both while being fatal to the user.
 *
 * That is exactly what shipped: after A-13b the Strategi form had nine of ten
 * sections, every route it used was served, every body key matched, all three
 * guards were green — and **no Strategi could be submitted from the UI at all**,
 * because D-2, D-8 and E-12 are submit requirements whose endpoints
 * (`/targets`, `/assumptions`, `/ketergantungan`) had zero callers anywhere in
 * `web-internal/src`. Every record showed a permanent gap count and `Ajukan` was
 * always answered `[data tidak lengkap, silahkan lengkapi semua pertanyaan
 * wajib!]`. It was found by reading the code, not by a test.
 *
 * ## What this asserts
 *
 * Every kode `checkCompleteness` can emit must appear in `DOORS` below, naming
 * the frontend function that writes the field — and that function must have a
 * caller somewhere in `web-internal/src` **outside its own definition file**.
 *
 * Both halves matter. The second is the reachability check; the first is what
 * makes it survive: a new required field added to `checkCompleteness` fails this
 * test until someone writes down which door answers it. That is the moment to
 * notice there is no door, rather than three sessions later.
 *
 * ## Read this before "fixing" a red run
 *
 * A red line here means one of two things and neither is fixed by editing the
 * list to match:
 *
 * - **A new gate with no `DOORS` row** ⇒ decide which endpoint answers it. If
 *   the honest answer is "none yet", the field is unanswerable from the UI and
 *   the gate is unpassable — the same state A-13b shipped in.
 * - **A door with no caller** ⇒ the endpoint exists and nothing opens it. Wire
 *   the form, do not delete the row.
 *
 * Deleting a row to get green re-creates the exact hole this file exists to
 * close.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FE_SRC, REPO_ROOT, stripComments, walkFe } from './parity-scan';

const DOMAIN_STRATEGI = join(REPO_ROOT, 'packages/domain/src/strategi.ts');
/** Where the client functions are DEFINED — a mention here is not a caller. */
const FE_CLIENT = join(FE_SRC, 'lib/strategi.ts');

/**
 * The frontend function that lets an AM answer each gated field.
 *
 * Keyed by the kode WITHOUT its `/{channel}` suffix — the channel names the row,
 * not the question, and `D-2/Shopee` and `D-2/TikTok Shop` are the same field
 * behind the same endpoint.
 *
 * Several kodes legitimately share a door: Section B's baseline groups are all
 * one `PUT /channels/{id}/baseline`, and E-1/E-13/H-3 share `/narasi`. That is
 * fine — the guard asks whether a door exists and is opened, not whether each
 * field has a private one.
 */
const DOORS: Readonly<Record<string, string>> = {
  // Section A — every `W` field is a header scalar on the konteks endpoint,
  // except the A-15 access matrix, which is per channel and has its own table.
  // A-11 and A-14 are the O58 list-XOR-"tidak ada" pair; the flag rides the same
  // body as the list, so they share the door.
  // A-1, A-5, A-8, A-10, A-12 moved to the Interview form and are no longer gated
  // in Strategi — owner QA 2026-08-20 (Fase 2 §3.A), DECISIONS.md. A-7 (plafon)
  // retired earlier (same date). Their rows are removed so the "DOORS free of stale
  // rows" guard stays green; `saveStrategiKonteks` stays open via the rows below.
  'A-2': 'saveStrategiKonteks',
  'A-3': 'saveStrategiKonteks',
  'A-4': 'saveStrategiKonteks',
  'A-6': 'saveStrategiKonteks',
  'A-9': 'saveStrategiKonteks',
  'A-11': 'saveStrategiKonteks',
  'A-13': 'saveStrategiKonteks',
  // A-14 (aset) stays gated — the owner kept it as the Strategi checklist.
  'A-14': 'saveStrategiKonteks',
  'A-15': 'saveStrategiAkses',

  // Section B — channel metadata, then the per-channel baseline months. Every
  // B-n.m group is the same endpoint; B-0 ("no channel at all") is answered by
  // declaring one.
  'B-0': 'saveStrategiChannels',
  // B-0.3/0.5/0.6/0.8 — store identity, launch date, baseline window+source, and
  // the short-window reason. Since owner QA 2026-08-22 these are gated at submit
  // (a Draft may save them blank); all live on the channel row, so the AM answers
  // them in Section B via `saveStrategiChannels`.
  'B-0.3': 'saveStrategiChannels',
  'B-0.5': 'saveStrategiChannels',
  'B-0.6': 'saveStrategiChannels',
  'B-0.8': 'saveStrategiChannels',
  'B-1': 'saveStrategiBaseline',
  'B-2': 'saveStrategiBaseline',
  'B-3': 'saveStrategiBaseline',
  'B-3.3': 'saveStrategiBaseline',
  'B-4': 'saveStrategiBaseline',
  'B-5': 'saveStrategiBaseline',
  'B-5.3': 'saveStrategiBaseline',
  'B-6': 'saveStrategiBaseline',
  'B-7': 'saveStrategiBaseline',
  'B-8': 'saveStrategiBaseline',
  'B-8.1': 'saveStrategiBaseline',
  'B-8.2': 'saveStrategiBaseline',
  'B-9': 'saveStrategiBaseline',
  'B-9.1': 'saveStrategiBaseline',

  // Section C — one atomic set (diagnosa + quick wins + risks + prereqs).
  'C-1': 'saveStrategiDiagnosa',
  'C-3': 'saveStrategiDiagnosa',
  'C-4': 'saveStrategiDiagnosa',
  'C-5': 'saveStrategiDiagnosa',
  'C-6': 'saveStrategiDiagnosa',
  'C-7': 'saveStrategiDiagnosa',

  // Section D (A-13c). These three were the hole.
  'D-2': 'saveStrategiTargets',
  // D-4 shares the endpoint with D-2 — one `strategi_target` table, one
  // replace-set. Gated since X-15 (owner, 2026-08-09) at MINIMAL ONE row per
  // channel; the editor is the "target metrik pendukung" list in SectionD.
  'D-4': 'saveStrategiTargets',
  'D-5': 'saveStrategiKpi',
  'D-6': 'saveStrategiKpi',
  'D-8': 'saveStrategiAssumptions',
  // Rule 8 ("every target carries an assumption") is not a field — it is the
  // D-9 mapping, which rides the assumptions endpoint.
  'Rule 8': 'saveStrategiAssumptions',

  // Section E. E-2 is stored on the channel row and so is saved by Section B —
  // `saveChannels` does DELETE-then-INSERT, which is exactly why E-2 could not
  // have its own table or its own endpoint (DECISIONS 2026-08-08, A-09b).
  'E-1': 'saveStrategiNarasi',
  'E-2': 'saveStrategiChannels',
  // E-11 (out-of-scope) and E-12 (ketergantungan klien) retired as submit gates —
  // owner QA decision 2026-08-20 (Fase 2), DECISIONS.md. `checkCompleteness` no
  // longer emits them, so their DOORS rows are removed to keep this list honest
  // (the "keeps DOORS free of rows the gate no longer emits" guard). The editors
  // and endpoints (`saveStrategiPillars`, `saveStrategiKetergantungan`) stay — the
  // fields are optional now, not gone.
  'E-13': 'saveStrategiNarasi',

  // Section G. G-0 (`tanggal_mulai_siklus`) is on the header endpoint, not the
  // calendar one: Rule 17 locks it once period 1 closes, so it must not ride an
  // autosave.
  'G-0': 'updateStrategiHeader',
  'G-1': 'saveStrategiKalender',
  'G-2': 'saveStrategiKalender',
  'G-3': 'saveStrategiKalender',
  'G-4': 'saveStrategiKalender',

  // Section H — risks, revision triggers, and the shared narasi paragraphs.
  'H-1': 'saveStrategiRisks',
  'H-2': 'saveStrategiTriggerRevisi',
  'H-3': 'saveStrategiNarasi',

  // Section I.
  'I-2': 'saveStrategiHandoff',
  'I-3': 'saveStrategiHandoff',
};

/**
 * Extracts the gate kodes `checkCompleteness` and its helpers can emit.
 *
 * Scans from `checkCompleteness` to the end of the file — everything below it is
 * its helpers — with comments stripped, so a kode named only in prose cannot
 * satisfy the guard.
 *
 * Two literal shapes carry a kode, and both are matched:
 *   `out.push({ kode: 'D-5', … })`            → plain
 *   `out.push({ kode: \`D-2/\${c.channel}\` })` → per-channel, suffix dropped
 * plus the group codes handed to the Section B helper (`grup('B-2', …)`,
 * `['B-5.3', …]`), which reach `out` as `` `${kode}/${channel}` ``.
 */
function gateKodes(): string[] {
  const src = stripComments(readFileSync(DOMAIN_STRATEGI, 'utf8'));
  const start = src.indexOf('export async function checkCompleteness');
  expect(start).toBeGreaterThan(-1);
  const region = src.slice(start);

  const found = new Set<string>();
  // Any quoted or backticked literal that LOOKS like a gate kode. Deliberately
  // broad: over-matching costs a `DOORS` row, under-matching costs the guard.
  const shape = /(?:'|`)((?:[A-J]-\d+(?:\.\d+)?|Rule \d+))(?:\/\$\{[^}]*\})?(?:'|`)/g;
  for (const m of region.matchAll(shape)) found.add(m[1]);
  return [...found].sort();
}

/** Every FE identifier that is CALLED somewhere other than where it is defined. */
function feCallers(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of walkFe(FE_SRC)) {
    if (file === FE_CLIENT) continue; // definitions, not calls
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/\b(saveStrategi\w+|updateStrategiHeader)\s*\(/g)) {
      const list = out.get(m[1]) ?? [];
      if (!list.includes(file)) list.push(file);
      out.set(m[1], list);
    }
  }
  return out;
}

describe('submit-gate reachability', () => {
  const kodes = gateKodes();
  const callers = feCallers();

  it('finds the gate and the callers (guards against the scan silently breaking)', () => {
    // Without this, a regex that matches nothing makes every assertion below
    // vacuously green — the failure mode that lets a guard rot unnoticed.
    expect(kodes.length).toBeGreaterThan(25);
    expect(callers.size).toBeGreaterThan(10);
    // The A-13c fields must be in scope by name: they are the reason this file
    // exists, and a scan that stopped finding them would pass while the form
    // regressed to exactly the state it was written to detect. E-12 was the third
    // canary until owner QA 2026-08-20 (Fase 2) retired it as a gate (DECISIONS.md);
    // D-4 replaces it here — still a per-channel Section D gate the scan must see.
    expect(kodes).toContain('D-2');
    expect(kodes).toContain('D-8');
    expect(kodes).toContain('D-4');
  });

  it('has a declared door for every field the submit gate can report', () => {
    const undeclared = kodes.filter((k) => DOORS[k] === undefined);
    expect(
      undeclared,
      `Gate kode(s) with no DOORS row: ${undeclared.join(', ')}. ` +
        'Name the frontend function that lets an AM answer the field. If there ' +
        'is none, the gate cannot be passed from the UI — that is the bug, not ' +
        'this test.',
    ).toEqual([]);
  });

  it('opens every declared door from somewhere in the frontend', () => {
    // The A-13b failure, stated as an assertion: `saveStrategiTargets`,
    // `saveStrategiAssumptions` and `saveStrategiKetergantungan` existed, were
    // served, matched on body keys — and had zero callers, so three required
    // fields had no box to type in and no Strategi could ever be submitted.
    const shut = [...new Set(Object.values(DOORS))]
      .filter((fn) => !callers.has(fn))
      .sort();
    expect(
      shut,
      `Endpoint wrapper(s) with no caller in web-internal/src: ${shut.join(', ')}. ` +
        'A required field with an unreachable endpoint makes the submit gate ' +
        'unpassable. Wire the form — do not delete the DOORS row.',
    ).toEqual([]);
  });

  it('keeps DOORS free of rows the gate no longer emits', () => {
    // A stale row is not harmless: it is a claim that a field is gated, and the
    // next reader trusts the list to say what submit requires.
    const stale = Object.keys(DOORS).filter((k) => !kodes.includes(k));
    expect(stale, `DOORS rows for kodes the gate never emits: ${stale.join(', ')}`).toEqual([]);
  });
});
