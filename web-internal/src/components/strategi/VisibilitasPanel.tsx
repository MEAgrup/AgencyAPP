'use client';

/**
 * A-13d — the "Visibilitas klien" panel (M6A §4.1, Rule 16).
 *
 * The Strategi is a client-facing document by default; §4.1 is the list of
 * exceptions, and Rule 16 gives the AM a switch over part of it. This is that
 * switch.
 *
 * ## Three shapes that come from the PRD, not from taste
 *
 * 1. **Scoped to the active section.** The overlay is ~116 rows. Rendered as one
 *    list it is a wall nobody reads, and a control nobody reads is a control
 *    that gets clicked wrong. Chaptering it the way the form is already
 *    chaptered means the AM decides about Section A's fields while looking at
 *    Section A's answers.
 *
 * 2. **A locked row is SHOWN, not hidden.** Rule 16(a) fields have no switch,
 *    and hiding them would leave "kenapa klien tidak lihat riwayat agensi?" a
 *    question with no answer on screen. They render greyed with an explicit
 *    "tidak pernah dibagikan", which is the answer.
 *
 * 3. **One field per click, no autosave.** Rule 16(b) requires the toggle
 *    audit-logged, and the log exists to answer *who decided the client could
 *    see the margin figure*. Riding the 20-second autosave would post the whole
 *    overlay and write "116 field berubah" into that log — technically a record,
 *    practically an erasure. Each click is its own request and its own row.
 *
 * ## The tier is never computed here
 *
 * `tier` and `dapat_diubah` arrive from the server, derived from
 * `packages/core/src/visibility.ts` — the single home of the §4.1 map that §7
 * enforces twice (TS predicate + DB CHECK). This component reads them. A local
 * copy would be the copy most likely to forget a hard-internal field, and that
 * is a leak rather than a rendering bug.
 */

import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { setStrategiFieldVisibility, type StrategiFieldVisibility } from '@/lib/strategi';
import { sectionLabel, type SectionKey } from '@/lib/strategi-sections';
import {
  fieldLabel,
  groupVisibilitas,
  isDiubah,
  isDibagikan,
  nextVisibilitas,
  ringkasVisibilitas,
  tierLabel,
  unreachableSections,
} from '@/lib/strategi-visibilitas';

export default function VisibilitasPanel({
  strategiId,
  rows,
  active,
  reachable,
  disabled,
  onChanged,
}: {
  strategiId: string;
  rows: StrategiFieldVisibility[];
  active: SectionKey;
  /** The sections the nav actually lets an AM open — see `unreachableSections`. */
  reachable: readonly SectionKey[];
  disabled: boolean;
  /** Receives the WHOLE overlay the server returns, not just the row clicked. */
  onChanged: (rows: StrategiFieldVisibility[]) => void;
}) {
  // Keyed by field ID rather than a single boolean: two clicks in different rows
  // must not make each other's row look busy, and the disabled state has to land
  // on the row the AM actually pressed.
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grouped = groupVisibilitas(rows);
  const mine = grouped.get(active) ?? [];
  const ringkas = ringkasVisibilitas(mine);
  const buntu = unreachableSections(rows, reachable);

  const toggle = async (row: StrategiFieldVisibility) => {
    setPending(row.field_id);
    setError(null);
    try {
      const res = await setStrategiFieldVisibility(
        strategiId,
        row.field_id,
        nextVisibilitas(row.visibilitas),
      );
      onChanged(res.visibilitas);
    } catch (err) {
      // The server's message is the one that names the field and the rule; a
      // generic "gagal" here would send the AM looking for a permission problem
      // they do not have.
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="card">
      <div className="cardHeader">
        Visibilitas klien{' '}
        <span className="badge badge-green">{ringkas.dibagikan} dibagikan</span>{' '}
        {ringkas.terkunci > 0 && (
          <span className="badge badge-amber">{ringkas.terkunci} terkunci</span>
        )}
      </div>

      <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
        Strategi adalah dokumen untuk klien secara default; daftar ini adalah
        pengecualiannya (§4.1). Klien melihat {ringkas.dibagikan} dari {ringkas.total} field di
        seksi ini.
        {ringkas.diubah > 0 && ` ${ringkas.diubah} di antaranya sudah diubah dari default.`}
      </p>

      {error && <div className="alert alertError">{error}</div>}

      {mine.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          Tidak ada field bertier di seksi ini.
        </p>
      ) : (
        <div className="stack" style={{ gap: 4 }}>
          {mine.map((row) => {
            const dibagikan = isDibagikan(row);
            const locked = !row.dapat_diubah;
            return (
              <div
                key={row.field_id}
                className="row"
                style={{
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 0',
                  opacity: locked ? 0.6 : 1,
                }}
              >
                <code style={{ minWidth: 52 }}>{row.field_id}</code>
                <span style={{ flex: 1, fontSize: 13 }}>
                  {fieldLabel(row.field_id)}
                  {isDiubah(row) && (
                    <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                      diubah {row.diubah_oleh}
                    </span>
                  )}
                </span>
                <span className="muted" style={{ fontSize: 11 }} title={row.tier}>
                  {tierLabel(row.tier)}
                </span>
                {locked ? (
                  // Rule 16(a): no switch exists for these, by anyone, ever. The
                  // row stays visible so the AM can see the field is covered.
                  <span className="badge badge-gray" title="Rule 16(a) — tidak pernah bisa dibagikan">
                    Internal Saja
                  </span>
                ) : (
                  <button
                    type="button"
                    className={dibagikan ? 'btn btnSecondary btnSm' : 'btn btnGhost btnSm'}
                    disabled={disabled || pending === row.field_id}
                    onClick={() => void toggle(row)}
                    title={
                      disabled
                        ? 'Visibilitas tidak dapat diubah pada versi ini'
                        : dibagikan
                          ? 'Klik untuk menyembunyikan dari klien'
                          : 'Klik untuk membagikan ke klien'
                    }
                  >
                    {pending === row.field_id ? '…' : row.visibilitas}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {buntu.length > 0 && (
        // Not decoration: these are fields with a switch and no way to reach it.
        // Saying so is the difference between a known gap and an invisible one.
        <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
          Belum terjangkau (form seksinya belum dibuat):{' '}
          {buntu.map((k) => sectionLabel(k)).join(' · ')}.
        </p>
      )}
    </div>
  );
}
