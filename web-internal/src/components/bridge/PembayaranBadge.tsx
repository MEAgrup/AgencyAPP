/**
 * Badge ringkasan pembayaran klien untuk order Bridge MSDPS (MSDPS 0377).
 *
 * Sejak 2026-11-04 MSDPS meneruskan order begitu pembayaran PERTAMA
 * diverifikasi — DP pun cukup — dan menempelkan ringkasannya di
 * `lines[].catatan`. Server mem-parse-nya (`bridge.ringkasanPembayaranOrder`);
 * komponen ini hanya menampilkannya: "DP 30%" (kuning) atau "Lunas" (hijau),
 * dengan nominal di tooltip. Order lama tanpa info → tidak merender apa pun.
 *
 * Info ini adalah SNAPSHOT saat diteruskan: pelunasan berikutnya tidak
 * dikirim ulang oleh MSDPS di Fase 1.
 */
import type { BridgeRingkasanPembayaran } from '@/lib/bridge';
import { formatIDR } from '@/lib/money';

export function pembayaranTooltip(p: BridgeRingkasanPembayaran): string {
  if (p.status === 'LUNAS') {
    return `Lunas saat diteruskan MSDPS — ${formatIDR(p.total)}`;
  }
  return `DP ${p.persen}% saat diteruskan MSDPS — ${formatIDR(p.dibayar)} dari ${formatIDR(p.total)}. Pelunasan berikutnya tidak dikirim ulang (Fase 1).`;
}

export default function PembayaranBadge({ pembayaran }: { pembayaran: BridgeRingkasanPembayaran | null }) {
  if (pembayaran === null) return null;
  const lunas = pembayaran.status === 'LUNAS';
  return (
    <span className={`badge ${lunas ? 'badge-green' : 'badge-amber'}`} title={pembayaranTooltip(pembayaran)}>
      {lunas ? 'Lunas' : `DP ${pembayaran.persen}%`}
    </span>
  );
}
