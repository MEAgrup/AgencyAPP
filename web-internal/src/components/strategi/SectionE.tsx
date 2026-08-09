'use client';

/**
 * A-13b — Section E (Strategi Inti).
 *
 * **What is here vs what is elsewhere:**
 *
 * - E-1 (growth thesis) and E-13 (execution order rationale) are on the header
 *   row and saved via the narasi endpoint — the same endpoint H-3/H-4 use.
 *   Saving Section E sends all four fields, so H-3/H-4 must be passed in and
 *   echoed back unchanged.
 *
 * - E-2 (channel priority) is on the channel row and is saved via Section B's
 *   `saveStrategiChannels` call. Section E shows the declared priorities read-
 *   only so the AM can see the rationale alongside the thesis.
 *
 * - E-3…E-10 (pillar strategy per activity type) are complex rich structs saved
 *   via `saveStrategiPillars`. Full per-pillar editing is out of scope for
 *   A-13b; a summary is shown for context.
 *
 * - E-11 (out-of-scope list) is stored as pillars of type `tidak_dikerjakan`.
 *   Rule 9 requires at least one entry, so it is editable here.
 *
 * - E-12 (client dependencies during execution) lives in Section G's UI and is
 *   saved via `/ketergantungan`.
 */

import RepeatList from './RepeatList';
import { PRIORITAS_LABELS, type StrategiDetail } from '@/lib/strategi';

// ---- Draft types ----------------------------------------------------------

/** E-11 — items the AM has explicitly declared out of scope. */
export interface OutOfScopeDraft {
  /** Maps to `StrategiPillar.aksi` for kind=`tidak_dikerjakan`. */
  item: string;
}

/**
 * Section E narasi — shares the same `/narasi` endpoint with Section H.
 *
 * This draft sits on the page level as `drafts.narasi`, replacing the former
 * `narasiH` (which only held H-3/H-4). Both sections read from and write to
 * the same object; each section only renders the fields it owns.
 */
export interface NarasiDraft {
  growth_thesis: string;
  urutan_eksekusi_alasan: string;
  skenario_mundur: string;
  kondisi_stop_scope: string;
}

export interface SectionEDraft {
  narasi: NarasiDraft;
  tidak_dikerjakan: OutOfScopeDraft[];
}

export function sectionEDraftOf(d: StrategiDetail): SectionEDraft {
  return {
    narasi: {
      growth_thesis: d.growth_thesis ?? '',
      urutan_eksekusi_alasan: d.urutan_eksekusi_alasan ?? '',
      skenario_mundur: d.skenario_mundur ?? '',
      kondisi_stop_scope: d.kondisi_stop_scope ?? '',
    },
    tidak_dikerjakan: d.pillars
      .filter((p) => p.jenis === 'tidak_dikerjakan')
      .map((p) => ({ item: p.aksi })),
  };
}

// ---- Component ------------------------------------------------------------

export default function SectionE({
  detail,
  draft,
  onNarasi,
  onTidakDikerjakan,
  disabled,
}: {
  detail: StrategiDetail;
  draft: SectionEDraft;
  onNarasi: (patch: Partial<NarasiDraft>) => void;
  onTidakDikerjakan: (rows: OutOfScopeDraft[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="stack">
      {/* E-1 --------------------------------------------------------------- */}
      <label className="field" style={{ display: 'block' }}>
        <span style={{ fontWeight: 600 }}>E-1 · Growth Thesis</span>
        <span className="muted" style={{ fontSize: 12, display: 'block' }}>
          Satu paragraf: &ldquo;Toko ini tumbuh dengan cara X, karena Y, dan yang paling menentukan
          adalah Z.&rdquo;
        </span>
        <textarea
          rows={4}
          value={draft.narasi.growth_thesis}
          disabled={disabled}
          onChange={(e) => onNarasi({ growth_thesis: e.target.value })}
        />
      </label>

      {/* E-2 read-only display -------------------------------------------- */}
      {detail.channels.length > 0 && (
        <div className="card">
          <div className="cardHeader">E-2 · Prioritas Channel</div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Diset di Section B untuk setiap channel. Edit di sana untuk mengubah prioritas atau
            alasannya.
          </p>
          <table style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Channel</th>
                <th style={{ textAlign: 'left' }}>Prioritas</th>
                <th style={{ textAlign: 'left' }}>Alasan</th>
              </tr>
            </thead>
            <tbody>
              {detail.channels.map((c) => (
                <tr key={c.id}>
                  <td>{c.channel}</td>
                  <td>
                    {c.prioritas
                      ? (PRIORITAS_LABELS.find((p) => p.value === c.prioritas)?.label ?? c.prioritas)
                      : <span className="muted">belum diset</span>}
                  </td>
                  <td>
                    {c.prioritas_alasan ?? <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* E-11 -------------------------------------------------------------- */}
      <RepeatList<OutOfScopeDraft>
        label="E-11 · Yang TIDAK Dikerjakan (out of scope eksplisit)"
        hint="Minimal satu entri wajib ada (Rule 9). Ini catatan anti-scope-creep — yang klien minta tapi bukan bagian kontrak ini."
        rows={draft.tidak_dikerjakan}
        min={1}
        onChange={onTidakDikerjakan}
        blank={() => ({ item: '' })}
        disabled={disabled}
        addLabel="Tambah item out of scope"
        empty="Belum ada — minimal satu wajib diisi."
      >
        {(row, set) => (
          <input
            placeholder="Apa yang tidak dikerjakan dan kenapa bukan bagian scope"
            value={row.item}
            disabled={disabled}
            onChange={(e) => set({ item: e.target.value })}
          />
        )}
      </RepeatList>

      {/* E-13 -------------------------------------------------------------- */}
      <label className="field" style={{ display: 'block' }}>
        <span style={{ fontWeight: 600 }}>E-13 · Urutan Eksekusi</span>
        <span className="muted" style={{ fontSize: 12, display: 'block' }}>
          Kenapa pilar A didahulukan dari pilar B? Urutan pilar itu sendiri diset di tiap baris
          pilar; ini adalah alasannya.
        </span>
        <textarea
          rows={3}
          value={draft.narasi.urutan_eksekusi_alasan}
          disabled={disabled}
          onChange={(e) => onNarasi({ urutan_eksekusi_alasan: e.target.value })}
        />
      </label>

      {/* Pillar summary (E-3…E-10) ---------------------------------------- */}
      {detail.pillars.filter((p) => p.jenis !== 'tidak_dikerjakan').length > 0 && (
        <div className="card">
          <div className="cardHeader">E-3…E-10 · Pilar Strategi</div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Editor pilar detail (SKU, Harga, Iklan, Konten, Affiliate, Live, Retensi, Operasional)
            tersedia di versi berikutnya. Pilar yang sudah tersimpan:
          </p>
          <table style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Jenis</th>
                <th style={{ textAlign: 'left' }}>Channel</th>
                <th style={{ textAlign: 'left' }}>Aksi / ringkasan</th>
              </tr>
            </thead>
            <tbody>
              {detail.pillars
                .filter((p) => p.jenis !== 'tidak_dikerjakan')
                .map((p) => (
                  <tr key={p.id}>
                    <td>{p.jenis}</td>
                    <td>{p.channel ?? '—'}</td>
                    <td style={{ maxWidth: 300 }}>{p.aksi}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
