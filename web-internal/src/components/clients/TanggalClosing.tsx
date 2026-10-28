import type { Client } from '@/lib/clients';

// Feedback Zahrah & OD 27-10-2026 — "[CDPS] Filter Tanggal untuk FU Approval
// Transaksi di Direktori Klien": Sales perlu melihat kapan klien closing dan
// sudah berapa lama transaksinya mengendap di Menunggu Finance tanpa membuka
// Riwayat Audit tiap klien. Angka hari dihitung server (`lama_menunggu_hari`),
// halaman hanya merender.

const FMT = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric',
});

/** Tanggal kalender WIB dari instant ISO, mis. "01 Okt 2026". */
export function formatTanggalClosing(iso: string): string {
  return FMT.format(new Date(iso));
}

/** Label lama menunggu Finance. */
export function lamaMenungguLabel(hari: number): string {
  return hari === 0 ? 'Menunggu sejak hari ini' : `Menunggu ${hari} hari`;
}

export function TanggalClosing({ c }: { c: Pick<Client, 'tanggal_closing' | 'lama_menunggu_hari'> }) {
  if (c.tanggal_closing === null) {
    // Klien yang tidak lahir dari closing CDPS (mis. Bridge MSDPS).
    return <span className="muted">—</span>;
  }
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <span>{formatTanggalClosing(c.tanggal_closing)}</span>
      {c.lama_menunggu_hari !== null && (
        <span className="badge badge-amber">{lamaMenungguLabel(c.lama_menunggu_hari)}</span>
      )}
    </span>
  );
}
