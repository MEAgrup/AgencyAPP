/**
 * Nested-key wire contract for the three endpoints A-13c wired up:
 * `PUT /strategi/{id}/targets`, `/assumptions` and `/ketergantungan`.
 *
 * ## The hole this fills
 *
 * `body-parity.test.ts` compares request-body keys between the frontend and the
 * route — but only the **top level**. All three of these bodies are a single key
 * wrapping an ARRAY of structs (`{ targets: [...] }`, `{ assumptions: [...] }`,
 * `{ ketergantungan: [...] }`), so body-parity proves exactly one thing about
 * each: that the word `targets` appears in both halves. Every field that
 * actually carries an answer — `month_index`, `nilai_floor`, `cara_verifikasi`,
 * `target_terkait`, `konsekuensi` — sits one level down, where nothing was
 * looking.
 *
 * That matters here more than for a flat body, because the `*FromWire`
 * translators read missing keys through `str()` / `Number(x ?? 0)`. A misspelled
 * nested key does not throw and does not arrive as `undefined`: it arrives as
 * `''` or `0`, which is a DIFFERENT VALID-LOOKING REQUEST. `month_index` read as
 * `0` fails the domain's range check with `[data tidak lengkap …]` — an error
 * that names the wrong problem and sends the AM to look at a box they filled in
 * correctly.
 *
 * ## What is asserted
 *
 * The rows below are the shapes `web-internal/src/lib/strategi-target.ts` and
 * `SectionE.tsx` build — copied deliberately, not imported. `web-internal` is a
 * separate package outside this workspace, so importing is not available; and a
 * shared literal would not be a check anyway, since both sides changing together
 * is exactly the drift a contract test is supposed to catch. If the frontend's
 * row shape changes, this file must change with it — that is the point.
 */
import { describe, expect, it } from 'vitest';
import {
  strategiAssumptionsFromWire,
  strategiKetergantunganFromWire,
  strategiTargetsFromWire,
} from './wire';

describe('PUT /strategi/{id}/targets — nested row keys (D-1/D-2/D-4)', () => {
  // Exactly what `gmvCellsToBody` / `supportRowsToBody` emit.
  const gmvRow = {
    channel: 'Shopee',
    month_index: 3,
    metric: 'gmv',
    nilai_floor: '400000000.00',
    nilai_stretch: '460000000.00',
  };

  it('carries every GMV field through to the domain input', () => {
    expect(strategiTargetsFromWire([gmvRow])).toEqual([
      {
        channel: 'Shopee',
        monthIndex: 3,
        metric: 'gmv',
        nilaiFloor: '400000000.00',
        nilaiStretch: '460000000.00',
      },
    ]);
  });

  it('carries a D-4 supporting row, whose floor is null rather than absent', () => {
    // `ck_strtg_floor_gmv_only` refuses a floor on a non-GMV metric, so `null`
    // is the answer — and an ABSENT key would read as null too, which is why
    // this asserts the value rather than the key's presence.
    expect(
      strategiTargetsFromWire([
        { channel: 'Shopee', month_index: 1, metric: 'aov', nilai_floor: null, nilai_stretch: '90' },
      ]),
    ).toEqual([
      { channel: 'Shopee', monthIndex: 1, metric: 'aov', nilaiFloor: null, nilaiStretch: '90' },
    ]);
  });

  it('degrades a misspelled month_index to 0, not to undefined — the reason this file exists', () => {
    // Pinning the degradation, not endorsing it: `monthIndex: 0` fails the
    // domain's 1…36 range check with `[data tidak lengkap …]`, so a nested-key
    // typo surfaces as a validation error about a field the AM filled in
    // correctly. Nothing upstream of the domain would have caught it.
    const [bad] = strategiTargetsFromWire([{ ...gmvRow, month_index: undefined, monthIndex: 3 }]);
    expect(bad.monthIndex).toBe(0);
  });

  it('never accepts sumber_floor from the wire (O57)', () => {
    // It records the APPROVAL PATH and is set server-side at Head approval.
    // Reading it here would let the AM who types the floor also mark it approved.
    const [row] = strategiTargetsFromWire([{ ...gmvRow, sumber_floor: 'disetujui_head' }]);
    expect(row).not.toHaveProperty('sumberFloor');
  });
});

