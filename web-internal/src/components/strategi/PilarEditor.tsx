'use client';

/**
 * Editor pilar Section E (E-3…E-10) — pengisi manual, penerus AM Co-Pilot.
 *
 * ## Kenapa komponen ini ada
 *
 * Sampai 2026-09-21 Section E hanya punya DUA pengisi, dan keduanya menuntut
 * `riset_awal_analisa`: tombol "Susun draft dari AM Co-Pilot" dan impor JSON
 * dari tool AM Cockpit. Akibatnya klien tanpa Riset Awal terkunci total dari
 * E-3…E-10 — halamannya tidak punya kolom ketik sama sekali. Itu yang pemilik
 * laporkan atas `STRG-202609-0009`, dan yang membuat gerbang `PILLAR_MIN`
 * kehilangan dasarnya (`docs/DECISIONS.md` E-PILAR-OPSIONAL).
 *
 * Kedua tool itu kemudian dipensiunkan seluruhnya ("PENSIUN-AMTOOLS"). Editor
 * ini penggantinya: AM memilih dari katalog 20 aksi (`GET
 * /strategi/katalog-pilar`, statis — nol baseline) atau mengetik baris sendiri
 * untuk empat jenis yang katalognya memang kosong.
 *
 * ## Dua hal yang mudah salah
 *
 * **Simpan = replace-set.** `PUT /strategi/{id}/pillars` mengganti SELURUH
 * daftar. Komponen ini tidak pernah mengirim daftarnya sendiri mentah-mentah:
 * ia menyerahkan baris baru ke `onApplyPillars`, dan halaman induk yang
 * menggabungkannya lewat `mergePilar` sehingga baris E-11 dan pilar lain yang
 * sudah ada tidak ikut terhapus.
 *
 * **`peran` BUKAN label pilar.** Ia enum peran SKU yang tertutup
 * (`ck_strpil_peran`). Mengisinya dengan apa pun di luar enum membuat INSERT
 * `savePillars` melempar galat Postgres tak terpetakan — AM melihatnya sebagai
 * "internal server error". Label pilar tinggal di `detail`.
 *
 * ## Yang sengaja BELUM ada
 *
 * Field vendor live (`vendor_id`, `slot_jam`, `tarif`, `target_gmv_per_jam`,
 * E-8/Rule 18) butuh daftar vendor terpilih dan aturan biayanya sendiri; ia
 * bukan "satu kolom lagi" dan tidak dikarang di sini. Baris `live` tetap bisa
 * dibuat, vendornya diisi lewat jalur vendor tersendiri.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getKatalogPilar, type KatalogPilarAksi, type StrategiDetail } from '@/lib/strategi';
import { blankPilar, type PilarBody } from '@/lib/strategi-pilar';
import { errorMessage } from '@/lib/api';

/**
 * Jenis yang katalognya KOSONG — tidak satu pun dari 20 aksi memetakan ke
 * sini, jadi satu-satunya jalan mengisinya adalah baris ketik tangan.
 *
 * `harga` yang paling berarti: `floor_price`-nya dibaca validasi Brief (Rule 11
 * "Di Bawah Floor"), dan selama Section E hanya bisa diisi mesin, guardrail itu
 * tidak punya pengisi sama sekali.
 */
export const JENIS_TANPA_KATALOG: { value: string; label: string }[] = [
  { value: 'sku', label: 'SKU — peran per SKU (hero / pendamping / bundling / baru / dimatikan)' },
  { value: 'harga', label: 'Harga — harga normal/promo + floor price (guardrail Brief Rule 11)' },
  { value: 'retensi', label: 'Retensi — pembelian ulang, CRM, after-sales' },
  { value: 'operasional', label: 'Operasional — pekerjaan toko (divisi Store Operation)' },
];

/** Enum `ck_strpil_peran` apa adanya — jangan tambah nilai di luar ini. */
const PERAN_SKU: { value: string; label: string }[] = [
  { value: '', label: '— tanpa peran —' },
  { value: 'hero', label: 'Hero' },
  { value: 'pendamping', label: 'Pendamping' },
  { value: 'bundling', label: 'Bundling' },
  { value: 'baru', label: 'Baru' },
  { value: 'dimatikan', label: 'Dimatikan' },
];

/** Label pilar katalog → judul kelompok di layar. */
const PILAR_JUDUL: Record<string, string> = {
  VIDEO: 'Konten / Video',
  LIVE: 'Live',
  AFFILIATE: 'Affiliate',
  ADS: 'Iklan',
};

