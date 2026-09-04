/**
 * In-app notification center — TypeScript catalog + wrapper over the SQL
 * function `notify_emit` (migration 20260723055732_statemachine.sql).
 *
 * Ported from backend/internal/core/notification. The event catalog is FROZEN,
 * and since O55 (DECISIONS 2026-08-07) "frozen" means VERSIONED rather than
 * "pinned to a literal": every event belongs to a catalog version, each version
 * is a registered row in `notif_catalog_versions`, and the invariant asserts the
 * catalog against that registry instead of against a hard-coded count. Adding an
 * event without registering it still fails; adding one together with its version
 * row is a visible amendment. v1 rows are frozen structurally (DB trigger).
 * The recipient resolution + per-recipient INSERT happen in `notify_emit`,
 * called inside the SAME transaction as the triggering change (atomic, never
 * best-effort). Notifications are never deletable (BEFORE DELETE trigger); the
 * only mutation is mark-as-read via `mark_notification_read`.
 */

/** How an event's recipients are resolved (mirror of the Go resolvers). */
export type Resolver = 'explicit' | 'leadsOfDivision' | 'explicitOrLeads';

/**
 * The cataloged event types (stable identifiers). v1 values mirror the Go
 * `EventType` string constants verbatim; v2 values are written exactly as the
 * M6A/6B/6C PRDs spell them (`strategi_diajukan`, not `m6a.strategi.diajukan`).
 * The convention break is deliberate — the PRD wrote those identifiers, and
 * re-coining them would be the rename the house rules forbid.
 */
