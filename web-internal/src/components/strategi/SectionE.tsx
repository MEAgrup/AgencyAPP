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
 *   Owner QA 2026-08-20 (Fase 2) retired it as a submit requirement — it is
 *   OPTIONAL now, still editable here.
 *
 * - E-12 (client dependencies during execution) is edited HERE, not in Section
 *   G's UI as an earlier draft of this note claimed. Owner QA 2026-08-20 (Fase 2)
 *   retired it as a submit requirement too, so it is OPTIONAL; it stays under
 *   Section E rather than Section G because that is where the AM edits it. It is
 *   still saved by its own endpoint (`/ketergantungan`), never folded into
 *   `saveKalender`, and each row it does carry is still shape-validated (an item
 *   needs its consequence).
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

/**
 * E-12 — one thing the client must supply while the work is running.
 *
 * All three parts are the point, and `konsekuensi` is what separates this from
 * C-7 (prasyarat klien). C-7 is the gate BEFORE execution starts, and its
 * consequence is fixed: execution does not begin. E-12 runs alongside delivery,
 * where "late" has a different cost every time — which is the field cited when a
 * target is missed. They have separate tables and separate endpoints for exactly
 * this reason; do not reuse the C-7 form here.
 */
export interface KetergantunganDraft {
  item: string;
  /** Free text, not a date — §4's own example is "tiap tgl 1". */
  kapan: string;
  konsekuensi: string;
}

export interface SectionEDraft {
  narasi: NarasiDraft;
  tidak_dikerjakan: OutOfScopeDraft[];
  /** E-12. Saved by `/ketergantungan`, which replaces the whole list. */
  ketergantungan: KetergantunganDraft[];
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
    ketergantungan: d.ketergantungan.map((k) => ({
      item: k.item,
      kapan: k.kapan,
      konsekuensi: k.konsekuensi,
    })),
  };
}

/**
 * Drops rows the AM added and never typed into, keeping any row with something
 * in it so the server's `[ketergantungan klien belum lengkap …]` answers it —
 * the same split `assumptionsToBody` makes, and for the same reason.
 *
 * `urutan` is not sent: `strategiKetergantunganFromWire` falls back to the array
 * index, which is the order on screen. Sending our own copy of the same number
 * would be a second source for one fact.
 */
export function ketergantunganToBody(
  rows: readonly KetergantunganDraft[],
): KetergantunganDraft[] {
  return rows.filter(
    (k) => k.item.trim() !== '' || k.kapan.trim() !== '' || k.konsekuensi.trim() !== '',
  );
}

// ---- Component ------------------------------------------------------------

export default function SectionE({
  detail,
  draft,
  onNarasi,
  onTidakDikerjakan,
  onKetergantungan,
  disabled,
}: {
  detail: StrategiDetail;
  draft: SectionEDraft;
  onNarasi: (patch: Partial<NarasiDraft>) => void;
  onTidakDikerjakan: (rows: OutOfScopeDraft[]) => void;
  onKetergantungan: (rows: KetergantunganDraft[]) => void;
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
        hint="Opsional — catatan anti-scope-creep: yang klien minta tapi bukan bagian kontrak ini. Isi kalau ada; tidak lagi menahan pengajuan."
        rows={draft.tidak_dikerjakan}
        onChange={onTidakDikerjakan}
        blank={() => ({ item: '' })}
        disabled={disabled}
        addLabel="Tambah item out of scope"
        empty="Belum ada item out of scope (opsional)."
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

      {/* E-12 -------------------------------------------------------------- */}
      <RepeatList<KetergantunganDraft>
        label="E-12 · Ketergantungan pada klien (selama eksekusi)"
        hint="Opsional — apa yang klien harus sediakan, kapan, dan konsekuensinya kalau terlambat. Tidak lagi menahan pengajuan, tapi kalau diisi: beda dari C-7 (syarat SEBELUM eksekusi mulai), ini yang berjalan terus, dan `konsekuensi` adalah field yang nanti dikutip saat target meleset — jadi tiap baris yang diisi tetap wajib punya konsekuensi."
        rows={draft.ketergantungan}
        onChange={onKetergantungan}
        blank={() => ({ item: '', kapan: '', konsekuensi: '' })}
        disabled={disabled}
        addLabel="Tambah ketergantungan"
        empty="Belum ada ketergantungan (opsional)."
      >
        {(row, set) => (
          <div className="formRow">
            <label className="field">
              <span className="muted" style={{ fontSize: 12 }}>Yang klien sediakan</span>
              <input
                placeholder="mis. stok hero SKU 2.000 pcs"
                value={row.item}
                disabled={disabled}
                onChange={(e) => set({ item: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="muted" style={{ fontSize: 12 }}>Kapan</span>
              <input
                placeholder="mis. tiap tgl 1"
                value={row.kapan}
                disabled={disabled}
                onChange={(e) => set({ kapan: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="muted" style={{ fontSize: 12 }}>Konsekuensi kalau terlambat</span>
              <input
                placeholder="mis. target GMV bulan itu ditinjau ulang"
                value={row.konsekuensi}
                disabled={disabled}
                onChange={(e) => set({ konsekuensi: e.target.value })}
              />
            </label>
          </div>
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
