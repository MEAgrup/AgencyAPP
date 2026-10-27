/**
 * WEBSITE-LEAD — lead dari form website (WordPress `mea-leads`, kontrak
 * `mea.website_lead.v1`) masuk Pool CDPS tanpa input manual.
 *
 * Otoritas: docs/DECISIONS.md 2026-10-27 (`2026-10-27-website-lead-intake.md`,
 * `2026-10-27-origin-division-seo-website.md`). Rencana:
 * docs/plan/PLAN_WEBSITE_LEAD_INTAKE.md.
 *
 * Rute mesin `POST /api/v1/internal/website-leads` memverifikasi tanda tangan
 * HMAC lebih dulu (`apps/api/src/lib/website-lead-auth.ts`); modul ini menerima
 * body mentah yang SUDAH terverifikasi dan menjalankan satu transaksi:
 *
 *   kunci idempotensi sudah ada → hasil pertama, nol baris baru
 *   validasi payload v1
 *   leads.poolIntake()  — pintu import Marketing yang SAMA (nol aturan dedup kedua)
 *   duplikat → leads.manual_review_flag = true + audit
 *   insert website_lead_inbox (payload imutabel)
 *   notify m1.lead.website_masuk → lead Sales (+ pemilik attempt bila duplikat)
 *
 * Bukan rute aktor: aktornya `SYSTEM` (konvensi `bridge.ts`/`finance.ts`).
 */
import { bi, notification, permission } from '@cdps/core';
import { executors, withTransaction, type Sql } from '@cdps/db';
import * as leads from './leads';

/** Nilai `schema` payload yang diterima. Versi lain ditolak, bukan ditebak. */
export const SCHEMA_V1 = 'mea.website_lead.v1';

/** `leads.source` untuk lead website (daftar referensi M1 §4). */
export const SOURCE_WEBSITE = 'Website';

/** `leads.origin_division` untuk lead website (DEVIASI PRD, 2026-10-27). */
export const ORIGIN_DIVISION_WEBSITE = 'SEO Website';

/** Nilai `omzet` yang sah di kontrak v1. */
export const OMZET_VALUES: readonly string[] = ['<100jt', '100-250jt', '250jt-1m', '>1m'];

/** Hasil yang dicatat di `website_lead_inbox.hasil`. */
export type InboxHasil = 'dibuat' | 'dibuka_ulang' | 'duplikat';