export const EVENTS = {
  NegotiationPendingApproval: 'm0.negotiation.pending_approval', // -> Sales Head/SPV
  NegotiationDecision: 'm0.negotiation.decision', // -> Salesperson
  // R-03 (Kinerja Sales) — renewal/cross-sell, same shape as the two above.
  RenewalPendingApproval: 'm0.renewal.pending_approval', // -> Sales Head/SPV
  RenewalDecision: 'm0.renewal.decision', // -> the proposer
  InstallmentDue: 'm0m5.installment.due', // -> Sales PIC + Finance
  ContractNotReceived: 'm5.contract.not_received', // -> Finance + SPV
  ComplaintLogged: 'm6.complaint.logged', // -> AM + SPV Account
  KOLQCFailedOrEscalated: 'm9.kol.qc_failed_or_escalated', // -> KOL Lead
  SessionDiscrepancyFlagged: 'm10.session.discrepancy_flagged', // -> SPV Account
  DependencySatisfied: 'm11.dependency.satisfied', // -> Target Brief PIC
  BlockRequestSubmitted: 'm12.block_request.submitted', // -> SPV/Lead
  BlockRequestDecided: 'm12.block_request.decided', // -> Requester
  RevisionCountFlag: 'm12.revision_count.flag', // -> Team Leader/SPV
  ClientBandDrop: 'm13.client.band_drop', // -> SPV
  PerformancePublished: 'm14.performance.published', // -> Each staff
  LeadCoPursuit: 'm1.lead.co_pursuit', // -> co-pursuit owners + registrant
  HoursLoggedReminder: 'm7.hours_logged.reminder', // -> Asset's assigned PIC
  // Lead-delete approval (owner decision 2026-07-29, DECISIONS.md). The two
  // entries below are the ONLY additions past the Go catalog: the ACC flow
  // cannot function if the Head is never told a request is waiting.
  LeadDeleteRequested: 'm1.lead.delete_requested', // -> Head of the lead's origin division
  LeadDeleteDecided: 'm1.lead.delete_decided', // -> Requester


  // ----- catalog v2 (O55) — 4 Strategi (M6A §7 D12) -----
  StrategiDiajukan: 'strategi_diajukan', // -> SPV / Head of Account
  StrategiDisetujui: 'strategi_disetujui', // -> AM + execution division leads + Finance
  StrategiDikembalikan: 'strategi_dikembalikan', // -> AM
  StrategiRevisiDisarankan: 'strategi_revisi_disarankan', // -> AM + SPV
  // ----- catalog v2 — 6 Plan (M6B §9) -----
  PlanPeriodeAktif: 'plan_periode_aktif', // -> AM + division leads with rows
  PlanTargetDiturunkan: 'plan_target_diturunkan', // -> SPV
  PlanBarisBelumDieksekusi: 'plan_baris_belum_dieksekusi', // -> AM + SPV
  PlanKeberatanKapasitas: 'plan_keberatan_kapasitas', // -> AM + SPV
  PlanRealisasiBelumLengkap: 'plan_realisasi_belum_lengkap', // -> AM + SPV
  PlanPeriodeDitutup: 'plan_periode_ditutup', // -> AM + SPV + Finance
  // ----- catalog v2 — 3 Gate (M6C §10) -----
  GateOverrideDicatat: 'gate_override_dicatat', // -> SPV
  PlanSekarangDisarankan: 'plan_sekarang_disarankan', // -> AM + SPV
  GateDeeskalasiDiminta: 'gate_deeskalasi_diminta', // -> SPV
  // ----- catalog v2 — 1 Account (O53) -----
  ClientAssigned: 'm6.client.assigned', // -> the assigned AM
  // ----- catalog v3 (M5-OA-7) — 2 Finance -----
  // Owner decision 2026-08-04: SPV/Head Finance may only REQUEST a
  // payment-scheme change, so the Director has to be told one is waiting, and
  // the requester has to be told how it was decided. A SEPARATE version from
  // v2: v2 is the M6A/6B/6C amendment, and folding a Finance event into it
  // would misdescribe what that amendment was.
  TransactionChangeRequested: 'm5.transaction.change_requested', // -> Directors
  TransactionChangeDecided: 'm5.transaction.change_decided', // -> Requester
  // ----- catalog v4 (A-08) — 1 Strategi -----
  // M6A §4 marks D-7 `O (notif SPV + Head of Sales)`, but §7 D12 lists only the
  // four `strategi_*` events and none of them is a target challenge. The PRD
  // contradicting itself is not a licence to pick silently, so §4 is built (the
  // PRD wins) through the mechanism O55 exists for: its own version row.
  // The identifier is DOTTED, unlike the four PRD-named ones — the v2 naming
  // rule says the plain style is used precisely because the PRD wrote it that
  // way. The PRD never wrote this one, so it follows the house convention,
  // exactly like `m6.client.assigned` (O53).
  StrategiSanggahanTarget: 'm6a.strategi.sanggahan_target', // -> SPV Account + Head of Sales

  // ----- catalog v5 (Interview / Kelola Klien tab 1) — 9 events -----
  // Names verbatim from the Interview spec's notification table. All advisory:
  // `kualifikasi_tidak_siap` is INFORMATIONAL and blocks nothing (the verdict
  // never gates). Dotted `mN` convention is NOT used because — like the v2
  // `strategi_*` names — the spec spelled these identifiers itself.
  InterviewDijadwalkan: 'interview_dijadwalkan', // -> AM + SPV
  InterviewPengingat: 'interview_pengingat', // -> AM (H-1 08:00, H-day 07:00 WIB)
  InterviewTerlewat: 'interview_terlewat', // -> AM, then SPV escalation at 7
  InterviewButuhDataKlien: 'interview_butuh_data_klien', // -> AM (3-day nudge, max 5)
  InterviewDiajukanDenganKekosongan: 'interview_diajukan_dengan_kekosongan', // -> SPV (approval)
  InterviewSelesai: 'interview_selesai', // -> AM + SPV + Head of Account
  KualifikasiTidakSiap: 'kualifikasi_tidak_siap', // -> SPV + Head of Account (info only)
  KualifikasiTurun: 'kualifikasi_turun', // -> SPV + Head of Account
  InterviewVersiBaru: 'interview_versi_baru', // -> AM + SPV

  // ----- catalog v6 (Interview bagian 2 — eskalasi prasyarat) — 1 event -----
  // Owner decision 2026-08-11: an AM with >= 2 hanging `bersyarat` prerequisites
  // (unfinished, past the 7-day mark) escalates to the AM's superiors. Its own
  // version (O55) — v5 was the Interview surface; this is the escalation the
  // owner added after that surface shipped.
  KualifikasiPrasyaratMenggantung: 'kualifikasi_prasyarat_menggantung', // -> SPV + Head of Account

  // ----- catalog v7 (M6D Rekap Hasil Mingguan) — 4 events -----
  // Owner signed off v7=48 on 2026-08-13 ("Iya ini benar."), clearing the M6B
  // PA-8 catalog gate. Names verbatim from PRD §9/§10.1-C. Plain snake_case (not
  // dotted) because the PRD wrote the identifiers itself — same rule as the v2
  // `strategi_*` / v5 `interview_*` names. Emission lands in D-06 (the Monday job:
  // rekap_mingguan_terbuka + belum_dikonfirmasi + catatan_divisi_belum_diisi at
  // force-close) and D-09 (AM close: rekap_sengketa_angka + catatan_divisi).
  RekapMingguanTerbuka: 'rekap_mingguan_terbuka', // -> AM/CRO owning the client
  RekapMingguanBelumDikonfirmasi: 'rekap_mingguan_belum_dikonfirmasi', // -> AM/CRO + SPV
  RekapSengketaAngka: 'rekap_sengketa_angka', // -> SPV
  CatatanDivisiBelumDiisi: 'catatan_divisi_belum_diisi', // -> division lead + AM

  // v8 (T-2c) — Hold Service two-step approval flow.
  ServiceHoldRequested: 'service_hold_requested', // -> Head of Account (Account leads)
  ServiceHeld: 'service_held', // -> owning AM
  ServiceHoldRejected: 'service_hold_rejected', // -> owning AM
  ServiceResumed: 'service_resumed', // -> owning AM

  // v9 — Penugasan Internal.
  PenugasanDitugaskan: 'penugasan_ditugaskan', // -> the assigned employee
  PenugasanSelesai: 'penugasan_selesai', // -> the assigner (atasan)

  // v10 — Penugasan Internal, due-date + cancellation. The first two are emitted
  // by the daily job `penugasan_reminder_tick` (once each, guarded by a marker
  // column); the third from the domain, because its trigger is an action rather
  // than the passing of time.
  PenugasanMendekatiJatuhTempo: 'penugasan_mendekati_jatuh_tempo', // -> PIC (H-1)
  PenugasanJatuhTempo: 'penugasan_jatuh_tempo', // -> PIC + assigner + division lead
  PenugasanDibatalkan: 'penugasan_dibatalkan', // -> PIC

  // ----- catalog v11 (M8 Ads — C4) — 1 event -----
  // Owner decision 2026-08-18: opened the frozen catalog for ONE event so a
  // campaign whose ROAS is below target for 2 consecutive periods (§8 Rule 4 /
  // M8-OA-5) escalates instead of only lighting a passive read-flag. Dotted `mN`
  // convention (the PRD never spelled an identifier for it) — like m6.client.assigned.
  AdsRoasUnderperforming: 'm8.ads.roas_underperforming', // -> owning AM + SPV Ads

  // --- v12 (M16 lead time + M17). SATU bump untuk SELURUH event kedua stream
  // paralel (docs/handoff/PARALEL_M16_DUA_AKUN.md F-4): invariant di sini
  // menjumlahkan `eventCount` per versi DAN `notif_catalog.reals.test.ts`
  // membandingkan TS↔DB set-equal, jadi dua bump terpisah akan memecahkan
  // keduanya dua kali. Emitter dipasang stream masing-masing — mendaftarkan
  // event tanpa emitter aman, gate-nya membandingkan NAMA, bukan pemanggil.

  // Menutup lubang lama: dispatch Brief ke divisi selama ini TIDAK punya
  // notifikasi sama sekali, divisi harus memantau antriannya sendiri.
  BriefDispatched: 'm16.brief.dispatched',             // -> lead divisi tujuan
  BriefDiterimaDivisi: 'm16.brief.diterima_divisi',    // -> AM pemilik klien
  BriefDikembalikan: 'm16.brief.dikembalikan',         // -> AM pemilik klien (+ alasan)
  // HANYA untuk tahap ber-gate (`gate_pihak` AM/KLIEN) — memberi tahu AM setiap
  // tahap maju akan membanjiri dia dengan 7 notifikasi per Brief.
  TahapButuhAksiAm: 'm16.tahap.butuh_aksi_am',         // -> AM pemilik klien
  TahapLewatTarget: 'm16.tahap.lewat_target',          // -> PIC + lead divisi + AM
  PermintaanDiajukan: 'm16.permintaan.diajukan',       // -> tujuan (AM / Finance)
  PermintaanJatuhTempo: 'm16.permintaan.jatuh_tempo',  // -> pengaju + tujuan + lead

  // ----- catalog v14 (Revisi Sales/Creative/Performa L2) — 2 lead-aging events -----
  // Emitted by the daily job `leads_unrespon_tick` (SQL, 20260911060000_m1_unrespon_tick.sql)
  // — a lead being pulled off a salesperson's desk by the SYSTEM is exactly the
  // kind of silent change that erodes trust in the system if it isn't announced.
  AttemptUnrespon: 'm1.attempt.unrespon',                       // -> attempt owner
  AttemptAutoNotQualified: 'm1.attempt.auto_not_qualified',     // -> attempt owner

} as const;

