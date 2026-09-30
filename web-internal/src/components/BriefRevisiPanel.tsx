'use client';

// BRIEF-KEMBALI-SIKLUS (Improvement Req Account butir 1, pemilik 2026-09-30).
// Brief yang dikembalikan divisi (Cek Brief AM → "Dikembalikan") bisa direvisi
// AM lalu dikirim ulang — satu form, satu aksi (`POST /briefs/{id}/kirim-ulang`).
// Hanya field yang benar-benar diubah yang dikirim; server menolak AM yang bukan
// pemilik klien dengan pesan BI (tombolnya tidak disembunyikan diam-diam).

import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api';
import type { Brief } from '@/lib/brief';
import { kirimUlangBrief, type KirimUlangInput } from '@/lib/stage';

const PRIORITIES = ['Low', 'Medium', 'High'];

export default function BriefRevisiPanel({
  brief,
  alasan,
  catatanDivisi,
  onResent,
}: {
  brief: Brief;
  /** alasan_kode putaran terakhir, bila ada. */
  alasan?: string | null;
  catatanDivisi?: string;
  onResent: () => void;
}) {
  const [title, setTitle] = useState(brief.title);
  const [instructions, setInstructions] = useState(brief.instructions ?? '');
  const [reference, setReference] = useState(brief.reference_attachments ?? '');
  const [dueDate, setDueDate] = useState(brief.due_date);
  const [quantity, setQuantity] = useState(String(brief.quantity_target));
  const [priority, setPriority] = useState(brief.priority);
  const [tanggalMulai, setTanggalMulai] = useState(brief.tanggal_mulai);
  const [tanggalAkhir, setTanggalAkhir] = useState(brief.tanggal_akhir);
  const [budget, setBudget] = useState(brief.budget ?? '');
  const [catatan, setCatatan] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (catatan.trim() === '') {
      setError('[catatan revisi wajib diisi]');
      return;
    }
    const input: KirimUlangInput = { catatan: catatan.trim() };
    if (title !== brief.title) input.title = title;
    if (instructions !== (brief.instructions ?? '')) input.instructions = instructions;
    if (reference !== (brief.reference_attachments ?? '')) input.reference_attachments = reference;
    if (dueDate !== brief.due_date) input.due_date = dueDate;
    if (Number(quantity) !== brief.quantity_target) input.quantity_target = Number(quantity);
    if (priority !== brief.priority) input.priority = priority;
    if (tanggalMulai !== brief.tanggal_mulai) input.tanggal_mulai = tanggalMulai;
    if (tanggalAkhir !== brief.tanggal_akhir) input.tanggal_akhir = tanggalAkhir;
    if (budget !== (brief.budget ?? '')) input.budget = budget === '' ? null : budget;
    if (!window.confirm('Kirim ulang brief ini ke divisi?')) return;
    setError(null);
    setSubmitting(true);
    try {
      await kirimUlangBrief(brief.id, input);
      setCatatan('');
      onResent();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card" id="revisi">
      <div className="cardHeader">
        <h2>Revisi &amp; Kirim Ulang Brief</h2>
        <span className="badge badge-red">Hold</span>
      </div>
      <div className="alert alertError" role="status">
        Brief ini dikembalikan divisi {brief.assigned_division}
        {alasan ? ` — alasan: ${alasan}` : ''}.
        {catatanDivisi && <div className="muted">Catatan divisi: {catatanDivisi}</div>}
        <div className="muted">Perbaiki isi brief bila perlu, tulis catatan revisi, lalu kirim ulang.</div>
      </div>
      {error && <div className="alert alertError" role="alert">{error}</div>}
      <form className="stack" style={{ gap: 10 }} onSubmit={handleSubmit}>
        <div className="field">
          <label>Judul *</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>Instruksi</label>
          <textarea className="input" rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </div>
        <div className="field">
          <label>Referensi / Lampiran (link)</label>
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div className="grid2">
          <div className="field">
            <label>Due Date *</label>
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Quantity / Target *</label>
            <input className="input" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="field">
            <label>Prioritas *</label>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Budget (Rp)</label>
            <input className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
          <div className="field">
            <label>Tanggal Mulai</label>
            <input className="input" type="date" value={tanggalMulai} onChange={(e) => setTanggalMulai(e.target.value)} />
          </div>
          <div className="field">
            <label>Tanggal Akhir</label>
            <input className="input" type="date" value={tanggalAkhir} onChange={(e) => setTanggalAkhir(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Catatan revisi untuk divisi *</label>
          <textarea
            className="input"
            rows={3}
            placeholder="Contoh: sampel sudah dikirim ke studio, brief dilengkapi referensi video."
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button type="submit" className="btn btnPrimary" disabled={submitting}>
            {submitting ? 'Mengirim...' : 'Kirim Ulang Brief'}
          </button>
        </div>
      </form>
    </section>
  );
}