const ENTITY_LEAD = 'lead';
const SALES_DIVISION = 'Sales';
const SYSTEM_ACTOR: leads.Actor = {
  employeeId: 'SYSTEM',
  role: permission.makeRole({ director: true }),
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Payload tidak valid → 400 dengan pesan BI bawaan (aturan rumah #5). */
export class ValidationError extends Error {
  constructor(message: string = bi.INCOMPLETE_DATA) {
    super(message);
    this.name = 'WebsiteLeadValidationError';
  }
}

/** Payload v1 yang sudah divalidasi. */
export interface PayloadV1 {
  idempotencyKey: string;
  site: string;
  submittedAt: string;
  nama: string;
  whatsapp: string;
  linkToko: string;
  omzet: string;
  layanan: string;
  sumberForm: string;
  halamanAsal: string;
  utm: { source: string | null; medium: string | null; campaign: string | null };
}

function str(v: unknown, max: number, required: boolean): string {
  if (typeof v !== 'string') {
    if (!required && (v === undefined || v === null)) return '';
    throw new ValidationError();
  }
  const t = v.trim();
  if ((required && t === '') || t.length > max) throw new ValidationError();
  return t;
}

function utmValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new ValidationError();
  const t = v.trim();
  if (t.length > 191) throw new ValidationError();
  return t === '' ? null : t;
}

/**
 * parsePayloadV1 memvalidasi body kontrak v1. Murni (tanpa DB), dipakai intake
 * dan diuji langsung. Melempar ValidationError dengan pesan BI bawaan.
 */
export function parsePayloadV1(raw: unknown): PayloadV1 {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError();
  const p = raw as Record<string, unknown>;
  if (p.schema !== SCHEMA_V1 || p.kanal !== 'website' || p.persetujuan_dihubungi !== true) {
    throw new ValidationError();
  }
  const idempotencyKey = str(p.idempotency_key, 64, true);
  if (!UUID.test(idempotencyKey)) throw new ValidationError();
  const whatsapp = str(p.whatsapp, 32, true);
  if (!/^08\d{8,11}$/.test(whatsapp)) throw new ValidationError();
  const omzet = str(p.omzet, 16, true);
  if (!OMZET_VALUES.includes(omzet)) throw new ValidationError();
  const halamanAsal = str(p.halaman_asal, 255, true);
  if (!halamanAsal.startsWith('/')) throw new ValidationError();
  const utm = p.utm;
  if (utm === null || typeof utm !== 'object' || Array.isArray(utm)) throw new ValidationError();
  const u = utm as Record<string, unknown>;
  return {
    idempotencyKey,
    site: str(p.site, 191, true),
    submittedAt: str(p.submitted_at, 40, true),
    nama: str(p.nama, 191, true),
    whatsapp,
    linkToko: str(p.link_toko, 255, false),
    omzet,
    layanan: str(p.layanan, 191, false),
    sumberForm: str(p.sumber_form, 100, true),
    halamanAsal,
    utm: { source: utmValue(u.source), medium: utmValue(u.medium), campaign: utmValue(u.campaign) },
  };
}

/** Jawaban intake untuk pengirim. */
export interface IntakeResult {
  /** 'dibuat' (lead baru atau dibuka ulang ke [Pool]) | 'duplikat' (nomor sedang diproses / sudah klien). */
  status: 'dibuat' | 'duplikat';
  leadId: string;
  /** true bila kunci idempotensi sudah pernah diterima (nol baris baru). */
  replay: boolean;
}

function toStatus(hasil: InboxHasil): 'dibuat' | 'duplikat' {
  return hasil === 'duplikat' ? 'duplikat' : 'dibuat';
}

/**
 * intake menerima satu lead website. `rawBody` adalah byte persis yang sudah
 * lolos verifikasi tanda tangan; `headerKey` adalah `X-MEA-Idempotency-Key`,
 * yang wajib sama dengan `idempotency_key` di body.
 */
export async function intake(sql: Sql, rawBody: string, headerKey: string): Promise<IntakeResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new ValidationError();
  }
  const payload = parsePayloadV1(parsed);
  if ((headerKey ?? '').trim() !== payload.idempotencyKey) throw new ValidationError();
  const phoneNorm = leads.normalizePhone(payload.whatsapp);
  if (phoneNorm === '') throw new ValidationError();

  return withTransaction(sql, async (tx) => {
    const existing = await tx<{ hasil: InboxHasil; lead_id: string }[]>`
      select hasil, lead_id from website_lead_inbox where idempotency_key = ${payload.idempotencyKey}`;
    if (existing.length > 0) {
      return { status: toStatus(existing[0].hasil), leadId: existing[0].lead_id, replay: true };
    }

    const ex = executors(tx);
    const res = await leads.poolIntake(tx, ex, SYSTEM_ACTOR, {
      leadName: payload.nama,
      phoneNumber: payload.whatsapp,
      phoneNorm,
      email: '',
      source: SOURCE_WEBSITE,
      originDivision: ORIGIN_DIVISION_WEBSITE,
      campaignId: '',
      channel: 'website',
    });

    let hasil: InboxHasil;
    let explicit: string[] = [];
    if (res.outcome === 'create') {
      hasil = 'dibuat';
    } else if (res.outcome === 'reopen') {
      hasil = 'dibuka_ulang';
    } else {
      // Duplikat: nol lead baru. Tanpa lead yang cocok (blok tanpa match tidak
      // terjadi di pintu import), tidak ada yang bisa ditunjuk — tolak saja.
      if (res.leadId === '') throw new ValidationError(res.message);
      hasil = 'duplikat';
      await tx`update leads set manual_review_flag = true where id = ${res.leadId}`;
      await ex.audit.insertAudit({
        entityType: ENTITY_LEAD, entityId: res.leadId, actorEmployeeId: SYSTEM_ACTOR.employeeId,
        action: 'website_lead_duplikat', beforeJson: null,
        afterJson: {
          manual_review_flag: true, site: payload.site, sumber_form: payload.sumberForm,
          idempotency_key: payload.idempotencyKey, message: res.message,
        },
        createdBy: SYSTEM_ACTOR.employeeId,
      });
      explicit = Array.from(new Set((res.match?.openAttempts ?? []).map((a) => a.ownerEmployeeId)));
    }

    await tx`
      insert into website_lead_inbox
        (idempotency_key, site, sumber_form, halaman_asal, utm_source, utm_medium, utm_campaign,
         payload, payload_schema, hasil, lead_id)
      values
        (${payload.idempotencyKey}, ${payload.site}, ${payload.sumberForm}, ${payload.halamanAsal},
         ${payload.utm.source}, ${payload.utm.medium}, ${payload.utm.campaign},
         ${parsed as never}::jsonb, ${SCHEMA_V1}, ${hasil}, ${res.leadId})`;

    await ex.notify.notifyEmit({
      event: notification.EVENTS.LeadWebsiteMasuk,
      entityType: ENTITY_LEAD,
      entityId: res.leadId,
      actor: SYSTEM_ACTOR.employeeId,
      deepLink: `/leads/${res.leadId}`,
      division: SALES_DIVISION,
      explicit,
      notifyActor: false,
    });

    return { status: toStatus(hasil), leadId: res.leadId, replay: false };
  });
}