/**
 * Target bawaan sebuah aksi katalog: kalimat jembatan yang menyebut metrik,
 * satuan, arah, dan horizonnya.
 *
 * Sengaja TIDAK diawali angka, dan itu konsekuensi yang disengaja:
 * `parseTargetKuota` (`plan-row-suggest.ts`) hanya membaca kuota dari target
 * yang DIAWALI angka, jadi baris Plan turunannya jatuh ke `butuh_kuota` dan AM
 * mengisi kuotanya di halaman Plan. Itu benar — kuota PC-6 adalah *berapa
 * deliverable dibuat*, angka yang berbeda dari target jembatan. AM boleh
 * mengetik "30 video, " di depan kalau memang ingin barisnya disemai penuh.
 */
export function targetBawaan(a: KatalogPilarAksi): string {
  return `jembatan ${a.jembatan} (${a.unit}, harus ${a.arah}) dalam ${a.minggu} minggu`;
}

/** Baris pilar dari satu aksi katalog yang AM centang. */
export function pilarDariAksi(a: KatalogPilarAksi, urutan: number, channel: string | null): PilarBody {
  return {
    ...blankPilar(a.jenis, urutan),
    channel,
    aksi: `${a.kode} ${a.nama}`,
    target: targetBawaan(a),
    detail: {
      sumber: 'cdps.pilarkatalog.v1',
      kode_aksi: a.kode,
      field_id_bukti: a.field_id_bukti,
      pilar: a.pilar,
      jembatan: a.jembatan,
      unit: a.unit,
      arah: a.arah,
      minggu_terlihat: a.minggu,
      angle_video: [],
    },
  };
}

/** Satu baris dalam state editor — `PilarBody` plus kunci render yang stabil. */
interface Baris extends PilarBody {
  /** Kunci React. Baris tidak pernah di-key pakai indeks: menghapus baris ke-2
   *  dari 4 membuat baris ke-3 mewarisi DOM baris ke-2, dan AM melihat teks yang
   *  baru saja dihapus muncul kembali satu baris di atas. Pelajaran yang sama
   *  sudah ditulis di `RepeatList.tsx`. */
  _key: string;
}

let seq = 0;
const nextKey = () => `p${(seq += 1)}`;

/** Buang kunci render lokal — ia milik React, bukan bagian badan wire. */
function tanpaKunci(r: Baris): PilarBody {
  const body: Partial<Baris> = { ...r };
  delete body._key;
  return body as PilarBody;
}

