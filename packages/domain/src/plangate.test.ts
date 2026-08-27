/**
 * Module 6C tests.
 *
 * - Unit: the trigger table (Rule 3) and the effective-gate precedence, driven by
 *   the PRD's own worked examples in §9 — Sini Store's Ads service, its one-off
 *   photo job, and the KOL package that joins in month 2. If the engine cannot
 *   reproduce the three cases the PRD spells out, it is wrong regardless of what
 *   the code reads like.
 * - Unit: the conditional-required matrix (GB-5/GB-6/GB-8), including the
 *   override counter-case §9 ends on.
 * - Integration (skipped unless DATABASE_URL is set): determination is recorded,
 *   audited, and the Brief gate obeys it; escalation/de-escalation asymmetry.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  ForbiddenError, ValidationError, ConflictError, guardBriefCreation, getService, MSG_STRATEGY_REQUIRED,
} from './account';
import { createStrategi } from './strategi';
import {
  DECISION_BUTUH_PLAN,
  DECISION_TANPA_PLAN,
  FIT_SESUAI,
  FIT_TAMBAH_PLAN,
  FIT_TOLAK_PLAN,
  MSG_DEESCALATION_FORBIDDEN,
  MSG_FULL_MGMT_PLAN,
  MSG_MONITORING_REQUIRED,
  MSG_REASON_REQUIRED,
  MSG_SUMMARY_REQUIRED,
  MSG_TIER_LOCKED,
  TIER_DITENTUKAN_AM,
  TIER_PLAN_WAJIB,
  TIER_TANPA_PLAN,
  type GateAttributes,
  type GateConfig,
  type GateDecisionInput,
  decideGate,
  effectiveGate,
  fitOf,
  recommend,
  redecideGate,
  validateDecision,
} from './plangate';

// M6C §10 defaults — the same numbers plan_gate_config version 1 is seeded with.
const CFG: GateConfig = {
  versionNo: 1,
  kuotaThreshold: 20,
  nilaiThreshold: '15000000.00',
  durasiThresholdBulan: 1,
  notifJoinThreshold: '15000000.00',
};

const NOTHING: GateAttributes = {
  durasiBulan: null,
  berulang: false,
  divisiTerlibat: [],
  targetJenis: null,
  kuotaPerPeriode: null,
  nilaiPerBulan: null,
  sequenceDependency: false,
  laporanPeriodik: false,
};

const codes = (ts: { kode: string }[]) => ts.map((t) => t.kode).sort();

// ---------------------------------------------------------------------------
// Rule 3 — the trigger table, via the PRD's worked examples (§9).
// ---------------------------------------------------------------------------
describe('recommend — M6C §9 worked examples', () => {
  it('Sini Store Ads Management: 2 hard + 1 soft → butuh_plan', () => {
    // "Ads Management, 3 months, Rp 12jt/month, ROAS target 5.0. Triggers:
    // duration > 1 month ✅ (hard), numeric target ✅ (hard), single division,
    // value below threshold, no sequence dependency, monthly report owed ✅ (soft)."
    const r = recommend(
      {
        ...NOTHING,
        durasiBulan: 3,
        divisiTerlibat: ['Ads'],
        targetJenis: 'roas',
        nilaiPerBulan: '12000000.00',
        laporanPeriodik: true,
      },
      CFG,
    );
    expect(codes(r.pemicuKeras)).toEqual(['durasi_atau_berulang', 'target_numerik']);
    expect(codes(r.pemicuLunak)).toEqual(['laporan_atau_sla']);
    expect(r.rekomendasi).toBe(DECISION_BUTUH_PLAN);
  });

  it('KOL package month 2: 1 hard (duration) + 1 soft (quota 25 > 20) → butuh_plan', () => {
    // "25 creators, 2 months, Rp 9jt/month. Triggers: duration > 1 month ✅
    // (hard), quota 25 above the 20 threshold ✅ (soft). One hard → recommends."
    const r = recommend(
      { ...NOTHING, durasiBulan: 2, divisiTerlibat: ['KOL'], kuotaPerPeriode: 25, nilaiPerBulan: '9000000.00' },
      CFG,
    );
    expect(codes(r.pemicuKeras)).toEqual(['durasi_atau_berulang']);
    expect(codes(r.pemicuLunak)).toEqual(['kuota_besar']);
    expect(r.rekomendasi).toBe(DECISION_BUTUH_PLAN);
  });

  it('one-off product photo: nothing fires → tanpa_plan', () => {
    // "40 photos, 3 weeks, Rp 6jt." Three weeks is below the 1-month threshold
    // and 40 photos is a one-off total, not a per-period quota.
    const r = recommend(
      { ...NOTHING, durasiBulan: 0.75, divisiTerlibat: ['Creative'], nilaiPerBulan: '6000000.00' },
      CFG,
    );
    expect(r.pemicuKeras).toEqual([]);
    expect(r.pemicuLunak).toEqual([]);
    expect(r.rekomendasi).toBe(DECISION_TANPA_PLAN);
  });
});

describe('recommend — trigger arithmetic', () => {
  it('a single hard trigger is enough, with zero soft', () => {
    const r = recommend({ ...NOTHING, divisiTerlibat: ['Creative', 'Ads'] }, CFG);
    expect(codes(r.pemicuKeras)).toEqual(['lintas_divisi']);
    expect(r.rekomendasi).toBe(DECISION_BUTUH_PLAN);
  });

  it('one soft trigger alone is NOT enough', () => {
    const r = recommend({ ...NOTHING, divisiTerlibat: ['Ads'], laporanPeriodik: true }, CFG);
    expect(r.pemicuKeras).toEqual([]);
    expect(r.pemicuLunak).toHaveLength(1);
    expect(r.rekomendasi).toBe(DECISION_TANPA_PLAN);
  });

  it('two soft triggers are enough', () => {
    const r = recommend(
      { ...NOTHING, divisiTerlibat: ['Ads'], laporanPeriodik: true, sequenceDependency: true },
      CFG,
    );
    expect(r.pemicuKeras).toEqual([]);
    expect(codes(r.pemicuLunak)).toEqual(['laporan_atau_sla', 'urutan_kerja']);
    expect(r.rekomendasi).toBe(DECISION_BUTUH_PLAN);
  });

  it('recurring fires the duration trigger even with no duration given', () => {
    const r = recommend({ ...NOTHING, berulang: true, divisiTerlibat: ['Ads'] }, CFG);
    expect(codes(r.pemicuKeras)).toEqual(['durasi_atau_berulang']);
  });

  it('duplicate divisions do not fake a cross-division trigger', () => {
    // The strongest trigger in the table must not fire on a typo.
    const r = recommend({ ...NOTHING, divisiTerlibat: ['Ads', 'Ads', ' Ads '] }, CFG);
    expect(r.pemicuKeras).toEqual([]);
    expect(r.rekomendasi).toBe(DECISION_TANPA_PLAN);
  });

  it('value trigger is >= (Rule 3 "at or above"), quota trigger is > ("above")', () => {
    // Exactly on the threshold: value fires, quota does not. The asymmetry is
    // the PRD's, and Rp 15jt / 20 items are exactly where it bites.
    const onValue = recommend({ ...NOTHING, divisiTerlibat: ['Ads'], nilaiPerBulan: '15000000.00' }, CFG);
    expect(codes(onValue.pemicuLunak)).toEqual(['nilai_besar']);

    const onQuota = recommend({ ...NOTHING, divisiTerlibat: ['Ads'], kuotaPerPeriode: 20 }, CFG);
    expect(onQuota.pemicuLunak).toEqual([]);

    const overQuota = recommend({ ...NOTHING, divisiTerlibat: ['Ads'], kuotaPerPeriode: 21 }, CFG);
    expect(codes(overQuota.pemicuLunak)).toEqual(['kuota_besar']);
  });

  it('every fired trigger carries the number that fired it (GB-1)', () => {
    const r = recommend({ ...NOTHING, durasiBulan: 3, divisiTerlibat: ['Ads'] }, CFG);
    expect(r.pemicuKeras[0].dasar).toContain('3');
    expect(r.pemicuKeras[0].dasar).toContain('ambang 1');
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — the two override directions are distinct.
// ---------------------------------------------------------------------------
describe('fitOf', () => {
  it('agreement is sesuai in both directions', () => {
    expect(fitOf(DECISION_BUTUH_PLAN, DECISION_BUTUH_PLAN)).toBe(FIT_SESUAI);
    expect(fitOf(DECISION_TANPA_PLAN, DECISION_TANPA_PLAN)).toBe(FIT_SESUAI);
  });

  it('system yes + AM no is tolak_plan (the accountability risk)', () => {
    expect(fitOf(DECISION_BUTUH_PLAN, DECISION_TANPA_PLAN)).toBe(FIT_TOLAK_PLAN);
  });

  it('system no + AM yes is tambah_plan (a threshold signal, not a risk)', () => {
    expect(fitOf(DECISION_TANPA_PLAN, DECISION_BUTUH_PLAN)).toBe(FIT_TAMBAH_PLAN);
  });
});

// ---------------------------------------------------------------------------
// effectiveGate — precedence, and the "unanswered ≠ Direct" distinction.
// ---------------------------------------------------------------------------
describe('effectiveGate', () => {
  it('plan_wajib is gated with no determination needed', () => {
    expect(effectiveGate({ tier: TIER_PLAN_WAJIB, override: null, keputusanAm: null })).toEqual({
      requiresPlan: true,
      perluPenentuan: false,
    });
  });

  it('tanpa_plan is ungated with no determination needed', () => {
    expect(effectiveGate({ tier: TIER_TANPA_PLAN, override: null, keputusanAm: null })).toEqual({
      requiresPlan: false,
      perluPenentuan: false,
    });
  });

  it('ditentukan_am with no decision is UNANSWERED, not Direct', () => {
    // The whole point of M6C §1: the middle tier must not silently default to
    // no-Plan, because that is the cheaper answer and nothing else checks it.
    expect(effectiveGate({ tier: TIER_DITENTUKAN_AM, override: null, keputusanAm: null })).toEqual({
      requiresPlan: false,
      perluPenentuan: true,
    });
  });

  it('a recorded decision answers the middle tier both ways', () => {
    expect(
      effectiveGate({ tier: TIER_DITENTUKAN_AM, override: null, keputusanAm: DECISION_BUTUH_PLAN }),
    ).toEqual({ requiresPlan: true, perluPenentuan: false });
    expect(
      effectiveGate({ tier: TIER_DITENTUKAN_AM, override: null, keputusanAm: DECISION_TANPA_PLAN }),
    ).toEqual({ requiresPlan: false, perluPenentuan: false });
  });

  it('escalating a tanpa_plan service works through the recorded decision (Rule 11)', () => {
    expect(
      effectiveGate({ tier: TIER_TANPA_PLAN, override: null, keputusanAm: DECISION_BUTUH_PLAN }),
    ).toEqual({ requiresPlan: true, perluPenentuan: false });
  });

  it('the M6-OA-1 override still wins over both', () => {
    expect(
      effectiveGate({ tier: TIER_PLAN_WAJIB, override: false, keputusanAm: DECISION_BUTUH_PLAN }),
    ).toEqual({ requiresPlan: false, perluPenentuan: false });
    expect(
      effectiveGate({ tier: TIER_DITENTUKAN_AM, override: true, keputusanAm: null }),
    ).toEqual({ requiresPlan: true, perluPenentuan: false });
  });
});

// ---------------------------------------------------------------------------
// GB-5 / GB-6 / GB-8 — the conditional-required matrix.
// ---------------------------------------------------------------------------
const baseInput = (over: Partial<GateDecisionInput> = {}): GateDecisionInput => ({
  ...NOTHING,
  divisiTerlibat: ['Ads'],
  deliverable: 'Restruktur kampanye + optimasi mingguan',
  keputusanAm: DECISION_BUTUH_PLAN,
  tanggalTinjauUlang: '2026-09-15',
  ringkasanPenugasan: null,
  ...over,
});

describe('validateDecision', () => {
  it('agreeing with the recommendation needs no justification (Rule 4)', () => {
    expect(validateDecision(baseInput(), DECISION_BUTUH_PLAN)).toBe(FIT_SESUAI);
  });

  it('§9 counter-case: declining a recommended Plan demands a reason', () => {
    const input = baseInput({
      keputusanAm: DECISION_TANPA_PLAN,
      ringkasanPenugasan: {
        deliverable: '3 kampanye', deadline: '2026-09-30',
        divisiPic: 'Ads', hasilDiharapkan: 'ROAS 5.0',
      },
    });
    expect(() => validateDecision(input, DECISION_BUTUH_PLAN)).toThrow(MSG_REASON_REQUIRED);
  });

  it('…and an alternative monitoring method (GB-6)', () => {
    const input = baseInput({
      keputusanAm: DECISION_TANPA_PLAN,
      alasan: 'klien minta jalan cepat, durasi efektif 3 minggu',
      ringkasanPenugasan: {
        deliverable: '3 kampanye', deadline: '2026-09-30',
        divisiPic: 'Ads', hasilDiharapkan: 'ROAS 5.0',
      },
    });
    expect(() => validateDecision(input, DECISION_BUTUH_PLAN)).toThrow(MSG_MONITORING_REQUIRED);
  });

  it('adding a Plan the system did not recommend needs a reason but NOT monitoring', () => {
    // Rule 5: `tambah_plan` is not an accountability risk, so it is not loaded
    // with the same questions as `tolak_plan`.
    const input = baseInput({ keputusanAm: DECISION_BUTUH_PLAN, alasan: 'klien rewel, ingin laporan rapi' });
    expect(validateDecision(input, DECISION_TANPA_PLAN)).toBe(FIT_TAMBAH_PLAN);
  });

  it('the no-Plan path still needs its four-field summary (GB-8)', () => {
    const input = baseInput({ keputusanAm: DECISION_TANPA_PLAN, ringkasanPenugasan: null });
    expect(() => validateDecision(input, DECISION_TANPA_PLAN)).toThrow(MSG_SUMMARY_REQUIRED);
  });

  it('a partially-filled summary is not a summary', () => {
    const input = baseInput({
      keputusanAm: DECISION_TANPA_PLAN,
      ringkasanPenugasan: {
        deliverable: '40 foto', deadline: '', divisiPic: 'Creative', hasilDiharapkan: 'listing 12 SKU',
      },
    });
    expect(() => validateDecision(input, DECISION_TANPA_PLAN)).toThrow(MSG_SUMMARY_REQUIRED);
  });

  it('rejects a KPI kind with no figure behind it (GA-5 pairs)', () => {
    const input = baseInput({ targetJenis: 'roas', targetNilai: null });
    expect(() => validateDecision(input, DECISION_BUTUH_PLAN)).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

const am = (id = 'ZZ-AM'): { employeeId: string; role: permission.Role } => ({
  employeeId: id,
  role: permission.makeRole({ division: 'Account', level: 'staff' }),
});
const spv = (): { employeeId: string; role: permission.Role } => ({
  employeeId: 'ZZ-SPV',
  role: permission.makeRole({ division: 'Account', level: 'lead' }),
});

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  // NOTE: audit_log is append-only (no-delete trigger), so it is never cleaned
  // here — every test seeds a UNIQUE service id and its assertions filter on it.
  // Following the account.test.ts precedent rather than fighting the invariant.
  await sql`delete from service_plan_gate where created_by like 'ZZ-%'`;
  // A `butuh_plan` determination now opens a Plan Satuan (Rule 6) — clean the
  // period + chain it leaves so the client delete below does not hit their FK.
  await sql`delete from plan where created_by like 'ZZ-%'`;
  await sql`delete from plan_satuan where created_by like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  // §4(b) tests mint a Contract + Strategi (createStrategi). strategi_version is
  // append-only (delete trigger), and a Strategi delete cascades into it — truncate
  // it first (the plan.test.ts precedent), then clear the Strategi before its Contract.
  await sql`truncate strategi_version`;
  await sql`delete from strategi where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
});

// Unique per RUN, not just per test: audit_log survives afterEach, so a fixed
// id would make the "exactly one audit row" assertions depend on run history.
const RUN = Date.now().toString(36).slice(-6);
let seq = 0;

/**
 * Seeds one released client + one Service on the given tier. Ids are unique per
 * call because audit_log survives the cleanup — reusing an id would make the
 * "exactly one audit row" assertions pass or fail depending on run order.
 */
