'use client';

/**
 * RAB-08 — the store identity & baseline the sales stage already captured
 * (`clients`, the post-closing snapshot of `qualified_forms`). The interview no
 * longer re-collects any of this; it shows it, read-only, so the AM can see what
 * is known and correct it at the source (the client record) rather than through a
 * duplicate box here. These fields are NOT scored interview inputs — money
 * baselines flow to Strategi (RAB-11), not Blok C.
 */

import Link from 'next/link';
import type { Client } from '@/lib/clients';

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div>{value && value.trim() !== '' ? value : '—'}</div>
    </div>
  );
}

export default function SalesContextCard({ client }: { client: Client | null }) {
  if (!client) return null;
  return (
    <section className="card">
      <div className="cardHeader">
        <span>Data dari Sales (sudah diketahui)</span>
        <Link href={`/clients/${client.id}`} className="btn btnGhost btnSm">
          Koreksi di Client Record →
        </Link>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Identitas & baseline toko dari tahap closing. Interview tidak menanyakan ulang — koreksi lewat Client Record
        bila berbeda.
      </p>
      <div className="grid2">
        <Row label="Nama PIC" value={client.nama_pic} />
        <Row label="Toko" value={client.toko} />
        <Row label="Kota" value={client.kota} />
        <Row label="Kategori" value={client.kategori} />
        <Row label="GMV baseline" value={client.gmv_baseline} />
        <Row label="Target GMV" value={client.target_gmv} />
        <Row label="Marketing budget" value={client.marketing_budget} />
        <Row label="Link toko" value={client.link_toko} />
      </div>
    </section>
  );
}
