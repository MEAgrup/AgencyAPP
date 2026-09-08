'use client';

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { listClientApprovedAssets, type ClientAssetOption } from '@/lib/creative';
import { opsiPickerAset, pesanKosongAset } from '@/lib/asset-picker';

/**
 * Picker aset kreatif `[Approved]` untuk halaman kampanye Ads (B-5, ketokan K-3).
 *
 * MENGGANTIKAN dua kolom teks di `/ads/[id]`: "Tautkan Aset" dan "Aset Baru" di
 * form Creative Swap. Kedua kolom itu meminta Advertiser mengetik
 * `AST-202607-0001` DARI INGATAN, dan sampai B-5 tidak ada satu pun cara untuk
 * menemukannya — kebuntuannya berlapis tiga dan ketiganya harus dibuka
 * bersamaan:
 *   (i)   nol endpoint daftar aset per klien       → `GET /clients/{id}/assets`
 *   (ii)  `creative.canSeeAsset` menolak divisi Ads → lengan Ads (baca saja)
 *   (iii) nol picker                                → berkas ini
 * Membuka satu atau dua saja tidak menghasilkan fitur: tanpa (ii) daftarnya
 * kosong, tanpa (i) picker-nya tidak punya isi, tanpa (iii) orangnya tetap
 * mengetik ID.
 *
 * SCOPE-nya BUKAN urusan komponen ini. Ia memanggil endpoint-nya apa adanya;
 * server yang memutuskan siapa boleh membaca (gerbang `canSeeAsset` dievaluasi
 * SEBELUM satu baris aset pun dibaca) dan aset mana yang ditawarkan. Menyaring
 * ulang di sini akan menciptakan aturan kedua yang bisa berbeda dari yang
 * ditegakkan server.
 */
interface Props {
  /** Klien kampanye (`campaign.client_id`). '' ⇒ picker menonaktifkan diri. */
  clientId: string;
  /**
   * Brief Creative sumber kampanye (`briefs.source_creative_brief_id`, K-3).
   * Kosong/undefined ⇒ seluruh aset `[Approved]` milik klien. Fallback itu
   * disengaja: picker yang menyempit lalu diam-diam kosong lebih buruk daripada
   * picker lebar.
   *
   * Diteruskan pemanggilnya dari `campaign.source_creative_brief_id`
   * (`ads.Campaign.sourceCreativeBriefId`, lewat `private.brief_source_creative_id`
   * — lihat B-D6/B-D9 di `docs/handoff/HANDOFF_FEEDBACK_OD_JALUR_B.md`).
   *
   * ⚠️ Yang BELUM mendarat adalah PENGISIAN kolomnya saat AM membuat Brief Ads
   * (A-req-2, berkas Jalur A). Sampai itu ada, nilainya `''` untuk Brief Ads
   * yang dibuat lewat UI, jadi yang berlaku adalah fallback di bawah — dan itu
   * memang perilaku yang benar, bukan kegagalan.
   */
  sourceBriefId?: string;
  /** ID aset yang sedang dipilih ('' = belum ada). */
  value: string;
  /** Dipanggil saat pilihan berubah — termasuk saat dikosongkan kembali. */
  onChange: (assetId: string) => void;
  /** Label kolom; dipakai juga sebagai `aria-label` select-nya. */
  label?: string;
  /** id `<select>`-nya, supaya `<label htmlFor>` pemanggil tetap benar. */
  id?: string;
  required?: boolean;
  disabled?: boolean;
  /** Aset yang tidak boleh dipilih lagi — mis. yang sudah tertaut ke kampanye. */
  excludeIds?: readonly string[];
}

export default function AssetPicker({
  clientId,
  sourceBriefId,
  value,
  onChange,
  label = 'Aset Kreatif [Approved]',
  id = 'assetPicker',
  required = false,
  disabled = false,
  excludeIds,
}: Props): React.ReactElement {
  const [assets, setAssets] = useState<ClientAssetOption[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * Jalan keluar dari penyempitan `sourceBriefId` (K-3).
   *
   * Penyempitan itu benar sebagai DEFAULT, tapi ia bisa berujung pada picker
   * yang kosong total: brief Creative sumbernya sah tapi belum punya satu pun
   * aset `[Approved]`, atau aset yang dimaksud lahir dari Brief Creative LAIN
   * milik klien yang sama. Tanpa jalan keluar, Advertiser membaca penjelasan
   * yang benar lalu tetap tidak bisa menautkan apa pun — dan kembali ke Google
   * Sheet, yang justru hasil yang perbaikan ini ada untuk mencegah.
   *
   * Default `false`: yang dilihat lebih dulu selalu yang disempitkan.
   */
  const [abaikanSumber, setAbaikanSumber] = useState(false);
  const sumberAktif = abaikanSumber ? undefined : sourceBriefId;

  const load = useCallback(async () => {
    if (clientId === '') {
      setAssets([]);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const res = await listClientApprovedAssets(clientId, sumberAktif);
      setAssets(res.data);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [clientId, sumberAktif]);

  useEffect(() => {
    load();
  }, [load]);

  // Yang sudah tertaut dibuang dari OPSI, tapi tidak dari perhitungan "kosong":
  // "semua asetnya sudah tertaut" dan "kliennya belum punya aset selesai" adalah
  // dua keadaan berbeda, dan menyamakannya menyembunyikan yang pertama.
  const excluded = new Set(excludeIds ?? []);
  const offered = assets.filter((a) => !excluded.has(a.id) || a.id === value);

  // Daftar opsinya disusun `lib/asset-picker`, bukan di sini: aturan "nilai yang
  // aktif selalu punya opsi yang cocok" adalah yang gagalnya paling senyap
  // (lihat berkas itu), dan ia harus bisa diuji tanpa merender apa pun.
  const opsi = opsiPickerAset(value, offered, { loading });

  return (
    <div className="field" style={{ minWidth: 320 }}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="input"
        aria-label={label}
        value={value}
        required={required}
        disabled={disabled || (loading && offered.length === 0)}
        onChange={(e) => onChange(e.target.value)}
      >
        {opsi.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {err && (
        <span className="muted" style={{ fontSize: 12, color: 'var(--danger, #b91c1c)' }}>
          Daftar aset gagal dimuat: {err}
        </span>
      )}
      {!err && !loading && assets.length === 0 && (
        <span className="muted" style={{ fontSize: 12 }}>
          {pesanKosongAset({ adaKlien: clientId !== '', adaSourceBrief: !!sumberAktif })}
          {sumberAktif !== undefined && sumberAktif !== '' && (
            <>
              {' '}
              <button
                type="button"
                className="btn btnGhost btnSm"
                style={{ marginLeft: 4 }}
                onClick={() => setAbaikanSumber(true)}
              >
                Tampilkan semua aset klien
              </button>
            </>
          )}
        </span>
      )}
      {!err && abaikanSumber && sourceBriefId && (
        <span className="muted" style={{ fontSize: 12 }}>
          Menampilkan SELURUH aset [Approved] klien ini, di luar Brief Creative sumber kampanye
          ({sourceBriefId}).{' '}
          <button type="button" className="btn btnGhost btnSm" onClick={() => setAbaikanSumber(false)}>
            Kembali ke Brief sumber
          </button>
        </span>
      )}
      {!err && !loading && assets.length > 0 && offered.length === 0 && (
        <span className="muted" style={{ fontSize: 12 }}>
          Semua aset [Approved] klien ini sudah tertaut ke kampanye ini.
        </span>
      )}
    </div>
  );
}
