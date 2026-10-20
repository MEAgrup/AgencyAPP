/**
 * Data halaman Ringkasan, dimuat sekaligus.
 *
 * Settled independently: one failing surface must not blank the others. A
 * client landing on an empty page cannot tell "nothing yet" from "broken".
 *
 * Saat Progres Layanan mati (`progresAktif()` false), `getServiceProgress()`
 * TIDAK dipanggil sama sekali — bukan dipanggil lalu disembunyikan — dan
 * `services` dikembalikan `null`.
 */
import { getHealthSummary, getReports, getServiceProgress } from './portal-data';
import { type PortalHealthSummary, type PortalReportRow, type PortalServiceProgress } from './types';

export type Ringkasan = {
  health: PortalHealthSummary | null;
  reports: PortalReportRow[] | null;
  services: PortalServiceProgress[] | null;
  /** Alasan penolakan pertama, bila ada surface yang gagal. */
  gagal: unknown;
  adaGagal: boolean;
};

export async function muatRingkasan(progres: boolean): Promise<Ringkasan> {
  const [h, r, s] = await Promise.allSettled([
    getHealthSummary(),
    getReports(),
    progres ? getServiceProgress() : Promise.resolve(null),
  ]);
  const ditolak = [h, r, s].find((x) => x.status === 'rejected');
  return {
    health: h.status === 'fulfilled' ? h.value : null,
    reports: r.status === 'fulfilled' ? r.value : null,
    services: s.status === 'fulfilled' ? s.value : null,
    gagal: ditolak && ditolak.status === 'rejected' ? ditolak.reason : null,
    adaGagal: ditolak !== undefined,
  };
}