async function seedService(tier: string, opts: { price?: string } = {}): Promise<string> {
  seq += 1;
  const clientId = `ZZ-CLI-${RUN}-${seq}`;
  const serviceId = `ZZ-SVC-${RUN}-${seq}`;
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${clientId}, 'Rani', 'Sini Store', 'Bandung', 'https://shopee.co.id/sinistore',
            'Home Living', 0, 0, 0, 'ZZ-SALES', 'ZZ-SALES', 'ZZ-AM', now(), 'ZZ-AM')
    on conflict (id) do nothing`;
  // Points at a real MSL version so the G-A read can join `frequency`/`unit`
  // from the catalog — the join is what GA-2/GA-4 pre-fill from, and a null
  // master_service_id would hide a broken join behind an empty form.
  const msv = await sql<{ service_id: string; version_no: number }[]>`
    select service_id, version_no from master_service_versions
     where name = 'Ads Management' order by version_no desc limit 1`;
  await sql`
    insert into services
      (id, client_id, master_service_id, master_version_no, name, standard_price,
       commission_rule, status, requires_strategy_plan, plan_tier, created_by)
    values (${serviceId}, ${clientId}, ${msv[0].service_id}, ${msv[0].version_no},
            'Ads Management', ${opts.price ?? '12000000.00'},
            '10%', '[Awaiting Onboarding]', ${tier === TIER_PLAN_WAJIB}, ${tier}, 'ZZ-AM')`;
  return serviceId;
}

describeDb('decideGate', () => {
  it('records the determination, the stored triggers, and an audit row', async () => {
    const serviceId = await seedService(TIER_DITENTUKAN_AM);
    const gate = await decideGate(sql, am(), serviceId, baseInput({ durasiBulan: 3, targetJenis: 'roas', targetNilai: '5.00', laporanPeriodik: true }));

    expect(gate.rekomendasi).toBe(DECISION_BUTUH_PLAN);
    expect(gate.keputusanAm).toBe(DECISION_BUTUH_PLAN);
    expect(gate.kesesuaian).toBe(FIT_SESUAI);
    // §10: triggers are STORED, so a later threshold change cannot rewrite this.
    expect(codes(gate.pemicuKeras)).toEqual(['durasi_atau_berulang', 'target_numerik']);
    expect(gate.configVersionNo).toBe(1);

    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where entity_type = 'service_plan_gate' and entity_id = ${serviceId} and action = 'decide'`;
    expect(rows[0].n).toBe(1);
  });

  it('unlocks Brief creation immediately, whichever way the AM decides (Rule 4)', async () => {
    const serviceId = await seedService(TIER_DITENTUKAN_AM);
    // Before the determination the Brief gate is shut (Rule 1).
    await expect(guardBriefCreation(sql, serviceId)).rejects.toThrow(ConflictError);

    await decideGate(sql, am(), serviceId, baseInput({
      keputusanAm: DECISION_TANPA_PLAN,
      alasan: 'durasi efektif 3 minggu, deliverable tunggal',
      pemantauanAlternatif: 'dipantau lewat papan Brief Creative + review mingguan AM',
      ringkasanPenugasan: {
        deliverable: '40 foto produk', deadline: '2026-09-05',
        divisiPic: 'Creative', hasilDiharapkan: 'listing 12 SKU Pareto pakai foto baru',
      },
      durasiBulan: 3,
      laporanPeriodik: true,
      targetJenis: 'roas',
      targetNilai: '5.00',
    }));

    // Delivery is not held up for a second — even though this was an override.
    await expect(guardBriefCreation(sql, serviceId)).resolves.toBeUndefined();
    const gate = await sql<{ kesesuaian: string }[]>`
      select kesesuaian from service_plan_gate where service_id = ${serviceId}`;
    expect(gate[0].kesesuaian).toBe(FIT_TOLAK_PLAN);
  });

  it('refuses to run on a locked tier (Rule 1)', async () => {
    const serviceId = await seedService(TIER_PLAN_WAJIB);
    await expect(decideGate(sql, am(), serviceId, baseInput())).rejects.toThrow(MSG_TIER_LOCKED);
  });

  it('still refuses "deciding" Tanpa Plan on a locked tanpa_plan tier — that direction stays locked (Rule 1)', async () => {
    // Only the ESCALATE direction (→ Butuh Plan) is the Rule 11 exception. A
    // locked `tanpa_plan` Service "deciding" to stay Tanpa Plan would just be
    // restating the catalog default through a door that should not exist.
    const serviceId = await seedService(TIER_TANPA_PLAN);
    await expect(
      decideGate(sql, am(), serviceId, baseInput({ keputusanAm: DECISION_TANPA_PLAN })),
    ).rejects.toThrow(MSG_TIER_LOCKED);
  });

  it('lets the AM escalate a locked tanpa_plan Service that never had a gate row (Rule 11 "either by catalog", production regression SVC-202608-0010/0011)', async () => {
    // Root cause of the 2026-08-27 production bug: close() never wrote
    // `plan_tier`, so services pinned to the `ditentukan_am` catalog tier were
    // silently born `tanpa_plan` with zero `service_plan_gate` rows — nobody
    // ever answered G-B. Before this fix there was NO way to reach Strategi
    // for such a Service: `redecideGate` requires an existing gate row, and
    // `decideGate` refused any locked tier outright. This is the escape
    // hatch — the owner chose to leave the already-created Services as-is and
    // rely on this door instead of a data correction.
    const serviceId = await seedService(TIER_TANPA_PLAN);
    const before = await getService(sql, am(), serviceId);
    expect(before.planDeterminationPending).toBe(false); // it's locked, not pending — that's the bug
    expect(before.requiresStrategyPlan).toBe(false);

    const gate = await decideGate(sql, am(), serviceId, baseInput({ durasiBulan: 3, laporanPeriodik: true }));
    expect(gate.tierKatalog).toBe(TIER_TANPA_PLAN);
    expect(gate.keputusanAm).toBe(DECISION_BUTUH_PLAN);

    const after = await getService(sql, am(), serviceId);
    expect(after.requiresStrategyPlan).toBe(true);
    expect(after.gateDecision).toBe(DECISION_BUTUH_PLAN);
    // The whole point of escalating: Brief creation is now GATED on a Strategi
    // & Plan existing, same as any other plan-gated Service (not blocked on the
    // determination itself — that part is answered — but on the Strategi it
    // now requires per M6 §4).
    await expect(guardBriefCreation(sql, serviceId)).rejects.toThrow(MSG_STRATEGY_REQUIRED);
  });

  it('is refused to an AM who does not own the client', async () => {
    const serviceId = await seedService(TIER_DITENTUKAN_AM);
    await expect(decideGate(sql, am('ZZ-OTHER'), serviceId, baseInput())).rejects.toThrow(ForbiddenError);
  });

  it('surfaces the pending determination on the Service read', async () => {
    const serviceId = await seedService(TIER_DITENTUKAN_AM);
    const before = await getService(sql, am(), serviceId);
    expect(before.planTier).toBe(TIER_DITENTUKAN_AM);
    expect(before.planDeterminationPending).toBe(true);
    expect(before.requiresStrategyPlan).toBe(false);

    await decideGate(sql, am(), serviceId, baseInput({ durasiBulan: 3 }));
    const after = await getService(sql, am(), serviceId);
    expect(after.planDeterminationPending).toBe(false);
    expect(after.requiresStrategyPlan).toBe(true);
    expect(after.gateDecision).toBe(DECISION_BUTUH_PLAN);
  });
});

