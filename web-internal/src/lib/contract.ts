// O57 — the `CTR-` Contract: the agreement one client signed, covering n
// Services. The Strategi hangs off this, not off a Service (M6A Rule 2 /
// D-1 / §7), so the contract window lives here and is read-only everywhere
// else.
//
// No page consumes this yet — the contract UI arrives with the Strategi form
// (backlog A-13). It exists now because `shape-parity` cannot check a converter
// whose FE type has not been declared, and an unchecked converter is how a
// blank page with a 200 response happens (O43).
import { api } from './api';

export interface Contract {
  id: string;
  client_id: string;
  durasi_bulan: number;
  tanggal_mulai: string;
  tanggal_akhir: string;
  catatan: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ContractBody {
  durasi_bulan: number;
  tanggal_mulai: string;
  tanggal_akhir: string;
  catatan?: string | null;
}

export function listContracts(clientId: string): Promise<Contract[]> {
  return api.get<Contract[]>(`/clients/${clientId}/contracts`);
}

export function createContract(clientId: string, body: ContractBody): Promise<Contract> {
  return api.post<Contract>(`/clients/${clientId}/contracts`, body);
}

export function getContract(id: string): Promise<Contract> {
  return api.get<Contract>(`/contracts/${id}`);
}

export function updateContract(id: string, body: ContractBody): Promise<Contract> {
  return api.put<Contract>(`/contracts/${id}`, body);
}

/** The Service ids this agreement covers (O57). */
export function contractServices(id: string): Promise<{ service_ids: string[] }> {
  return api.get<{ service_ids: string[] }>(`/contracts/${id}/services`);
}

export function attachService(contractId: string, serviceId: string): Promise<Contract> {
  return api.post<Contract>(`/contracts/${contractId}/services`, { service_id: serviceId });
}

export function detachService(serviceId: string): Promise<{ ok: boolean }> {
  return api.delete<{ ok: boolean }>(`/services/${serviceId}/contract`);
}
