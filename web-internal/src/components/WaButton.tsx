/**
 * Nomor telepon + tombol kirim WhatsApp. Feedback tim Sales 2026-09-08 #1.
 *
 * Nomornya TETAP dirender sebagai teks di sebelah tombol: sales masih perlu
 * membacanya (menyalin ke CRM lain, mencocokkan dengan catatan), dan tabel yang
 * kehilangan kolom nomornya demi sebuah tombol adalah pertukaran yang tidak
 * diminta siapa pun.
 *
 * Kalau nomornya tidak sah (`waLink` → null), yang dirender HANYA nomornya apa
 * adanya. Tombol yang menuju nomor tebakan lebih buruk daripada tanpa tombol —
 * sales akan mengira pesannya sudah sampai ke lead yang benar.
 */
import { waLink, waSapaan } from '@/lib/phone';

export default function WaButton({
  phone,
  nama,
  text,
}: {
  phone: string | null | undefined;
  /** Nama lead — dipakai untuk menyapa; abaikan kalau tidak diketahui. */
  nama?: string | null;
  /** Teks pesan penuh, menimpa sapaan bawaan. */
  text?: string;
}) {
  const nomor = (phone ?? '').trim();
  const href = waLink(phone, text ?? waSapaan(nama));

  if (href === null) {
    return <span>{nomor === '' ? '—' : nomor}</span>;
  }

  return (
    <span className="row" style={{ gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
      <span>{nomor}</span>
      <a
        className="btn btnSecondary btnSm"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={`Kirim WhatsApp ke ${nomor}`}
        aria-label={`Kirim WhatsApp ke ${nomor}`}
      >
        WA
      </a>
    </span>
  );
}
