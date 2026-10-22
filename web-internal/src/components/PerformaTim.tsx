/**
 * Potongan tampilan bersama Ringkasan Tim (`/performance`) dan Portal Tim
 * (`/portal/team`) — feedback OD 2026-10-22 (`docs/decisions/2026-10-22-nama-karyawan-performa-tim.md`).
 *
 * Murni tampilan: nama datang dari server (`private.employee_display_name`,
 * jatuh ke id), di sini hanya dirangkai `Nama (ID)`.
 */

/** `Nama (ID)` — ID kecil abu-abu. Nama kosong/sama dengan ID ⇒ ID saja; ID kosong ⇒ `—`. */
export function NamaKaryawan({ nama, id }: { nama: string | null | undefined; id: string }) {
  if (!id) return <>—</>;
  if (!nama || nama === id) return <>{id}</>;
  return (
    <>
      {nama}{' '}
      <span className="muted" style={{ fontSize: '12px' }}>({id})</span>
    </>
  );
}

/**
 * Arti "Skor Akhir" — dicocokkan dengan kode M14 (`scoreProfile`, `boundFinal`,
 * `modifierComponent`) dan PRD M14 §2 Rule 2–6. Ubah kodenya dulu, baru teks ini.
 */
export const CATATAN_SKOR_AKHIR =
  'Skor Akhir = skor KPI bulanan M14 (0–100): rata-rata berbobot komponen KPI role + ' +
  'Client-Outcome Modifier (±10, khusus Creative/Ads/KOL). Komponen tanpa data dikecualikan ' +
  'dan bobotnya dibagi ulang. Skor ini tidak terkait OKR. Klik nama karyawan untuk melihat ' +
  'rincian komponennya.';

export function CatatanSkorAkhir() {
  return (
    <p className="muted" style={{ fontSize: '12px', marginTop: '8px' }}>
      {CATATAN_SKOR_AKHIR}
    </p>
  );
}