describeDb('redecideGate — Rules 11 & 12 are not symmetric', () => {
  it('the AM may escalate a tanpa_plan service (forward-only)', async () => {
    const serviceId = await seedService(TIER_DITENTUKAN_AM);
    await decideGate(sql, am(), serviceId, baseInput({
      keputusanAm: DECISION_TANPA_PLAN,
      ringkasanPenugasan: {
        deliverable: '3 kampanye', deadline: '2026-09-30',
        divisiPic: 'Ads', hasilDiharapkan: 'ROAS 5.0',
      },
    }));
    const gate = await redecideGate(sql, am(), serviceId, DECISION_BUTUH_PLAN, 'klien menambah target GMV');
    expect(gate.keputusanAm).toBe(DECISION_BUTUH_PLAN);

    const rows = await sql<{ action: string }[]>`
      select action from audit_log
       where entity_type = 'service_plan_gate' and entity_id = ${serviceId}
       order by created_at`;
    expect(rows.map((r) => r.action)).toEqual(['decide', 'escalate']);
  });

  it('the AM may NOT de-escalate — that needs SPV (Rule 12)', async () => {
    const serviceId = await seedService(TIER_DITENTUKAN_AM);
    await decideGate(sql, am(), serviceId, baseInput({ durasiBulan: 3 }));
    await expect(
      redecideGate(sql, am(), serviceId, DECISION_TANPA_PLAN, 'scope mengecil'),
    ).rejects.toThrow(MSG_DEESCALATION_FORBIDDEN);

    // Even for SPV, turning the Plan off without the GB-8 summary is refused —
    // the work would otherwise become invisible.
    await expect(
      redecideGate(sql, spv(), serviceId, DECISION_TANPA_PLAN, 'scope mengecil'),
    ).rejects.toThrow(MSG_SUMMARY_REQUIRED);

    const gate = await redecideGate(sql, spv(), serviceId, DECISION_TANPA_PLAN, 'scope mengecil, disetujui SPV', {
      deliverable: '1 kampanye sisa', deadline: '2026-09-30',
      divisiPic: 'Ads', hasilDiharapkan: 'kampanye tetap jalan sampai kontrak habis',
    });
    expect(gate.keputusanAm).toBe(DECISION_TANPA_PLAN);
    expect(gate.kesesuaian).toBe(FIT_TOLAK_PLAN);
  });

  it('re-deciding to the same value is rejected, not logged as an escalation', async () => {
    const serviceId = await seedService(TIER_DITENTUKAN_AM);
    await decideGate(sql, am(), serviceId, baseInput({ durasiBulan: 3 }));
    await expect(
      redecideGate(sql, am(), serviceId, DECISION_BUTUH_PLAN, 'apa pun'),
    ).rejects.toThrow(ConflictError);
  });
});

