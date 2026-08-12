'use client';

/**
 * M6A langkah 8 — the "Buka Strategi" handoff, tab 2 of Kelola Klien.
 *
 * This is the UI half of the Interview → Strategi handoff. It does one thing the
 * rest of the app could not do before: create a Strategi that KNOWS which
 * Interview it came from. The `interview_id` it posts is what the API turns into
 * the link, the Blok D advisory flags, and the Section A prefill — the verdict
 * never blocks (I14), so this card is reachable for any interview.
 *
 * Three states:
 *   - no service         — the Interview isn't tied to a plan-gated Service, so
 *                          there is nothing to hang a Strategi on. Read-only note.
 *   - a Strategi exists   — Rule 2 allows one live Strategi per agreement, so we
 *                          link to it rather than trying (and failing) to make a
 *                          second one.
 *   - none yet + can write — a minimal contract-window form (D2 menu 3/6/12 +
 *                          start date), then `createStrategi({ interview_id })`
 *                          and navigate to the new form.
 *
 * The contract window is required by `createStrategi` (it mints or matches the
 * agreement), so this is a small form, not a bare button — but everything else
 * about Section A arrives prefilled from the Interview.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api';
import { createStrategi, listStrategi, type Strategi, type StrategiStatus } from '@/lib/strategi';

const LIVE_STATUSES: StrategiStatus[] = ['Draft', 'Diajukan', 'Aktif', 'Draft Revisi'];
const DURASI_MENU = [3, 6, 12] as const;

/** today as YYYY-MM-DD in local time (the date input's format). */
function todayLocal(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/** Contract window from a start date + a duration in months (end is inclusive). */
function contractWindow(startISO: string, months: number): { mulai: string; akhir: string } {
  const start = new Date(`${startISO}T00:00:00`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + months);
  end.setDate(end.getDate() - 1);
  const iso = (d: Date): string => {
    const off = d.getTimezoneOffset() * 60_000;
    return new Date(d.getTime() - off).toISOString().slice(0, 10);
  };
  return { mulai: iso(start), akhir: iso(end) };
}

interface Props {
  interviewId: string;
  serviceId: string | null;
  canCreate: boolean;
}

export default function StrategiHandoffCard({ interviewId, serviceId, canCreate }: Props): React.ReactElement {
  const router = useRouter();
  const [existing, setExisting] = useState<Strategi[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [durasi, setDurasi] = useState<number>(6);
  const [mulai, setMulai] = useState<string>(todayLocal());
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!serviceId) {
      setExisting([]);
      return;
    }
    let alive = true;
    listStrategi(serviceId)
      .then((rows) => {
        if (alive) setExisting(rows);
      })
      .catch((err) => {
        if (alive) setLoadError(errorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [serviceId]);

  const live = (existing ?? []).find((s) => LIVE_STATUSES.includes(s.status)) ?? (existing ?? [])[0] ?? null;

  const openStrategi = useCallback(async () => {
    if (!serviceId) return;
    setOpening(true);
    setError(null);
    try {
      const { mulai: tglMulai, akhir } = contractWindow(mulai, durasi);
      const created = await createStrategi(serviceId, {
        durasi_kontrak_bulan: durasi,
        tanggal_mulai_kontrak: tglMulai,
        tanggal_akhir_kontrak: akhir,
        tanggal_mulai_siklus: tglMulai,
        interview_id: interviewId,
      });
      router.push(`/account/strategi/${encodeURIComponent(created.id)}`);
    } catch (err) {
      setError(errorMessage(err));
      setOpening(false);
    }
  }, [serviceId, mulai, durasi, interviewId, router]);

  if (!serviceId) {
    return (
      <div className="card">
        <div className="cardHeader">Strategi</div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Interview ini belum tertaut ke layanan berbayar (plan-gated), jadi Strategi belum bisa dibuka dari sini.
          Buka Strategi dari halaman layanan setelah pembayaran terkonfirmasi.
        </p>
      </div>
    );
  }

  if (existing === null) {
    return (
      <div className="card">
        <div className="cardHeader">Strategi</div>
        <p className="muted" style={{ marginBottom: 0 }}>Memuat…</p>
      </div>
    );
  }

  if (live) {
    return (
      <div className="card">
        <div className="cardHeader">Strategi</div>
        <p style={{ marginTop: 0 }}>
          Strategi untuk layanan ini sudah dibuka: <strong>{live.id}</strong>{' '}
          <span className="muted">({live.status})</span>
          {live.sumber === 'interview' && live.interview_id === interviewId && (
            <span className="badge badge-gray" style={{ marginLeft: 8 }}>
              dari Interview ini
            </span>
          )}
          .
        </p>
        <Link className="btn btnPrimary btnSm" href={`/account/strategi/${encodeURIComponent(live.id)}`}>
          Buka Strategi {live.id}
        </Link>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="cardHeader">Buka Strategi dari Interview ini</div>
      <p className="muted" style={{ marginTop: 0 }}>
        Section A (Konteks Klien) akan terisi otomatis dari jawaban Interview, dan verdict-nya menempel sebagai
        badge advisory di Strategi. Baseline angka (Section B) tetap diisi manual.
      </p>
      {loadError && <div className="alert alertError">{loadError}</div>}
      {error && <div className="alert alertError">{error}</div>}
      {canCreate ? (
        <>
          <div className="grid2">
            <div className="field">
              <label htmlFor="handoff-durasi">Durasi kontrak</label>
              <select
                id="handoff-durasi"
                value={durasi}
                onChange={(e) => setDurasi(Number(e.target.value))}
                disabled={opening}
              >
                {DURASI_MENU.map((m) => (
                  <option key={m} value={m}>
                    {m} bulan
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="handoff-mulai">Tanggal mulai kontrak</label>
              <input
                id="handoff-mulai"
                type="date"
                value={mulai}
                onChange={(e) => setMulai(e.target.value)}
                disabled={opening}
              />
            </div>
          </div>
          <button
            type="button"
            className="btn btnPrimary"
            style={{ marginTop: 12 }}
            disabled={opening || mulai.trim() === ''}
            onClick={openStrategi}
          >
            {opening ? 'Membuka…' : 'Buka Strategi'}
          </button>
        </>
      ) : (
        <p className="muted" style={{ marginBottom: 0 }}>
          Hanya Account Manager pemilik klien (atau Direksi) yang dapat membuka Strategi.
        </p>
      )}
    </div>
  );
}