/** A cataloged event type. */
export type EventType = (typeof EVENTS)[keyof typeof EVENTS];

/** A registered catalog version (mirror of a `notif_catalog_versions` row). */
export interface CatalogVersion {
  version: number;
  description: string;
  /** How many events THIS version introduces (not cumulative). */
  eventCount: number;
  decisionRef: string;
}

/**
 * The registered catalog versions. This is the replacement for the literal the
 * invariant test used to assert: `eventCount` here is the number the test now
 * checks the catalog against, and it must equal the `notif_catalog_versions`
 * rows in the DB.
 */
export const CATALOG_VERSIONS: readonly CatalogVersion[] = [
  {
    version: 1,
    description: 'Fase 0 v2 §9 — 15 event beku + 2 deviasi lead-delete tercatat',
    eventCount: 17,
    decisionRef: 'docs/DECISIONS.md 2026-07-29 (lead delete) + Phase 0 v2 §9',
  },
  {
    version: 2,
    description: 'M6A §7 D12 + M6B §9 + M6C §10 — 4 Strategi, 6 Plan, 3 Gate; + m6.client.assigned (O53)',
    eventCount: 14,
    decisionRef: 'docs/DECISIONS.md 2026-08-07 (O55 pilihan a; menutup O53)',
  },
  {
    version: 3,
    description: 'M5-OA-7 — perubahan skema transaksi wajib ACC Direktur: 2 event Finance',
    eventCount: 2,
    decisionRef: 'docs/DECISIONS.md 2026-08-04 (M5-OA-7)',
  },
  {
    version: 4,
    description:
      'M6A §4 D-7 — sanggahan target memberi tahu SPV Account + Head of Sales: 1 event Strategi',
    eventCount: 1,
    decisionRef: 'docs/DECISIONS.md 2026-08-08 (A-08 — §4 vs §7 D12)',
  },
  {
    version: 5,
    description:
      'Interview / Kelola Klien tab 1 — 9 event (jadwal, pengingat, terlewat, butuh data, kekosongan, selesai, kualifikasi tidak siap/turun, versi baru). Semua advisory; kualifikasi_tidak_siap informasional (verdict tidak pernah memblok).',
    eventCount: 9,
    decisionRef: 'docs/DECISIONS.md 2026-08-11 (Interview — verdict advisory non-blocking)',
  },
  {
    version: 6,
    description:
      'Interview bagian 2 — eskalasi prasyarat menggantung: 1 event (kualifikasi_prasyarat_menggantung, >= 2 per AM). Advisory; verdict tetap tidak memblok.',
    eventCount: 1,
    decisionRef: 'docs/DECISIONS.md 2026-08-11 (Interview — bagian 2: resolusi + eskalasi N=2)',
  },
  {
    version: 7,
    description:
      'M6D Rekap Hasil Mingguan — 4 event (rekap_mingguan_terbuka, rekap_mingguan_belum_dikonfirmasi, rekap_sengketa_angka, catatan_divisi_belum_diisi wajib RM-8)',
    eventCount: 4,
    decisionRef: 'docs/DECISIONS.md 2026-08-13 (RM-6 sign-off v7=48; RM-8 catatan divisi wajib)',
  },
  {
    version: 8,
    description:
      'T-2c Hold Service two-step — 4 event (service_hold_requested → Head of Account; service_held / service_hold_rejected / service_resumed → AM pemilik)',
    eventCount: 4,
    decisionRef: 'docs/DECISIONS.md 2026-08-14 (T-2b/T-2c — hold dua-langkah + notif, keputusan pemilik)',
  },
  {
    version: 9,
    description:
      'Penugasan Internal — 2 event (penugasan_ditugaskan → karyawan yang ditugaskan; penugasan_selesai → pemberi tugas). Notifikasi jatuh tempo BELUM didaftarkan: emitter cron-nya belum ada.',
    eventCount: 2,
    decisionRef: 'docs/DECISIONS.md 2026-08-14 (Penugasan Internal — permintaan pemilik)',
  },
  {
    version: 10,
    description:
      'Penugasan Internal — 3 event jatuh tempo & pembatalan (penugasan_mendekati_jatuh_tempo H-1 → PIC; penugasan_jatuh_tempo → PIC + pemberi tugas + lead divisi; penugasan_dibatalkan → PIC). Menutup lubang yang dicatat v9: emitter-nya job harian `penugasan_reminder_tick`.',
    eventCount: 3,
    decisionRef: 'docs/DECISIONS.md 2026-08-14 (Penugasan Internal — notifikasi tambahan, permintaan pemilik)',
  },
  {
    version: 11,
    description:
      'M8 Ads eskalasi ROAS underperforming — 1 event (m8.ads.roas_underperforming: ROAS < target 2 periode berturut → AM pemilik + SPV Ads)',
    eventCount: 1,
    decisionRef: 'docs/DECISIONS.md 2026-08-18 (C4 — pemilik setuju membuka satu event katalog)',
  },
  {
    version: 12,
    description:
      'M16 Lead Time + M17 — 7 event: 3 Brief (dispatched → lead divisi tujuan, menutup lubang "dispatch tanpa notifikasi"; diterima_divisi / dikembalikan → AM pemilik), 2 tahapan (butuh_aksi_am HANYA untuk tahap ber-gate; lewat_target → PIC + lead + AM), 2 Permintaan REQ- (diajukan, jatuh_tempo). Didaftarkan sekaligus dalam SATU bump karena dua stream paralel mengerjakan emitternya masing-masing.',
    eventCount: 7,
    decisionRef: 'docs/DECISIONS.md 2026-08-28 (M16) + docs/handoff/PARALEL_M16_DUA_AKUN.md F-4',
  },
  {
    version: 13,
    description:
      'R-03 (Kinerja Sales) — 2 event renewal/cross-sell (m0.renewal.pending_approval → Sales Head/SPV saat baris custom menunggu persetujuan; m0.renewal.decision → pengaju saat diputuskan)',
    eventCount: 2,
    decisionRef: 'docs/DECISIONS.md 2026-08-29 (Kinerja Sales #5)',
  },
  {
    version: 14,
    description:
      'Revisi Sales/Creative/Performa L2 — 2 event lead aging otomatis (m1.attempt.unrespon → pemilik attempt saat New Lead/Contacted menua 3 hari diam; m1.attempt.auto_not_qualified → pemilik attempt saat [Unrespon] menua 14 hari, auto Not Qualified). Emitter: job harian leads_unrespon_tick.',
    eventCount: 2,
    decisionRef: 'docs/DECISIONS.md 2026-09-04 (REV-1..REV-4, permintaan Nerissa/COO)',
  },
] as const;