// ---------------------------------------------------------------------------
// §4(b) — a service inside a Full-Management contract never enters the Plan
// Satuan (B-11). The contract has a Strategi, so the service is covered by that
// contract's own Plan; joining the Plan Satuan too would put it in two Plans.
// ---------------------------------------------------------------------------
const FM_HEADER = {
  durasiKontrakBulan: 6,
  tanggalMulaiKontrak: '2026-08-12',
  tanggalAkhirKontrak: '2027-02-11',
  tanggalMulaiSiklus: '2026-08-12',
};

async function seedClientRow(): Promise<string> {
  seq += 1;
  const clientId = `ZZ-CLI-${RUN}-${seq}`;
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${clientId}, 'Rani', 'Sini Store', 'Bandung', 'https://shopee.co.id/sinistore',
            'Home Living', 0, 0, 0, 'ZZ-SALES', 'ZZ-SALES', 'ZZ-AM', now(), 'ZZ-AM')`;
  return clientId;
}

async function seedServiceRow(
  clientId: string,
  opts: { tier: string; contractId?: string; name?: string },
): Promise<string> {
  seq += 1;
  const serviceId = `ZZ-SVC-${RUN}-${seq}`;
  const msv = await sql<{ service_id: string; version_no: number }[]>`
    select service_id, version_no from master_service_versions
     where name = 'Ads Management' order by version_no desc limit 1`;
  await sql`
    insert into services
      (id, client_id, contract_id, master_service_id, master_version_no, name, standard_price,
       commission_rule, status, requires_strategy_plan, plan_tier, created_by)
    values (${serviceId}, ${clientId}, ${opts.contractId ?? null}, ${msv[0].service_id}, ${msv[0].version_no},
            ${opts.name ?? 'Ads Management'}, '12000000.00', '10%', '[Awaiting Onboarding]',
            ${opts.tier === TIER_PLAN_WAJIB}, ${opts.tier}, 'ZZ-AM')`;
  return serviceId;
}

/**
 * A client that holds a Full-Management contract (a plan_wajib anchor + Strategi)
 * plus a `ditentukan_am` add-on ATTACHED TO THE SAME CONTRACT — the §4(b) case.
 */
async function seedFullMgmtWithAddon(): Promise<{ clientId: string; addonId: string }> {
  const clientId = await seedClientRow();
  const anchorId = await seedServiceRow(clientId, { tier: TIER_PLAN_WAJIB, name: 'Full Store Management' });
  const strg = await createStrategi(sql, am(), anchorId, FM_HEADER);
  const addonId = await seedServiceRow(clientId, { tier: TIER_DITENTUKAN_AM, contractId: strg.contractId });
  return { clientId, addonId };
}

describeDb('§4(b) — a Full-Management-contract service never joins the Plan Satuan (B-11)', () => {
  it('decideGate refuses a butuh_plan determination and opens no Plan Satuan (TS mirror)', async () => {
    const { clientId, addonId } = await seedFullMgmtWithAddon();
    await expect(decideGate(sql, am(), addonId, baseInput({ durasiBulan: 3 }))).rejects.toThrow(
      MSG_FULL_MGMT_PLAN,
    );
    // The determination transaction rolls back whole: no gate row, no chain.
    const gate = await sql<{ n: number }[]>`
      select count(*)::int as n from service_plan_gate where service_id = ${addonId}`;
    expect(gate[0].n).toBe(0);
    const chain = await sql<{ n: number }[]>`
      select count(*)::int as n from plan_satuan where client_id = ${clientId}`;
    expect(chain[0].n).toBe(0);
  });

  it('escalation cannot pull the add-on into the Plan Satuan either (Rule 11 + §4b)', async () => {
    const { addonId } = await seedFullMgmtWithAddon();
    // A tanpa_plan determination is allowed — it never joins the Plan Satuan.
    await decideGate(sql, am(), addonId, baseInput({
      keputusanAm: DECISION_TANPA_PLAN,
      ringkasanPenugasan: {
        deliverable: '3 kampanye', deadline: '2026-09-30', divisiPic: 'Ads', hasilDiharapkan: 'ROAS 5.0',
      },
    }));
    // Escalating it to butuh_plan hits the same §4(b) guard the first pass would.
    await expect(
      redecideGate(sql, am(), addonId, DECISION_BUTUH_PLAN, 'klien menambah target'),
    ).rejects.toThrow(MSG_FULL_MGMT_PLAN);
  });

  it('the DB trigger refuses the link even when the TS guard is bypassed (frozen invariant)', async () => {
    const { clientId, addonId } = await seedFullMgmtWithAddon();
    // Record a tanpa_plan gate for the add-on (plan_id NULL) — the shape a raw
    // write would exploit.
    await decideGate(sql, am(), addonId, baseInput({
      keputusanAm: DECISION_TANPA_PLAN,
      ringkasanPenugasan: {
        deliverable: '3 kampanye', deadline: '2026-09-30', divisiPic: 'Ads', hasilDiharapkan: 'ROAS 5.0',
      },
    }));
    // A stand-alone satuan service opens a real Plan Satuan for the SAME client.
    const soloId = await seedServiceRow(clientId, { tier: TIER_DITENTUKAN_AM });
    const solo = await decideGate(sql, am(), soloId, baseInput({ durasiBulan: 3 }));
    expect(solo.planId).not.toBeNull();
    // Forcing the add-on's gate to point at that Plan Satuan is refused by the DB,
    // not the TS layer — the two enforce the identical invariant.
    await expect(
      sql`update service_plan_gate set plan_id = ${solo.planId} where service_id = ${addonId}`,
    ).rejects.toThrow(/full management/);
  });

  it('a stand-alone satuan service for the same client still joins the Plan Satuan (contract-scoped, not client-scoped)', async () => {
    const { clientId } = await seedFullMgmtWithAddon();
    const soloId = await seedServiceRow(clientId, { tier: TIER_DITENTUKAN_AM });
    const gate = await decideGate(sql, am(), soloId, baseInput({ durasiBulan: 3 }));
    expect(gate.keputusanAm).toBe(DECISION_BUTUH_PLAN);
    expect(gate.planId).not.toBeNull();
    const chain = await sql<{ status_dormansi: string }[]>`
      select status_dormansi from plan_satuan where client_id = ${clientId}`;
    expect(chain[0]?.status_dormansi).toBe('Aktif');
  });
});
