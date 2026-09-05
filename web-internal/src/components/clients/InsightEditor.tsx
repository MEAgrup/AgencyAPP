'use client';

/**
 * Editor insight laporan klien (C1 lanjutan) — the narrative fields, and
 * the gate that decides what the client actually reads.
 *
 * ## What is editable here, and what is not
 *
 * The report's NUMBERS are immutable — `client_reports.payload` is frozen by a
 * DB trigger, and nothing on this screen offers to change one. What the AM
 * rewrites is the prose the client reads: the executive summary, the key
 * insights, the two recommendation lists, the outlook and its indicators, and
 * (R3) one paragraph per buyer-journey stage.
 *
 * The stage paragraphs are the reason R3 needed an editor change at all. The
 * stage TABLES are numbers and behave like every other number here — frozen,
 * uneditable, recomputed from the export. The paragraph beside each table is
 * where the AM says what the numbers meant, which is the half of the report the
 * engine cannot write and the client actually reads.
 *
 * ## Why "Simpan" and "Terbitkan" are two buttons
 *
 * Saving appends a revision; the client keeps reading the PINNED revision until
 * someone publishes. That is what makes it safe to save half a thought — and it
 * is why a published report can be edited at all without the client watching the
 * process. `Terbitkan pembaruan` appears only when there is a newer revision
 * than the pinned one, so the button cannot be used to fake an update.
 */
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  TAHAP_OPTIONS,
  canPublishReportUi,
  getReportInsight,
  labelStatusPublikasi,
  publishReport,
  republishReport,
  resetReportInsight,
  revokeReport,
  saveReportInsight,
  STATUS_DICABUT,
  STATUS_TERBIT,
  type Indikator,
  type Rekomendasi,
  type TahapKey,
  type TahapNarasi,
  type ReportInsight,
  type ReportInsightBundle,
} from '@/lib/report';

/** Blank rows the editor renders so there is always somewhere to type. */
const REK_KOSONG: Rekomendasi = { judul: '', target: '', dampak: '', timeline: '' };
const IND_KOSONG: Indikator = { nama: '', target: '' };

/** The three stages, in funnel order — the order the report renders them in. */
const TAHAP_URUT = TAHAP_OPTIONS.filter((o) => o.value !== '') as Array<{ value: TahapKey; label: string }>;

function statusTone(status: string): string {
  if (status === STATUS_TERBIT) return 'badge badgeSuccess';
  if (status === STATUS_DICABUT) return 'badge badgeDanger';
  return 'badge badgeWarning';
}

/** A list editor over plain strings (key insights). */
function PoinEditor({
  value, disabled, onChange,
}: { value: string[]; disabled: boolean; onChange: (v: string[]) => void }) {
  const rows = [...value, ''];
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.map((t, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <span className="muted" style={{ fontSize: 12, paddingTop: 8, minWidth: 18 }}>{i + 1}.</span>
          <textarea
            rows={2}
            value={t}
            disabled={disabled}
            placeholder={i === value.length ? 'Tambah poin…' : ''}
            style={{ flex: 1, fontSize: 13 }}
            onChange={(e) => {
              const next = [...value];
              if (i === value.length) next.push(e.target.value);
              else next[i] = e.target.value;
              onChange(next.filter((x, idx) => x.trim() !== '' || idx < next.length - 1));
            }}
          />
          {i < value.length && (
            <button
              type="button" className="btn btnGhost btnSm" disabled={disabled}
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            >hapus</button>
          )}
        </div>
      ))}
    </div>
  );
}

/** A list editor over recommendation cards. All four fields or none — the server
 *  refuses a half-filled card, because a recommendation without a target or a
 *  timeline is not actionable and the client would read a half-written order. */
function RekEditor({
  value, disabled, onChange,
}: { value: Rekomendasi[]; disabled: boolean; onChange: (v: Rekomendasi[]) => void }) {
  const rows = [...value, REK_KOSONG];
  const set = (i: number, patch: Partial<Rekomendasi>) => {
    const next = [...value];
    if (i === value.length) next.push({ ...REK_KOSONG, ...patch });
    else next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ border: '1px solid var(--line, #DAE2EA)', borderRadius: 4, padding: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <input value={r.judul} disabled={disabled} placeholder="Judul"
              onChange={(e) => set(i, { judul: e.target.value })} style={{ fontSize: 13 }} />
            <input value={r.timeline} disabled={disabled} placeholder="Timeline (mis. 2 minggu)"
              onChange={(e) => set(i, { timeline: e.target.value })} style={{ fontSize: 13 }} />
            <input value={r.target} disabled={disabled} placeholder="Target"
              onChange={(e) => set(i, { target: e.target.value })} style={{ fontSize: 13 }} />
            <input value={r.dampak} disabled={disabled} placeholder="Dampak"
              onChange={(e) => set(i, { dampak: e.target.value })} style={{ fontSize: 13 }} />
          </div>
          {i < value.length && (
            <button type="button" className="btn btnGhost btnSm" disabled={disabled}
              style={{ marginTop: 6 }}
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            >hapus rekomendasi</button>
          )}
        </div>
      ))}
    </div>
  );
}