/** The catalog version currently in force. */
export const CATALOG_VERSION = CATALOG_VERSIONS[CATALOG_VERSIONS.length - 1].version;

/**
 * registeredEventCount is the total the catalog MUST have, derived from the
 * registry. The invariant asserts against this, never against a literal (O55).
 */
export function registeredEventCount(): number {
  return CATALOG_VERSIONS.reduce((n, v) => n + v.eventCount, 0);
}

/** One catalog entry: human description + recipient resolver + its version. */
export interface CatalogEntry {
  description: string;
  resolver: Resolver;
  /** Catalog version that introduced this event. */
  version: number;
}

/**
 * The catalog — event → {description, resolver, version}. Must stay identical to
 * the `notif_events` seed in the migrations, including the version column.
 *
 * v1 (17): the 15 FROZEN Phase 0 v2 §9 entries, identical to Go's NewCatalog,
 * plus the two `m1.lead.delete_*` entries — a logged deviation (DECISIONS
 * 2026-07-29, seeded in 20260729162101_lead_delete_request.sql) that postdates
 * the Go build. These are frozen structurally: the DB rejects UPDATE/DELETE on
 * any v1 row.
 *
 * v2 (14): the single M6A/6B/6C amendment (O55, seeded in
 * 20260807010000_notif_catalog_v2.sql) plus `m6.client.assigned` (O53).
 *
 * v3 (2): the Finance ACC flow (M5-OA-7, seeded in
 * 20260807130000_transaction_change_request.sql).
 *
 * v4 (1): D-7 Sanggahan Target (A-08, seeded in
 * 20260808000000_m6a_section_d.sql). Its own version rather than an addition to
 * v2 for the same reason v3 got one: v2 is the M6A/6B/6C §7 amendment, and an
 * event §7 never lists would make the registry misdescribe it.
 */
