'use client';

/**
 * Panel **"Pilar Strategi belum jadi baris kerja"** — Plan periode 1 (B5).
 *
 * KENAPA ADA. Sejak B5, `generatePlanPeriods` menyemai baris P-C langsung dari
 * Section E untuk lima jenis pilar yang punya satu divisi pemilik. Tiga jenis
 * sisanya TIDAK disemai, dan itu keputusan pemilik, bukan kelalaian: pilar
 * `sku`/`harga` diberikan ke **AI Optimizer atau Store Operation dan AM yang
 * memilih** (2026-09-06), dan `retensi` belum diketok sama sekali. Dua keadaan
 * lain juga menahan semai: target yang tak menyebut angka (baris ber-kuota nol
 * tak pernah jadi Brief — `brief-inherit.ts` melewatinya) dan pilar lintas
 * channel pada Strategi multi-channel.
 *
 * Tanpa panel ini, ketiganya HILANG dari layar: AM tidak punya cara tahu bahwa
 * Section E-nya memuat pekerjaan yang belum punya baris. Jadi panel ini bukan
 * hiasan — ia yang membuat "tidak disemai" tetap terlihat sebagai pekerjaan
 * yang tersisa, bukan sebagai data yang menguap.
 *
 * NOL ENDPOINT BARU. Pilar dibaca dari `GET /strategi/{id}` yang sudah ada,
 * baris dibuat lewat `POST /plan/{id}/rows` (`createPlanRow`) yang sudah ada.
 * Aturan pemetaannya dibaca dari `plan-row-suggest.ts` — cermin
 * `packages/core/src/planpillar.ts`, mesin yang sama yang menyemai di server.
 */

import { useMemo, useState } from 'react';
import { createPlanRow, type PlanRow } from '@/lib/plan';
import type { StrategiPillar } from '@/lib/strategi';
import { DIVISI_KERJA } from '@/lib/divisions';
import {
  ALASAN_LABEL,
  PILAR_LABEL,
  kandidatDivisi,
  kekuranganPilar,
  type KekuranganPilar,
} from '@/lib/plan-row-suggest';

interface Draft {
  divisiPic: string;
  channel: string;
  kuota: string;
  satuan: string;
}

function draftAwal(k: KekuranganPilar): Draft {
  return {
    divisiPic: k.divisiPic ?? '',
    channel: k.channel ?? '',
    kuota: k.kuota === null ? '' : String(k.kuota),
    satuan: k.satuan,
  };
}

