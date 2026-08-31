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
