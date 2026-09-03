// Shared API types for web-client-portal. Mirrors the wire contract emitted
// by apps/api's client-contact endpoints (packages/domain/src/client-portal-auth.ts
// ClientContactMe — NOT translated through apps/api/src/lib/wire.ts, same as
// the employee/vendor `/me` surfaces: this IS the public auth contract).

export interface ClientContactProfile {
  nama: string;
  email: string;
  client_id: string;
  nama_klien: string;
  must_change_password: boolean;
}

export interface ClientContactMeResponse {
  contact: ClientContactProfile;
}

// ---------------------------------------------------------------------------
// Read-model DTOs (M15-C2). Mirror `apps/api` `portal*ToWire` exactly —
// shape-parity now covers this app too, so a drift here fails a test in
// `apps/api/src/lib/shape-parity.test.ts`.
//
// These are the narrowest shapes in CDPS on purpose: the security spec's §4.2
// allow-list is a list of FIELDS, and this is where that list is enforced.
// Adding a field is a visibility decision, not a convenience.
// ---------------------------------------------------------------------------

/** One published report in the client's list. Navigation only — no score, no GMV. */
export interface PortalReportRow {
  report_id: number;
  platform: string;
  periode_tipe: string;
  periode_mulai: string;
  periode_akhir: string;
  diterbitkan_pada: string | null;
}

/**
 * One active service's progress (M15 Rule 2). `label` is the client-facing
 * relabelling — never an internal status name, and there is deliberately no
 * brief id, title, PIC, division or SLA field to render.
 */
export interface PortalServiceProgress {
  nama_layanan: string;
  label: string;
  jumlah_pekerjaan: number;
  jumlah_selesai: number;
}

/**
 * The account health summary (M15 Rule 4): a BAND LABEL and the month it
 * covers. There is no numeric field and there must never be one — the 0–100
 * score, its components and its weights are internal operational detail.
 * `label: null` means no snapshot exists yet, not a bad band.
 */
export interface PortalHealthSummary {
  label: string | null;
  periode_akhir: string | null;
}

/** The immediate acknowledgment after submitting a complaint (M15 Rule 5). */
export interface PortalComplaintAck {
  complaint_id: string;
  pesan: string;
}
