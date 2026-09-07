'use client';

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { getBriefRollup, pesanBlocker, type BriefRollupDiagnosis } from '@/lib/creative';
import { hitungProgres, labelProgres } from '@/lib/brief-progress';

/**
 * Panel "kenapa Brief ini belum bergerak" (B-1a).
 *
 * `task.recomputeBriefRollup` punya EMPAT jalan keluar yang tidak meninggalkan
 * jejak apa pun, dan dari halaman keempatnya terlihat identik: status Brief
 * tidak berubah, tanpa galat, tanpa penjelasan. Divisi bilang "sudah beres", AM
 * melihat status yang tidak pernah bergerak, dan keduanya benar (keluhan
 * Account #3 & #4). Yang paling sering menggigit: `created < quantity_target`,
 * jadi Brief "12 video" dengan 3 Aset yang SEMUANYA selesai tetap
 * `[In Progress]` selamanya.
 *
 * Aturan kerja yang dipatuhi di sini: **ketiadaan yang diam tidak bisa
 * dibedakan dari kerusakan** — halaman wajib mengatakan kenapa ia belum
 * bergerak.
 *
 * Diagnosisnya datang dari SERVER (`GET /briefs/{id}/rollup`), bukan dihitung
 * di sini: dua dari empat sebabnya (`menunggu_dependency`, `di_luar_rantai`)
 * tidak bisa diturunkan dari data yang halaman ini punya, dan menghitung ulang
 * aturan `allExist` di FE akan menciptakan aturan kedua yang bisa berbeda dari
 * `rollupTarget` yang sebenarnya menggerakkan status.
 *
 * Gagal memuat diagnosis TIDAK boleh meruntuhkan halaman: ia satu baris
 * keterangan, dan aksi Brief di sekitarnya harus tetap jalan.
 */
interface Props {
  briefId: string;
  /** Kata untuk anak Brief-nya: "Aset" (Creative/Ads) atau "Booking" (KOL). */
  satuan?: string;
  /**
   * Naik setiap kali pemanggil mengubah sesuatu yang bisa menggeser rollup
   * (membuat unit, transisi status), supaya panelnya ikut segar tanpa
   * pemanggil perlu tahu cara memuatnya.
   */
  refreshKey?: number;
}

export default function RollupBlockerPanel({ briefId, satuan = 'unit', refreshKey = 0 }: Props): React.ReactElement | null {
  const [diag, setDiag] = useState<BriefRollupDiagnosis | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setDiag(await getBriefRollup(briefId));
    } catch (e) {
      setErr(errorMessage(e));
    }
  }, [briefId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (err !== null) {
    // Diam-diam gagal adalah persis cacat yang panel ini ada untuk menutup, jadi
    // kegagalannya sendiri pun disebutkan — kecil, dan tidak menutupi halaman.
    return (
      <p className="muted" style={{ fontSize: 12 }}>
        Diagnosis rollup gagal dimuat: {err}
      </p>
    );
  }
  if (diag === null) {
    return null; // belum termuat — jangan berkedip
  }

  const progres = hitungProgres(diag.created, diag.target);
  const pesan = pesanBlocker(diag, satuan);
  // `selesai` ⇒ pesan null. Progresnya tetap ditampilkan: "12 dari 12" adalah
  // konfirmasi yang orangnya cari, bukan informasi kosong.
  const tone = pesan === null
    ? 'alertSuccess'
    : diag.blocker === 'di_luar_rantai'
      ? 'alertError'
      : 'alertInfo';

  return (
    <div className={`alert ${tone}`} role="status" style={{ marginTop: 12 }}>
      <strong>{labelProgres(progres, `${satuan} dibuat`)}</strong>
      {diag.target > 0 && <> &middot; {diag.done} selesai</>}
      {pesan !== null && <div style={{ marginTop: 4 }}>{pesan}</div>}
      {pesan === null && <div style={{ marginTop: 4 }}>Rollup Brief ini sudah menutup.</div>}
    </div>
  );
}