export const CATALOG: Record<EventType, CatalogEntry> = {

  [EVENTS.NegotiationPendingApproval]: { description: 'Negotiation Pending Approval submitted', resolver: 'leadsOfDivision', version: 1 },
  [EVENTS.NegotiationDecision]: { description: 'Negotiation decision', resolver: 'explicit', version: 1 },
  [EVENTS.RenewalPendingApproval]: { description: 'Renewal/cross-sell Pending Approval submitted', resolver: 'leadsOfDivision', version: 13 },
  [EVENTS.RenewalDecision]: { description: 'Renewal/cross-sell decision', resolver: 'explicit', version: 13 },
  [EVENTS.InstallmentDue]: { description: 'Installment due/overdue', resolver: 'explicitOrLeads', version: 1 },
  [EVENTS.ContractNotReceived]: { description: 'Contract not received 7 days after routing', resolver: 'explicitOrLeads', version: 1 },
  [EVENTS.ComplaintLogged]: { description: 'Complaint logged (any door)', resolver: 'explicitOrLeads', version: 1 },
  [EVENTS.KOLQCFailedOrEscalated]: { description: 'QC Failed / Booking Escalated', resolver: 'leadsOfDivision', version: 1 },
  [EVENTS.SessionDiscrepancyFlagged]: { description: 'Session Discrepancy Flagged', resolver: 'leadsOfDivision', version: 1 },
  [EVENTS.DependencySatisfied]: { description: 'Blocking Dependency Satisfied', resolver: 'explicit', version: 1 },
  [EVENTS.BlockRequestSubmitted]: { description: 'Block request submitted', resolver: 'leadsOfDivision', version: 1 },
  [EVENTS.BlockRequestDecided]: { description: 'Block request approved/rejected', resolver: 'explicit', version: 1 },
  [EVENTS.RevisionCountFlag]: { description: 'Revision Count >= 3 (Quality flag)', resolver: 'leadsOfDivision', version: 1 },
  [EVENTS.ClientBandDrop]: { description: 'Client band drop', resolver: 'leadsOfDivision', version: 1 },
  [EVENTS.PerformancePublished]: { description: 'Monthly Performance Score published', resolver: 'explicit', version: 1 },
  [EVENTS.LeadCoPursuit]: { description: 'Lead dikerjakan lebih dari satu sales', resolver: 'explicit', version: 1 },
  [EVENTS.HoursLoggedReminder]: { description: 'Hours Logged end-of-day reminder', resolver: 'explicit', version: 1 },
  [EVENTS.LeadDeleteRequested]: { description: 'Permintaan hapus lead diajukan', resolver: 'leadsOfDivision', version: 1 },
  [EVENTS.LeadDeleteDecided]: { description: 'Permintaan hapus lead di-ACC/tolak', resolver: 'explicit', version: 1 },

  // --- v2 (O55) — descriptions and resolvers must match the migration seed ---
  [EVENTS.StrategiDiajukan]: { description: 'Strategi diajukan AM (v1 atau revisi) — ke SPV/Head of Account', resolver: 'leadsOfDivision', version: 2 },
  [EVENTS.StrategiDisetujui]: { description: 'Strategi disetujui reviewer — ke AM, lead divisi eksekusi, Finance', resolver: 'explicitOrLeads', version: 2 },
  [EVENTS.StrategiDikembalikan]: { description: 'Strategi dikembalikan reviewer dengan catatan — ke AM', resolver: 'explicit', version: 2 },
  [EVENTS.StrategiRevisiDisarankan]: { description: 'Pemicu H-2 menyala atau asumsi D-8 flip ke Gugur — ke AM + SPV', resolver: 'explicitOrLeads', version: 2 },
  [EVENTS.PlanPeriodeAktif]: { description: 'Periode Plan aktif (manual atau otomatis) — ke AM + lead divisi yang punya baris', resolver: 'explicitOrLeads', version: 2 },
  [EVENTS.PlanTargetDiturunkan]: { description: 'Penyesuaian target ke bawah — ke SPV (>10% = permintaan persetujuan)', resolver: 'leadsOfDivision', version: 2 },
  [EVENTS.PlanBarisBelumDieksekusi]: { description: 'Baris tanpa Brief di tengah periode — ke AM + SPV', resolver: 'explicitOrLeads', version: 2 },
  [EVENTS.PlanKeberatanKapasitas]: { description: 'Divisi mengajukan keberatan kapasitas — ke AM + SPV', resolver: 'explicitOrLeads', version: 2 },
  [EVENTS.PlanRealisasiBelumLengkap]: { description: 'GMV manual belum diisi 5 hari setelah tutup — ke AM + SPV', resolver: 'explicitOrLeads', version: 2 },
  [EVENTS.PlanPeriodeDitutup]: { description: 'Periode ditutup (termasuk auto-close, dengan flag) — ke AM, SPV, Finance', resolver: 'explicitOrLeads', version: 2 },
  [EVENTS.GateOverrideDicatat]: { description: 'Keputusan AM menyimpang dari rekomendasi gerbang — ke SPV', resolver: 'leadsOfDivision', version: 2 },
  [EVENTS.PlanSekarangDisarankan]: { description: 'Pemicu keras muncul pada service tanpa Plan — ke AM + SPV', resolver: 'explicitOrLeads', version: 2 },
  [EVENTS.GateDeeskalasiDiminta]: { description: 'AM minta mematikan Plan di tengah service — ke SPV (butuh persetujuan)', resolver: 'leadsOfDivision', version: 2 },
  [EVENTS.ClientAssigned]: { description: 'Klien di-assign ke AM — ke AM bersangkutan', resolver: 'explicit', version: 2 },
  [EVENTS.TransactionChangeRequested]: { description: 'Pengajuan perubahan transaksi menunggu ACC Direktur', resolver: 'explicit', version: 3 },
  [EVENTS.TransactionChangeDecided]: { description: 'Pengajuan perubahan transaksi di-ACC/tolak', resolver: 'explicit', version: 3 },

  // --- v4 (A-08) — description and resolver must match the migration seed ---
  [EVENTS.StrategiSanggahanTarget]: { description: 'AM mengajukan Sanggahan Target (D-7, advisory) — ke SPV Account + Head of Sales', resolver: 'explicitOrLeads', version: 4 },

  // --- v5 (Interview) — descriptions and resolvers must match the migration seed ---
  // Resolver rule (per notif_catalog_v2 header): single explicit recipient ->
  // explicit; only lead/SPV of a division -> leadsOfDivision; explicit AND
  // lead/SPV -> explicitOrLeads.
  [EVENTS.InterviewDijadwalkan]: { description: 'Jadwal interview diset/diubah (IA-3) — ke AM + SPV', resolver: 'explicitOrLeads', version: 5 },
  [EVENTS.InterviewPengingat]: { description: 'Pengingat interview H-1 08:00 & H-hari 07:00 WIB — ke AM', resolver: 'explicit', version: 5 },
  [EVENTS.InterviewTerlewat]: { description: 'Interview terlewat (harian, maks 7) lalu eskalasi SPV — ke AM, lalu SPV', resolver: 'explicitOrLeads', version: 5 },
  [EVENTS.InterviewButuhDataKlien]: { description: 'Status Butuh Data Klien — nudge tiap 3 hari (maks 5) — ke AM', resolver: 'explicit', version: 5 },
  [EVENTS.InterviewDiajukanDenganKekosongan]: { description: 'Blok B diajukan dengan kekosongan (I11) — permintaan persetujuan ke SPV', resolver: 'leadsOfDivision', version: 5 },
  [EVENTS.InterviewSelesai]: { description: 'Interview Selesai / Selesai Dengan Catatan — ke AM + SPV + Head of Account', resolver: 'explicitOrLeads', version: 5 },
  [EVENTS.KualifikasiTidakSiap]: { description: 'Verdict tidak_siap (informasional, tidak memblok apa pun) — ke SPV + Head of Account', resolver: 'leadsOfDivision', version: 5 },
  [EVENTS.KualifikasiTurun]: { description: 'Re-interview menurunkan verdict pada kontrak berjalan — ke SPV + Head of Account', resolver: 'leadsOfDivision', version: 5 },
  [EVENTS.InterviewVersiBaru]: { description: 'Versi re-interview disetujui dengan perubahan field ter-mapping — ke AM + SPV', resolver: 'explicitOrLeads', version: 5 },

  // --- v6 (Interview bagian 2) — resolver must match the migration seed ---
  [EVENTS.KualifikasiPrasyaratMenggantung]: { description: '>= 2 prasyarat bersyarat menggantung pada satu AM (belum selesai, lewat hari-7) — eskalasi ke SPV + Head of Account', resolver: 'leadsOfDivision', version: 6 },

  // --- v7 (M6D Rekap Hasil Mingguan) — descriptions and resolvers must match the migration seed ---
  // Resolver rule (per notif_catalog_v2 header): single explicit recipient ->
  // explicit; only lead/SPV of a division -> leadsOfDivision; explicit AND
  // lead/SPV -> explicitOrLeads.
  [EVENTS.RekapMingguanTerbuka]: { description: 'Rekap hasil mingguan dibuka (job Senin 00:00 WIB) — ke AM/CRO pemilik klien', resolver: 'explicit', version: 7 },
  [EVENTS.RekapMingguanBelumDikonfirmasi]: { description: 'Rekap belum dikonfirmasi N=2 hari kerja setelah minggu tutup — ke AM/CRO + SPV', resolver: 'explicitOrLeads', version: 7 },
  [EVENTS.RekapSengketaAngka]: { description: 'AM mengajukan Sengketa Angka atas angka otomatis (RM-B6/RM-C) — ke SPV', resolver: 'leadsOfDivision', version: 7 },
  [EVENTS.CatatanDivisiBelumDiisi]: { description: 'Divisi berutang catatan mingguan wajib (RM-8) belum mengisi saat rekap tutup — ke lead divisi + AM', resolver: 'explicitOrLeads', version: 7 },

  // --- v8 (T-2c) — Hold Service two-step. Descriptions/resolvers must match the
  // migration seed (20260814080000_t2b_hold_twostep.sql). ---
  [EVENTS.ServiceHoldRequested]: { description: 'AM mengajukan Hold Service — ke Head of Account', resolver: 'leadsOfDivision', version: 8 },
  [EVENTS.ServiceHeld]: { description: 'Hold Service disetujui Head of Account — ke AM pemilik', resolver: 'explicit', version: 8 },
  [EVENTS.ServiceHoldRejected]: { description: 'Hold Service ditolak Head of Account — ke AM pemilik', resolver: 'explicit', version: 8 },
  [EVENTS.ServiceResumed]: { description: 'Service dilanjutkan dari On Hold — ke AM pemilik', resolver: 'explicit', version: 8 },

  // --- v9 — Penugasan Internal. Descriptions/resolvers must match the migration
  // seed (20260814110000_penugasan_internal.sql). ---
  [EVENTS.PenugasanDitugaskan]: { description: 'Penugasan internal baru diberikan — ke karyawan yang ditugaskan', resolver: 'explicit', version: 9 },
  [EVENTS.PenugasanSelesai]: { description: 'Penugasan internal ditandai selesai PIC — ke pemberi tugas', resolver: 'explicit', version: 9 },

  // --- v10 — Penugasan Internal jatuh tempo + pembatalan. Descriptions/resolvers
  // must match the migration seed (20260814120000_penugasan_notif_jatuh_tempo.sql). ---
  // H-1 goes to the PIC ALONE on purpose: a reminder copied to the boss stops
  // being a reminder and becomes a report, and nobody is late yet.
  [EVENTS.PenugasanMendekatiJatuhTempo]: { description: 'Penugasan internal jatuh tempo besok (H-1) — ke karyawan yang ditugaskan', resolver: 'explicit', version: 10 },
  // Past due is where the atasan legitimately needs to know: PIC + assigner
  // explicit, division lead resolved from `division`.
  [EVENTS.PenugasanJatuhTempo]: { description: 'Penugasan internal lewat jatuh tempo & belum selesai — ke PIC, pemberi tugas, lead divisi', resolver: 'explicitOrLeads', version: 10 },
  [EVENTS.PenugasanDibatalkan]: { description: 'Penugasan internal dibatalkan atasan — ke karyawan yang ditugaskan', resolver: 'explicit', version: 10 },

  // --- v11 (M8 Ads — C4). Description/resolver must match the migration seed
  // (20260818040000_m8_roas_underperforming_notif.sql). ---
  [EVENTS.AdsRoasUnderperforming]: { description: 'ROAS di bawah target 2 periode berturut (§8 Rule 4 / M8-OA-5) — ke AM pemilik + SPV Ads', resolver: 'explicitOrLeads', version: 11 },

  // --- v12 (M16 Lead Time + M17). Description/resolver WAJIB sama persis
  // dengan seed migrasi 20260829001000_m16_fondasi.sql — `notif_catalog.reals.test.ts`
  // membandingkan (event_type, catalog_version, resolver) set-equal TS↔DB. ---
  [EVENTS.BriefDispatched]: { description: 'Brief didispatch AM ke divisi — ke lead divisi tujuan', resolver: 'leadsOfDivision', version: 12 },
  [EVENTS.BriefDiterimaDivisi]: { description: 'Divisi menerima & memproses Brief (Cek Brief AM) — ke AM pemilik klien', resolver: 'explicit', version: 12 },
  [EVENTS.BriefDikembalikan]: { description: 'Brief dikembalikan ke AM oleh divisi + alasan terstruktur — ke AM pemilik klien', resolver: 'explicit', version: 12 },
  [EVENTS.TahapButuhAksiAm]: { description: 'Tahapan mencapai gate yang menunggu AM/klien — ke AM pemilik klien', resolver: 'explicit', version: 12 },
  [EVENTS.TahapLewatTarget]: { description: 'Tahapan melewati target hari kerjanya — ke PIC + lead divisi + AM pemilik', resolver: 'explicitOrLeads', version: 12 },
  [EVENTS.PermintaanDiajukan]: { description: 'Permintaan (REQ-) diajukan divisi — ke tujuan (AM / Finance)', resolver: 'explicitOrLeads', version: 12 },
  [EVENTS.PermintaanJatuhTempo]: { description: 'Permintaan (REQ-) lewat jatuh tempo 1 hari kerja — ke pengaju + tujuan + lead divisi', resolver: 'explicitOrLeads', version: 12 },

  // --- v14 (Revisi Sales/Creative/Performa L2). Description/resolver WAJIB sama
  // persis dengan seed migrasi 20260911050000_m1_unrespon_notif.sql. ---
  [EVENTS.AttemptUnrespon]: { description: 'Attempt menua ke [Unrespon] setelah 3 hari diam — ke pemilik attempt', resolver: 'explicit', version: 14 },
  [EVENTS.AttemptAutoNotQualified]: { description: 'Attempt auto Not Qualified setelah 14 hari diam di [Unrespon] — ke pemilik attempt', resolver: 'explicit', version: 14 },
};