function IndEditor({
  value, disabled, onChange,
}: { value: Indikator[]; disabled: boolean; onChange: (v: Indikator[]) => void }) {
  const rows = [...value, IND_KOSONG];
  const set = (i: number, patch: Partial<Indikator>) => {
    const next = [...value];
    if (i === value.length) next.push({ ...IND_KOSONG, ...patch });
    else next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.map((m, i) => (
        <div key={i} style={{ display: 'flex', gap: 6 }}>
          <input value={m.nama} disabled={disabled} placeholder="Nama indikator"
            onChange={(e) => set(i, { nama: e.target.value })} style={{ flex: 1, fontSize: 13 }} />
          <input value={m.target} disabled={disabled} placeholder="Target"
            onChange={(e) => set(i, { target: e.target.value })} style={{ flex: 1, fontSize: 13 }} />
          {i < value.length && (
            <button type="button" className="btn btnGhost btnSm" disabled={disabled}
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            >hapus</button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * One paragraph per stage.
 *
 * Renders a fixed row per stage rather than a list with an "add" button: there
 * are exactly three stages and no fourth is possible, so an add/remove UI would
 * only offer ways to produce a draft the server refuses. A stage left blank is
 * simply dropped on save — that is how an AM removes a paragraph.
 */
function TahapEditor({
  value, disabled, onChange,
}: { value: TahapNarasi[]; disabled: boolean; onChange: (v: TahapNarasi[]) => void }) {
  const setOne = (tahap: TahapKey, patch: Partial<TahapNarasi>) => {
    const lain = value.filter((n) => n.tahap !== tahap);
    const kini = value.find((n) => n.tahap === tahap) ?? { tahap, judul: '', teks: '' };
    const baru = { ...kini, ...patch };
    // Order is normalised on the server too; keeping it here as well means the
    // form never renders the stages in a different order than the report does.
    onChange([...lain, baru].sort(
      (a, b) => TAHAP_URUT.findIndex((t) => t.value === a.tahap) - TAHAP_URUT.findIndex((t) => t.value === b.tahap)));
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      {TAHAP_URUT.map((t) => {
        const n = value.find((x) => x.tahap === t.value) ?? { tahap: t.value, judul: '', teks: '' };
        return (
          <div key={t.value} className="stack" style={{ gap: 6, borderLeft: '3px solid var(--border)', paddingLeft: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{t.label}</div>
            <input value={n.judul} disabled={disabled} placeholder="Judul paragraf (mis. Apa yang berhasil di tahap ini)"
              onChange={(e) => setOne(t.value, { judul: e.target.value })} style={{ fontSize: 13 }} />
            <textarea rows={3} value={n.teks} disabled={disabled}
              placeholder="Kosongkan bila tahap ini tidak perlu diberi catatan"
              onChange={(e) => setOne(t.value, { teks: e.target.value })} style={{ fontSize: 13 }} />
          </div>
        );
      })}
    </div>
  );
}

export default function InsightEditor({ reportId, onPublikasiChange }: {
  reportId: number;
  /** Lets the parent list refresh its status badge without a full reload. */
  onPublikasiChange?: () => void;
}) {
  const { role } = useAuth();
  const bolehTulis = canPublishReportUi(role);

  const [bundle, setBundle] = useState<ReportInsightBundle | null>(null);
  const [draft, setDraft] = useState<ReportInsight | null>(null);
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const b = await getReportInsight(reportId);
      setBundle(b);
      // The editor always opens on the LATEST revision — that is what pressing
      // "Terbitkan" would send, so it is the only honest thing to show.
      setDraft(b.terbaru.insight);
      setErr(null);
    } catch (e) {
      setErr(errorMessage(e));
    }
  }, [reportId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, pesan: string) => {
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      await fn();
      await load();
      setInfo(pesan);
      onPublikasiChange?.();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (err && !bundle) return <div className="alert alertError" style={{ fontSize: 13 }}>{err}</div>;
  if (!bundle || !draft) return <div className="muted" style={{ fontSize: 13 }}>Memuat insight…</div>;

  const pub = bundle.publikasi;
  const terbit = pub.status === STATUS_TERBIT;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={statusTone(pub.status)}>{labelStatusPublikasi(pub.status)}</span>
        {pub.insight_revisi !== null && (
          <span className="muted" style={{ fontSize: 12 }}>
            Klien membaca revisi {pub.insight_revisi} · revisi terakhir {bundle.terbaru.revisi}
          </span>
        )}
        {bundle.ada_perubahan_belum_terbit && (
          <span className="badge badgeWarning">Ada suntingan yang belum diterbitkan</span>
        )}
      </div>

      {pub.status === STATUS_DICABUT && pub.alasan_cabut && (
        <div className="alert alertWarning" style={{ fontSize: 13 }}>
          Dicabut: {pub.alasan_cabut}
        </div>
      )}

      {err && <div className="alert alertError" style={{ fontSize: 13 }}>{err}</div>}
      {info && <div className="alert alertSuccess" style={{ fontSize: 13 }}>{info}</div>}

      <div className="note" style={{ fontSize: 12 }}>
        Yang bisa disunting di sini hanya <strong>teks insight dan saran</strong>. Angka
        laporan (GMV, ROAS, skor, tabel funnel, metrik per tahap) berasal dari berkas
        export dan tidak bisa diubah — kalau angkanya salah, buat laporan baru dari
        berkas yang benar.
      </div>

      <div className="field">
        <label>Ringkasan Eksekutif</label>
        <textarea rows={3} value={draft.ringkasan} disabled={!bolehTulis || busy}
          onChange={(e) => setDraft({ ...draft, ringkasan: e.target.value })} style={{ fontSize: 13 }} />
      </div>

      <div className="field">
        <label>Key Insights</label>
        <PoinEditor value={draft.poin} disabled={!bolehTulis || busy}
          onChange={(poin) => setDraft({ ...draft, poin })} />
      </div>

      <div className="field">
        <label>Rekomendasi — Prioritas Tinggi</label>
        <RekEditor value={draft.rekomendasi_tinggi} disabled={!bolehTulis || busy}
          onChange={(v) => setDraft({ ...draft, rekomendasi_tinggi: v })} />
      </div>

      <div className="field">
        <label>Rekomendasi — Prioritas Sedang</label>
        <RekEditor value={draft.rekomendasi_sedang} disabled={!bolehTulis || busy}
          onChange={(v) => setDraft({ ...draft, rekomendasi_sedang: v })} />
      </div>

      <div className="field">
        <label>Outlook Periode Berikutnya</label>
        <textarea rows={3} value={draft.outlook} disabled={!bolehTulis || busy}
          onChange={(e) => setDraft({ ...draft, outlook: e.target.value })} style={{ fontSize: 13 }} />
      </div>

      <div className="field">
        <label>Indikator</label>
        <IndEditor value={draft.indikator} disabled={!bolehTulis || busy}
          onChange={(v) => setDraft({ ...draft, indikator: v })} />
      </div>

      <div className="field">
        <label>Narasi per Tahap (Awareness / Consideration / Conversion)</label>
        <TahapEditor value={draft.tahap_narasi} disabled={!bolehTulis || busy}
          onChange={(v) => setDraft({ ...draft, tahap_narasi: v })} />
      </div>

      {bolehTulis && (
        <>
          <div className="field">
            <label>Catatan revisi (opsional — kenapa disunting)</label>
            <input value={catatan} disabled={busy} placeholder="mis. konteks kampanye Ramadan"
              onChange={(e) => setCatatan(e.target.value)} style={{ fontSize: 13 }} />
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btnPrimary btnSm" disabled={busy}
              onClick={() => run(
                () => saveReportInsight(reportId, draft, catatan || null).then(() => setCatatan('')),
                'Draf insight disimpan. Klien belum melihatnya — tekan Terbitkan bila sudah siap.',
              )}
            >{busy ? 'Menyimpan…' : 'Simpan draf insight'}</button>

            <button type="button" className="btn btnGhost btnSm" disabled={busy}
              title="Menyalin insight mesin sebagai revisi baru; suntingan Anda tetap tersimpan di riwayat"
              onClick={() => run(() => resetReportInsight(reportId), 'Dikembalikan ke insight mesin.')}
            >Kembalikan ke insight mesin</button>

            {!terbit && (
              <button type="button" className="btn btnPrimary btnSm" disabled={busy}
                onClick={() => run(() => publishReport(reportId), 'Laporan diterbitkan — klien bisa membacanya di portal.')}
              >Terbitkan ke klien</button>
            )}

            {terbit && bundle.ada_perubahan_belum_terbit && (
              <button type="button" className="btn btnPrimary btnSm" disabled={busy}
                onClick={() => run(() => republishReport(reportId), 'Pembaruan diterbitkan — klien kini membaca revisi terbaru.')}
              >Terbitkan pembaruan</button>
            )}

            {terbit && (
              <button type="button" className="btn btnGhost btnSm" disabled={busy}
                onClick={() => {
                  const alasan = window.prompt('Alasan pencabutan (wajib — klien akan bertanya):');
                  if (alasan === null) return;
                  void run(() => revokeReport(reportId, alasan), 'Laporan dicabut dari portal klien.');
                }}
              >Cabut dari klien</button>
            )}
          </div>
        </>
      )}

      {!bolehTulis && (
        <div className="muted" style={{ fontSize: 12 }}>
          Anda bisa membaca insight ini, tapi tidak menyuntingnya atau menerbitkannya.
        </div>
      )}
    </div>
  );
}