export default function PilarBelumJadiBaris({
  planId,
  pillars,
  rows,
  channelStrategi,
  channelOptions,
  disabled,
  onCreated,
}: {
  planId: string;
  pillars: StrategiPillar[];
  rows: PlanRow[];
  /** B-0.1 channel yang dikontrak Strategi — penentu "lintas channel yang tak ambigu". */
  channelStrategi: string[];
  /** Channel yang sudah muncul di periode ini (target/baris), untuk dropdown. */
  channelOptions: string[];
  disabled: boolean;
  onCreated: () => Promise<void> | void;
}) {
  const kurang = useMemo(
    () => kekuranganPilar(pillars, rows, channelStrategi),
    [pillars, rows, channelStrategi],
  );
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const kandidat = useMemo(() => kandidatDivisi(DIVISI_KERJA), []);
  const channelPilihan = useMemo(
    () => [...new Set([...channelStrategi, ...channelOptions])],
    [channelStrategi, channelOptions],
  );

  if (kurang.length === 0) return null;

  const draftOf = (k: KekuranganPilar): Draft => drafts[k.pillar.id] ?? draftAwal(k);
  const setDraft = (id: number, patch: Partial<Draft>, awal: Draft) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? awal), ...patch } }));

  async function buat(k: KekuranganPilar) {
    const d = draftOf(k);
    const kuota = Number(d.kuota);
    if (d.divisiPic.trim() === '' || d.channel.trim() === '' || !Number.isFinite(kuota) || kuota <= 0) {
      setError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
      return;
    }
    setBusy(k.pillar.id);
    setError(null);
    try {
      await createPlanRow(planId, {
        channel: d.channel.trim(),
        pilar: k.pillar.jenis,
        strategi_pillar_id: k.pillar.id,
        aksi: (k.pillar.aksi ?? '').trim(),
        sku_sasaran: (k.pillar.sku ?? '').trim() ? [(k.pillar.sku ?? '').trim()] : [],
        kuota,
        satuan: d.satuan.trim(),
        divisi_pic: d.divisiPic.trim(),
        hasil_diharapkan: (k.pillar.target ?? '').trim(),
      });
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Pilar Strategi belum jadi baris kerja ({kurang.length})</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Pilar Section E di bawah ini <strong>tidak</strong> disemai otomatis karena ada kolom
        wajib baris P-C yang hanya bisa kamu putuskan. Lengkapi lalu tekan{' '}
        <strong>Buat baris</strong> — baris yang jadi tetap tertaut ke pilarnya, jadi tidak
        terhitung sebagai pekerjaan di luar Strategi.
      </p>
      {error && (
        <div className="alert alertError" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>Pilar</th>
            <th>Aksi &amp; target (E)</th>
            <th>Yang kurang</th>
            <th>Divisi PIC</th>
            <th>Channel</th>
            <th>Kuota</th>
            <th>Satuan</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {kurang.map((k) => {
            const awal = draftAwal(k);
            const d = draftOf(k);
            const perluDivisi = k.alasan.includes('butuh_divisi');
            const perluChannel = k.alasan.includes('butuh_channel');
            const perluKuota = k.alasan.includes('butuh_kuota');
            return (
              <tr key={k.pillar.id}>
                <td>
                  {PILAR_LABEL[k.pillar.jenis] ?? k.pillar.jenis}
                  <div className="muted" style={{ fontSize: 11 }}>#{k.pillar.id}</div>
                </td>
                <td style={{ maxWidth: 280 }}>
                  {(k.pillar.aksi ?? '').trim() || <span className="muted">—</span>}
                  <div className="muted" style={{ fontSize: 11 }}>
                    {(k.pillar.target ?? '').trim() || '—'}
                  </div>
                </td>
                <td className="muted" style={{ fontSize: 11 }}>
                  {k.alasan.map((a) => ALASAN_LABEL[a] ?? a).join(' · ')}
                </td>
                <td>
                  {perluDivisi ? (
                    <select
                      value={d.divisiPic}
                      disabled={disabled}
                      onChange={(e) => setDraft(k.pillar.id, { divisiPic: e.target.value }, awal)}
                    >
                      <option value="">— pilih —</option>
                      {kandidat.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  ) : (
                    d.divisiPic
                  )}
                </td>
                <td>
                  {perluChannel ? (
                    <select
                      value={d.channel}
                      disabled={disabled}
                      onChange={(e) => setDraft(k.pillar.id, { channel: e.target.value }, awal)}
                    >
                      <option value="">— pilih —</option>
                      {channelPilihan.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  ) : (
                    d.channel
                  )}
                </td>
                <td>
                  {perluKuota ? (
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      style={{ width: 90 }}
                      value={d.kuota}
                      disabled={disabled}
                      onChange={(e) => setDraft(k.pillar.id, { kuota: e.target.value }, awal)}
                    />
                  ) : (
                    d.kuota
                  )}
                </td>
                <td>
                  <input
                    style={{ width: 90 }}
                    value={d.satuan}
                    disabled={disabled}
                    onChange={(e) => setDraft(k.pillar.id, { satuan: e.target.value }, awal)}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btnSm"
                    disabled={disabled || busy === k.pillar.id}
                    onClick={() => buat(k)}
                  >
                    {busy === k.pillar.id ? 'Membuat…' : 'Buat baris'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