/** All registered event types (introspection / tests). */
export function events(): EventType[] {
  return Object.keys(CATALOG) as EventType[];
}

/** The event types introduced by one catalog version. */
export function eventsOfVersion(version: number): EventType[] {
  return events().filter((e) => CATALOG[e].version === version);
}

/** isEventType reports whether s is a cataloged event. */
export function isEventType(s: string): s is EventType {
  return Object.prototype.hasOwnProperty.call(CATALOG, s);
}

/** One notification-generating occurrence (mirror of Go's Emission). */
export interface Emission {
  event: EventType;
  entityType: string;
  entityId: string;
  actor: string;
  /** optional; defaulted to `/entityType/entityId` by the SQL function. */
  deepLink?: string;
  /** CDPS division for role-based recipient resolution. */
  division?: string;
  /** used when the caller already knows recipients. */
  explicitRecipients?: string[];
  /** include the actor as a recipient (default: exclude). */
  notifyActor?: boolean;
}

/** Arguments passed straight through to the SQL function `notify_emit`. */
export interface NotifyEmitArgs {
  event: string;
  entityType: string;
  entityId: string;
  actor: string;
  deepLink: string;
  division: string;
  explicit: string[];
  notifyActor: boolean;
}

/**
 * Executor over the atomic SQL emitter. The real implementation wraps
 * postgres.js/drizzle and runs inside the caller's transaction:
 *
 *   sql`select notify_emit(${event}, ...) as r`.then(r => r[0].r)
 */
export interface NotifyExecutor {
  notifyEmit(args: NotifyEmitArgs): Promise<{ ok: true; notified: string[] }>;
}

/**
 * emit resolves recipients and inserts one notification per recipient via
 * `notify_emit`, inside the caller's transaction. Returns the recipient ids
 * actually notified. Rejects an uncataloged event before touching the DB
 * (mirror of Go's "unknown event" error).
 */
export async function emit(exec: NotifyExecutor, em: Emission): Promise<string[]> {
  if (!isEventType(em.event)) {
    throw new Error(`notification: unknown event ${JSON.stringify(em.event)}`);
  }
  const res = await exec.notifyEmit({
    event: em.event,
    entityType: em.entityType,
    entityId: em.entityId,
    actor: em.actor,
    deepLink: em.deepLink ?? '',
    division: em.division ?? '',
    explicit: em.explicitRecipients ?? [],
    notifyActor: em.notifyActor ?? false,
  });
  return res.notified;
}