export default function PilarEditor({
  detail,
  onApplyPillars,
  disabled,
}: {
  detail: StrategiDetail;
  onApplyPillars: (pillars: PilarBody[]) => Promise<void>;
  disabled: boolean;
}) {
  const [katalog, setKatalog] = useState<KatalogPilarAksi[] | null>(null);
  const [katalogError, setKatalogError] = useState<string | null>(null);
  const [rows, setRows] = useState<Baris[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    getKatalogPilar()
      .then((k) => { if (alive) setKatalog(k); })
      .catch((err) => { if (alive) setKatalogError(errorMessage(err)); });
    return () => { alive = false; };
  }, []);

  /** Channel yang Strategi ini deklarasikan di Section B — pilihan dropdown. */
  const channels = useMemo(
    () => detail.channels.map((c) => (c.channel === 'Lainnya' && c.channel_lain ? c.channel_lain : c.channel)),
    [detail.channels],
  );
  const channelBawaan = channels[0] ?? null;

  /** Kode aksi yang SUDAH tersimpan — dipakai menandai katalog, bukan mengunci:
   *  AM boleh menambahkannya lagi untuk channel yang berbeda. */
  const kodeTersimpan = useMemo(() => {
    const out = new Set<string>();
    for (const p of detail.pillars) {
      const kode = (p.detail as { kode_aksi?: unknown })?.kode_aksi;
      if (typeof kode === 'string') out.add(kode);
    }
    return out;
  }, [detail.pillars]);

  const kodeDiAntrean = useMemo(() => {
    const out = new Set<string>();
    for (const r of rows) {
      const kode = (r.detail as { kode_aksi?: unknown })?.kode_aksi;
      if (typeof kode === 'string') out.add(kode);
    }
    return out;
  }, [rows]);

  const tambahDariKatalog = useCallback((a: KatalogPilarAksi) => {
    setSaved(false);
    setRows((prev) => [...prev, { ...pilarDariAksi(a, prev.length + 1, channelBawaan), _key: nextKey() }]);
  }, [channelBawaan]);

  const tambahManual = useCallback((jenis: string) => {
    setSaved(false);
    setRows((prev) => [
      ...prev,
      { ...blankPilar(jenis, prev.length + 1), channel: channelBawaan, _key: nextKey() },
    ]);
  }, [channelBawaan]);

  const patchRow = useCallback((key: string, patch: Partial<PilarBody>) => {
    setSaved(false);
    setRows((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  }, []);

  const hapusRow = useCallback((key: string) => {
    setSaved(false);
    setRows((prev) => prev.filter((r) => r._key !== key));
  }, []);

  /**
   * Baris yang layak dikirim: `aksi` terisi. Baris yang AM tambah lalu tidak
   * jadi diketik dibuang di sini — sama seperti `ketergantunganToBody` di
   * `SectionE.tsx`, dan karena alasan yang sama: `aksi` adalah `NOT NULL` yang
   * server tolak sebagai baris kosong, bukan kesalahan yang perlu ditampilkan.
   */
  const siapKirim = useMemo(
    () => rows.filter((r) => r.aksi.trim() !== '').map(tanpaKunci),
    [rows],
  );

  const simpan = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onApplyPillars(siapKirim.map((p, i) => ({ ...p, urutan: i + 1 })));
      setRows([]);
      setSaved(true);
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [onApplyPillars, siapKirim]);

  const perPilar = useMemo(() => {
    const out = new Map<string, KatalogPilarAksi[]>();
    for (const a of katalog ?? []) {
      const list = out.get(a.pilar);
      if (list) list.push(a);
      else out.set(a.pilar, [a]);
    }
    return [...out.entries()];
  }, [katalog]);

  return (
    <div className="card">
      <div className="cardHeader">Pilih pilar (E-3…E-10)</div>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Katalog aksi MEA — <b>tidak butuh Riset Awal</b>, daftarnya sama untuk setiap klien. Pilih
        yang relevan, ubah targetnya, lalu simpan. Pilar tetap <b>opsional</b>: Strategi bisa
        diajukan tanpa satu pun baris.
      </p>

      {katalogError && <div className="alert alertError">{katalogError}</div>}
      {!katalog && !katalogError && <p className="muted">Memuat katalog…</p>}

      {katalog && perPilar.map(([pilar, aksiList]) => (
        <div key={pilar} style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
            {PILAR_JUDUL[pilar] ?? pilar}
            <span className="muted" style={{ fontWeight: 400 }}> · divisi {aksiList[0].divisi}</span>
          </div>
          <table style={{ fontSize: 13, width: '100%' }}>
            <tbody>
              {aksiList.map((a) => {
                const sudah = kodeTersimpan.has(a.kode);
                const antre = kodeDiAntrean.has(a.kode);
                return (
                  <tr key={a.kode}>
                    <td style={{ width: 52, verticalAlign: 'top' }}>
                      <b>{a.kode}</b>
                    </td>
                    <td style={{ verticalAlign: 'top' }}>
                      <div>
                        {a.nama}
                        {a.quick_win && (
                          <span className="badge" style={{ marginLeft: 6 }}>quick win</span>
                        )}
                        {sudah && <span className="muted" style={{ marginLeft: 6 }}>· sudah tersimpan</span>}
                        {antre && <span className="muted" style={{ marginLeft: 6 }}>· sudah di daftar bawah</span>}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {a.deskripsi} · jembatan: {a.jembatan} ({a.unit}, harus {a.arah}) · terlihat ~{a.minggu} minggu
                      </div>
                      {a.relevan_saat.length > 0 && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          Biasanya dipakai saat: {a.relevan_saat.join('; ')}.
                        </div>
                      )}
                      {a.platform.length < 3 && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          Berlaku di: {a.platform.join(', ')}.
                        </div>
                      )}
                    </td>
                    <td style={{ width: 90, verticalAlign: 'top', textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn"
                        disabled={disabled}
                        onClick={() => tambahDariKatalog(a)}
                      >
                        Tambah
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      <div style={{ marginTop: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Baris ketik sendiri</div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Empat jenis ini tidak ada di katalog — tidak satu pun dari 20 aksi memetakan ke sana, jadi
          hanya bisa diketik. <b>Harga</b> yang paling berarti: <i>floor price</i>-nya dibaca
          validasi Brief (Rule 11 &ldquo;Di Bawah Floor&rdquo;).
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {JENIS_TANPA_KATALOG.map((j) => (
            <button
              key={j.value}
              type="button"
              className="btn"
              disabled={disabled}
              title={j.label}
              onClick={() => tambahManual(j.value)}
            >
              + {j.value}
            </button>
          ))}
        </div>
      </div>

      {rows.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
            Akan disimpan ({siapKirim.length} baris)
          </div>
          <div className="stack">
            {rows.map((r) => (
              <div key={r._key} className="card" style={{ padding: 10 }}>
                <div className="formRow">
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Jenis</span>
                    <input value={r.jenis} disabled readOnly />
                  </label>
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Channel</span>
                    <select
                      value={r.channel ?? ''}
                      disabled={disabled}
                      onChange={(e) => patchRow(r._key, { channel: e.target.value || null })}
                    >
                      <option value="">— lintas channel —</option>
                      {channels.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="field" style={{ flex: 2 }}>
                    <span className="muted" style={{ fontSize: 12 }}>Aksi</span>
                    <input
                      placeholder="Apa yang dikerjakan"
                      value={r.aksi}
                      disabled={disabled}
                      onChange={(e) => patchRow(r._key, { aksi: e.target.value })}
                    />
                  </label>
                </div>

                <label className="field" style={{ display: 'block' }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Target — diawali angka (mis. &ldquo;30 video, …&rdquo;) supaya baris Plan
                    periode 1 lahir dengan kuotanya; tanpa angka di depan, kuotanya diisi di halaman Plan
                  </span>
                  <input
                    value={r.target}
                    disabled={disabled}
                    onChange={(e) => patchRow(r._key, { target: e.target.value })}
                  />
                </label>

                {r.jenis === 'sku' && (
                  <div className="formRow">
                    <label className="field">
                      <span className="muted" style={{ fontSize: 12 }}>SKU</span>
                      <input
                        value={r.sku ?? ''}
                        disabled={disabled}
                        onChange={(e) => patchRow(r._key, { sku: e.target.value || null })}
                      />
                    </label>
                    <label className="field">
                      <span className="muted" style={{ fontSize: 12 }}>Peran</span>
                      <select
                        value={r.peran ?? ''}
                        disabled={disabled}
                        onChange={(e) => patchRow(r._key, { peran: e.target.value || null })}
                      >
                        {PERAN_SKU.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                    </label>
                  </div>
                )}

                {r.jenis === 'harga' && (
                  <div className="formRow">
                    <label className="field">
                      <span className="muted" style={{ fontSize: 12 }}>SKU (wajib untuk floor price)</span>
                      <input
                        value={r.sku ?? ''}
                        disabled={disabled}
                        onChange={(e) => patchRow(r._key, { sku: e.target.value || null })}
                      />
                    </label>
                    <label className="field">
                      <span className="muted" style={{ fontSize: 12 }}>Harga normal</span>
                      <input
                        inputMode="decimal"
                        placeholder="mis. 99000"
                        value={r.harga_normal ?? ''}
                        disabled={disabled}
                        onChange={(e) => patchRow(r._key, { harga_normal: e.target.value || null })}
                      />
                    </label>
                    <label className="field">
                      <span className="muted" style={{ fontSize: 12 }}>Harga promo</span>
                      <input
                        inputMode="decimal"
                        placeholder="mis. 85000"
                        value={r.harga_promo ?? ''}
                        disabled={disabled}
                        onChange={(e) => patchRow(r._key, { harga_promo: e.target.value || null })}
                      />
                    </label>
                    <label className="field">
                      <span className="muted" style={{ fontSize: 12 }}>Floor price</span>
                      <input
                        inputMode="decimal"
                        placeholder="mis. 79000"
                        value={r.floor_price ?? ''}
                        disabled={disabled}
                        onChange={(e) => patchRow(r._key, { floor_price: e.target.value || null })}
                      />
                    </label>
                  </div>
                )}

                {r.jenis === 'konten' && (
                  <label className="field" style={{ display: 'block' }}>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Angle video (satu per baris) — ini yang sampai ke Creative sebagai instruksi
                      Brief. Dulu diperingkat AM Co-Pilot dari export; sekarang Anda yang menuliskannya.
                    </span>
                    <textarea
                      rows={2}
                      placeholder="mis. Racun skincare #serum #glowing — konversi tertinggi bulan lalu"
                      value={angleText(r.detail)}
                      disabled={disabled}
                      onChange={(e) => patchRow(r._key, {
                        detail: { ...r.detail, angle_video: parseAngle(e.target.value) },
                      })}
                    />
                  </label>
                )}

                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="btn" disabled={disabled} onClick={() => hapusRow(r._key)}>
                    Hapus baris
                  </button>
                </div>
              </div>
            ))}
          </div>

          {saveError && <div className="alert alertError" style={{ marginTop: 8 }}>{saveError}</div>}
          <div className="row" style={{ marginTop: 8, gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btnPrimary"
              disabled={disabled || saving || siapKirim.length === 0}
              onClick={simpan}
            >
              {saving ? 'Menyimpan…' : `Simpan ${siapKirim.length} pilar`}
            </button>
            {siapKirim.length < rows.length && (
              <span className="muted" style={{ fontSize: 12 }}>
                {rows.length - siapKirim.length} baris tanpa aksi akan dilewati.
              </span>
            )}
          </div>
        </div>
      )}

      {saved && rows.length === 0 && (
        <div className="alert alertInfo" style={{ marginTop: 8 }}>Pilar tersimpan.</div>
      )}
    </div>
  );
}

/** `detail.angle_video` → teks textarea (satu angle per baris). */
export function angleText(detail: Record<string, unknown>): string {
  const raw = detail.angle_video;
  return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').join('\n') : '';
}

/** Teks textarea → `detail.angle_video`, membuang baris kosong. */
export function parseAngle(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter((s) => s !== '');
}