describe('PUT /strategi/{id}/assumptions — nested row keys (D-8/D-9)', () => {
  // Exactly what `assumptionsToBody` emits, after `pruneTargetTerkait`.
  const row = {
    kode: 'AS-1',
    asumsi: 'budget iklan cair tiap tanggal 1',
    pemilik: 'Klien',
    cara_verifikasi: 'cek mutasi rekening',
    target_terkait: ['gmv:Shopee:1', 'gmv:TikTok Shop:2'],
  };

  it('carries all four required fields plus the D-9 mapping', () => {
    expect(strategiAssumptionsFromWire([row])).toEqual([
      {
        kode: 'AS-1',
        asumsi: 'budget iklan cair tiap tanggal 1',
        pemilik: 'Klien',
        caraVerifikasi: 'cek mutasi rekening',
        status: undefined,
        targetTerkait: ['gmv:Shopee:1', 'gmv:TikTok Shop:2'],
      },
    ]);
  });

  it('keeps target keys byte-identical — they are matched by string equality', () => {
    // `saveAssumptions` checks membership of these strings in the set built by
    // `targetKey(metric, channel, month_index)`, and `checkCompleteness` computes
    // Rule 8 coverage the same way. Any normalisation here — trimming, casing,
    // re-encoding the space in "TikTok Shop" — would turn a correct mapping into
    // `[asumsi menunjuk target yang tidak ada]`.
    const [out] = strategiAssumptionsFromWire([row]);
    expect(out.targetTerkait).toEqual(row.target_terkait);
  });

  it('leaves status undefined when the form omits it, so the domain defaults it', () => {
    // The form never sends a status: a new assumption is `Berlaku`, and flipping
    // one to `Gugur` is a separate endpoint reachable while `Aktif`. Sending a
    // status here would let a Draft-only save overwrite a flip made in execution.
    const [out] = strategiAssumptionsFromWire([row]);
    expect(out.status).toBeUndefined();
  });

  it('reads an absent target_terkait as an empty mapping, not as undefined', () => {
    // D-9 is optional per assumption (Rule 8 is checked from the target side),
    // so "no targets" must be a list, not a hole the domain has to test for.
    const [out] = strategiAssumptionsFromWire([{ ...row, target_terkait: undefined }]);
    expect(out.targetTerkait).toEqual([]);
  });
});

describe('PUT /strategi/{id}/ketergantungan — nested row keys (E-12)', () => {
  it('carries all three fields, konsekuensi included', () => {
    // `konsekuensi` is the field that makes E-12 a different question from C-7.
    // Losing it would leave two indistinguishable prerequisite lists, which is
    // how one of them ends up empty (DECISIONS 2026-08-08, A-09b).
    expect(
      strategiKetergantunganFromWire([
        {
          item: 'Budget iklan Rp 41jt cair',
          kapan: 'tiap tanggal 1',
          konsekuensi: 'Fase scale mundur satu minggu',
        },
      ]),
    ).toEqual([
      {
        item: 'Budget iklan Rp 41jt cair',
        kapan: 'tiap tanggal 1',
        konsekuensi: 'Fase scale mundur satu minggu',
        urutan: 0,
      },
    ]);
  });

  it('falls back to array order when the form omits urutan', () => {
    // The form deliberately does not send `urutan` — the array order IS the
    // order on screen, and a second copy of the same fact could disagree with it.
    const rows = strategiKetergantunganFromWire([
      { item: 'a', kapan: 'x', konsekuensi: 'y' },
      { item: 'b', kapan: 'x', konsekuensi: 'y' },
    ]);
    expect(rows.map((r) => r.urutan)).toEqual([0, 1]);
  });
});
